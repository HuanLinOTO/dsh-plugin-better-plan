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
import { attachLocale } from '../../src/client/locales.ts'
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

/** Stub fetch for the fs.read endpoint and both review verbs (GET bootstrap + POST decision). */
function stubReviewFetch(reviewResponse: unknown, ok = true): void {
  vi.mocked(fetch).mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith(REVIEW_API_PATH)) return Promise.resolve(fetchResponse(reviewResponse, ok))
    return Promise.resolve(fetchResponse({ ok: true, value: { kind: 'text', content: '# The plan', truncated: false } }))
  }) as never)
}

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

  it('re-reads the plan file when a new review id arrives (a re-delivery rewrites the same file)', async () => {
    const fetchMock = stubUrlFetch([
      { ok: true, value: { kind: 'text', content: '# Draft', truncated: false } },
      { ok: true, value: { kind: 'text', content: '# Revised', truncated: false } },
    ])
    reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    render(createElement(PlanView, tabProps()))
    await waitFor(() => {
      expect(screen.getByTestId('markdown').textContent).toBe('# Draft')
    })
    // The model revised the same conventional file and re-delivered: a new
    // pending review id is the only signal a mounted native tab gets.
    reviewStore.set({ id: 'r2', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    await waitFor(() => {
      expect(screen.getByTestId('markdown').textContent).toBe('# Revised')
    })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith(REVIEW_API_PATH))).toHaveLength(1)
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
    expect(JSON.parse(String(init.body))).toEqual({ session: 's1', decision: 'approve', locale: 'en', id: 'r1' })
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
    expect(JSON.parse(String(init.body))).toEqual({ session: 's1', decision: 'keep', locale: 'en', feedback: 'add tests', id: 'r1' })
  })

  it('a failed decision keeps the bar up with the localized error line for a retry', async () => {
    reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    stubReviewFetch({ ok: false, code: 'no_pending', error: 'no plan review is pending for this session' }, false)
    render(createElement(PlanView, tabProps()))
    await screen.findByText(/Review this plan here/)
    fireEvent.click(screen.getByText('Approve'))
    // The route's stable code maps to the locale catalog (en in this jsdom).
    await screen.findByText('No plan is awaiting review.')
    expect(screen.getByText('Approve')).toBeDefined()
    expect(reviewStore.get()?.status).toBe('pending')
  })

  it('an uncoded failure falls back to the prefix + raw message', async () => {
    reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    stubReviewFetch({ ok: false, error: 'boom' }, false)
    render(createElement(PlanView, tabProps()))
    await screen.findByText(/Review this plan here/)
    fireEvent.click(screen.getByText('Approve'))
    await screen.findByText('Submitting the decision failed: boom')
  })

  it('a review for a different path shows no bar on this tab', async () => {
    reviewStore.set({ id: 'r2', path: '/other.md', title: 'Other', status: 'pending' })
    stubReviewFetch({})
    render(createElement(PlanView, tabProps()))
    await screen.findByTestId('markdown')
    expect(screen.queryByText(/Review this plan here/)).toBeNull()
    expect(screen.queryByText('Approve')).toBeNull()
  })

  it('the delegation button is hidden without the sessions service', async () => {
    reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    stubReviewFetch({})
    render(createElement(PlanView, tabProps()))
    await screen.findByText(/Review this plan here/)
    expect(screen.getByText('Approve')).toBeDefined()
    expect(screen.queryByText('Execute in new chat')).toBeNull()
  })

  it('follows the attached DSH locale: a zh service renders the Chinese copy', async () => {
    attachLocale({ getSnapshot: () => ({ active: 'zh' }) })
    try {
      reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
      stubReviewFetch({ ok: true, review: { id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'approved' } })
      render(createElement(PlanView, tabProps()))
      expect(await screen.findByText(/在此审阅计划/)).toBeDefined()
      fireEvent.click(screen.getByText('批准'))
      await screen.findByText('计划已批准——模型正在执行该计划。')
      // The decision POST reported the zh locale to the host.
      const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => url === REVIEW_API_PATH) as [string, RequestInit]
      expect(JSON.parse(String(init.body)).locale).toBe('zh')
    } finally {
      attachLocale(undefined)
    }
  })
})

