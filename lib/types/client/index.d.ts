/**
 * Client half of @huanlin/dsh-plugin-better-plan: registers the sidebar's
 * "Plan" tab through better-sidebar's service and subscribes the per-session
 * delivery WebSocket that opens it and feeds its review action bar.
 *
 * The tab is `single: true` (one Plan tab per session, dedupe-focused on
 * repeat deliveries). The plan path travels ONLY in the tab `meta`
 * (`meta.path`): on the native right sidebar (better-sidebar v0.19+) an
 * openTab seed carrying `path` is routed to `openResource`, where the editor
 * type claims `dsh-resource://file/**` — the plan would open in the file
 * editor and the Plan tab (the approval surface) would never mount. PlanView
 * reads `meta.path` first (`planPathOf`), and `meta` rides the tab into
 * better-sidebar's localStorage persistence, so a refresh restores the view
 * and PlanView re-reads the file from `tab.meta.path`. Because the native page
 * open dedupes by kind (an existing tab keeps its seed fields), every push is
 * still followed by `updateTab` (feature-gated, v0.12.0+) and `activateTab` —
 * they carry the refresh on the pre-0.19 sidebar and are harmless no-ops on
 * the native one. Review frames feed the shared
 * review store; the tab's action bar posts decisions back to
 * `POST /better-plan/api/review` — the sidebar IS the approval surface, the
 * chat shows no popup.
 *
 * With better-sidebar absent this half stays pending on its inject (legal
 * per the client runner) and, defensively, apply() skips everything when the
 * service is unreachable — the host half's `delivered: false` path covers
 * the no-sidebar deployment.
 *
 * @module @huanlin/dsh-plugin-better-plan/client
 */
import type { Context } from '@deepseek-ai/cordis';
import type { BetterSidebarService } from 'dsh-better-sidebar/client/service';
import { ReviewStore } from './review-store.ts';
/** The Plan tab type id (also the minted tab id — single instance). */
export declare const TAB_ID = "better-plan:plan";
/** The delivery WebSocket path (mirror of the host half's route). */
export declare const DELIVERY_WS_PATH = "/better-plan/ws/delivery";
/**
 * Apply one delivery push to the sidebar: open (or focus) the Plan tab, then
 * overwrite its content via updateTab and focus it (both v0.12.0+; on an
 * older host the plain openTab dedupe-focus still lands the FIRST delivery).
 * The plan path travels in `meta.path` only — a path-carrying seed would open
 * the file editor on the native right sidebar instead of this tab.
 * @param service - the better-sidebar service.
 * @param payload - the parsed WS frame.
 * @param sessionId - the session the socket is subscribed to.
 */
export declare function applyDeliveryPush(service: BetterSidebarService, payload: unknown, sessionId: string): void;
/**
 * Route one WS frame: `deliver` opens/updates the Plan tab, `review` feeds
 * the review store (the Plan tab's action bar). Malformed frames are ignored
 * (the next push carries its own state).
 * @param service - the better-sidebar service.
 * @param store - the review store the review frames feed.
 * @param frame - the parsed WS frame.
 * @param sessionId - the session the socket is subscribed to.
 */
export declare function applyDeliveryFrame(service: BetterSidebarService, store: ReviewStore, frame: unknown, sessionId: string): void;
/** The betterSidebar and locale services this half resolves through the context proxy. */
export declare const inject: string[];
/**
 * Client plugin body.
 * @param ctx - the client cordis context.
 */
export declare function apply(ctx: Context): void;
