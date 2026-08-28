// @vitest-environment jsdom
/**
 * PlanView component spec (jsdom): load / error / retry over the sidebar
 * fs.read route, and the meta-path preference. DSH's MarkdownText is mocked
 * (its rendering is upstream's contract; the dual-shape label props have
 * their own spec) so this test isolates PlanView's fetch lifecycle.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { PlanView, planPathOf } from '../../src/client/PlanView.tsx'
import type { TabComponentProps } from 'dsh-better-sidebar/client/service'

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
  it('renders the fetched plan through MarkdownText with the session-scoped fs.read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse({ ok: true, value: { kind: 'text', content: '# The plan\n\nbody', truncated: false } }))
    vi.mocked(fetch).mockImplementation(fetchMock as never)
    render(createElement(PlanView, tabProps()))
    await waitFor(() => {
      expect(screen.getByTestId('markdown')).toBeDefined()
      expect(screen.getByTestId('markdown').textContent).toBe('# The plan\n\nbody')
    })
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/sidebar/api/fs.read')
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: 's1', path: '/repo/meta.md' })
    expect(screen.getByText('The plan')).toBeDefined()
    expect(screen.getByText('/repo/meta.md')).toBeDefined()
    expect(screen.getByText('Open in editor')).toBeDefined()
  })

  it('shows the error state with a working retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fetchResponse({ ok: false, error: { code: 'fs-error', message: 'boom' } }))
      .mockResolvedValueOnce(fetchResponse({ ok: true, value: { kind: 'text', content: '# Recovered', truncated: false } }))
    vi.mocked(fetch).mockImplementation(fetchMock as never)
    render(createElement(PlanView, tabProps()))
    expect(await screen.findByText('Failed to read the plan: boom')).toBeDefined()
    expect(screen.queryByTestId('markdown')).toBeNull()
    screen.getByText('Retry').click()
    await waitFor(() => {
      expect(screen.getByTestId('markdown').textContent).toBe('# Recovered')
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
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