describe('PlanView delegation (execute in a new conversation)', () => {
  /** A structural sessions-service stub capturing the delegation calls. */
  function sessionsStub(failure?: Error) {
    const calls = {
      created: [] as Array<{ cwd?: string } | undefined>,
      prompts: [] as Array<{ text: string; mode: string }>,
      opened: [] as string[],
    }
    const sessions = {
      create: failure === undefined
        ? vi.fn(async (opts?: { cwd?: string }) => { calls.created.push(opts); return 's2' })
        : vi.fn(async (opts?: { cwd?: string }) => { calls.created.push(opts); throw failure }),
      open: vi.fn((id: string) => { calls.opened.push(id) }),
      list: { getSnapshot: () => ({ byId: { s1: { cwd: '/from-list' } } }) },
      binding: vi.fn(() => ({
        session: {
          prompt: vi.fn(async (content: { type: 'text'; text: string }[], mode: string) => {
            calls.prompts.push({ text: content[0]?.text ?? '', mode })
            return { ok: true }
          }),
        },
      })),
    }
    return { sessions, calls }
  }

  /** tabProps with the sessions service reachable through ctx.get. */
  function propsWithSessions(sessions: unknown): TabComponentProps {
    return tabProps({
      ctx: {
        get: (name: string) => (name === 'betterSidebar'
          ? { features: ['updateTab', 'openFile'], openFile: vi.fn() }
          : name === 'sessions' ? sessions : undefined),
      } as unknown as TabComponentProps['ctx'],
    })
  }

  it('settles delegated, queues the kickoff into a fresh session, and navigates there', async () => {
    const { sessions, calls } = sessionsStub()
    reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    stubReviewFetch({ ok: true, review: { id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'delegated' } })
    render(createElement(PlanView, propsWithSessions(sessions)))
    await screen.findByText(/Review this plan here/)
    fireEvent.click(screen.getByText('Execute in new chat'))
    await screen.findByText('Plan approved — execution continues in a new conversation.')
    // The decision POST carried the third decision value (no feedback field).
    const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => url === REVIEW_API_PATH) as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ session: 's1', decision: 'approve_new_session', locale: 'en', id: 'r1' })
    // The new conversation: same cwd as the planning session (from the list
    // summary), kickoff anchored on the plan path, then navigation.
    expect(calls.created).toEqual([{ cwd: '/from-list' }])
    expect(calls.prompts).toHaveLength(1)
    expect(calls.prompts[0]?.mode).toBe('queue')
    expect(calls.prompts[0]?.text).toContain('/repo/meta.md')
    expect(calls.prompts[0]?.text).toContain('[Plan execution]')
    expect(calls.opened).toEqual(['s2'])
    expect(reviewStore.get()?.status).toBe('delegated')
  })

  it('surfaces a launch failure under the delegated status line', async () => {
    const { sessions } = sessionsStub(new Error('workspace gone'))
    reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    stubReviewFetch({ ok: true, review: { id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'delegated' } })
    render(createElement(PlanView, propsWithSessions(sessions)))
    await screen.findByText(/Review this plan here/)
    fireEvent.click(screen.getByText('Execute in new chat'))
    expect(await screen.findByText('Failed to start the execution conversation: workspace gone')).toBeDefined()
    expect(screen.getByText('Plan approved — execution continues in a new conversation.')).toBeDefined()
    expect(sessions.open).not.toHaveBeenCalled()
  })

  it('localizes the zh delegation copy end to end', async () => {
    attachLocale({ getSnapshot: () => ({ active: 'zh' }) })
    try {
      const { sessions, calls } = sessionsStub()
      reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
      stubReviewFetch({ ok: true, review: { id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'delegated' } })
      render(createElement(PlanView, propsWithSessions(sessions)))
      expect(await screen.findByText(/在此审阅计划/)).toBeDefined()
      fireEvent.click(screen.getByText('新开对话执行'))
      await screen.findByText('计划已批准——执行已移交到新对话。')
      expect(calls.prompts[0]?.text).toContain('[计划执行]')
      expect(calls.prompts[0]?.text).toContain('/repo/meta.md')
      expect(calls.opened).toEqual(['s2'])
    } finally {
      attachLocale(undefined)
    }
  })
})
