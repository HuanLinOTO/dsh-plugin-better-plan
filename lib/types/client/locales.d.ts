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
export declare const zhDict: {
    readonly tabTitle: "计划";
    readonly openInEditor: "在编辑器中打开";
    readonly copyPath: "复制路径";
    readonly copied: "已复制";
    readonly copy: "复制";
    readonly copiedLabel: "已复制";
    readonly reviewHint: "在此审阅计划——聊天中不会弹出审批卡。点「批准」退出计划模式，或附反馈选择「继续规划」。";
    readonly feedbackPlaceholder: "「继续规划」时可附反馈（可选）…";
    readonly approve: "批准";
    readonly keepPlanning: "继续规划";
    readonly approvedStatus: "计划已批准——模型正在执行该计划。";
    readonly keptStatus: "反馈已发送——模型正在修改计划。";
    readonly loading: "正在读取计划…";
    readonly readFailed: "读取计划失败";
    readonly retry: "重试";
    readonly truncated: "文件因侧边栏读取上限被截断；其余内容请在编辑器中查看。";
    readonly noPath: "该计划标签页未携带文件路径";
    readonly binaryFile: "计划文件是二进制文件；请在编辑器中查看";
    readonly unexpectedRead: "fs.read 响应格式异常";
    readonly errStale: "当前面板已过期——有更新的计划正在审批。";
    readonly errNoPending: "当前没有等待审批的计划。";
    readonly errSubmitFailed: "提交决定失败";
};
/** The en dictionary (key-set-equal to zh, enforced by the type annotation). */
export declare const enDict: Record<keyof typeof zhDict, string>;
/** The dictionary type every future locale must satisfy. */
export type PlanCopy = Record<keyof typeof zhDict, string>;
/** The locale namespace this plugin owns in the DSH locale registry. */
export declare const LOCALE_NS = "betterPlan";
/** The minimal face of the DSH locale service this module needs. */
interface LocaleServiceFace {
    getSnapshot(): {
        active: string;
    };
}
/**
 * Attach (or detach, with undefined) the DSH locale service.
 * @param service - the client context's locale service.
 */
export declare function attachLocale(service: LocaleServiceFace | undefined): void;
/**
 * The active copy locale: the DSH locale service's snapshot when attached
 * (zh → zh, anything else → en), else the browser language.
 * @returns `'zh'` or `'en'`.
 */
export declare function activeLocale(): 'zh' | 'en';
/**
 * Translate one copy key in the active locale.
 * @param key - the copy key.
 * @returns the localized string.
 */
export declare function t(key: keyof PlanCopy): string;
/**
 * Localize one review-route error for the action bar: known error codes map
 * to copy; unknown codes fall back to the route's raw English message.
 * @param code - the route's stable error code, when present.
 * @param raw - the route's raw error message (or an HTTP fallback).
 * @returns the text the action bar shows.
 */
export declare function submitErrorText(code: string | undefined, raw: string): string;
export {};
