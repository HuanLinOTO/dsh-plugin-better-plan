// @vitest-environment jsdom
/**
 * PlanView component spec (jsdom): load / error / retry over the sidebar
 * fs.read route, the meta-path preference, and the review action bar (the
 * sidebar approval surface — decisions POST to the host review route). DSH's
 * MarkdownText is mocked (its rendering is upstream's contract; the
 * dual-shape label props have their own spec) so this test isolates
 * PlanView's fetch lifecycle and review wiring.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PlanView, planPathOf } from '../../src/client/PlanView.tsx'
import type { TabComponentProps } from 'dsh-better-sidebar/client/service'
import { REVIEW_API_PATH, reviewStore } from '../../src/client/review-store.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  MarkdownText: (props: { text?: string }) => createElement('div', { 'data-testid': 'markdown' }, props.text),
  writeClipboard: vi.fn(),
}))

function fetchResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as unknown as Response
}

function tabProps(overrides: Partial<TabComponentProps> = {}): TabComponentProps {
  return {
    ctx: {
      get: (name: string) => (name === 'betterSidebar'
        ? { features: ['updateTab', 'openFile'], openFile: vi.fn() }
        : undefined),
    } as unknown as TabComponentProps['ctx'],
    store: {} as never,
    scope: { sessionId: 's1', cwd: '/repo' },
    tab: { id: 'better-plan:plan', type: 'better-plan:plan', title: 'The plan', path: '/repo/fallback.md', meta: { path: '/repo/meta.md' } } as never,
    visible: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  reviewStore.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('planPathOf', () => {
  it('prefers meta.path and falls back to the tab path', () => {
    expect(planPathOf({ meta: { path: '/meta.md' }, path: '/tab.md' } as never)).toBe('/meta.md')
    expect(planPathOf({ path: '/tab.md' } as never)).toBe('/tab.md')
    expect(planPathOf({ meta: {}, path: '' } as never)).toBeUndefined()
  })
})

describe('PlanView', () => {
  /** Route mocks by URL: the review bootstrap (GET) answers separately from fs.read. */
  function stubUrlFetch(fsReadResponses: unknown[], reviewResponse: unknown = { ok: true, review: null }): ReturnType<typeof vi.fn> {
    let readIndex = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).startsWith(REVIEW_API_PATH)) return Promise.resolve(fetchResponse(reviewResponse))
      const body = fsReadResponses[Math.min(readIndex, fsReadResponses.length - 1)]
      readIndex += 1
      return Promise.resolve(fetchResponse(body))
    })
    vi.mocked(fetch).mockImplementation(fetchMock as never)
    return fetchMock
  }

  it('renders the fetched plan through MarkdownText with the session-scoped fs.read', async () => {
    const fetchMock = stubUrlFetch([{ ok: true, value: { kind: 'text', content: '# The plan\n\nbody', truncated: false } }])
    render(createElement(PlanView, tabProps()))
    await waitFor(() => {
      expect(screen.getByTestId('markdown')).toBeDefined()
      expect(screen.getByTestId('markdown').textContent).toBe('# The plan\n\nbody')
    })
    const [url, init] = vi.mocked(fetch).mock.calls.find(([candidate]) => candidate === '/sidebar/api/fs.read') as [string, RequestInit]
    expect(url).toBe('/sidebar/api/fs.read')
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: 's1', path: '/repo/meta.md' })
    expect(screen.getByText('The plan')).toBeDefined()
    expect(screen.getByText('/repo/meta.md')).toBeDefined()
    expect(screen.getByText('Open in editor')).toBeDefined()
    // The review bootstrap rode along and found nothing pending.
    expect(reviewStore.get()).toBeNull()
    expect(fetchMock).toHaveBeenCalled()
  })

  it('shows the error state with a working retry', async () => {
    const fetchMock = stubUrlFetch([
      { ok: false, error: { code: 'fs-error', message: 'boom' } },
      { ok: true, value: { kind: 'text', content: '# Recovered', truncated: false } },
    ])
    render(createElement(PlanView, tabProps()))
    expect(await screen.findByText('Failed to read the plan: boom')).toBeDefined()
    expect(screen.queryByTestId('markdown')).toBeNull()
    screen.getByText('Retry').click()
    await waitFor(() => {
      expect(screen.getByTestId('markdown').textContent).toBe('# Recovered')
    })
    expect(fetchMock).toHaveBeenCalledTimes(3) // bootstrap + read + retry read
  })

  it('flags a binary read result as a review-in-editor case', async () => {
    vi.mocked(fetch).mockResolvedValue(fetchResponse({ ok: true, value: { kind: 'binary', size: 10, truncated: false, head: '' } }) as never)
    render(createElement(PlanView, tabProps()))
    expect(await screen.findByText('Failed to read the plan: the plan file is binary; review it in the editor instead')).toBeDefined()
  })

  it('hides the editor action when the service lacks the openFile feature', async () => {
    vi.mocked(fetch).mockResolvedValue(fetchResponse({ ok: true, value: { kind: 'text', content: '# Hi', truncated: false } }))
    render(createElement(PlanView, tabProps({
      ctx: { get: () => ({ features: [] }) } as unknown as TabComponentProps['ctx'],
    })))
    await screen.findByTestId('markdown')
    expect(screen.queryByText('Open in editor')).toBeNull()
    expect(screen.getByText('Copy path')).toBeDefined()
  })
})

