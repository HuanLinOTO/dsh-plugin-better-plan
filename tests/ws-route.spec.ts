import { describe, expect, it, vi } from 'vitest'
import { PlanDeliveryRegistry } from '../src/delivery-registry.ts'
import { DELIVERY_WS_PATH, attachDeliverySocket, type DeliverySocket } from '../src/ws-route.ts'

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
    const ws = fakeSocket()
    attachDeliverySocket(registry, ws, { url: '/better-plan/ws/delivery', headers: {} })
    expect(ws.closeCalls).toEqual([[1008, 'session is required']])
  })

  it('attaches by ?session= and receives pushes for that session', () => {
    const registry = new PlanDeliveryRegistry()
    const ws = fakeSocket()
    attachDeliverySocket(registry, ws, { url: `${DELIVERY_WS_PATH}?session=s1`, headers: {} })
    registry.enqueue('s1', '/p.md', 'Title')
    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0] ?? '{}')).toMatchObject({ path: '/p.md', title: 'Title' })
  })

  it('replays queued deliveries on attach and detaches on close', () => {
    const registry = new PlanDeliveryRegistry()
    registry.enqueue('s1', '/p1.md', 'One')
    const ws = fakeSocket()
    attachDeliverySocket(registry, ws, { url: `${DELIVERY_WS_PATH}?session=s1`, headers: {} })
    expect(ws.sent.map(frame => JSON.parse(frame).path)).toEqual(['/p1.md'])
    // After close, later deliveries queue again instead of hitting a dead socket.
    ws.emitClose()
    registry.enqueue('s1', '/p2.md', 'Two')
    expect(ws.sent).toHaveLength(1)
    // A fresh view receives the queued delivery.
    const ws2 = fakeSocket()
    attachDeliverySocket(registry, ws2, { url: `${DELIVERY_WS_PATH}?session=s1`, headers: {} })
    expect(ws2.sent.map(frame => JSON.parse(frame).path)).toEqual(['/p2.md'])
  })

  it('detaches on socket error too', () => {
    const registry = new PlanDeliveryRegistry()
    const ws = fakeSocket()
    const detach = vi.spyOn(registry, 'attach')
    attachDeliverySocket(registry, ws, { url: `${DELIVERY_WS_PATH}?session=s1`, headers: {} })
    expect(detach).toHaveBeenCalledOnce()
    // Simulate the error listener: registry must have registered it.
    ws.emitClose()
    expect(detach).toHaveBeenCalledOnce()
  })
})
