/**
 * The plan-review gate: the per-session record of a delivered plan that
 * awaits the user's decision IN THE SIDEBAR (no chat popup).
 *
 * The shadowed `exit_plan_mode` returns immediately after a delivered push
 * (the model ends its turn on the render's instruction — the conversation
 * simply stops), and the user decides later in the plan panel. The gate
 * holds that pending decision and its handlers; `decide()` (driven by the
 * review HTTP route) settles the state, broadcasts it to the attached
 * sidebar views, and fires the handlers that steer the decision back to the
 * model. Handlers never throw into the route: they are defensive at their
 * definition site.
 *
 * Every state change broadcasts a `{ kind: 'review', review }` frame, and
 * `attach()` replays the latest state (including a pending review) so a page
 * refresh restores the action bar.
 *
 * @module @huanlin/dsh-plugin-better-plan/review-gate
 */

/** Lifecycle of one plan review (the wire status the plan panel renders). */
export type ReviewStatus = 'pending' | 'approved' | 'delegated' | 'kept' | 'cancelled'

/** The sidebar decision vocabulary: how the plan panel settles a review. */
export type ReviewDecision = 'approve' | 'keep' | 'approve_new_session'

/** One review's user-visible state (the wire face of a review frame). */
export interface ReviewState {
  /** The delivery id this review belongs to (stale-click guard). */
  id: string
  /** Absolute path of the plan file under review. */
  path: string
  /** The plan panel tab title. */
  title: string
  status: ReviewStatus
}

/** The server→view frame carrying review state (null = nothing to show). */
export interface ReviewFrame {
  kind: 'review'
  review: ReviewState | null
}

/** One attached sidebar view's review-frame sender. */
export type ReviewSender = (frame: ReviewFrame) => void

/**
 * The decision side effects, wired by the tool that delivered the plan:
 * steer the outcome back to the model (approval also flips plan mode off;
 * delegation flips it off too but hands execution to a new conversation).
 */
export interface ReviewHandlers {
  onApprove(): void
  onKeep(feedback: string | undefined): void
  onDelegate(): void
}

interface Waiter {
  review: ReviewState
  handlers: ReviewHandlers
}

/**
 * Per-session pending decision plus the attached view set. One pending
 * review per session; a newer delivery supersedes the previous one (its
 * handlers never fire — the newest plan is the one under review).
 */
export class PlanReviewGate {
  private pending = new Map<string, Waiter>()
  /** Latest known state per session — attach replay + stale-window reads. */
  private latest = new Map<string, ReviewState>()
  private subscribers = new Map<string, Set<ReviewSender>>()

  /**
   * Record one pending review and broadcast it.
   * @param sessionId - the session whose plan is under review.
   * @param review - the delivery identity (id from the delivery push).
   * @param handlers - the decision side effects (steer back to the model).
   */
  begin(sessionId: string, review: { id: string; path: string; title: string }, handlers: ReviewHandlers): void {
    const existing = this.pending.get(sessionId)
    if (existing !== undefined) {
      // Superseded: the older plan is no longer the one under review and its
      // decision surface is gone, so its handlers must never fire.
      this.pending.delete(sessionId)
      this.settle(sessionId, { ...existing.review, status: 'cancelled' })
    }
    const waiter: Waiter = { review: { ...review, status: 'pending' }, handlers }
    this.pending.set(sessionId, waiter)
    this.settle(sessionId, waiter.review)
  }

  /**
   * Settle the session's pending review from the sidebar decision.
   * @param sessionId - the session under review.
   * @param decision - the user's choice (approve_new_session settles as
   *   `delegated`: execution continues in a new conversation).
   * @param feedback - optional keep-planning feedback (trimmed; forwarded to
   *   the model verbatim in the steer message).
   * @returns the settled review state, or undefined when nothing is pending.
   */
  decide(sessionId: string, decision: ReviewDecision, feedback?: string): ReviewState | undefined {
    const waiter = this.pending.get(sessionId)
    if (waiter === undefined) return undefined
    this.pending.delete(sessionId)
    const settled = this.settle(sessionId, {
      ...waiter.review,
      status: decision === 'approve' ? 'approved' : decision === 'keep' ? 'kept' : 'delegated',
    })
    if (decision === 'approve') waiter.handlers.onApprove()
    else if (decision === 'keep') waiter.handlers.onKeep(feedback?.trim() || undefined)
    else waiter.handlers.onDelegate()
    return settled
  }

  /**
   * Read the session's pending review (stale-click guard + GET bootstrap).
   * @param sessionId - the session to inspect.
   * @returns the pending review, or null when nothing is parked.
   */
  peek(sessionId: string): ReviewState | null {
    return this.pending.get(sessionId)?.review ?? null
  }

  /**
   * Attach one sidebar view; the latest known review state replays
   * immediately (a `null` frame clears a stale bar), and later changes push.
   * @param sessionId - the session the view displays.
   * @param send - the review-frame sender.
   * @returns the disposer detaching the view.
   */
  attach(sessionId: string, send: ReviewSender): () => void {
    let views = this.subscribers.get(sessionId)
    if (views === undefined) {
      views = new Set()
      this.subscribers.set(sessionId, views)
    }
    views.add(send)
    send({ kind: 'review', review: this.latest.get(sessionId) ?? null })
    return () => {
      const current = this.subscribers.get(sessionId)
      current?.delete(send)
      if (current !== undefined && current.size === 0) this.subscribers.delete(sessionId)
    }
  }

  /**
   * Settle every pending review as cancelled and drop the views (plugin
   * teardown). Handlers do not fire: a reload discards the decision surface,
   * and the user re-drives the session.
   */
  dispose(): void {
    for (const [sessionId, waiter] of this.pending) {
      this.pending.delete(sessionId)
      this.settle(sessionId, { ...waiter.review, status: 'cancelled' })
    }
    this.subscribers.clear()
  }

  /**
   * Record one state as latest and broadcast it to the session's views.
   * @returns the recorded state.
   */
  private settle(sessionId: string, review: ReviewState): ReviewState {
    this.latest.set(sessionId, review)
    for (const send of this.subscribers.get(sessionId) ?? []) {
      send({ kind: 'review', review })
    }
    return review
  }
}
