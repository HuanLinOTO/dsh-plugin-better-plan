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

import type { PlanReviewGate, ReviewState } from './review-gate.ts'
import { isTrustedDeliveryRequest, type FenceRequest } from './trust-fence.ts'

/** The exact pathname the route registers on the host webServer. */
export const REVIEW_API_PATH = '/better-plan/api/review'

/** Request-body cap: a decision is a handful of fields, not a plan. */
export const REVIEW_BODY_LIMIT = 4096

/** The request face the handler consumes (node:http IncomingMessage subset). */
export interface ReviewHttpRequest extends FenceRequest {
  method?: string
  url?: string
  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array | string>
}

/** The response face the handler writes (node:http ServerResponse subset). */
export interface ReviewHttpResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): unknown
}

/** The exact HTTP route this plugin registers. */
export interface ReviewApiRoute {
  kind: 'exact'
  path: string
  handler: (req: ReviewHttpRequest, res: ReviewHttpResponse) => void | Promise<void>
}

/** One parsed review decision body. */
export interface ReviewDecisionBody {
  session: string
  decision: 'approve' | 'keep'
  feedback?: string
  id?: string
}

/**
 * Parse and validate one review decision body (wire-boundary validation).
 * @param raw - the request body text.
 * @returns the parsed decision, or an error message.
 */
export function parseReviewDecisionBody(raw: string): { value: ReviewDecisionBody; error?: undefined } | { value?: undefined; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'malformed JSON body' }
  }
  if (parsed === null || typeof parsed !== 'object') return { error: 'the body must be a JSON object' }
  const record = parsed as Record<string, unknown>
  if (typeof record.session !== 'string' || record.session === '') return { error: 'session is required' }
  if (record.decision !== 'approve' && record.decision !== 'keep') return { error: 'decision must be "approve" or "keep"' }
  const decision: ReviewDecisionBody = { session: record.session, decision: record.decision }
  if (typeof record.feedback === 'string' && record.feedback !== '') decision.feedback = record.feedback
  if (typeof record.id === 'string' && record.id !== '') decision.id = record.id
  return { value: decision }
}

/**
 * Serve one review request: GET bootstraps the plan panel's action bar with
 * the current state (the WS attach replay remains the live channel); POST
 * settles the pending decision.
 * @param gate - the review gate holding the pending review.
 * @param req - the request (method/headers/body iterator).
 * @param res - the response.
 * @param trustedHosts - non-loopback authorities the deployment serves.
 */
export async function handleReviewRequest(
  gate: PlanReviewGate,
  req: ReviewHttpRequest,
  res: ReviewHttpResponse,
  trustedHosts: readonly string[],
): Promise<void> {
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(405, { ok: false, error: 'GET or POST only' })
  }
  if (!isTrustedDeliveryRequest(req, trustedHosts)) {
    return json(403, { ok: false, error: 'untrusted origin' })
  }
  if (req.method === 'GET') {
    // Bootstrap the plan panel's action bar with the current state; the WS
    // attach replay remains the live channel.
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const sessionId = url.searchParams.get('session')
    if (sessionId === null || sessionId === '') {
      return json(400, { ok: false, error: 'session is required' })
    }
    return json(200, { ok: true, review: gate.peek(sessionId) })
  }
  let raw = ''
  let bytes = 0
  for await (const chunk of req) {
    bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength
    if (bytes > REVIEW_BODY_LIMIT) {
      return json(413, { ok: false, error: `review request body exceeds the ${REVIEW_BODY_LIMIT}-byte limit` })
    }
    raw += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
  }
  const parsed = parseReviewDecisionBody(raw)
  if (parsed.error !== undefined) {
    return json(400, { ok: false, error: parsed.error })
  }
  const body = parsed.value
  const pending = gate.peek(body.session)
  if (pending === null) {
    return json(409, { ok: false, error: 'no plan review is pending for this session' })
  }
  if (body.id !== undefined && body.id !== pending.id) {
    return json(409, { ok: false, error: 'the plan panel is stale; a newer plan delivery is under review' })
  }
  const review: ReviewState | undefined = gate.decide(body.session, body.decision, body.feedback)
  if (review === undefined) {
    return json(409, { ok: false, error: 'no plan review is pending for this session' })
  }
  return json(200, { ok: true, review })
}

/**
 * Register the review decision route on the host webServer.
 * @param register - the webServer's route registrar.
 * @param gate - the review gate.
 * @param trustedHosts - non-loopback authorities the deployment serves.
 * @returns the route disposer.
 */
export function registerReviewRoute(
  register: (route: ReviewApiRoute) => () => void,
  gate: PlanReviewGate,
  trustedHosts: readonly string[],
): () => void {
  return register({
    kind: 'exact',
    path: REVIEW_API_PATH,
    handler: (req, res) => handleReviewRequest(gate, req, res, trustedHosts),
  })
}
