import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/types'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import UserQuestionService, { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { isPlanModeActive } from '../src/plan-fold.ts'
import { EXIT_PLAN_MODE } from '@deepseek-ai/dsh-plan-mode'
import { PLAN_DELIVERY_ANCHOR } from '../src/prompt-override.ts'
import * as betterPlan from '../src/index.ts'
import { resolveBetterPlanConfig, type BetterPlanConfig } from '../src/config.ts'
import type { PlanDeliveryRegistry } from '../src/delivery-registry.ts'
import type { PlanReviewGate, ReviewFrame } from '../src/review-gate.ts'
import { REVIEW_API_PATH, type ReviewHttpRequest, type ReviewHttpResponse } from '../src/review-route.ts'
import { DELIVERY_WS_PATH } from '../src/ws-route.ts'

/**
 * Drives the REAL plugin: mounts `dsh-plugin-better-plan` beside real
 * `SystemPrompt` / `ToolRuntime` / `AgentRegistry` / `UserQuestionService`
 * services, with fake Agents carrying real `Session`s and a real scoped
 * `agent.ctx` minted through `createScope`. The webServer is a capturing
 * fake (route registrations are asserted; socket traffic lives in the
 * ws-route unit tests).
 *
 * `setup` mounts through `ctx.plugin` (the real loader path). `setupDirect`
 * calls `createBetterPlan` directly to reach the delivery registry / review
 * gate for the sidebar-review flow tests (attaching a fake view is what the
 * real WebSocket would do).
 */

const CONFIG: BetterPlanConfig = resolveBetterPlanConfig({ planDir: 'docs/plans', maxPlanBytes: 262144, locale: 'auto' })

interface CapturedUpgrade {
  path: string
  handler: (req: { url?: string; headers: Record<string, string> }, socket: { destroy(): void }, head: Uint8Array) => void | Promise<void>
}

interface CapturedRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: ReviewHttpRequest, res: ReviewHttpResponse) => void | Promise<void>
}

interface Harness {
  ctx: Context
  fiber: { dispose(): Promise<void> | void }
  asked: AskUserQuestionRequest[]
  upgrades: CapturedUpgrade[]
  routes: CapturedRoute[]
  dir: string
}

