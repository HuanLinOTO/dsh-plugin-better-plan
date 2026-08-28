import { describe, expect, it, vi } from 'vitest'
import { TAB_ID, applyDeliveryPush } from '../../src/client/index.tsx'

/** A mock better-sidebar service face (only the methods the push flow uses). */
function fakeService(features?: readonly string[]) {
  const calls: { method: string; args: unknown[] }[] = []
  return {
    calls,
    openTab: vi.fn((...args: unknown[]) => { calls.push({ method: 'openTab', args }) }),
    updateTab: vi.fn((...args: unknown[]) => { calls.push({ method: 'updateTab', args }) }),
    activateTab: vi.fn((...args: unknown[]) => { calls.push({ method: 'activateTab', args }) }),
    features,
  }
}

describe('applyDeliveryPush (WS push → tab open/update/activate sequence)', () => {
  it('opens the single Plan tab with the path seed and meta, then updates and activates (v0.12+ service)', () => {
    const service = fakeService(['updateTab', 'openFile'])
    applyDeliveryPush(service as never, { id: 'd1', path: '/repo/docs/plans/p.md', title: 'The plan' }, 's1')
    expect(service.openTab).toHaveBeenCalledExactlyOnceWith(
      {
        type: TAB_ID,
        id: TAB_ID,
        path: '/repo/docs/plans/p.md',
        title: 'The plan',
        meta: { path: '/repo/docs/plans/p.md', deliveredAt: expect.any(Number) },
      },
      { sessionId: 's1' },
    )
    expect(service.updateTab).toHaveBeenCalledExactlyOnceWith(
      TAB_ID,
      {
        title: 'The plan',
        path: '/repo/docs/plans/p.md',
        meta: { path: '/repo/docs/plans/p.md', deliveredAt: expect.any(Number) },
      },
    )
    expect(service.activateTab).toHaveBeenCalledExactlyOnceWith(TAB_ID, { sessionId: 's1' })
    expect(service.calls.map(call => call.method)).toEqual(['openTab', 'updateTab', 'activateTab'])
  })

  it('skips updateTab/activateTab on a pre-0.12 service (features absent) — openTab dedupe still lands', () => {
    const service = fakeService(undefined)
    applyDeliveryPush(service as never, { path: '/p.md', title: 'T' }, 's1')
    expect(service.calls.map(call => call.method)).toEqual(['openTab'])
  })

  it('omits an empty/missing title from both the seed and the update patch', () => {
    const service = fakeService(['updateTab'])
    applyDeliveryPush(service as never, { path: '/p.md' }, 's1')
    expect(service.openTab).toHaveBeenCalledExactlyOnceWith(
      { type: TAB_ID, id: TAB_ID, path: '/p.md', title: undefined, meta: { path: '/p.md', deliveredAt: expect.any(Number) } },
      { sessionId: 's1' },
    )
    expect(service.updateTab).toHaveBeenCalledExactlyOnceWith(
      TAB_ID,
      { path: '/p.md', meta: { path: '/p.md', deliveredAt: expect.any(Number) } },
    )
  })

  it('ignores malformed pushes', () => {
    const service = fakeService(['updateTab'])
    for (const payload of [null, undefined, 5, 'x', {}, { path: '' }, { path: 42 }]) {
      applyDeliveryPush(service as never, payload, 's1')
    }
    expect(service.calls).toEqual([])
  })
})
