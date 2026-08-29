/**
 * The plan-review gate: the per-session parking spot for a delivered plan
 * that awaits the user's decision IN THE SIDEBAR (no chat popup).
 *
 * The shadowed `exit_plan_mode` parks its tool call here when the delivery
 * push reached a connected sidebar view (`delivered: true`). Parking blocks
 * the agent loop — the conversation simply stops until the user decides in
 * the plan panel, which is the point: review happens in the sidebar, the
 * approval card never renders in chat. The gate settles through
 * `decide()` (the review HTTP route), through the tool call's abort signal
 * (the user stopped the turn), or through `dispose()` (plugin reload).
 *
 * Every state change broadcasts a `{ kind: 'review', review }` frame to the
 * attached sidebar views, and `attach()` replays the latest state (including
 * a pending review) so a page refresh restores the action bar.
 *
 * Error wording mirrors the built-in popup flow verbatim so the model sees
 * identical guidance whichever surface the user decided on.
 *
 * @module @huanlin/dsh-plugin-better-plan/review-gate
 */
/** Lifecycle of one plan review (the wire status the plan panel renders). */
export type ReviewStatus = 'pending' | 'approved' | 'kept' | 'cancelled';
/** One review's user-visible state (the wire face of a review frame). */
export interface ReviewState {
    /** The delivery id this review belongs to (stale-click guard). */
    id: string;
    /** Absolute path of the plan file under review. */
    path: string;
    /** The plan panel tab title. */
    title: string;
    status: ReviewStatus;
}
/** The server→view frame carrying review state (null = nothing to show). */
export interface ReviewFrame {
    kind: 'review';
    review: ReviewState | null;
}
/** One attached sidebar view's review-frame sender. */
export type ReviewSender = (frame: ReviewFrame) => void;
/** The error that settles a pending review the plugin fiber did not survive. */
export declare function pluginReloadedWhileReviewingError(): Error;
/**
 * Per-session review parking plus the attached view set. One pending review
 * per session (the agent loop is parked in the tool call, so a second
 * `begin` supersedes the first defensively).
 */
export declare class PlanReviewGate {
    private pending;
    /** Latest known state per session — attach replay + stale-window reads. */
    private latest;
    private subscribers;
    /**
     * Park one review for the session and broadcast it. The returned promise
     * resolves `'approve'` when the user approves, and rejects with the same
     * corrective errors the built-in popup flow produces otherwise.
     * @param sessionId - the session whose plan is under review.
     * @param review - the delivery identity to park (id from the delivery push).
     * @param signal - the tool call's signal; aborting settles the review as
     *   cancelled and rejects with the abort reason (matches the popup flow,
     *   where an abort propagates its own error).
     * @returns a promise resolving only on approval.
     */
    begin(sessionId: string, review: {
        id: string;
        path: string;
        title: string;
    }, signal?: AbortSignal): Promise<'approve'>;
    /**
     * Settle the session's pending review from the sidebar decision.
     * @param sessionId - the session under review.
     * @param decision - the user's choice.
     * @param feedback - optional keep-planning feedback (trimmed; forwarded to
     *   the model verbatim in the tool error).
     * @returns the settled review state, or undefined when nothing is pending.
     */
    decide(sessionId: string, decision: 'approve' | 'keep', feedback?: string): ReviewState | undefined;
    /**
     * Read the session's pending review (stale-click guard for the HTTP route).
     * @param sessionId - the session to inspect.
     * @returns the pending review, or null when nothing is parked.
     */
    peek(sessionId: string): ReviewState | null;
    /**
     * Attach one sidebar view; the latest known review state replays
     * immediately (a `null` frame clears a stale bar), and later changes push.
     * @param sessionId - the session the view displays.
     * @param send - the review-frame sender.
     * @returns the disposer detaching the view.
     */
    attach(sessionId: string, send: ReviewSender): () => void;
    /** Settle every pending review and drop the views (plugin teardown). */
    dispose(): void;
    /**
     * Record one state as latest and broadcast it to the session's views.
     * @returns the recorded state.
     */
    private settle;
}
