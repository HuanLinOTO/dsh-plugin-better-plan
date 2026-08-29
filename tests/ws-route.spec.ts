import { describe, expect, it, vi } from 'vitest'
import { PlanDeliveryRegistry } from '../src/delivery-registry.ts'
import { PlanReviewGate } from '../src/review-gate.ts'
import { LocaleDirectory } from '../src/locale.ts'
import { DELIVERY_WS_PATH, attachDeliverySocket, type DeliverySocket } from '../src/ws-route.ts'

const NO_HANDLERS = { onApprove: () => {}, onKeep: () => {}, onDelegate: () => {} }

/** A minimal fake socket capturing sends and lifecycle callbacks. */
function fakeSocket(): DeliverySocket & { sent: string[]; closeCalls: Array<[number?, string?]>; emitClose(): void } {
  const sent: string[] = []
  const closeCalls: Array<[number?, string?]> = []
  const listeners: Array<() => void> = []
  return {
    sent,
    closeCalls,
    send: (data: string) => { sent.push(data) },
    close: (code?: number, reason?: string) => { closeCalls.push([code, reason]) },
    on: (_event: 'close' | 'error', listener: () => void) => { listeners.push(listener) },
    emitClose: () => { for (const listener of listeners) listener() },
  }
}

describe('attachDeliverySocket', () => {
  it('rejects a socket without a session query', () => {
    const registry = new PlanDeliveryRegistry()
    const gate = new PlanReviewGate()
    const ws = fakeSocket()
    attachDeliverySocket(registry, gate, ws, { url: '/better-plan/ws/delivery', headers: {} }, new LocaleDirectory())
    expect(ws.closeCalls).toEqual([[1008, 'session is required']])
  })

  it('records the view-reported locale for the session', () => {
    const registry = new PlanDeliveryRegistry()
    const gate = new PlanReviewGate()
    const directory = new LocaleDirectory()
    const ws = fakeSocket()
    attachDeliverySocket(registry, gate, ws, { url: `${DELIVERY_WS_PATH}?session=s1&locale=zh-CN`, headers: {} }, directory)
    expect(directory.known('s1')).toBe('zh')
    // An unsupported tag leaves the directory untouched (no throw either way).
    const ws2 = fakeSocket()
    attachDeliverySocket(registry, gate, ws2, { url: `${DELIVERY_WS_PATH}?session=s2&locale=xx`, headers: {} }, directory)
    expect(directory.known('s2')).toBeUndefined()
  })

  it('attaches by ?session= and receives tagged deliver pushes for that session', () => {
    const registry = new PlanDeliveryRegistry()
    const gate = new PlanReviewGate()
    const ws = fakeSocket()
    attachDeliverySocket(registry, gate, ws, { url: `${DELIVERY_WS_PATH}?session=s1`, headers: {} }, new LocaleDirectory())
    registry.enqueue('s1', '/p.md', 'Title')
    const frames = ws.sent.map(frame => JSON.parse(frame))
    expect(frames.find(frame => frame.kind === 'deliver')).toMatchObject({ kind: 'deliver', path: '/p.md', title: 'Title' })
    // The review snapshot (null here) rides along on attach.
    expect(frames.find(frame => frame.kind === 'review')).toEqual({ kind: 'review', review: null })
  })

  it('replays queued deliveries plus the pending review on attach, and detaches on close', () => {
    const registry = new PlanDeliveryRegistry()
    const gate = new PlanReviewGate()
    registry.enqueue('s1', '/p1.md', 'One')
    gate.begin('s1', { id: 'd1', path: '/p1.md', title: 'One' }, NO_HANDLERS)
    const ws = fakeSocket()
    attachDeliverySocket(registry, gate, ws, { url: `${DELIVERY_WS_PATH}?session=s1`, headers: {} }, new LocaleDirectory())
    const frames = ws.sent.map(frame => JSON.parse(frame))
    expect(frames.filter(frame => frame.kind === 'deliver').map(frame => frame.path)).toEqual(['/p1.md'])
    expect(frames.filter(frame => frame.kind === 'review')).toEqual([
      { kind: 'review', review: { id: 'd1', path: '/p1.md', title: 'One', status: 'pending' } },
    ])
    // A settled decision broadcasts to the attached view…
    gate.decide('s1', 'approve')
    expect(JSON.parse(ws.sent.at(-1) ?? '{}')).toMatchObject({ kind: 'review', review: { status: 'approved' } })
    // …and after close, later pushes queue instead of hitting a dead socket.
    ws.emitClose()
    registry.enqueue('s1', '/p2.md', 'Two')
    expect(ws.sent.filter(frame => JSON.parse(frame).kind === 'deliver')).toHaveLength(1)
    // A fresh view receives the queued delivery and the settled review.
    const ws2 = fakeSocket()
    attachDeliverySocket(registry, gate, ws2, { url: `${DELIVERY_WS_PATH}?session=s1`, headers: {} }, new LocaleDirectory())
    const frames2 = ws2.sent.map(frame => JSON.parse(frame))
    expect(frames2.filter(frame => frame.kind === 'deliver').map(frame => frame.path)).toEqual(['/p2.md'])
    expect(frames2.filter(frame => frame.kind === 'review').at(-1)?.review?.status).toBe('approved')
  })

  it('detaches on socket error too', () => {
    const registry = new PlanDeliveryRegistry()
    const gate = new PlanReviewGate()
    const ws = fakeSocket()
    const detach = vi.spyOn(registry, 'attach')
    attachDeliverySocket(registry, gate, ws, { url: `${DELIVERY_WS_PATH}?session=s1`, headers: {} }, new LocaleDirectory())
    expect(detach).toHaveBeenCalledOnce()
    // Simulate the error listener: after detach, neither registry reaches the
    // dead socket (the review parks invisibly, like the delivery would queue).
    ws.emitClose()
    const before = ws.sent.length
    gate.begin('s1', { id: 'd1', path: '/p.md', title: 'T' }, NO_HANDLERS)
    expect(ws.sent.length).toBe(before)
  })
})
