/**
 * Client-half copy for the Plan tab, following the DSH i18n system: the
 * dictionaries register into the shared locale registry (namespace
 * `betterPlan`), and `t()` resolves the active locale from the attached
 * `ctx.locale` service (`@deepseek-ai/dsh-client-locale`) — the Host-backed
 * `locale.preference` wins over the raw browser language and switches live.
 * Absent the service (locale plugin not mounted), the browser language is
 * the fallback.
 *
 * The module-level attach mirrors better-sidebar's own locales.ts: the Plan
 * tab renders inside the sidebar's React tree, so the component reads copy
 * through `t()` at render time; the sidebar re-renders tab content on locale
 * switches (its tab-content memo keys on the locale revision), so no extra
 * subscription is needed here.
 *
 * @module @huanlin/dsh-plugin-better-plan/client/locales
 */

/** The zh dictionary (source of truth for the key set). */
export const zhDict = {
  tabTitle: '计划',
  openInEditor: '在编辑器中打开',
  copyPath: '复制路径',
  copied: '已复制',
  copy: '复制',
  copiedLabel: '已复制',
  reviewHint: '在此审阅计划——聊天中不会弹出审批卡。点「批准」在本对话执行，点「新开对话执行」移到全新对话执行，或附反馈选择「继续规划」。',
  feedbackPlaceholder: '「继续规划」时可附反馈（可选）…',
  approve: '批准',
  keepPlanning: '继续规划',
  approveNewSession: '新开对话执行',
  delegatingStatus: '计划已批准——正在新建执行对话…',
  delegatedStatus: '计划已批准——执行已移交到新对话。',
  errDelegateFailed: '新开执行对话失败',
  approvedStatus: '计划已批准——模型正在执行该计划。',
  keptStatus: '反馈已发送——模型正在修改计划。',
  loading: '正在读取计划…',
  readFailed: '读取计划失败',
  retry: '重试',
  truncated: '文件因侧边栏读取上限被截断；其余内容请在编辑器中查看。',
  noPath: '该计划标签页未携带文件路径',
  binaryFile: '计划文件是二进制文件；请在编辑器中查看',
  unexpectedRead: 'fs.read 响应格式异常',
  errStale: '当前面板已过期——有更新的计划正在审批。',
  errNoPending: '当前没有等待审批的计划。',
  errSubmitFailed: '提交决定失败',
} as const

/** The en dictionary (key-set-equal to zh, enforced by the type annotation). */
export const enDict: Record<keyof typeof zhDict, string> = {
  tabTitle: 'Plan',
  openInEditor: 'Open in editor',
  copyPath: 'Copy path',
  copied: 'Copied',
  copy: 'Copy',
  copiedLabel: 'Copied',
  reviewHint: 'Review this plan here — the chat shows no approval popup. Approve to execute in this conversation, execute in a new chat, or keep planning with feedback.',
  feedbackPlaceholder: 'Optional feedback for "Keep planning"…',
  approve: 'Approve',
  keepPlanning: 'Keep planning',
  approveNewSession: 'Execute in new chat',
  delegatingStatus: 'Plan approved — starting the execution conversation…',
  delegatedStatus: 'Plan approved — execution continues in a new conversation.',
  errDelegateFailed: 'Failed to start the execution conversation',
  approvedStatus: 'Plan approved — the model is carrying out the plan.',
  keptStatus: 'Feedback sent — the model is revising the plan.',
  loading: 'Loading plan…',
  readFailed: 'Failed to read the plan',
  retry: 'Retry',
  truncated: 'The file was truncated by the sidebar read limit; open it in the editor for the rest.',
  noPath: 'this plan tab carries no file path',
  binaryFile: 'the plan file is binary; review it in the editor instead',
  unexpectedRead: 'unexpected fs.read response',
  errStale: 'This panel is stale — a newer plan delivery is under review.',
  errNoPending: 'No plan is awaiting review.',
  errSubmitFailed: 'Submitting the decision failed',
}

/** The dictionary type every future locale must satisfy. */
export type PlanCopy = Record<keyof typeof zhDict, string>

const DICTS: Record<'zh' | 'en', PlanCopy> = { zh: zhDict, en: enDict }

/** The locale namespace this plugin owns in the DSH locale registry. */
export const LOCALE_NS = 'betterPlan'

/** The minimal face of the DSH locale service this module needs. */
interface LocaleServiceFace {
  getSnapshot(): { active: string }
}

/** The DSH locale service attached by the client apply (absent → browser detection). */
let localeService: LocaleServiceFace | undefined

/**
 * Attach (or detach, with undefined) the DSH locale service.
 * @param service - the client context's locale service.
 */
export function attachLocale(service: LocaleServiceFace | undefined): void {
  localeService = service
}

/**
 * The active copy locale: the DSH locale service's snapshot when attached
 * (zh → zh, anything else → en), else the browser language.
 * @returns `'zh'` or `'en'`.
 */
export function activeLocale(): 'zh' | 'en' {
  const active = localeService?.getSnapshot().active
  if (active !== undefined) return active === 'zh' ? 'zh' : 'en'
  const language = typeof navigator !== 'undefined' ? navigator.language : 'en'
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/**
 * Translate one copy key in the active locale.
 * @param key - the copy key.
 * @returns the localized string.
 */
export function t(key: keyof PlanCopy): string {
  return DICTS[activeLocale()][key]
}

/**
 * The kickoff prompt the delegation flow queues into the NEW conversation:
 * the model there has no context, so the message anchors it on the approved
 * plan file (an absolute path) and orders execution. It is both
 * user-visible (a chat bubble) and model-directed, so it localizes with the
 * view like the steer copy does.
 * @param path - the absolute plan file path.
 * @returns the kickoff prompt text.
 */
export function executionKickoffPrompt(path: string): string {
  if (activeLocale() === 'zh') {
    return `[计划执行] 用户已在上一对话中制定并批准了以下计划文件：${path}。`
      + '这是一个全新对话——请先读取该计划文件，然后严格按计划开始执行，无需重新规划或再次确认。'
  }
  return `[Plan execution] The user planned and approved the following plan file in a previous conversation: ${path}. `
    + 'This is a fresh conversation — read that plan file first, then carry it out exactly as written; no re-planning or re-confirmation needed.'
}

/**
 * Localize one review-route error for the action bar: known error codes map
 * to copy; unknown codes fall back to the route's raw English message.
 * @param code - the route's stable error code, when present.
 * @param raw - the route's raw error message (or an HTTP fallback).
 * @returns the text the action bar shows.
 */
export function submitErrorText(code: string | undefined, raw: string): string {
  if (code === 'stale_review') return t('errStale')
  if (code === 'no_pending') return t('errNoPending')
  if (code === undefined || code === '') return `${t('errSubmitFailed')}: ${raw}`
  return `${t('errSubmitFailed')}: ${raw}`
}
