import { describe, expect, it } from 'vitest'
import { LocaleDirectory } from '../src/locale.ts'
import { PlanReviewGate } from '../src/review-gate.ts'
import {
  REVIEW_API_PATH,
  REVIEW_BODY_LIMIT,
  handleReviewRequest,
  parseReviewDecisionBody,
  type ReviewHttpRequest,
  type ReviewHttpResponse,
} from '../src/review-route.ts'

const REVIEW = { id: 'd1', path: '/repo/docs/plans/p.md', title: 'The plan' }
const NO_HANDLERS = { onApprove: () => {}, onKeep: () => {} }

/** A fake request: method/headers plus a one-chunk async body iterator. */
function fakeRequest(body: unknown, headers: Record<string, string> = { host: '127.0.0.1:18080' }): ReviewHttpRequest {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    method: 'POST',
    url: REVIEW_API_PATH,
    headers,
    [Symbol.asyncIterator]: async function * (): AsyncIterableIterator<Uint8Array | string> {
      yield Buffer.from(raw, 'utf8')
    },
  }
}

interface CapturedResponse {
  status?: number
  body?: string
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): unknown
}

function fakeResponse(): CapturedResponse {
  const response: CapturedResponse = {
    writeHead(status) { response.status = status },
    end(body) { response.body = body },
  }
  return response
}

async function post(gate: PlanReviewGate, body: unknown, headers?: Record<string, string>, directory = new LocaleDirectory()): Promise<CapturedResponse> {
  const res = fakeResponse()
  await handleReviewRequest(gate, fakeRequest(body, headers), res, [], directory)
  return res
}

async function get(gate: PlanReviewGate, url: string, headers: Record<string, string> = { host: '127.0.0.1:18080' }, directory = new LocaleDirectory()): Promise<CapturedResponse> {
  const res = fakeResponse()
  await handleReviewRequest(gate, { ...fakeRequest({}), method: 'GET', url, headers }, res, [], directory)
  return res
}

describe('parseReviewDecisionBody', () => {
  it('parses session + decision and keeps optional feedback/id/locale', () => {
    expect(parseReviewDecisionBody('{"session":"s1","decision":"keep","feedback":"f","id":"d1","locale":"zh-CN"}'))
      .toEqual({ value: { session: 's1', decision: 'keep', feedback: 'f', id: 'd1', locale: 'zh-CN' } })
    expect(parseReviewDecisionBody('{"session":"s1","decision":"approve"}'))
      .toEqual({ value: { session: 's1', decision: 'approve' } })
  })

  it('rejects malformed JSON, non-objects, and invalid decisions', () => {
    expect(parseReviewDecisionBody('{').error).toBe('malformed JSON body')
    expect(parseReviewDecisionBody('7').error).toBe('the body must be a JSON object')
    expect(parseReviewDecisionBody('{"decision":"approve"}').error).toBe('session is required')
    expect(parseReviewDecisionBody('{"session":"s1","decision":"maybe"}').error).toBe('decision must be "approve" or "keep"')
  })
})