type AnswerFactory = (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>

const tmpDirs: string[] = []

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Mount the real services and the capturing webServer fake. */
async function mountCore(answer?: AnswerFactory): Promise<{
  ctx: Context
  asked: AskUserQuestionRequest[]
  upgrades: CapturedUpgrade[]
  routes: CapturedRoute[]
  dir: string
}> {
  const ctx = new Context()
  const upgrades: CapturedUpgrade[] = []
  const routes: CapturedRoute[] = []
  ctx.provide('webServer', {
    registerUpgrade: (route: CapturedUpgrade) => {
      upgrades.push(route)
      return () => {}
    },
    register: (route: CapturedRoute) => {
      routes.push(route)
      return () => {}
    },
  })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  const asked: AskUserQuestionRequest[] = []
  ctx.on('user-questions/request', (request) => {
    asked.push(request)
    if (answer === undefined) throw new Error('no answerer in this test')
    return answer(request)
  })
  const dir = await mkdtemp(join(tmpdir(), 'better-plan-'))
  tmpDirs.push(dir)
  return { ctx, asked, upgrades, routes, dir }
}

async function setup(answer?: AnswerFactory, config: Partial<typeof CONFIG> = {}): Promise<Harness> {
  const core = await mountCore(answer)
  const fiber = await core.ctx.plugin(betterPlan, { ...CONFIG, ...config })
  return { ...core, fiber }
}

/** Mount the plugin body directly, exposing the registry and the review gate. */
async function setupDirect(config: Partial<typeof CONFIG> = {}): Promise<Harness & {
  registry: PlanDeliveryRegistry
  reviewGate: PlanReviewGate
}> {
  const core = await mountCore(undefined)
  const { registry, reviewGate } = betterPlan.createBetterPlan(core.ctx as unknown as Parameters<typeof betterPlan.createBetterPlan>[0], resolveBetterPlanConfig({ ...CONFIG, ...config }))
  return { ...core, fiber: { dispose() {} }, registry, reviewGate }
}

async function agentWithSession(
  harness: Harness,
  id: string,
  { active, cwd }: { active?: boolean; cwd?: string } = {},
): Promise<Agent & { session: Session; steered: UserMessage[] }> {
  const header: Record<string, unknown> = { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 0, isSeeded: false }
  if (cwd !== undefined) header.cwd = cwd
  const session = Session.create(SessionId(id), undefined, header as never)
  const steered: UserMessage[] = []
  const agent = {
    id: SessionId(id),
    session,
    options: {},
    steered,
    inject(message: UserMessage) {
      session.append('user/message', message, { surfaceOp: 'append' })
    },
    steer(message: UserMessage) {
      steered.push(message)
    },
  } as unknown as Agent & { session: Session; steered: UserMessage[] }
  let scoped!: Context
  await harness.ctx.plugin(Object.assign((inner: Context) => { scoped = createScope(inner, agent).ctx }, {
    inject: ['tools'],
  }))
  ;(agent as { ctx?: Context }).ctx = scoped
  if (active !== undefined) session.append('plan/mode', { active })
  harness.ctx.agents.enter(agent, undefined)
  harness.ctx.agents.announce(agent)
  agentEvents(harness.ctx, agent).emit('agent/session-start', { source: 'startup' })
  return agent
}

let callCounter = 0

function callExit(
  harness: Harness,
  agent: Agent | undefined,
  path: string,
  signal = new AbortController().signal,
) {
  return harness.ctx.tools.execute({
    callId: ToolCallId(`call-exit-${++callCounter}`),
    name: EXIT_PLAN_MODE,
    arguments: { path },
    signal,
    ...agent !== undefined ? { agent } : {},
  })
}

/** Drive one accepted pre-step boundary (the loop's flip flush point). */
async function boundary(harness: Harness, agent: Agent & { session: Session }): Promise<void> {
  const events = agentEvents(harness.ctx, agent)
  const message = { id: 'm', role: 'user', content: [{ type: 'text', text: 'probe' }], source: { kind: 'user' } } as unknown as UserMessage
  await events.waterfall(
    'agent/pre-step',
    { messages: [message], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [message] }),
  )
}

/** A fake review POST request (one-chunk body iterator). */
function fakeReviewRequest(body: unknown): ReviewHttpRequest {
  const raw = JSON.stringify(body)
  return {
    method: 'POST',
    url: REVIEW_API_PATH,
    headers: { host: '127.0.0.1:18080' },
    [Symbol.asyncIterator]: async function * (): AsyncIterableIterator<Uint8Array | string> {
      yield Buffer.from(raw, 'utf8')
    },
  }
}

/** Post one review decision through the plugin's captured HTTP route. */
async function postDecision(harness: Harness, body: unknown): Promise<{ status?: number; body?: string }> {
  const route = harness.routes.find(candidate => candidate.path === REVIEW_API_PATH)
  if (route === undefined) throw new Error('the review route is not registered')
  const res: { status?: number; body?: string; writeHead(status: number, headers?: Record<string, string>): void; end(body?: string): void } = {
    writeHead(status) { res.status = status },
    end(body) { res.body = body },
  }
  await route.handler(fakeReviewRequest(body), res)
  return res
}

