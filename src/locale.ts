/**
 * Locale vocabulary and resolution for the host half, plus the localized
 * user-facing copy the host generates: the delivery render text (through the
 * tool's `finalizeContent` seam), the steer messages that announce the
 * sidebar decision, and the no-sidebar review question.
 *
 * Deliberately NOT localized (model contract, English only): the shadow
 * tool's description, the `plan:policy` prompt rewrite, and every execute
 * error message — those are instructions the model must parse reliably, and
 * the built-in presets keep the same English-only contract.
 *
 * The active locale resolves per session: the plugin config's `locale`
 * override wins, else the locale the sidebar view reported (the browser's
 * active DSH locale, carried on the delivery WS connect and every review
 * request), else English.
 *
 * @module @huanlin/dsh-plugin-better-plan/locale
 */

/** The locales this plugin ships copy for. */
export type PlanLocale = 'zh' | 'en'

/** The plugin config's locale knob: a forced locale or browser following. */
export type LocaleSetting = 'auto' | PlanLocale

/**
 * Normalize one client-reported locale tag (BCP 47-style, e.g. `zh-CN`)
 * to a shipped {@link PlanLocale}, or undefined when unsupported.
 * @param value - the raw reported value (query param / body field).
 * @returns `'zh'` / `'en'`, or undefined when the value is not a supported tag.
 */
export function normalizeReportedLocale(value: unknown): PlanLocale | undefined {
  if (typeof value !== 'string') return undefined
  const tag = value.trim().toLowerCase()
  if (tag === '' || tag.length > 12 || !/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i.test(tag)) return undefined
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh'
  if (tag === 'en' || tag.startsWith('en-')) return 'en'
  return undefined
}

/**
 * Per-session directory of sidebar-reported locales. The browser view is the
 * authority on the user's language (the DSH locale preference is Host-backed
 * and already reflected in the client's active locale), so the host learns
 * the locale from the client instead of reading settings itself.
 */
export class LocaleDirectory {
  private reported = new Map<string, PlanLocale>()

  /**
   * Record one view-reported locale for a session (invalid values ignored).
   * @param sessionId - the session the view is subscribed to.
   * @param value - the raw reported locale tag.
   */
  report(sessionId: string, value: unknown): void {
    const locale = normalizeReportedLocale(value)
    if (locale === undefined || sessionId === '') return
    this.reported.set(sessionId, locale)
  }

  /**
   * The locale a session's connected view reported, if any.
   * @param sessionId - the session to look up.
   */
  known(sessionId: string | undefined): PlanLocale | undefined {
    if (sessionId === undefined) return undefined
    return this.reported.get(sessionId)
  }

  /** Drop every report (plugin disposal). */
  dispose(): void {
    this.reported.clear()
  }
}

/**
 * Resolve the locale for one session's user-facing copy.
 * @param setting - the plugin config's locale knob.
 * @param directory - the sidebar-reported locale directory.
 * @param sessionId - the session the copy is generated for.
 * @returns the resolved locale (English when nothing better is known).
 */
export function resolvePlanLocale(
  setting: LocaleSetting,
  directory: LocaleDirectory,
  sessionId: string | undefined,
): PlanLocale {
  if (setting !== 'auto') return setting
  return directory.known(sessionId) ?? 'en'
}

/**
 * The localized render content for a delivered plan (the pending and approved
 * branches of the shadow tool's render). English returns undefined — the
 * caller preserves the render's own baseline content.
 * @param path - the delivered plan file path (for the approved note).
 * @param value - the canonical exit value.
 * @param locale - the resolved session locale.
 * @returns the localized content blocks, or undefined to keep the baseline.
 */
