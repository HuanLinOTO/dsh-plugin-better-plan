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
export type PlanLocale = 'zh' | 'en';
/** The plugin config's locale knob: a forced locale or browser following. */
export type LocaleSetting = 'auto' | PlanLocale;
/**
 * Normalize one client-reported locale tag (BCP 47-style, e.g. `zh-CN`)
 * to a shipped {@link PlanLocale}, or undefined when unsupported.
 * @param value - the raw reported value (query param / body field).
 * @returns `'zh'` / `'en'`, or undefined when the value is not a supported tag.
 */
export declare function normalizeReportedLocale(value: unknown): PlanLocale | undefined;
/**
 * Per-session directory of sidebar-reported locales. The browser view is the
 * authority on the user's language (the DSH locale preference is Host-backed
 * and already reflected in the client's active locale), so the host learns
 * the locale from the client instead of reading settings itself.
 */
export declare class LocaleDirectory {
    private reported;
    /**
     * Record one view-reported locale for a session (invalid values ignored).
     * @param sessionId - the session the view is subscribed to.
     * @param value - the raw reported locale tag.
     */
    report(sessionId: string, value: unknown): void;
    /**
     * The locale a session's connected view reported, if any.
     * @param sessionId - the session to look up.
     */
    known(sessionId: string | undefined): PlanLocale | undefined;
    /** Drop every report (plugin disposal). */
    dispose(): void;
}
/**
 * Resolve the locale for one session's user-facing copy.
 * @param setting - the plugin config's locale knob.
 * @param directory - the sidebar-reported locale directory.
 * @param sessionId - the session the copy is generated for.
 * @returns the resolved locale (English when nothing better is known).
 */
export declare function resolvePlanLocale(setting: LocaleSetting, directory: LocaleDirectory, sessionId: string | undefined): PlanLocale;
/**
 * The localized render content for a delivered plan (the pending and approved
 * branches of the shadow tool's render). English returns undefined — the
 * caller preserves the render's own baseline content.
 * @param path - the delivered plan file path (for the approved note).
 * @param value - the canonical exit value.
 * @param locale - the resolved session locale.
 * @returns the localized content blocks, or undefined to keep the baseline.
 */
export declare function localizedRenderContent(path: string, value: {
    delivered?: unknown;
    decision?: unknown;
}, locale: PlanLocale): {
    type: 'text';
    text: string;
}[] | undefined;
/**
 * The steer message fired when the sidebar approval lands.
 * @param locale - the resolved session locale.
 * @returns the steer text.
 */
export declare function approvalSteerText(locale: PlanLocale): string;
/**
 * The steer message fired when the sidebar keeps planning.
 * @param feedback - the user's optional feedback (already trimmed).
 * @param locale - the resolved session locale.
 * @returns the steer text.
 */
export declare function keepPlanningSteerText(feedback: string | undefined, locale: PlanLocale): string;
/** The localized copy of the no-sidebar plan-review question. */
export interface PlanReviewCopy {
    header: string;
    question: string;
    approveLabel: string;
    approveDescription: string;
    keepLabel: string;
    keepDescription: string;
}
/**
 * The no-sidebar plan-review question's copy (the popup fallback surface).
 * @param locale - the resolved session locale.
 * @returns the question copy; labels pair with the ask intent so the
 *   plan-review takeover matches the approve option by label.
 */
export declare function planReviewCopy(locale: PlanLocale): PlanReviewCopy;