describe('shadow registration', () => {
  it('registers the delivery WebSocket and the review API route on the webServer', async () => {
    const harness = await setup()
    expect(harness.upgrades.map(route => route.path)).toEqual([DELIVERY_WS_PATH])
    expect(harness.routes.map(route => route.path)).toEqual([REVIEW_API_PATH])
  })

  it('shadows exit_plan_mode in every started agent and leaves the global layer alone', async () => {
    const harness = await setup()
    const agent = await agentWithSession(harness, 'shadow-1', { active: true })
    const scoped = agent.ctx.tools.get(EXIT_PLAN_MODE, agent)
    expect(scoped).toBeDefined()
    expect(scoped?.description).toContain('MANDATORY two-step delivery, both steps in the same turn')
    expect(scoped?.description).toContain('write the COMPLETE plan as markdown to')
    expect(harness.ctx.tools.get(EXIT_PLAN_MODE)).toBeUndefined()
    // A second agent is shadowed independently (no duplicate-registration error).
    const second = await agentWithSession(harness, 'shadow-2', { active: true })
    expect(second.ctx.tools.get(EXIT_PLAN_MODE, second)).toBeDefined()
    // The visible schema carries the path parameter.
    const schema = agent.ctx.tools.schemas(agent).find(entry => entry.name === EXIT_PLAN_MODE)
    expect(schema?.description).toContain('sidebar plan panel')
  })

  it('keeps the built-in plan policy section text source intact (plan mode active renders it)', async () => {
    // The preset's policy section is a preset-side concern; here we assert the
    // plugin does not register any prompt section of its own.
    const harness = await setup()
    const agent = await agentWithSession(harness, 'no-section', { active: true })
    const assembly = await harness.ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.sections.find(section => section.name.startsWith('better-plan'))).toBeUndefined()
  })

  it('rewrites the preset plan policy text on the agent scope via the session-start wiring', async () => {
    // The listener must live on the agent's scope: the loop assembles with the
    // agent as the dispatch key, and scope admission flows up the chain only.
    const harness = await setup()
    const agent = await agentWithSession(harness, 'prompt-override', { active: true })
    harness.ctx.systemPrompt.section({
      name: 'plan:policy',
      order: 100,
      text: 'When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make it the only and final tool call.',
    })
    const assembly = await harness.ctx.systemPrompt.assemble({ scope: agent })
    const section = assembly.sections.find(candidate => candidate.name === 'plan:policy')
    expect(section?.text).not.toContain(PLAN_DELIVERY_ANCHOR)
    expect(section?.text).toContain('Deliver the plan in the same turn you finish it')
  })
})

