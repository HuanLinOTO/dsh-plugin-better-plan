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
/** Mirrors the host gate's ReviewState (the wire face of a review frame). */
export interface ReviewState {
    id: string;
    path: string;
    title: string;
    status: 'pending' | 'approved' | 'kept' | 'cancelled';
}
/** The server→view frame carrying review state. */
export interface ReviewFrame {
    kind: 'review';
    review: ReviewState | null;
}
/** Whether an unknown wire value is a well-formed review state. */
export declare function isReviewState(value: unknown): value is ReviewState;
type Listener = () => void;
/** External store for the current session's review state. */
export declare class ReviewStore {
    private state;
    private listeners;
    /** The current review state (null = nothing to review). */
    get: () => ReviewState | null;
    /** Replace the state and notify subscribers. */
    set: (next: ReviewState | null) => void;
    /** Clear the state (session switch); attach replay restores it. */
    reset: () => void;
    /** @returns the unsubscribe disposer. */
    subscribe: (listener: Listener) => (() => void);
}
/** The singleton store the WS handler writes and the Plan tab reads. */
export declare const reviewStore: ReviewStore;
/** The exact pathname of the host's review decision route. */
export declare const REVIEW_API_PATH = "/better-plan/api/review";
/** The outcome of one review decision POST. */
export type ReviewDecisionOutcome = {
    ok: true;
    review: ReviewState;
} | {
    ok: false;
    error: string;
};
/**
 * Bootstrap the review state over HTTP (the WS attach replay remains the
 * live channel): fills the bar when a review frame was missed (stale bundle,
 * reconnect gap). A live frame already in the store wins — the GET result is
 * only applied while the store is empty, so a late null response can never
 * clear a pending bar. The request reports the view's active locale so the
 * host's user-facing copy follows the browser.
 * @param sessionId - the session whose review state to read.
 */
export declare function fetchReviewState(sessionId: string): Promise<void>;
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
export declare function submitReviewDecision(sessionId: string, decision: 'approve' | 'keep', feedback: string | undefined, reviewId: string): Promise<ReviewDecisionOutcome>;
export {};
