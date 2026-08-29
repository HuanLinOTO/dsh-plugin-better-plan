import { describe, expect, it } from 'vitest'
import { resolveBetterPlanConfig, type BetterPlanConfig } from '../src/config.ts'
import { PlanDeliveryRegistry } from '../src/delivery-registry.ts'
import {
  approvalSteerText, delegatedSteerText, keepPlanningSteerText, planReviewCopy,
} from '../src/locale.ts'
import { PlanReviewGate } from '../src/review-gate.ts'
import { REVIEW_ID, defineExitPlanTool, exitPlanDescription, reviewDetail } from '../src/shadow-tool.ts'

const CONFIG: BetterPlanConfig = resolveBetterPlanConfig({})

/** Build the shadow tool with inert collaborators (projections never touch them). */
function stubTool(localeOf: (sessionId: string | undefined) => 'zh' | 'en' = () => 'en'): ReturnType<typeof defineExitPlanTool> {
  return defineExitPlanTool({
    ctx: {} as never,
    config: CONFIG,
    registry: new PlanDeliveryRegistry(),
    reviewGate: new PlanReviewGate(),
    localeOf,
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

  it('exposes the review question id the answer is read by', () => {
    expect(REVIEW_ID).toBe('plan-review')
  })

  it('localizes the render content at finalize time for a non-English session', () => {
    const tool = stubTool(() => 'zh')
    const exec = {
      agent: { session: { id: 's1' } },
      arguments: { path: '/repo/docs/plans/2026-08-09-demo.md' },
    } as never
    const pending = tool.finalizeContent?.(exec, {
      isError: false,
      value: { delivered: true, decision: 'pending' },
      content: [{ type: 'text', text: 'English baseline' }],
    } as never)
    expect(pending).toHaveLength(1)
    expect(pending?.[0]?.type === 'text' && pending[0].text).toContain('请立即结束回合')
    expect(pending?.[0]?.type === 'text' && pending[0].text).toContain('不要再调用任何工具')
    const approved = tool.finalizeContent?.(exec, {
      isError: false,
      value: { delivered: false, decision: 'approved' },
      content: [{ type: 'text', text: 'English baseline' }],
    } as never)
    expect(approved?.[0]?.type === 'text' && approved[0].text).toContain('计划已批准')
    expect(approved?.[0]?.type === 'text' && approved[0].text).toContain('2026-08-09-demo.md')
  })

  it('preserves the English baseline for English sessions, errors, and agent-less executions', () => {
    const english = stubTool(() => 'en')
    const outcome = { isError: false, value: { delivered: true, decision: 'pending' }, content: [{ type: 'text', text: 'base' }] } as never
    expect(english.finalizeContent?.({ agent: { session: { id: 's1' } }, arguments: {} } as never, outcome)).toBeUndefined()
    const zhError = stubTool(() => 'zh')
    expect(zhError.finalizeContent?.({ agent: { session: { id: 's1' } }, arguments: {} } as never, { isError: true, error: {} } as never)).toBeUndefined()
    // No calling agent → no session → no locale → preserve.
    expect(zhError.finalizeContent?.({ arguments: {} } as never, outcome)).toBeUndefined()
  })

  it('builds the localized steer messages the sidebar decisions fire', () => {
    expect(approvalSteerText('en')).toContain('approved the plan in the sidebar plan panel')
    expect(approvalSteerText('en')).toContain('Plan mode is now off')
    expect(approvalSteerText('zh')).toContain('[计划审批]')
    expect(approvalSteerText('zh')).toContain('计划模式现已关闭')
    expect(keepPlanningSteerText(undefined, 'en')).toContain('chose to keep planning')
    expect(keepPlanningSteerText(undefined, 'en')).not.toContain('Their feedback')
    expect(keepPlanningSteerText('add tests', 'en')).toContain('Their feedback: add tests.')
    expect(keepPlanningSteerText('补测试', 'zh')).toContain('用户的反馈：补测试。')
    expect(keepPlanningSteerText(undefined, 'zh')).not.toContain('用户的反馈')
    expect(keepPlanningSteerText(undefined, 'zh')).toContain('重新调用 exit_plan_mode 提交')
  })

  it('builds the delegation steer that closes the planning session without executing', () => {
    const en = delegatedSteerText('en')
    expect(en).toContain('approved the plan and chose to carry it out in a NEW conversation')
    expect(en).toContain('do not execute the plan here')
    expect(en).toContain('acknowledge briefly and end your turn')
    const zh = delegatedSteerText('zh')
    expect(zh).toContain('[计划审批]')
    expect(zh).toContain('在一个新对话中执行')
    expect(zh).toContain('不要在此会话中执行该计划')
    expect(zh).toContain('简短确认收到后结束回合')
  })

  it('builds the localized no-sidebar review question (labels pair with the ask intent)', () => {
    const en = planReviewCopy('en')
    expect(en.header).toBe('Plan review')
    expect(en.approveLabel).toBe('Approve')
    expect(en.keepLabel).toBe('Keep planning')
    const zh = planReviewCopy('zh')
    expect(zh.header).toBe('计划审批')
    expect(zh.approveLabel).toBe('批准')
    expect(zh.keepLabel).toBe('继续规划')
    expect(zh.approveLabel).not.toBe(zh.keepLabel)
  })
})