describe('exit_plan_mode delivery flow', () => {
  it('approve: delivers undelivered (no view), asks with the full plan, and flips the mode at the boundary', async () => {
    const harness = await setup(() => Promise.resolve({ answers: [{ id: 'plan-review', selected: ['Approve'] }] }))
    const planPath = join(harness.dir, 'plan.md')
    const plan = '# The plan\n\ndo things'
    await writeFile(planPath, plan, 'utf8')
    const agent = await agentWithSession(harness, 'approve-1', { active: true, cwd: harness.dir })

    const result = await callExit(harness, agent, 'plan.md')

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected approved result')
    expect(result.value).toEqual({ delivered: false, decision: 'approved' })
    expect(result.content).toEqual([{
      type: 'text',
      text: 'Plan approved — plan mode exited; carry out the plan starting with your next step. (No sidebar plan panel is connected; the plan file is at plan.md.)',
    }])
    // The question carried the FULL plan (undelivered fallback) and the
    // built-in intent vocabulary.
    expect(harness.asked).toHaveLength(1)
    const question = harness.asked[0]?.questions[0]
    expect(question).toMatchObject({
      id: 'plan-review',
      header: 'Plan review',
      question: 'Approve this plan and leave plan mode?',
      detail: plan,
      intent: { kind: 'plan-review', approve: 'Approve' },
    })
    expect(question?.options?.map(option => option.label)).toEqual(['Approve', 'Keep planning'])
    expect(harness.asked[0]?.agent).toBe(agent)
    // The fold stays plan until the boundary flush, then logs the exit.
    expect(isPlanModeActive(agent.session)).toBe(true)
    await boundary(harness, agent)
    expect(isPlanModeActive(agent.session)).toBe(false)
  })

  it('falls back to the full plan detail while no sidebar view is attached', async () => {
    const harness = await setup(() => Promise.resolve({ answers: [{ id: 'plan-review', selected: ['Approve'] }] }))
    const plan = '## Fix the flake\n\nsteps'
    await writeFile(join(harness.dir, 'plan.md'), plan, 'utf8')
    const agent = await agentWithSession(harness, 'relative-1', { active: true, cwd: harness.dir })
    await callExit(harness, agent, 'plan.md')
    // delivered=false (no socket attached) ⇒ the ask detail is the FULL plan
    // text, so the user still reviews the plan on the approval card. (The
    // relative→absolute resolution shows up in the missing-file error test;
    // the push payload itself is covered by the ws-route unit tests.)
    expect(harness.asked[0]?.questions[0]?.detail).toBe(plan)
  })

  it('rejects a call outside plan mode', async () => {
    const harness = await setup()
    const agent = await agentWithSession(harness, 'inactive-1')
    const result = await callExit(harness, agent, 'plan.md')
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: exit_plan_mode is only available in plan mode' }])
  })

  it('an agent-less dispatch cannot even resolve the per-agent shadow', async () => {
    const harness = await setup()
    const result = await callExit(harness, undefined, 'plan.md')
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: unknown tool "exit_plan_mode"' }])
  })

  it('guides to the write tool when the plan file is missing', async () => {
    const harness = await setup(() => Promise.resolve({ answers: [{ id: 'plan-review', selected: ['Approve'] }] }))
    const agent = await agentWithSession(harness, 'missing-1', { active: true, cwd: harness.dir })
    const result = await callExit(harness, agent, 'does-not-exist.md')
    expect(result.isError).toBe(true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    expect(text).toContain('does-not-exist.md')
    expect(text).toContain(join(harness.dir, 'does-not-exist.md'))
    expect(text).toContain('Write the COMPLETE plan as markdown to a file with the write tool first')
    expect(text).toContain('`docs/plans/YYYY-MM-DD-<topic>.md`')
    expect(text).toContain('in the same turn')
  })

  it('refuses a plan file over the configured byte cap', async () => {
    const harness = await setup(undefined, { maxPlanBytes: 8 })
    await writeFile(join(harness.dir, 'big.md'), 'x'.repeat(64), 'utf8')
    const agent = await agentWithSession(harness, 'small-1', { active: true, cwd: harness.dir })
    const result = await callExit(harness, agent, 'big.md')
    expect(result.isError).toBe(true)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    expect(text).toContain('64 bytes')
    expect(text).toContain('8-byte')
    expect(harness.asked).toHaveLength(0)
  })

  it('keep planning: returns the corrective error and never queues the flip', async () => {
    const harness = await setup(() => Promise.resolve({ answers: [{ id: 'plan-review', selected: ['Keep planning'], custom: 'consider the resume path' }] }))
    const planPath = join(harness.dir, 'plan.md')
    await writeFile(planPath, '# The plan\n\ndo things', 'utf8')
    const agent = await agentWithSession(harness, 'keep-1', { active: true, cwd: harness.dir })
    const result = await callExit(harness, agent, 'plan.md')
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: The user chose to keep planning; their feedback: consider the resume path' }])
    await boundary(harness, agent)
    expect(isPlanModeActive(agent.session)).toBe(true)
  })

  it('keep planning without feedback returns the generic corrective error', async () => {
    const harness = await setup(() => Promise.resolve({ answers: [{ id: 'plan-review', selected: ['Keep planning'] }] }))
    await writeFile(join(harness.dir, 'plan.md'), '# The plan', 'utf8')
    const agent = await agentWithSession(harness, 'keep-2', { active: true, cwd: harness.dir })
    const result = await callExit(harness, agent, 'plan.md')
    expect(result.content).toEqual([{ type: 'text', text: 'Error: The user chose to keep planning; revise the plan file and present it again.' }])
  })

  it('a dismissed review reads as the user taking the turn back', async () => {
    const harness = await setup(() => Promise.reject(new UserQuestionError('cancelled', 'ASK_CANCELLED')))
    await writeFile(join(harness.dir, 'plan.md'), '# The plan', 'utf8')
    const agent = await agentWithSession(harness, 'cancel-1', { active: true, cwd: harness.dir })
    const result = await callExit(harness, agent, 'plan.md')
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{
      type: 'text',
      text: 'Error: The user dismissed the plan review to speak instead; stay in plan mode, stop here, and wait for their message.',
    }])
    expect(isPlanModeActive(agent.session)).toBe(true)
  })

  it('fails the call when the plugin is disposed while the review awaits (no phantom exit)', async () => {
    let resolveAnswer!: (value: AskUserQuestionAnswer) => void
    const harness = await setup(() => new Promise<AskUserQuestionAnswer>((resolve) => { resolveAnswer = resolve }))
    await writeFile(join(harness.dir, 'plan.md'), '# The plan', 'utf8')
    const agent = await agentWithSession(harness, 'disposed-1', { active: true, cwd: harness.dir })
    const pending = callExit(harness, agent, 'plan.md')
    // Wait until the review actually awaits (fs reads take real I/O ticks),
    // then unload the plugin (HMR) and only afterwards approve. The pre-step
    // flush listener is gone, so a success would claim an exit that can never
    // land — the call must fail instead. (Time-budgeted, not tick-counted:
    // the suite runs in parallel and tick budgets flake under load.)
    for (let waited = 0; harness.asked.length === 0 && waited < 4000; waited += 10) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(harness.asked).toHaveLength(1)
    await harness.fiber.dispose()
    resolveAnswer({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: the better-plan plugin was reloaded while the plan was under review; write the plan and present it again' }])
    expect(isPlanModeActive(agent.session)).toBe(true)
  })

  it('keeps the flip pending through a failed append and lands it at the next boundary', async () => {
    const harness = await setup(() => Promise.resolve({ answers: [{ id: 'plan-review', selected: ['Approve'] }] }))
    await writeFile(join(harness.dir, 'plan.md'), '# The plan', 'utf8')
    const agent = await agentWithSession(harness, 'retry-1', { active: true, cwd: harness.dir })
    const warn = vi.fn()
    harness.ctx.logger.warn = warn as never
    const original = agent.session.append.bind(agent.session)
    agent.session.append = (((type: string, ...rest: unknown[]) => {
      if (type === 'plan/mode') throw new Error('backend gone')
      return (original as (...args: unknown[]) => unknown)(type, ...rest)
    }) as unknown) as typeof agent.session.append
    await callExit(harness, agent, 'plan.md')
    await boundary(harness, agent)
    expect(warn).toHaveBeenCalledOnce()
    expect(isPlanModeActive(agent.session)).toBe(true)
    agent.session.append = original
    await boundary(harness, agent)
    expect(isPlanModeActive(agent.session)).toBe(false)
  })
})

describe('sidebar review flow (delivery returns at once, the decision steers back)', () => {
  it('approve: returns pending with the end-turn narration, no popup; the route decision flips the mode and steers the next turn', async () => {
    const harness = await setupDirect()
    const sessionId = 'side-approve-1'
    const deliveries: unknown[] = []
    const reviews: ReviewFrame[] = []
    const detachDelivery = harness.registry.attach(sessionId, delivery => deliveries.push(delivery))
    const detachReview = harness.reviewGate.attach(sessionId, frame => reviews.push(frame))
    const planPath = join(harness.dir, 'plan.md')
    await writeFile(planPath, '# The plan\n\ndo things', 'utf8')
    const agent = await agentWithSession(harness, sessionId, { active: true, cwd: harness.dir })

    const result = await callExit(harness, agent, 'plan.md')

    // The call returns at once — nothing parks, nothing hangs.
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected pending result')
    expect(result.value).toEqual({ delivered: true, decision: 'pending' })
    expect(result.content).toHaveLength(1)
    expect(result.content[0]?.type === 'text' && result.content[0].text).toContain('End your turn now')
    // No chat popup: the question channel never fired; the plan panel saw
    // the delivery and the pending review.
    expect(harness.asked).toHaveLength(0)
    expect(deliveries).toHaveLength(1)
    expect(reviews.map(frame => frame.review === null ? null : frame.review?.status ?? null)).toEqual([null, 'pending'])
    // The mode stays on while the review is open.
    expect(isPlanModeActive(agent.session)).toBe(true)

    const res = await postDecision(harness, { session: sessionId, decision: 'approve' })
    expect(res.status).toBe(200)
    // Out-of-turn approval: the flip appends immediately and the decision is
    // steered back as the next turn's message.
    expect(reviews.at(-1)?.review?.status).toBe('approved')
    expect(isPlanModeActive(agent.session)).toBe(false)
    expect(agent.steered).toHaveLength(1)
    const steerText = agent.steered[0]?.content.find(part => part.type === 'text')
    expect(steerText?.type === 'text' && steerText.text).toContain('approved the plan in the sidebar plan panel')
    detachDelivery()
    detachReview()
  })

  it('keep planning from the sidebar steers the feedback back and never flips the mode', async () => {
    const harness = await setupDirect()
    const sessionId = 'side-keep-1'
    harness.registry.attach(sessionId, () => {})
    harness.reviewGate.attach(sessionId, () => {})
    await writeFile(join(harness.dir, 'plan.md'), '# The plan', 'utf8')
    const agent = await agentWithSession(harness, sessionId, { active: true, cwd: harness.dir })
    const result = await callExit(harness, agent, 'plan.md')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected pending result')
    expect(result.value).toEqual({ delivered: true, decision: 'pending' })
    expect(harness.asked).toHaveLength(0)

    const res = await postDecision(harness, { session: sessionId, decision: 'keep', feedback: 'consider the resume path' })
    expect(res.status).toBe(200)
    expect(isPlanModeActive(agent.session)).toBe(true)
    expect(agent.steered).toHaveLength(1)
    const steerText = agent.steered[0]?.content.find(part => part.type === 'text')
    expect(steerText?.type === 'text' && steerText.text).toContain('chose to keep planning')
    expect(steerText?.type === 'text' && steerText.text).toContain('Their feedback: consider the resume path')
  })

  it('a zh session localizes the render content and the steered decisions (config locale: zh)', async () => {
    const harness = await setupDirect({ locale: 'zh' })
    const sessionId = 'side-zh-1'
    harness.registry.attach(sessionId, () => {})
    harness.reviewGate.attach(sessionId, () => {})
    await writeFile(join(harness.dir, 'plan.md'), '# The plan', 'utf8')
    const agent = await agentWithSession(harness, sessionId, { active: true, cwd: harness.dir })

    // The tool result content is the localized end-of-turn contract…
    const result = await callExit(harness, agent, 'plan.md')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected pending result')
    expect(result.value).toEqual({ delivered: true, decision: 'pending' })
    expect(result.content[0]?.type === 'text' && result.content[0].text).toContain('请立即结束回合')
    expect(harness.asked).toHaveLength(0)

    // …and the sidebar approve steers the localized execution kick-off.
    const res = await postDecision(harness, { session: sessionId, decision: 'approve' })
    expect(res.status).toBe(200)
    expect(isPlanModeActive(agent.session)).toBe(false)
    expect(agent.steered).toHaveLength(1)
    const steerText = agent.steered[0]?.content.find(part => part.type === 'text')
    expect(steerText?.type === 'text' && steerText.text).toContain('[计划审批]')
    expect(steerText?.type === 'text' && steerText.text).toContain('从这一步开始执行计划')
  })

  it('approve_new_session settles delegated: the mode flips but the steer hands execution off instead of starting it', async () => {
    const harness = await setupDirect({ locale: 'zh' })
    const sessionId = 'side-delegate-1'
    const reviews: ReviewFrame[] = []
    harness.registry.attach(sessionId, () => {})
    harness.reviewGate.attach(sessionId, frame => reviews.push(frame))
    await writeFile(join(harness.dir, 'plan.md'), '# The plan', 'utf8')
    const agent = await agentWithSession(harness, sessionId, { active: true, cwd: harness.dir })
    const result = await callExit(harness, agent, 'plan.md')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected pending result')

    const res = await postDecision(harness, { session: sessionId, decision: 'approve_new_session' })
    expect(res.status).toBe(200)
    // The wire settles as delegated (the panel's status line for the
    // handoff), the mode is off, and the steer closes the planning session
    // without ordering execution here.
    expect(reviews.at(-1)?.review?.status).toBe('delegated')
    expect(isPlanModeActive(agent.session)).toBe(false)
    expect(agent.steered).toHaveLength(1)
    const steerText = agent.steered[0]?.content.find(part => part.type === 'text')
    expect(steerText?.type === 'text' && steerText.text).toContain('[计划审批]')
    expect(steerText?.type === 'text' && steerText.text).toContain('在一个新对话中执行')
    expect(steerText?.type === 'text' && steerText.text).toContain('不要在此会话中执行该计划')
  })

  it('the popup fallback copy follows the view-reported locale (auto config, zh report)', async () => {
    // The config stays auto, but a sidebar view attached earlier in the
    // session reported zh on its review bootstrap (what the plan panel's
    // GET does on mount); the view is now gone, so delivery falls back to
    // the popup — whose copy resolves from the reported locale.
    const harness = await setup(() => Promise.resolve({ answers: [{ id: 'plan-review', selected: ['批准'] }] }))
    const sessionId = 'popup-zh-1'
    const planPath = join(harness.dir, 'plan.md')
    await writeFile(planPath, '# The plan', 'utf8')
    const agent = await agentWithSession(harness, sessionId, { active: true, cwd: harness.dir })
    // Drive the locale report through the captured review route.
    const route = harness.routes.find(candidate => candidate.path === REVIEW_API_PATH)
    if (route === undefined) throw new Error('the review route is not registered')
    const res: { status?: number; body?: string; writeHead(): void; end(): void } = {
      writeHead() {}, end() {},
    }
    await route.handler({
      method: 'GET',
      url: `${REVIEW_API_PATH}?session=${sessionId}&locale=zh-CN`,
      headers: { host: '127.0.0.1:18080' },
    } as unknown as ReviewHttpRequest, res as unknown as ReviewHttpResponse)

    const result = await callExit(harness, agent, 'plan.md')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected approved result')
    expect(result.value).toEqual({ delivered: false, decision: 'approved' })
    // The popup question copy was Chinese (the ask carried the zh copy and
    // the answerer matched the localized approve label).
    expect(harness.asked).toHaveLength(1)
    expect(harness.asked[0]?.questions[0]?.header).toBe('计划审批')
  })

  it('a second delivery supersedes the open review: only the newest handlers can fire', async () => {
    const harness = await setupDirect()
    const sessionId = 'side-supersede-1'
    harness.registry.attach(sessionId, () => {})
    harness.reviewGate.attach(sessionId, () => {})
    await writeFile(join(harness.dir, 'plan.md'), '# The plan v1', 'utf8')
    const agent = await agentWithSession(harness, sessionId, { active: true, cwd: harness.dir })
    await callExit(harness, agent, 'plan.md')
    const firstReview = harness.reviewGate.peek(sessionId)
    expect(firstReview).not.toBeNull()
    // Revise and re-deliver.
    await writeFile(join(harness.dir, 'plan.md'), '# The plan v2', 'utf8')
    await callExit(harness, agent, 'plan.md')
    const secondReview = harness.reviewGate.peek(sessionId)
    expect(secondReview?.id).not.toBe(firstReview?.id)

    // The stale window still holds the first id: refused, nothing settles.
    const stale = await postDecision(harness, { session: sessionId, decision: 'approve', id: firstReview?.id })
    expect(stale.status).toBe(409)
    expect(harness.reviewGate.peek(sessionId)?.id).toBe(secondReview?.id)

    // The fresh decision lands.
    const res = await postDecision(harness, { session: sessionId, decision: 'approve' })
    expect(res.status).toBe(200)
    expect(isPlanModeActive(agent.session)).toBe(false)
    expect(agent.steered).toHaveLength(1)
  })
})
