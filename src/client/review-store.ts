/**
 * The client-side review state: a tiny external store fed by the delivery
 * WebSocket's `{ kind: 'review', review }` frames and by the decision POST's
 * echoed response, consumed by the Plan tab's action bar through
 * `useSyncExternalStore`.
 *
 * The state mirrors the host gate's per-session review; a session switch
 * resets it (the reconnect's attach replay restores the current state).
 *
 * @module @huanlin/dsh-plugin-better-plan/client/review-store
 */

import { activeLocale, submitErrorText, t } from './locales.ts'

/** Mirrors the host gate's ReviewState (the wire face of a review frame). */
export interface ReviewState {
  id: string
  path: string
  title: string
  status: 'pending' | 'approved' | 'delegated' | 'kept' | 'cancelled'
}

/** The server→view frame carrying review state. */
export interface ReviewFrame {
  kind: 'review'
  review: ReviewState | null
}

/** The sidebar decision vocabulary the panel posts (mirrors the gate's). */
export type ReviewDecision = 'approve' | 'keep' | 'approve_new_session'

/** Whether an unknown wire value is a well-formed review state. */
export function isReviewState(value: unknown): value is ReviewState {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && record.id !== ''
    && typeof record.path === 'string' && record.path !== ''
    && typeof record.title === 'string'
    && (record.status === 'pending' || record.status === 'approved' || record.status === 'delegated'
      || record.status === 'kept' || record.status === 'cancelled')
}

type Listener = () => void

/** External store for the current session's review state. */
export class ReviewStore {
  private state: ReviewState | null = null
  private listeners = new Set<Listener>()

  /** The current review state (null = nothing to review). */
  get = (): ReviewState | null => this.state

  /** Replace the state and notify subscribers. */
  set = (next: ReviewState | null): void => {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /** Clear the state (session switch); attach replay restores it. */
  reset = (): void => {
    this.set(null)
  }

  /** @returns the unsubscribe disposer. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/** The singleton store the WS handler writes and the Plan tab reads. */
export const reviewStore = new ReviewStore()

/** The exact pathname of the host's review decision route. */
export const REVIEW_API_PATH = '/better-plan/api/review'

/** The outcome of one review decision POST. */
export type ReviewDecisionOutcome =
  | { ok: true; review: ReviewState }
  | { ok: false; error: string }

/**
 * Bootstrap the review state over HTTP (the WS attach replay remains the
 * live channel): fills the bar when a review frame was missed (stale bundle,
 * reconnect gap). A live frame already in the store wins — the GET result is
 * only applied while the store is empty, so a late null response can never
 * clear a pending bar. The request reports the view's active locale so the
 * host's user-facing copy follows the browser.
 * @param sessionId - the session whose review state to read.
 */
export async function fetchReviewState(sessionId: string): Promise<void> {
  try {
    const url = `${REVIEW_API_PATH}?session=${encodeURIComponent(sessionId)}&locale=${encodeURIComponent(activeLocale())}`
    const response = await fetch(url)
    const parsed: { ok?: unknown; review?: unknown } | null = await response.json().catch(() => null)
    if (!response.ok || parsed === null || parsed.ok !== true) return
    if (reviewStore.get() !== null) return
    if (parsed.review === null) reviewStore.set(null)
    else if (isReviewState(parsed.review)) reviewStore.set(parsed.review)
  } catch {
    // Bootstrap only: the WS remains the authoritative live channel.
  }
}

/**
 * Post one review decision to the host route and, on success, echo the
 * settled state into the store (the submitting view updates immediately;
 * other views follow over the WebSocket). The body reports the view's active
 * locale; failures map the route's stable error codes to localized copy.
 * @param sessionId - the session whose plan is under review.
 * @param decision - the user's choice.
 * @param feedback - optional keep-planning feedback.
 * @param reviewId - the reviewed delivery's id (stale-click guard).
 * @returns the outcome; failures keep the pending bar up for a retry.
 */
export async function submitReviewDecision(
  sessionId: string,
  decision: ReviewDecision,
  feedback: string | undefined,
  reviewId: string,
): Promise<ReviewDecisionOutcome> {
  try {
    const response = await fetch(REVIEW_API_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: sessionId,
        decision,
        locale: activeLocale(),
        ...(decision === 'keep' && feedback !== undefined && feedback !== '' ? { feedback } : {}),
        id: reviewId,
      }),
    })
    const parsed: { ok?: unknown; review?: unknown; error?: unknown; code?: unknown } | null
      = await response.json().catch(() => null)
    if (!response.ok || parsed === null || parsed.ok !== true) {
      const raw = typeof parsed?.error === 'string' ? parsed.error : `HTTP ${response.status}`
      const code = typeof parsed?.code === 'string' ? parsed.code : undefined
      return { ok: false, error: submitErrorText(code, raw) }
    }
    if (!isReviewState(parsed.review)) {
      return { ok: false, error: t('errSubmitFailed') }
    }
    reviewStore.set(parsed.review)
    return { ok: true, review: parsed.review }
  } catch (cause: unknown) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}
