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
import { foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
import { EXIT_PLAN_MODE } from '@deepseek-ai/dsh-plan-mode'
import { PLAN_DELIVERY_ANCHOR } from '../src/prompt-override.ts'
import * as betterPlan from '../src/index.ts'
import { DELIVERY_WS_PATH } from '../src/ws-route.ts'

/**
 * Drives the REAL plugin: mounts `dsh-plugin-better-plan` beside real
 * `SystemPrompt` / `ToolRuntime` / `AgentRegistry` / `UserQuestionService`
 * services, with fake Agents carrying real `Session`s and a real scoped
 * `agent.ctx` minted through `createScope`. The webServer is a capturing
 * fake (the WS route registration is asserted; socket traffic lives in the
 * ws-route unit tests).
 */

const CONFIG = { planDir: 'docs/plans', maxPlanBytes: 262144 }

interface CapturedUpgrade {
  path: string
  handler: (req: { url?: string; headers: Record<string, string> }, socket: { destroy(): void }, head: Uint8Array) => void | Promise<void>
}

interface Harness {
  ctx: Context
  fiber: { dispose(): Promise<void> | void }
  asked: AskUserQuestionRequest[]
  upgrades: CapturedUpgrade[]
  dir: string
}

type AnswerFactory = (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>

const tmpDirs: string[] = []

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function setup(answer?: AnswerFactory, config: Partial<typeof CONFIG> = {}): Promise<Harness> {
  const ctx = new Context()
  const upgrades: CapturedUpgrade[] = []
  ctx.provide('webServer', {
    registerUpgrade: (route: CapturedUpgrade) => {
      upgrades.push(route)
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
  const fiber = await ctx.plugin(betterPlan, { ...CONFIG, ...config })
  const dir = await mkdtemp(join(tmpdir(), 'better-plan-'))
  tmpDirs.push(dir)
  return { ctx, fiber, asked, upgrades, dir }
}

async function agentWithSession(
  harness: Harness,
  id: string,
  { active, cwd }: { active?: boolean; cwd?: string } = {},
): Promise<Agent & { session: Session }> {
  const header: Record<string, unknown> = { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 0 }
  if (cwd !== undefined) header.cwd = cwd
  const session = Session.create(SessionId(id), undefined, header as never)
  const agent = {
    id: SessionId(id),
    session,
    options: {},
    inject(message: UserMessage) {
      session.append('user/message', message, { surfaceOp: 'append' })
    },
  } as unknown as Agent & { session: Session }
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

describe('shadow registration', () => {
  it('registers the delivery route on the webServer', async () => {
    const harness = await setup()
    expect(harness.upgrades.map(route => route.path)).toEqual([DELIVERY_WS_PATH])
  })

  it('shadows exit_plan_mode in every started agent and leaves the global layer alone', async () => {
    const harness = await setup()
    const agent = await agentWithSession(harness, 'shadow-1', { active: true })
    const scoped = agent.ctx.tools.get(EXIT_PLAN_MODE, agent)
    expect(scoped).toBeDefined()
    expect(scoped?.description).toContain('write the COMPLETE plan as markdown to a file')
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
    const assembly = await harness.ctx.systemPrompt.assemble({ agent, scope: agent })
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
    const assembly = await harness.ctx.systemPrompt.assemble({ agent, scope: agent })
    const section = assembly.sections.find(candidate => candidate.name === 'plan:policy')
    expect(section?.text).not.toContain(PLAN_DELIVERY_ANCHOR)
    expect(section?.text).toContain('call exit_plan_mode with the path of the plan file you wrote')
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
    expect(result.value).toEqual({ approved: true, delivered: false })
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
    expect(foldPlanMode(agent.session.events)).toBe(true)
    await boundary(harness, agent)
    expect(foldPlanMode(agent.session.events)).toBe(false)
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
    expect(foldPlanMode(agent.session.events)).toBe(true)
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
    expect(foldPlanMode(agent.session.events)).toBe(true)
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
    // land — the call must fail instead.
    for (let waited = 0; harness.asked.length === 0 && waited < 100; waited++) {
      await new Promise(resolve => setImmediate(resolve))
    }
    expect(harness.asked).toHaveLength(1)
    await harness.fiber.dispose()
    resolveAnswer({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: the better-plan plugin was reloaded while the plan was under review; write the plan and present it again' }])
    expect(foldPlanMode(agent.session.events)).toBe(true)
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
    expect(foldPlanMode(agent.session.events)).toBe(true)
    agent.session.append = original
    await boundary(harness, agent)
    expect(foldPlanMode(agent.session.events)).toBe(false)
  })
})