describe('PlanView review action bar (the sidebar approval surface)', () => {
  /** Stub fetch for the fs.read endpoint and both review verbs (GET bootstrap + POST decision). */
  function stubReviewFetch(reviewResponse: unknown, ok = true): void {
    vi.mocked(fetch).mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(REVIEW_API_PATH)) return Promise.resolve(fetchResponse(reviewResponse, ok))
      return Promise.resolve(fetchResponse({ ok: true, value: { kind: 'text', content: '# The plan', truncated: false } }))
    }) as never)
  }

  it('shows no bar without review state', async () => {
    stubReviewFetch({})
    render(createElement(PlanView, tabProps()))
    await screen.findByTestId('markdown')
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Keep planning')).toBeNull()
  })

  it('the HTTP bootstrap fills the bar when no WS frame arrived', async () => {
    stubReviewFetch({ ok: true, review: { id: 'r9', path: '/repo/meta.md', title: 'The plan', status: 'pending' } })
    render(createElement(PlanView, tabProps()))
    expect(await screen.findByText(/Review this plan here/)).toBeDefined()
    expect(reviewStore.get()?.id).toBe('r9')
  })

  it('the bootstrap never clears a live pending bar with a late null', async () => {
    reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    stubReviewFetch({ ok: true, review: null })
    render(createElement(PlanView, tabProps()))
    await screen.findByText(/Review this plan here/)
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith(REVIEW_API_PATH))).toBe(true)
    })
    expect(reviewStore.get()?.status).toBe('pending')
  })

  it('a pending review renders the buttons and Approve posts the decision', async () => {
    reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    stubReviewFetch({ ok: true, review: { id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'approved' } })
    render(createElement(PlanView, tabProps()))
    expect(await screen.findByText(/Review this plan here/)).toBeDefined()
    fireEvent.click(screen.getByText('Approve'))
    await screen.findByText('Plan approved — the model is carrying out the plan.')
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === REVIEW_API_PATH)).toBe(true)
    const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => url === REVIEW_API_PATH) as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session: 's1', decision: 'approve', id: 'r1' })
    // The echoed state cleared the buttons.
    expect(screen.queryByText('Approve')).toBeNull()
    expect(reviewStore.get()?.status).toBe('approved')
  })

  it('Keep planning forwards the typed feedback', async () => {
    reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    stubReviewFetch({ ok: true, review: { id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'kept' } })
    render(createElement(PlanView, tabProps()))
    await screen.findByText(/Review this plan here/)
    fireEvent.change(screen.getByPlaceholderText(/Optional feedback/), { target: { value: 'add tests' } })
    fireEvent.click(screen.getByText('Keep planning'))
    await screen.findByText('Feedback sent — the model is revising the plan.')
    const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => url === REVIEW_API_PATH) as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session: 's1', decision: 'keep', feedback: 'add tests', id: 'r1' })
  })

  it('a failed decision keeps the bar up with the error line for a retry', async () => {
    reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    stubReviewFetch({ ok: false, error: 'no plan review is pending for this session' }, false)
    render(createElement(PlanView, tabProps()))
    await screen.findByText(/Review this plan here/)
    fireEvent.click(screen.getByText('Approve'))
    await screen.findByText('no plan review is pending for this session')
    expect(screen.getByText('Approve')).toBeDefined()
    expect(reviewStore.get()?.status).toBe('pending')
  })

  it('a review for a different path shows no bar on this tab', async () => {
    reviewStore.set({ id: 'r2', path: '/other.md', title: 'Other', status: 'pending' })
    stubReviewFetch({})
    render(createElement(PlanView, tabProps()))
    await screen.findByTestId('markdown')
    expect(screen.queryByText(/Review this plan here/)).toBeNull()
    expect(screen.queryByText('Approve')).toBeNull()
  })
})
