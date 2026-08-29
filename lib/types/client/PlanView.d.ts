/**
 * The Plan tab view: a status header (title, path, actions), the review
 * action bar (the sidebar approval surface — the chat shows no popup), and
 * the plan rendered through DSH's shared `MarkdownText`.
 *
 * The file content comes from better-sidebar's `/sidebar/api/fs.read` route
 * (same-origin, browser-authenticated) — the plan file lives in the session
 * workspace, and the host half has no route of its own for reading it. The
 * path is `tab.meta.path` (persisted with the tab, so a refresh restores the
 * view) falling back to `tab.path`.
 *
 * The review state comes from the delivery WebSocket's review frames (via
 * the shared review store, restored by the attach replay after a refresh).
 * While a review is pending the bar offers Approve / Execute in new chat /
 * Keep planning; a decision POSTs to the host's review route and the echo
 * updates the store. The delegation choice then launches the execution
 * conversation through the sessions service (see execution-launch.ts) and
 * navigates there.
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
