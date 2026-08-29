/**
 * The shadowed `exit_plan_mode` tool — better-plan's whole model-facing
 * contract.
 *
 * The tool keeps the built-in plan mode's name (D1): every agent preset's
 * planning group mounts `@deepseek-ai/dsh-plan-mode` inside an isolate realm,
 * and preset mount lines cannot be patched, so a same-name per-agent
 * registration through `agent.ctx` is the only replacement seam. Shadowing
 * keeps the preset's `plan:policy` section verbatim (its statements about
 * `exit_plan_mode` remain true) and leaves `/plan`, the projection, and the
 * composer badge working unchanged.
 *
 * What changes is the delivery: the model must write the COMPLETE plan to a
 * markdown file first (guided by this description — D2 verifies only that the
 * file exists and is readable), then pass its path. The tool reads the file
 * and pushes it to the session's sidebar plan panel through the delivery
 * registry. When the push reached a connected sidebar view the tool call
 * PARKS on the review gate — the conversation stops with no approval popup,
 * and the user reviews the plan and decides in the sidebar plan panel. When
 * no view is attached the built-in plan-review question renders in chat with
 * the full plan text (no-sidebar environment ⇒ the original experience).
 *
 * Approval keeps the built-in approval semantics AND the built-in mode
 * switch: the preset realm's `planMode` service is invisible to this plugin,
 * so the `plan/mode: false` append is deferred to the next accepted
 * `agent/pre-step` boundary here (the same mechanism the built-in controller
 * uses; the tool result is the narration, so nothing extra is injected).
 *
 * Conventions (per plugin-development-guide.md §3):
 *   C4 — `execute` returns one canonical JSON value; `render` is separate.
 *   C6 — `exec.signal.throwIfAborted()` before any fs work.
 *   C9 — presentCall/presentResult are pure functions of their arguments.
 *
 * @module @huanlin/dsh-plugin-better-plan/shadow-tool
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { BetterPlanConfig } from './config.ts';
import type { Context } from './context.ts';
import type { PlanDeliveryRegistry } from './delivery-registry.ts';
import type { PlanReviewGate } from './review-gate.ts';
/** The review question's id, echoed in the answer this tool reads. */
export declare const REVIEW_ID = "plan-review";
/** The review question's approve option label (the built-in wording). */
export declare const APPROVE_LABEL = "Approve";
/** The review question's keep-planning option label (the built-in wording). */
export declare const KEEP_PLANNING_LABEL = "Keep planning";
/**
 * The model-facing description. The model's only new knowledge: the
 * file-first contract, the sidebar plan panel, and the unchanged review flow.
 * `planDir` is interpolated into the example path.
 * @param config - the plugin config (planDir suggestion).
 * @returns the description string.
 */
export declare function exitPlanDescription(config: BetterPlanConfig): string;
/**
 * The review question's detail: the full plan text. Only the no-sidebar
 * fallback reaches the question (a delivered plan parks on the review gate
 * instead), so the user always sees the whole plan on the popup card.
 * @param plan - the full plan markdown.
 * @returns the detail string for the plan-review question.
 */
export declare function reviewDetail(plan: string): string;
/** Dependencies the shadow tool closes over (all provided by the plugin entry). */
export interface ShadowToolDeps {
    /** The host plugin context (service reads at execute time). */
    ctx: Context;
    /** Resolved plugin config. */
    config: BetterPlanConfig;
    /** The delivery registry (per-session queue + views). */
    registry: PlanDeliveryRegistry;
    /** The sidebar review gate (parks a delivered call until the user decides). */
    reviewGate: PlanReviewGate;
    /** Whether the plugin fiber was disposed while a review may be pending. */
    isDisposed: () => boolean;
    /** Queue the approved mode flip for the next accepted pre-step boundary. */
    onApproved: (session: object) => void;
}
/**
 * Build the shadowed tool definition. Registration is the caller's job
 * (`agent.ctx.tools.register` from the session-start hook).
 * @param deps - the plugin-provided collaborators.
 * @returns a registry-ready tool definition.
 */
export declare function defineExitPlanTool(deps: ShadowToolDeps): ToolDefinition;
