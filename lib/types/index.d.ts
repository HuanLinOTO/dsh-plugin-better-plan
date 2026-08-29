/**
 * @huanlin/dsh-plugin-better-plan — replaces the built-in plan mode's plan
 * DELIVERY while keeping everything else about plan mode intact.
 *
 * The model writes the complete plan to a markdown file (guided by the tool
 * description) and calls the same-name `exit_plan_mode` with its path. This
 * plugin registers that same-name tool into EVERY agent's scope at
 * `agent/session-start` (`agent.ctx.tools.register`) — per-agent scoped
 * registrations shadow the preset-mounted built-in across scope layers, so
 * the built-in plan-mode plugin stays mounted and untouched (its `plan:policy`
 * section, `/plan` command, projection, and composer badge keep working).
 *
 * Delivery pipeline (execute): validate plan mode → resolve the path against
 * the session cwd → stat/read with a byte cap → enqueue a push on the
 * per-session delivery registry (consumed by the `/better-plan/ws/delivery`
 * WebSocket when a sidebar view is attached) → when the push reached a view,
 * PARK the call on the review gate: the conversation stops with no approval
 * popup and the user decides in the plan panel (`POST /better-plan/api/review`
 * settles it); when no view is attached, ask the SAME plan-review question
 * the built-in tool asks, with the full plan as the detail (D3: without the
 * sidebar the user still reviews the plan on the card).
 *
 * Approval queueing the mode flip: the preset realm's `planMode` service is
 * invisible to this plugin, so the approved `plan/mode: false` append is
 * deferred to the next accepted `agent/pre-step` boundary here — the same
 * mechanism the built-in controller uses (the tool result is the narration).
 *
 * The preset's static `plan:policy` section still teaches the ORIGINAL
 * inline-plan contract and bans file writes, so a `system-prompt/assemble`
 * waterfall listener rewrites those sentences to the file-first contract on
 * every assembled prompt (see `prompt-override.ts`).
 *
 * @module @huanlin/dsh-plugin-better-plan
 */
import type { Context } from './context.ts';
import { type BetterPlanConfig } from './config.ts';
import { PlanDeliveryRegistry } from './delivery-registry.ts';
import { PlanReviewGate } from './review-gate.ts';
export declare const name = "dsh-plugin-better-plan";
/**
 * Services required before mounting: the tool registry (its availability
 * gates scoped registrations), the webserver (the delivery push route), and
 * the system-prompt registry (the assemble waterfall this plugin rewrites
 * plan-mode guidance through).
 */
export declare const inject: string[];
/** Loader schema (schemastery, strict) — validated by the cordis Loader. */
export { Config } from './config.ts';
export type { BetterPlanConfig } from './config.ts';
/**
 * Wire the plugin onto a host context. Everything this registers is bound to
 * `ctx`'s own fiber and cleans up on disposal (HMR-safe).
 * @param ctx - the host plugin context.
 * @param config - the resolved plugin config.
 * @returns the created delivery registry and review gate (exposed for tests).
 */
export declare function createBetterPlan(ctx: Context, config: BetterPlanConfig): {
    registry: PlanDeliveryRegistry;
    reviewGate: PlanReviewGate;
};
/**
 * Plugin entry.
 * @param ctx - the host plugin context.
 * @param config - the composition entry config (defaults fill in via the schema).
 */
export declare function apply(ctx: Context, config?: Partial<BetterPlanConfig>): void;
