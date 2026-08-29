/**
 * The Plan tab view: a status header (title, path, actions), the review
 * action bar (the sidebar approval surface — the chat shows no popup), and
 * the plan rendered through DSH's shared `MarkdownText`.
 *
 * The file content comes from better-sidebar's `/sidebar/api/fs.read` route
 * (same-origin, browser-authenticated) — the plan file lives in the session
 * workspace, and the host half has no route of its own for reading it. The
 * path is `tab.meta.path` (persisted with the tab, so a refresh restores the
 * view) falling back to `tab.path`.
 *
 * The review state comes from the delivery WebSocket's review frames (via
 * the shared review store, restored by the attach replay after a refresh).
 * While a review is pending the bar offers Approve / Keep planning; a
 * decision POSTs to the host's review route and the echo updates the store.
 *
 * @module @huanlin/dsh-plugin-better-plan/client/PlanView
 */

import { createElement, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ComponentProps } from 'react'
import { MarkdownText, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TabComponentProps } from 'dsh-better-sidebar/client/service'
import { markdownTextProps } from './markdown-props.ts'
import { reviewStore, submitReviewDecision } from './review-store.ts'

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
  primaryButton: {
    fontSize: 12, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
    border: '1px solid var(--ds-border-strong, var(--ds-border, rgba(127,127,127,0.5)))',
    background: 'transparent', color: 'inherit',
  },
  path: {
    fontSize: 11, fontFamily: 'var(--ds-font-mono, ui-monospace, monospace)',
    color: 'var(--ds-text-muted, var(--ds-text-3, #888))',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  reviewBar: {
    display: 'flex', flexDirection: 'column', gap: 8,
    padding: '10px 14px', borderBottom: '1px solid var(--ds-border, rgba(127,127,127,0.25))',
    background: 'var(--dsw-alias-bg-layer-2, transparent)',
  },
  reviewText: { fontSize: 12, lineHeight: 1.55 },
  reviewInput: {
    fontSize: 12, padding: '5px 8px', borderRadius: 6,
    border: '1px solid var(--ds-border, rgba(127,127,127,0.35))',
    background: 'transparent', color: 'inherit', width: '100%', boxSizing: 'border-box',
  },
  reviewButtons: { display: 'flex', gap: 8 },
  reviewError: { fontSize: 11, color: 'var(--ds-text-critical, #b3261e)' },
  reviewStatus: {
    padding: '8px 14px', fontSize: 12, lineHeight: 1.55,
    borderBottom: '1px solid var(--ds-border, rgba(127,127,127,0.25))',
  },
  body: { flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 16px', fontSize: 13, lineHeight: 1.65 },
  notice: { padding: '14px 16px', fontSize: 12, lineHeight: 1.6 },
}

/** The one-line status a settled review renders (cancelled stays quiet). */
function settledReviewText(status: 'approved' | 'kept' | 'cancelled'): string | null {
  if (status === 'approved') return 'Plan approved — the model is carrying out the plan.'
  if (status === 'kept') return 'Feedback sent — the model is revising the plan.'
  return null
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
  const review = useSyncExternalStore(reviewStore.subscribe, reviewStore.get)
  const pendingReview = review !== null && review.status === 'pending' && review.path === path ? review : null
  const settledReview = review !== null && review.path === path && review.status !== 'pending'
    ? settledReviewText(review.status)
    : null
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | undefined>(undefined)

  // A new review starts with a clean feedback field.
  useEffect(() => {
    setFeedback('')
    setSubmitError(undefined)
  }, [review?.id])

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

  const decide = useCallback((decision: 'approve' | 'keep') => {
    if (pendingReview === null) return
    setSubmitting(true)
    setSubmitError(undefined)
    void submitReviewDecision(scope.sessionId, decision, decision === 'keep' ? feedback : undefined, pendingReview.id)
      .then((outcome) => {
        if (outcome.ok === false) setSubmitError(outcome.error)
      })
      .finally(() => { setSubmitting(false) })
  }, [pendingReview, scope.sessionId, feedback])

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
    pendingReview !== null
      ? createElement('div', { style: styles.reviewBar },
          createElement('div', { style: styles.reviewText },
            'Review this plan here — the chat shows no approval popup. Approve to leave plan mode, or keep planning with feedback.',
          ),
          createElement('input', {
            style: styles.reviewInput,
            value: feedback,
            placeholder: 'Optional feedback for "Keep planning"…',
            onChange: (event: { target: { value: string } }) => { setFeedback(event.target.value) },
          }),
          createElement('div', { style: styles.reviewButtons },
            createElement('button', {
              style: styles.primaryButton,
              disabled: submitting,
              onClick: () => { decide('approve') },
            }, 'Approve'),
            createElement('button', {
              style: styles.button,
              disabled: submitting,
              onClick: () => { decide('keep') },
            }, 'Keep planning'),
          ),
          submitError !== undefined ? createElement('div', { style: styles.reviewError }, submitError) : null,
        )
      : settledReview !== null
        ? createElement('div', { style: styles.reviewStatus }, settledReview)
        : null,
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
