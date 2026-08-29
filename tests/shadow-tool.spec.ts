import { describe, expect, it } from 'vitest'
import { resolveBetterPlanConfig, type BetterPlanConfig } from '../src/config.ts'
import { PlanDeliveryRegistry } from '../src/delivery-registry.ts'
import { PlanReviewGate } from '../src/review-gate.ts'
import { APPROVAL_STEER_TEXT, APPROVE_LABEL, KEEP_PLANNING_LABEL, REVIEW_ID, defineExitPlanTool, exitPlanDescription, keepPlanningSteerText, reviewDetail } from '../src/shadow-tool.ts'

const CONFIG: BetterPlanConfig = resolveBetterPlanConfig({})

/** Build the shadow tool with inert collaborators (projections never touch them). */
function stubTool(): ReturnType<typeof defineExitPlanTool> {
  return defineExitPlanTool({
    ctx: {} as never,
    config: CONFIG,
    registry: new PlanDeliveryRegistry(),
    reviewGate: new PlanReviewGate(),
    isDisposed: () => false,
    onApproved: () => {},
  })
}

describe('exitPlanDescription', () => {
  it('carries the mandatory two-step same-turn delivery contract', () => {
    const description = exitPlanDescription(resolveBetterPlanConfig({ planDir: 'docs/plans' }))
    expect(description).toMatch(/^Use only in plan mode\./)
    expect(description).toContain('MANDATORY two-step delivery, both steps in the same turn')
    expect(description).toContain('write the COMPLETE plan as markdown to `docs/plans/YYYY-MM-DD-<topic>.md`')
    expect(description).toContain("`docs/plans/2026-08-09-dsh-pet-rust-impl-spec.md`")
    expect(description).toContain("today's date")
    expect(description).toContain('never end the turn with the plan file written but this tool not called')
    expect(description).toContain('sidebar plan panel')
    expect(description).toContain('returns immediately')
    expect(description).toContain('end your turn right after it and wait')
    expect(description).toContain('revise the file and present it again')
  })
})

describe('reviewDetail (D3: the popup fallback carries the full plan)', () => {
  it('is the full plan text (only the no-sidebar fallback reaches the question)', () => {
    const plan = '# The plan\n\ndo things'
    expect(reviewDetail(plan)).toBe(plan)
  })
})

describe('the shadow tool definition (pure projections)', () => {
  it('keeps the built-in name and the required path parameter', () => {
    const tool = stubTool()
    expect(tool.name).toBe('exit_plan_mode')
    const parameters = tool.parameters as { properties: Record<string, unknown>; required?: string[] }
    expect(Object.keys(parameters.properties)).toEqual(['path'])
    expect(parameters.required).toEqual(['path'])
  })

  it('presents the call as a compact generic card titled by the file basename', () => {
    const tool = stubTool()
    const view = tool.presentCall?.({ path: 'docs/plans/2026-08-29-topic.md' })
    expect(view).toEqual({
      card: 'generic',
      title: '2026-08-29-topic.md',
      kind: 'other',
      content: [{ type: 'text', text: 'Plan file delivered for review — the complete plan opens in the sidebar plan panel; the conversation waits for the user\'s decision there.' }],
    })
    // The card never carries the plan body (compact by design).
    expect(JSON.stringify(view)).not.toContain('# The plan')
  })

  it('presents the result as the generic review card', () => {
    const tool = stubTool()
    const content = [{ type: 'text' as const, text: 'ok' }]
    expect(tool.presentResult?.({ path: '/p.md' }, { content, isError: false })).toEqual({
      card: 'generic',
      title: 'Plan review',
      content,
    })
  })

  it('renders the pending branch as the end-of-turn contract and the approved branch for the popup path', () => {
    const tool = stubTool()
    const pending = tool.output.render({ path: '/p.md' }, { delivered: true, decision: 'pending' })
    expect(pending).toHaveLength(1)
    expect(pending[0]?.type === 'text' && pending[0].text).toContain('End your turn now')
    expect(pending[0]?.type === 'text' && pending[0].text).toContain('sidebar plan panel')
    expect(pending[0]?.type === 'text' && pending[0].text).toContain('do not call any more tools')
    expect(tool.output.render({ path: '/p.md' }, { delivered: false, decision: 'approved' }))
      .toEqual([{ type: 'text', text: 'Plan approved — plan mode exited; carry out the plan starting with your next step. (No sidebar plan panel is connected; the plan file is at /p.md.)' }])
  })

  it('exposes the review vocabulary the question and intent are built from', () => {
    expect(REVIEW_ID).toBe('plan-review')
    expect(APPROVE_LABEL).toBe('Approve')
    expect(KEEP_PLANNING_LABEL).toBe('Keep planning')
  })

  it('builds the steer messages the sidebar decisions fire', () => {
    expect(APPROVAL_STEER_TEXT).toContain('approved the plan in the sidebar plan panel')
    expect(APPROVAL_STEER_TEXT).toContain('Plan mode is now off')
    expect(keepPlanningSteerText(undefined)).toContain('chose to keep planning')
    expect(keepPlanningSteerText(undefined)).not.toContain('Their feedback')
    expect(keepPlanningSteerText('add tests')).toContain('Their feedback: add tests.')
  })
})
