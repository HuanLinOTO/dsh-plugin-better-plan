/**
 * The `POST /better-plan/api/review` route: the browser→host command channel
 * that settles a parked plan review (the tab→host half of the sidebar
 * approval flow the chat popup used to own).
 *
 * The plan panel posts `{ session, decision, feedback?, id? }`; the route
 * settles the session's pending review through the {@link PlanReviewGate}
 * and echoes the settled state back so the submitting view (and, over the
 * delivery WebSocket, every other view) reflects the decision.
 *
 * The same browser-trust fence as the delivery WebSocket guards the route:
 * this is a DNS-rebinding / cross-site defense for a session-scoped command,
 * not authentication.
 *
 * @module @huanlin/dsh-plugin-better-plan/review-route
 */
import type { PlanReviewGate } from './review-gate.ts';
import { type FenceRequest } from './trust-fence.ts';
/** The exact pathname the route registers on the host webServer. */
export declare const REVIEW_API_PATH = "/better-plan/api/review";
/** Request-body cap: a decision is a handful of fields, not a plan. */
export declare const REVIEW_BODY_LIMIT = 4096;
/** The request face the handler consumes (node:http IncomingMessage subset). */
export interface ReviewHttpRequest extends FenceRequest {
    method?: string;
    url?: string;
    [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array | string>;
}
/** The response face the handler writes (node:http ServerResponse subset). */
export interface ReviewHttpResponse {
    writeHead(status: number, headers?: Record<string, string>): unknown;
    end(body?: string): unknown;
}
/** The exact HTTP route this plugin registers. */
export interface ReviewApiRoute {
    kind: 'exact';
    path: string;
    handler: (req: ReviewHttpRequest, res: ReviewHttpResponse) => void | Promise<void>;
}
/** One parsed review decision body. */
export interface ReviewDecisionBody {
    session: string;
    decision: 'approve' | 'keep';
    feedback?: string;
    id?: string;
}
/**
 * Parse and validate one review decision body (wire-boundary validation).
 * @param raw - the request body text.
 * @returns the parsed decision, or an error message.
 */
export declare function parseReviewDecisionBody(raw: string): {
    value: ReviewDecisionBody;
    error?: undefined;
} | {
    value?: undefined;
    error: string;
};
/**
 * Serve one review request: GET bootstraps the plan panel's action bar with
 * the current state (the WS attach replay remains the live channel); POST
 * settles the pending decision.
 * @param gate - the review gate holding the pending review.
 * @param req - the request (method/headers/body iterator).
 * @param res - the response.
 * @param trustedHosts - non-loopback authorities the deployment serves.
 */
export declare function handleReviewRequest(gate: PlanReviewGate, req: ReviewHttpRequest, res: ReviewHttpResponse, trustedHosts: readonly string[]): Promise<void>;
/**
 * Register the review decision route on the host webServer.
 * @param register - the webServer's route registrar.
 * @param gate - the review gate.
 * @param trustedHosts - non-loopback authorities the deployment serves.
 * @returns the route disposer.
 */
export declare function registerReviewRoute(register: (route: ReviewApiRoute) => () => void, gate: PlanReviewGate, trustedHosts: readonly string[]): () => void;
