import { describe, expect, it } from 'vitest'
import { resolveBetterPlanConfig, type BetterPlanConfig } from '../src/config.ts'
import { PlanDeliveryRegistry } from '../src/delivery-registry.ts'
import { APPROVE_LABEL, KEEP_PLANNING_LABEL, REVIEW_ID, defineExitPlanTool, exitPlanDescription, reviewDetail } from '../src/shadow-tool.ts'

const CONFIG: BetterPlanConfig = resolveBetterPlanConfig({})

/** Build the shadow tool with inert collaborators (projections never touch them). */
function stubTool(): ReturnType<typeof defineExitPlanTool> {
  return defineExitPlanTool({
    ctx: {} as never,
    config: CONFIG,
    registry: new PlanDeliveryRegistry(),
    isDisposed: () => false,
    onApproved: () => {},
  })
}

describe('exitPlanDescription', () => {
  it('carries the file-first contract and the configured planDir suggestion', () => {
    const description = exitPlanDescription(resolveBetterPlanConfig({ planDir: 'docs/plans' }))
    expect(description).toMatch(/^Use only in plan mode\./)
    expect(description).toContain('write tool')
    expect(description).toContain('`docs/plans/YYYY-MM-DD-<topic>.md`')
    expect(description).toContain('sidebar plan panel')
    expect(description).toContain('revise the file and present again')
  })
})

describe('reviewDetail (D3 branch selection)', () => {
  const plan = '# The plan\n\ndo things'

  it('returns the one-line pointer with the path when delivered', () => {
    const detail = reviewDetail(true, plan, '/repo/docs/plans/p.md')
    expect(detail).toContain('sidebar plan panel')
    expect(detail).toContain('/repo/docs/plans/p.md')
    expect(detail).not.toContain('do things')
  })

  it('falls back to the full plan text when not delivered', () => {
    expect(reviewDetail(false, plan, '/repo/docs/plans/p.md')).toBe(plan)
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
      content: [{ type: 'text', text: 'Plan file delivered for review — the complete plan opens in the sidebar plan panel; approve or keep planning below.' }],
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

  it('renders the model-facing confirmation with the delivered branch', () => {
    const tool = stubTool()
    expect(tool.output.render({ path: '/p.md' }, { approved: true, delivered: true }))
      .toEqual([{ type: 'text', text: 'Plan approved — plan mode exited; carry out the plan starting with your next step. The plan is open in the sidebar plan panel.' }])
    expect(tool.output.render({ path: '/p.md' }, { approved: true, delivered: false }))
      .toEqual([{ type: 'text', text: 'Plan approved — plan mode exited; carry out the plan starting with your next step. (No sidebar plan panel is connected; the plan file is at /p.md.)' }])
  })

  it('exposes the review vocabulary the question and intent are built from', () => {
    expect(REVIEW_ID).toBe('plan-review')
    expect(APPROVE_LABEL).toBe('Approve')
    expect(KEEP_PLANNING_LABEL).toBe('Keep planning')
  })
})
