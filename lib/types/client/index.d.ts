/**
 * Client half of @huanlin/dsh-plugin-better-plan: registers the sidebar's
 * "Plan" tab through better-sidebar's service and subscribes the per-session
 * delivery WebSocket that opens it and feeds its review action bar.
 *
 * The tab is `single: true` (one Plan tab per session, dedupe-focused on
 * repeat deliveries). Because the dedupe focus does NOT overwrite an already
 * open tab's path, every push is followed by `updateTab` (feature-gated,
 * v0.12.0+) so a re-delivered plan replaces the tab's content, then
 * `activateTab` focuses it. `meta` rides the tab into better-sidebar's
 * localStorage persistence, so a refresh restores the view and PlanView
 * re-reads the file from `tab.meta.path`. Review frames feed the shared
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
/** The betterSidebar service this half resolves through the context proxy. */
export declare const inject: string[];
/**
 * Client plugin body.
 * @param ctx - the client cordis context.
 */
export declare function apply(ctx: Context): void;
