/**
 * The Plan tab view: a status header (title, path, actions) over the plan
 * rendered through DSH's shared `MarkdownText`.
 *
 * The file content comes from better-sidebar's `/sidebar/api/fs.read` route
 * (same-origin, browser-authenticated) — the plan file lives in the session
 * workspace, and the host half has no route of its own for reading it. The
 * path is `tab.meta.path` (persisted with the tab, so a refresh restores the
 * view) falling back to `tab.path`.
 *
 * @module @huanlin/dsh-plugin-better-plan/client/PlanView
 */
import { createElement } from 'react';
import type { TabComponentProps } from 'dsh-better-sidebar/client/service';
/**
 * Extract the plan path from a tab (meta first, then the seed path).
 * @param tab - the sidebar tab instance.
 * @returns the plan file path, or undefined when the tab carries none.
 */
export declare function planPathOf(tab: TabComponentProps['tab']): string | undefined;
/**
 * The Plan tab component (better-sidebar TabDescriptor.component).
 * @param props - the tab component props (ctx/store/scope/tab/visible).
 * @returns the rendered view.
 */
export declare function PlanView(props: TabComponentProps): ReturnType<typeof createElement>;
