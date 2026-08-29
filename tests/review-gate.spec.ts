import { describe, expect, it, vi } from 'vitest'
import { PlanReviewGate, type ReviewFrame, type ReviewHandlers } from '../src/review-gate.ts'

const REVIEW = { id: 'd1', path: '/repo/docs/plans/p.md', title: 'The plan' }

/** Map captured frames to their status, keeping an explicit null as null. */
function statusesOf(
  frames: ReviewFrame[],
): Array<'pending' | 'approved' | 'delegated' | 'kept' | 'cancelled' | null> {
  return frames.map(frame => frame.review === null ? null : frame.review?.status ?? null)
}

/** Spied handlers recording which decisions fired. */
function spyHandlers(): ReviewHandlers & {
  approvals: number
  keeps: Array<string | undefined>
  delegations: number
} {
  const handlers = {
    approvals: 0,
    keeps: [] as Array<string | undefined>,
    delegations: 0,
    onApprove: vi.fn(() => { handlers.approvals += 1 }),
    onKeep: vi.fn((feedback: string | undefined) => { handlers.keeps.push(feedback) }),
    onDelegate: vi.fn(() => { handlers.delegations += 1 }),
  }
  return handlers
}

describe('PlanReviewGate.begin/decide', () => {
  it('records the pending review, then fires onApprove and broadcasts the settled state', () => {
    const gate = new PlanReviewGate()
    const frames: ReviewFrame[] = []
    const handlers = spyHandlers()
    gate.attach('s1', frame => frames.push(frame))
    gate.begin('s1', REVIEW, handlers)
    expect(gate.peek('s1')).toMatchObject({ id: 'd1', status: 'pending' })
    expect(handlers.approvals).toBe(0)
    const settled = gate.decide('s1', 'approve')
    expect(settled).toMatchObject({ id: 'd1', status: 'approved' })
    expect(handlers.approvals).toBe(1)
    expect(statusesOf(frames)).toEqual([null, 'pending', 'approved'])
  })

  it('keep planning fires onKeep with the trimmed feedback', () => {
    const gate = new PlanReviewGate()
    const handlers = spyHandlers()
    gate.begin('s1', REVIEW, handlers)
    gate.decide('s1', 'keep', '  consider the resume path  ')
    expect(handlers.keeps).toEqual(['consider the resume path'])
    expect(gate.peek('s1')).toBeNull()
  })

  it('keep planning without feedback hands undefined to onKeep', () => {
    const gate = new PlanReviewGate()
    const handlers = spyHandlers()
    gate.begin('s1', REVIEW, handlers)
    gate.decide('s1', 'keep')
    expect(handlers.keeps).toEqual([undefined])
  })

  it('approve_new_session settles as delegated and fires onDelegate', () => {
    const gate = new PlanReviewGate()
    const frames: ReviewFrame[] = []
    const handlers = spyHandlers()
    gate.begin('s1', REVIEW, handlers)
    gate.attach('s1', frame => frames.push(frame))
    const settled = gate.decide('s1', 'approve_new_session')
    expect(settled).toMatchObject({ id: 'd1', status: 'delegated' })
    expect(handlers.delegations).toBe(1)
    expect(handlers.approvals).toBe(0)
    expect(gate.peek('s1')).toBeNull()
    // The attach replay carried the pending state; the decide broadcast the
    // delegated settlement.
    expect(statusesOf(frames)).toEqual(['pending', 'delegated'])
  })

  it('returns undefined and stays silent when deciding with nothing pending', () => {
    const gate = new PlanReviewGate()
    const handlers = spyHandlers()
    expect(gate.decide('s1', 'approve')).toBeUndefined()
    expect(handlers.approvals).toBe(0)
    expect(gate.peek('s1')).toBeNull()
  })

  it('a newer delivery supersedes the pending review and its handlers never fire', () => {
    const gate = new PlanReviewGate()
    const first = spyHandlers()
    const second = spyHandlers()
    gate.begin('s1', { id: 'd1', path: '/old.md', title: 'Old' }, first)
    gate.begin('s1', { id: 'd2', path: '/new.md', title: 'New' }, second)
    expect(gate.peek('s1')?.id).toBe('d2')
    // A click on the superseded delivery id is refused by the route's stale
    // guard; the gate itself settles by session key, so only the newest
    // handlers can ever fire.
    gate.decide('s1', 'approve')
    expect(second.approvals).toBe(1)
    expect(first.approvals).toBe(0)
  })
})

describe('PlanReviewGate disposal', () => {
  it('dispose settles pending reviews as cancelled and never fires handlers', () => {
    const gate = new PlanReviewGate()
    const handlers = spyHandlers()
    const frames: ReviewFrame[] = []
    gate.begin('s1', REVIEW, handlers)
    gate.attach('s1', frame => frames.push(frame))
    gate.dispose()
    expect(gate.peek('s1')).toBeNull()
    expect(handlers.approvals).toBe(0)
    expect(handlers.keeps).toEqual([])
    expect(frames.at(-1)?.review?.status).toBe('cancelled')
  })
})

describe('PlanReviewGate attach replay', () => {
  it('replays the latest state on attach, including a pending review', () => {
    const gate = new PlanReviewGate()
    gate.begin('s1', REVIEW, spyHandlers())
    const frames: ReviewFrame[] = []
    gate.attach('s1', frame => frames.push(frame))
    expect(frames).toEqual([{ kind: 'review', review: { ...REVIEW, status: 'pending' } }])
  })

  it('a session with no review history clears a stale bar with a null frame', () => {
    const gate = new PlanReviewGate()
    const frames: ReviewFrame[] = []
    gate.attach('s1', frame => frames.push(frame))
    expect(frames).toEqual([{ kind: 'review', review: null }])
  })

  it('broadcasts decisions to every attached view and stops after detach', () => {
    const gate = new PlanReviewGate()
    const first: ReviewFrame[] = []
    const second: ReviewFrame[] = []
    const handlers = spyHandlers()
    const detach = gate.attach('s1', frame => first.push(frame))
    gate.attach('s1', frame => second.push(frame))
    gate.begin('s1', REVIEW, handlers)
    detach()
    gate.decide('s1', 'approve')
    expect(statusesOf(first)).toEqual([null, 'pending'])
    expect(statusesOf(second)).toEqual([null, 'pending', 'approved'])
  })
})