describe('handleReviewRequest', () => {
  it('settles approve and echoes the settled review', async () => {
    const gate = new PlanReviewGate()
    gate.begin('s1', REVIEW, NO_HANDLERS)
    const res = await post(gate, { session: 's1', decision: 'approve', id: 'd1' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body ?? '{}')).toEqual({ ok: true, review: { ...REVIEW, status: 'approved' } })
  })

  it('forwards keep feedback into the gate', async () => {
    const gate = new PlanReviewGate()
    const keeps: Array<string | undefined> = []
    gate.begin('s1', REVIEW, { onApprove: () => {}, onKeep: (feedback) => { keeps.push(feedback) } })
    const res = await post(gate, { session: 's1', decision: 'keep', feedback: 'add tests' })
    expect(res.status).toBe(200)
    expect(keeps).toEqual(['add tests'])
  })

  it('answers 409 with a stable code when nothing is pending', async () => {
    const gate = new PlanReviewGate()
    const res = await post(gate, { session: 's1', decision: 'approve' })
    expect(res.status).toBe(409)
    const parsed = JSON.parse(res.body ?? '{}')
    expect(parsed.error).toBe('no plan review is pending for this session')
    expect(parsed.code).toBe('no_pending')
  })

  it('answers 409 with a stable code on a stale delivery id (multi-window guard)', async () => {
    const gate = new PlanReviewGate()
    gate.begin('s1', REVIEW, NO_HANDLERS)
    const res = await post(gate, { session: 's1', decision: 'approve', id: 'stale' })
    expect(res.status).toBe(409)
    const parsed = JSON.parse(res.body ?? '{}')
    expect(parsed.error).toContain('stale')
    expect(parsed.code).toBe('stale_review')
    // The pending review survives the stale click.
    expect(gate.peek('s1')?.id).toBe('d1')
  })

  it('answers 400 on a malformed body and 405 on other methods', async () => {
    const gate = new PlanReviewGate()
    expect((await post(gate, '{')).status).toBe(400)
    const res = fakeResponse()
    await handleReviewRequest(gate, { ...fakeRequest({}), method: 'PUT' }, res, [], new LocaleDirectory())
    expect(res.status).toBe(405)
  })

  it('records the view-reported locale from both verbs', async () => {
    const gate = new PlanReviewGate()
    const directory = new LocaleDirectory()
    await get(gate, `${REVIEW_API_PATH}?session=s1&locale=zh-CN`, undefined, directory)
    expect(directory.known('s1')).toBe('zh')
    await post(gate, { session: 's2', decision: 'approve', locale: 'en' }, undefined, directory)
    expect(directory.known('s2')).toBe('en')
    // Unsupported tags are ignored (the previous report stands).
    await post(gate, { session: 's2', decision: 'approve', locale: 'xx-YY' }, undefined, directory)
    expect(directory.known('s2')).toBe('en')
  })

  it('GET bootstraps the current review state for the plan panel', async () => {
    const gate = new PlanReviewGate()
    const missing = await get(gate, `${REVIEW_API_PATH}?session=s1`)
    expect(missing.status).toBe(200)
    expect(JSON.parse(missing.body ?? '{}')).toEqual({ ok: true, review: null })
    gate.begin('s1', REVIEW, NO_HANDLERS)
    const res = await get(gate, `${REVIEW_API_PATH}?session=s1`)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body ?? '{}')).toEqual({ ok: true, review: { ...REVIEW, status: 'pending' } })
    const noSession = await get(gate, REVIEW_API_PATH)
    expect(noSession.status).toBe(400)
    // GET never settles the pending review.
    expect(gate.peek('s1')?.id).toBe('d1')
  })

  it('refuses cross-site and off-host requests (the browser trust fence)', async () => {
    const gate = new PlanReviewGate()
    gate.begin('s1', REVIEW, NO_HANDLERS)
    const offHost = await post(gate, { session: 's1', decision: 'approve' }, { host: 'evil.example:80' })
    expect(offHost.status).toBe(403)
    const crossSite = await post(gate, { session: 's1', decision: 'approve' }, {
      host: '127.0.0.1:18080',
      'sec-fetch-site': 'cross-site',
    })
    expect(crossSite.status).toBe(403)
    // The pending review survives both refused clicks.
    expect(gate.peek('s1')?.id).toBe('d1')
  })

  it('answers 413 when the body exceeds the cap', async () => {
    const gate = new PlanReviewGate()
    gate.begin('s1', REVIEW, NO_HANDLERS)
    const res = fakeResponse()
    await handleReviewRequest(
      gate,
      fakeRequest('x'.repeat(REVIEW_BODY_LIMIT + 1)),
      res,
      [],
      new LocaleDirectory(),
    )
    expect(res.status).toBe(413)
  })
})