export function localizedRenderContent(
  path: string,
  value: { delivered?: unknown; decision?: unknown },
  locale: PlanLocale,
): { type: 'text'; text: string }[] | undefined {
  if (locale !== 'zh') return undefined
  if (value.decision === 'pending') {
    return [{
      type: 'text',
      text: '计划已呈现在侧边栏的「计划」面板，等待用户审阅。请立即结束回合：简单说明计划已在侧边栏等待审阅，然后停止——'
        + '不要再调用任何工具。用户的决定会作为下一条消息送达：批准将关闭计划模式，你可以从下一步开始执行计划；'
        + '「继续规划」的反馈会要求你修改计划文件后重新提交。',
    }]
  }
  if (value.decision === 'approved') {
    return [{
      type: 'text',
      text: `计划已批准——计划模式已退出；从下一步开始执行计划。（当前未连接侧边栏计划面板；计划文件位于 ${path}。）`,
    }]
  }
  return undefined
}

/**
 * The steer message fired when the sidebar approval lands.
 * @param locale - the resolved session locale.
 * @returns the steer text.
 */
export function approvalSteerText(locale: PlanLocale): string {
  if (locale === 'zh') {
    return '[计划审批] 用户已在侧边栏计划面板批准该计划。计划模式现已关闭——从这一步开始执行计划。'
  }
  return '[Plan review] The user approved the plan in the sidebar plan panel. Plan mode is now off — carry out the plan starting with this step.'
}

/**
 * The steer message fired when the sidebar approval delegates execution to a
 * new conversation: the planning session is closed out (plan mode off) and
 * must NOT execute the plan itself.
 * @param locale - the resolved session locale.
 * @returns the steer text.
 */
export function delegatedSteerText(locale: PlanLocale): string {
  if (locale === 'zh') {
    return '[计划审批] 用户已批准该计划，并选择在一个新对话中执行它。本会话的规划任务已完成——'
      + '不要在此会话中执行该计划；简短确认收到后结束回合即可。'
  }
  return '[Plan review] The user approved the plan and chose to carry it out in a NEW conversation. '
    + 'Planning is complete in this one — do not execute the plan here; acknowledge briefly and end your turn.'
}

/**
 * The steer message fired when the sidebar keeps planning.
 * @param feedback - the user's optional feedback (already trimmed).
 * @param locale - the resolved session locale.
 * @returns the steer text.
 */
export function keepPlanningSteerText(feedback: string | undefined, locale: PlanLocale): string {
  if (locale === 'zh') {
    return '[计划审批] 用户在侧边栏计划面板审阅计划后选择继续规划。'
      + (feedback === undefined ? '' : ` 用户的反馈：${feedback}。`)
      + ' 请保持计划模式：修改计划文件后重新调用 exit_plan_mode 提交。'
  }
  return '[Plan review] The user chose to keep planning after reviewing the plan in the sidebar plan panel.'
    + (feedback === undefined ? '' : ` Their feedback: ${feedback}.`)
    + ' Stay in plan mode: revise the plan file and present it again with exit_plan_mode.'
}

/** The localized copy of the no-sidebar plan-review question. */
export interface PlanReviewCopy {
  header: string
  question: string
  approveLabel: string
  approveDescription: string
  keepLabel: string
  keepDescription: string
}

/**
 * The no-sidebar plan-review question's copy (the popup fallback surface).
 * @param locale - the resolved session locale.
 * @returns the question copy; labels pair with the ask intent so the
 *   plan-review takeover matches the approve option by label.
 */
export function planReviewCopy(locale: PlanLocale): PlanReviewCopy {
  if (locale === 'zh') {
    return {
      header: '计划审批',
      question: '批准该计划并退出计划模式？',
      approveLabel: '批准',
      approveDescription: '退出计划模式；计划将从下一步开始执行。',
      keepLabel: '继续规划',
      keepDescription: '保持计划模式；反馈将回传给模型。',
    }
  }
  return {
    header: 'Plan review',
    question: 'Approve this plan and leave plan mode?',
    approveLabel: 'Approve',
    approveDescription: 'Leave plan mode; the plan is carried out from the next step.',
    keepLabel: 'Keep planning',
    keepDescription: 'Stay in plan mode; feedback goes back to the model.',
  }
}
