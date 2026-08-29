import { describe, expect, it, vi } from 'vitest'
import { TAB_ID, applyDeliveryFrame, applyDeliveryPush } from '../../src/client/index.tsx'
import { ReviewStore } from '../../src/client/review-store.ts'

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

describe('applyDeliveryFrame (tagged WS frame routing)', () => {
  it('routes deliver frames through the tab open/update/activate sequence', () => {
    const service = fakeService(['updateTab'])
    applyDeliveryFrame(service as never, new ReviewStore(), { kind: 'deliver', id: 'd1', path: '/p.md', title: 'T' }, 's1')
    expect(service.calls.map(call => call.method)).toEqual(['openTab', 'updateTab', 'activateTab'])
  })

  it('routes review frames into the review store, null clearing it', () => {
    const service = fakeService(['updateTab'])
    const store = new ReviewStore()
    applyDeliveryFrame(service as never, store, { kind: 'review', review: { id: 'd1', path: '/p.md', title: 'T', status: 'pending' } }, 's1')
    expect(store.get()).toMatchObject({ id: 'd1', status: 'pending' })
    applyDeliveryFrame(service as never, store, { kind: 'review', review: null }, 's1')
    expect(store.get()).toBeNull()
    expect(service.calls).toEqual([])
  })

  it('drops malformed review states and unknown frames', () => {
    const service = fakeService(['updateTab'])
    const store = new ReviewStore()
    store.set({ id: 'd1', path: '/p.md', title: 'T', status: 'pending' })
    for (const frame of [
      { kind: 'review', review: { id: 'd1' } },
      { kind: 'review' },
      { kind: 'mystery' },
      null,
      'x',
      5,
    ]) {
      applyDeliveryFrame(service as never, store, frame, 's1')
    }
    expect(store.get()).toMatchObject({ status: 'pending' })
    expect(service.calls).toEqual([])
  })
})
