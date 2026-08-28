/**
 * The Plan tab view: a status header (title, path, actions) over the plan
 * rendered through DSH's shared `MarkdownText`.
 *
 * The file content comes from better-sidebar's `/sidebar/api/fs.read` route
 * (same-origin, browser-authenticated) — the plan file lives in the session
 * workspace, and the host half has no route of its own for reading it. The
 * path is `tab.meta.path` (persisted with the tab, so a refresh restores the
 * view) falling back to `tab.path`.
 *
 * @module @huanlin/dsh-plugin-better-plan/client/PlanView
 */

import { createElement, useCallback, useEffect, useState } from 'react'
import type { ComponentProps } from 'react'
import { MarkdownText, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TabComponentProps } from 'dsh-better-sidebar/client/service'
import { markdownTextProps } from './markdown-props.ts'

/** The meta payload the delivery flow stores on the tab. */
interface PlanTabMeta {
  path?: unknown
  deliveredAt?: unknown
}

/** The fetch lifecycle of one plan read. */
type PlanLoad =
  | { status: 'loading' }
  | { status: 'ok'; content: string; truncated: boolean }
  | { status: 'error'; message: string }

/**
 * Extract the plan path from a tab (meta first, then the seed path).
 * @param tab - the sidebar tab instance.
 * @returns the plan file path, or undefined when the tab carries none.
 */
export function planPathOf(tab: TabComponentProps['tab']): string | undefined {
  const meta = tab.meta as PlanTabMeta | null | undefined
  if (meta !== null && typeof meta === 'object' && typeof meta.path === 'string' && meta.path !== '') {
    return meta.path
  }
  return typeof tab.path === 'string' && tab.path !== '' ? tab.path : undefined
}

/** Read the sidebar fs API for one session-scoped path. */
async function fsRead(sessionId: string, path: string, signal?: AbortSignal): Promise<{ content: string; truncated: boolean }> {
  const response = await fetch('/sidebar/api/fs.read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, path }),
    signal,
  })
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new Error(parsed?.error?.message ?? `HTTP ${response.status}`)
  }
  const value = parsed.value as { kind?: unknown; content?: unknown; truncated?: unknown }
  if (value.kind === 'binary') {
    throw new Error('the plan file is binary; review it in the editor instead')
  }
  if (typeof value.content !== 'string') {
    throw new Error('unexpected fs.read response')
  }
  return { content: value.content, truncated: value.truncated === true }
}

/** Shared style tokens (alias tokens with plain fallbacks, no hardcoded theme). */
const styles: Record<string, ComponentProps<'div'>['style']> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' },
  header: {
    display: 'flex', flexDirection: 'column', gap: 4,
    padding: '10px 14px', borderBottom: '1px solid var(--ds-border, rgba(127,127,127,0.25))',
    background: 'var(--dsw-alias-bg-layer-1, transparent)',
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  title: { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actions: { display: 'flex', gap: 6, marginLeft: 'auto', flexShrink: 0 },
  button: {
    fontSize: 11, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
    border: '1px solid var(--ds-border, rgba(127,127,127,0.35))',
    background: 'transparent', color: 'inherit',
  },
  path: {
    fontSize: 11, fontFamily: 'var(--ds-font-mono, ui-monospace, monospace)',
    color: 'var(--ds-text-muted, var(--ds-text-3, #888))',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  body: { flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 16px', fontSize: 13, lineHeight: 1.65 },
  notice: { padding: '14px 16px', fontSize: 12, lineHeight: 1.6 },
}

/**
 * The Plan tab component (better-sidebar TabDescriptor.component).
 * @param props - the tab component props (ctx/store/scope/tab/visible).
 * @returns the rendered view.
 */
export function PlanView(props: TabComponentProps): ReturnType<typeof createElement> {
  const { ctx, scope, tab } = props
  const path = planPathOf(tab)
  const [load, setLoad] = useState<PlanLoad>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (path === undefined) {
      setLoad({ status: 'error', message: 'this plan tab carries no file path' })
      return
    }
    const controller = new AbortController()
    setLoad({ status: 'loading' })
    fsRead(scope.sessionId, path, controller.signal)
      .then((result) => { setLoad({ status: 'ok', ...result }) })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setLoad({ status: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => { controller.abort() }
  }, [path, scope.sessionId, attempt])

  const betterSidebar = ctx.get('betterSidebar')
  const canOpenInEditor = path !== undefined
    && Array.isArray(betterSidebar?.features) === true
    && betterSidebar.features.includes('openFile') === true

  const copyPath = useCallback(() => {
    if (path === undefined) return
    void writeClipboard(path)
    setCopied(true)
    window.setTimeout(() => { setCopied(false) }, 1500)
  }, [path])

  return createElement('div', { style: styles.root },
    createElement('div', { style: styles.header },
      createElement('div', { style: styles.titleRow },
        createElement('span', { style: styles.title, title: path ?? undefined }, tab.title),
        createElement('span', { style: styles.actions },
          canOpenInEditor && betterSidebar !== undefined && path !== undefined
            ? createElement('button', {
                style: styles.button,
                onClick: () => { betterSidebar.openFile(scope, path) },
              }, 'Open in editor')
            : null,
          path !== undefined
            ? createElement('button', { style: styles.button, onClick: copyPath }, copied ? 'Copied' : 'Copy path')
            : null,
        ),
      ),
      path !== undefined ? createElement('div', { style: styles.path }, path) : null,
    ),
    load.status === 'loading'
      ? createElement('div', { style: styles.notice }, 'Loading plan…')
      : load.status === 'error'
        ? createElement('div', { style: styles.notice },
            createElement('div', null, `Failed to read the plan: ${load.message}`),
            path !== undefined
              ? createElement('button', {
                  style: { ...styles.button, marginTop: 8 },
                  onClick: () => { setAttempt(attempt + 1) },
                }, 'Retry')
              : null,
          )
        : createElement('div', { style: styles.body },
            createElement(MarkdownText, {
              ...markdownTextProps(load.content, { copyLabel: 'Copy', copiedLabel: 'Copied' }),
            }),
            load.truncated
              ? createElement('div', { style: { ...styles.notice, paddingLeft: 0, paddingRight: 0 } },
                  'The file was truncated by the sidebar read limit; open it in the editor for the rest.',
                )
              : null,
          ),
  )
}
