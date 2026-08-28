import { describe, expect, it, vi } from 'vitest'
import { DELIVERY_QUEUE_LIMIT, PlanDeliveryRegistry } from '../src/delivery-registry.ts'

describe('PlanDeliveryRegistry', () => {
  it('queues when no view is attached and reports undelivered', () => {
    const registry = new PlanDeliveryRegistry()
    const result = registry.enqueue('s1', '/repo/docs/plans/p.md', 'Title')
    expect(result.delivered).toBe(false)
  })

  it('delivers immediately and clears the queue when a view is attached (consume-on-send)', () => {
    const registry = new PlanDeliveryRegistry()
    const seen: unknown[] = []
    const detach = registry.attach('s1', d => seen.push(d))
    const result = registry.enqueue('s1', '/p.md', 'Title')
    expect(result.delivered).toBe(true)
    expect(seen).toHaveLength(1)
    // The queue is drained: a reconnect must not replay an applied delivery.
    const detach2 = registry.attach('s1', () => {})
    expect(seen).toHaveLength(1)
    detach2()
    detach()
  })

  it('replays queued deliveries on attach, oldest first', () => {
    const registry = new PlanDeliveryRegistry()
    registry.enqueue('s1', '/p1.md', 'One')
    registry.enqueue('s1', '/p2.md', 'Two')
    const seen: string[] = []
    registry.attach('s1', d => seen.push(d.path))
    expect(seen).toEqual(['/p1.md', '/p2.md'])
  })

  it('keeps sessions isolated', () => {
    const registry = new PlanDeliveryRegistry()
    registry.enqueue('s1', '/p1.md', 'One')
    const seen: string[] = []
    registry.attach('s2', d => seen.push(d.path))
    expect(seen).toEqual([])
    registry.enqueue('s2', '/p2.md', 'Two')
    expect(seen).toEqual(['/p2.md'])
  })

  it('fans one delivery out to every attached view', () => {
    const registry = new PlanDeliveryRegistry()
    const seenA: string[] = []
    const seenB: string[] = []
    registry.attach('s1', d => seenA.push(d.path))
    registry.attach('s1', d => seenB.push(d.path))
    registry.enqueue('s1', '/p.md', 'T')
    expect(seenA).toEqual(['/p.md'])
    expect(seenB).toEqual(['/p.md'])
  })

  it('drops the oldest queued delivery beyond the per-session limit', () => {
    const registry = new PlanDeliveryRegistry()
    for (let index = 0; index < DELIVERY_QUEUE_LIMIT + 2; index++) {
      registry.enqueue('s1', `/p${index}.md`, `T${index}`)
    }
    const seen: string[] = []
    registry.attach('s1', d => seen.push(d.path))
    expect(seen).toHaveLength(DELIVERY_QUEUE_LIMIT)
    expect(seen[0]).toBe('/p2.md')
    expect(seen.at(-1)).toBe(`/p${DELIVERY_QUEUE_LIMIT + 1}.md`)
  })

  it('detaching the last view of a session frees it for later attaches', () => {
    const registry = new PlanDeliveryRegistry()
    const detach = registry.attach('s1', () => {})
    detach()
    const seen: unknown[] = []
    registry.attach('s1', d => seen.push(d))
    registry.enqueue('s1', '/p.md', 'T')
    expect(seen).toHaveLength(1)
  })

  it('drainAll drops every queued delivery', () => {
    const registry = new PlanDeliveryRegistry()
    registry.enqueue('s1', '/p.md', 'T')
    registry.drainAll()
    const seen: unknown[] = []
    registry.attach('s1', d => seen.push(d))
    expect(seen).toEqual([])
  })

  it('dispose drops queues and subscribers', () => {
    const registry = new PlanDeliveryRegistry()
    const seen = vi.fn()
    registry.attach('s1', seen)
    registry.dispose()
    registry.enqueue('s1', '/p.md', 'T')
    expect(seen).not.toHaveBeenCalled()
  })
})
