import { describe, expect, it } from 'vitest'
import { PlanReviewGate, pluginReloadedWhileReviewingError, type ReviewFrame } from '../src/review-gate.ts'

const REVIEW = { id: 'd1', path: '/repo/docs/plans/p.md', title: 'The plan' }

/** Map captured frames to their status, keeping an explicit null as null. */
function statusesOf(frames: ReviewFrame[]): Array<'pending' | 'approved' | 'kept' | 'cancelled' | null> {
  return frames.map(frame => frame.review === null ? null : frame.review?.status ?? null)
}

describe('PlanReviewGate.begin/decide', () => {
  it('resolves approve and records the settled state', async () => {
    const gate = new PlanReviewGate()
    const frames: ReviewFrame[] = []
    const detach = gate.attach('s1', frame => frames.push(frame))
    const parked = gate.begin('s1', REVIEW)
    expect(gate.peek('s1')).toMatchObject({ id: 'd1', status: 'pending' })
    const settled = gate.decide('s1', 'approve')
    await expect(parked).resolves.toBe('approve')
    expect(settled).toMatchObject({ id: 'd1', status: 'approved' })
    expect(statusesOf(frames)).toEqual([null, 'pending', 'approved'])
    detach()
  })

  it('rejects keep planning with the popup flow wording and forwards feedback', async () => {
    const gate = new PlanReviewGate()
    const parked = gate.begin('s1', REVIEW)
    gate.decide('s1', 'keep', '  consider the resume path  ')
    await expect(parked).rejects.toThrow('The user chose to keep planning; their feedback: consider the resume path')
    expect(gate.peek('s1')).toBeNull()
  })

  it('keep planning without feedback uses the generic corrective error', async () => {
    const gate = new PlanReviewGate()
    const parked = gate.begin('s1', REVIEW)
    gate.decide('s1', 'keep')
    await expect(parked).rejects.toThrow('The user chose to keep planning; revise the plan file and present it again.')
  })

  it('returns undefined when deciding with nothing pending', () => {
    const gate = new PlanReviewGate()
    expect(gate.decide('s1', 'approve')).toBeUndefined()
    expect(gate.peek('s1')).toBeNull()
  })

  it('a stale click on a superseded delivery id is visible through peek', () => {
    const gate = new PlanReviewGate()
    gate.begin('s1', { id: 'd1', path: '/old.md', title: 'Old' }).catch(() => {
      // Superseded rejection is asserted in the dedicated test below; this
      // test only reads the peek face.
    })
    gate.begin('s1', { id: 'd2', path: '/new.md', title: 'New' })
    expect(gate.peek('s1')?.id).toBe('d2')
  })

  it('begin supersedes a stray pending review instead of leaking it', async () => {
    const gate = new PlanReviewGate()
    const first = gate.begin('s1', { id: 'd1', path: '/old.md', title: 'Old' })
    const second = gate.begin('s1', REVIEW)
    await expect(first).rejects.toThrow('a newer plan delivery superseded the pending review')
    gate.decide('s1', 'approve')
    await expect(second).resolves.toBe('approve')
  })
})

describe('PlanReviewGate abort and disposal', () => {
  it('an aborted tool call settles the review as cancelled and rejects with the abort reason', async () => {
    const gate = new PlanReviewGate()
    const frames: ReviewFrame[] = []
    gate.attach('s1', frame => frames.push(frame))
    const controller = new AbortController()
    const parked = gate.begin('s1', REVIEW, controller.signal)
    controller.abort(new Error('user stopped the turn'))
    await expect(parked).rejects.toThrow('user stopped the turn')
    expect(gate.peek('s1')).toBeNull()
    expect(statusesOf(frames)).toEqual([null, 'pending', 'cancelled'])
  })

  it('an abort after the decision is a no-op', async () => {
    const gate = new PlanReviewGate()
    const controller = new AbortController()
    const parked = gate.begin('s1', REVIEW, controller.signal)
    gate.decide('s1', 'approve')
    await expect(parked).resolves.toBe('approve')
    controller.abort()
    await expect(parked).resolves.toBe('approve')
  })

  it('dispose rejects pending reviews with the reload error and clears the views', async () => {
    const gate = new PlanReviewGate()
    const parked = gate.begin('s1', REVIEW)
    const frames: ReviewFrame[] = []
    gate.attach('s1', frame => frames.push(frame))
    gate.dispose()
    await expect(parked).rejects.toThrow(pluginReloadedWhileReviewingError().message)
    expect(gate.peek('s1')).toBeNull()
    expect(frames.at(-1)?.review?.status).toBe('cancelled')
  })
})

describe('PlanReviewGate attach replay', () => {
  it('replays the latest state on attach, including a pending review', () => {
    const gate = new PlanReviewGate()
    gate.begin('s1', REVIEW)
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
    const detach = gate.attach('s1', frame => first.push(frame))
    gate.attach('s1', frame => second.push(frame))
    gate.begin('s1', REVIEW)
    detach()
    gate.decide('s1', 'approve')
    expect(statusesOf(first)).toEqual([null, 'pending'])
    expect(statusesOf(second)).toEqual([null, 'pending', 'approved'])
  })
})
