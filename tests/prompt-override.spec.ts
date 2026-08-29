import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import * as betterPlan from '../src/index.ts'
import { PLAN_DELIVERY_ANCHOR, registerPlanPolicyOverride, rewritePlanPolicySection } from '../src/prompt-override.ts'

/**
 * The `plan:policy` section text exactly as the shipped presets configure it
 * (standard/ptc/cordis `agent.cordis.yml`). The rewrite is anchored on
 * verbatim sentences from this text.
 */
const SHIPPED_SECTION = [
  'You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user\'s conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.',
  'Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.',
  'The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.',
  'Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.',
  'Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.',
  'When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.',
].join('\n\n')

describe('rewritePlanPolicySection', () => {
  it('rewrites the shipped section to the file-first contract', () => {
    const result = rewritePlanPolicySection(SHIPPED_SECTION, 'docs/plans')
    // The inline-plan delivery sentence is gone, replaced by the path contract.
    expect(result).not.toContain(PLAN_DELIVERY_ANCHOR)
    expect(result).toContain('call exit_plan_mode with the path of the plan file you wrote')
    expect(result).toContain('the complete plan markdown must already be in the file')
    expect(result).toContain('Never paste the plan text into the tool call.')
    // The write ban keeps standing but carves out the delivery file.
    expect(result).toContain('Do not edit or write files, change configuration')
    expect(result).toContain('this delivery write is allowed in plan mode')
    expect(result).toContain('`docs/plans/YYYY-MM-DD-<topic>.md`')
    // The override claim keeps standing with its exception named.
    expect(result).toContain('those tools remain listed to keep the tool catalog unchanged.')
    expect(result).toContain('The exit_plan_mode file-first contract is the single exception to that override.')
    // Untouched guidance survives verbatim.
    expect(result).toContain('You are in plan mode. Stay in plan mode until exit_plan_mode succeeds')
    expect(result).toContain('Make the plan decision-complete')
    expect(result).toContain('Do not use todo_write to track this planning phase')
  })

  it('flows the configured planDir into the delivery example', () => {
    const result = rewritePlanPolicySection(SHIPPED_SECTION, 'plans')
    expect(result).toContain('`plans/YYYY-MM-DD-<topic>.md`')
    expect(result).not.toContain('docs/plans')
  })

  it('leaves text without the anchors untouched', () => {
    expect(rewritePlanPolicySection('', 'docs/plans')).toBe('')
    expect(rewritePlanPolicySection('Plan mode is a planning surface.', 'docs/plans'))
      .toBe('Plan mode is a planning surface.')
  })

  it('is idempotent (an already-rewritten section passes through unchanged)', () => {
    const once = rewritePlanPolicySection(SHIPPED_SECTION, 'docs/plans')
    expect(rewritePlanPolicySection(once, 'docs/plans')).toBe(once)
  })
})

describe('assemble waterfall', () => {
  /**
   * Minimal harness mirroring the loop's dispatch: the real system-prompt
   * registry, the plugin mounted (proving no global-fiber registration), and
   * one agent-scoped context minted through `createScope` — the agent is the
   * loop's assemble dispatch key, so the override must live on that scope.
   */
  async function setup(): Promise<{ ctx: Context; agent: Agent }> {
    const ctx = new Context()
    ctx.provide('webServer', { registerUpgrade: () => () => {} })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(betterPlan, { planDir: 'docs/plans', maxPlanBytes: 262144 })
    const agent = {} as Agent
    await ctx.plugin(Object.assign((inner: Context) => {
      const agentCtx = createScope(inner, agent).ctx
      agentCtx.effect(
        () => registerPlanPolicyOverride(agentCtx, 'docs/plans'),
        'test: plan policy override',
      )
    }, { inject: [] }))
    return { ctx, agent }
  }

  it('rewrites the assembled plan-mode section on the agent scope', async () => {
    const { ctx, agent } = await setup()
    ctx.systemPrompt.section({ name: 'plan:policy', order: 100, text: SHIPPED_SECTION })
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    const section = assembly.sections.find(candidate => candidate.name === 'plan:policy')
    expect(section?.text).toBeDefined()
    expect(section?.text).not.toContain(PLAN_DELIVERY_ANCHOR)
    expect(section?.text).toContain('call exit_plan_mode with the path of the plan file you wrote')
  })

  it('does not reach assemblies dispatched outside the registered scope', async () => {
    // An unscoped assemble dispatches to the registry's own scope; the
    // agent-tagged listener stays excluded (events flow up the chain only).
    // This pins WHY the registration must be per-agent.
    const { ctx } = await setup()
    ctx.systemPrompt.section({ name: 'plan:policy', order: 100, text: SHIPPED_SECTION })
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(candidate => candidate.name === 'plan:policy')
    expect(section?.text).toBe(SHIPPED_SECTION)
  })

  it('passes unrelated sections through untouched', async () => {
    const { ctx, agent } = await setup()
    const unrelated = 'Review guidance for something else entirely.'
    ctx.systemPrompt.section({ name: 'unrelated', order: 100, text: unrelated })
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.sections.find(candidate => candidate.name === 'unrelated')?.text).toBe(unrelated)
  })
})
