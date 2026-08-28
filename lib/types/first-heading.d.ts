/**
 * Plan-title extraction, shared by the delivery registry (sidebar tab title),
 * the WS push payload, and the canonical tool value.
 *
 * `firstHeading` mirrors the built-in plan mode's regex so both tools name a
 * plan the same way. D2 keeps validation loose: a plan without any heading is
 * accepted and falls back to the file basename.
 *
 * @module @huanlin/dsh-plugin-better-plan/first-heading
 */
/**
 * The plan's first markdown heading (any level), or `undefined` when the plan
 * has none. Tolerates leading whitespace before `#` and trailing whitespace
 * after the text; a 7-`#` run is not a heading.
 * @param plan - the full plan markdown.
 * @returns the heading text, or `undefined` when no line matches.
 */
export declare function firstHeading(plan: string): string | undefined;
/**
 * The last path segment of a POSIX or Windows path (mirror of the sidebar
 * client's FileTree baseName), used as the fallback plan title.
 * @param path - the path to shorten.
 * @returns the basename without trailing separators.
 */
export declare function basenameOf(path: string): string;
