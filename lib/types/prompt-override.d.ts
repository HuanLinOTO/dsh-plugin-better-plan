/**
 * Prompt-surface override for the built-in plan mode's `plan:policy` section.
 *
 * The preset ships the section as static config text teaching the ORIGINAL
 * delivery contract ("call exit_plan_mode with the complete plan markdown")
 * while forbidding file writes — both directly contradict this plugin's
 * file-first tool contract (`exit_plan_mode({ path })`). The section text is
 * unreachable as config (isolated preset realm), so the correction runs on the
 * assembled prompt instead: a `system-prompt/assemble` waterfall listener
 * rewrites the offending sentences in place, leaving every other section —
 * and any deployment-customized wording around them — untouched.
 *
 * The anchor sentence only appears in the assembly while plan mode is active
 * (the built-in provider returns `''` otherwise), so the listener needs no
 * plan-state tracking of its own. The mutation is visible to the session log
 * through the per-request `request/header` event, which records the rendered
 * system prompt after this waterfall.
 *
 * Registration is per-agent, on the agent's own scope: the loop assembles
 * every prompt with the agent as the dispatch key (`assembleContextFor`), and
 * scope-chain admission flows events UP the chain only — a listener on this
 * plugin's own fiber is a sibling of the composition scopes and would never
 * be admitted. This mirrors the tool shadow's per-agent registration.
 *
 * @module @huanlin/dsh-plugin-better-plan
 */
import type { Context as CordisContext } from '@deepseek-ai/cordis';
/**
 * The shipped preset's delivery sentence, verbatim across the standard, ptc,
 * and cordis presets. Doubles as the plan-mode-active gate for the listener.
 */
export declare const PLAN_DELIVERY_ANCHOR = "When ready, call exit_plan_mode with the complete plan markdown, starting with a # title.";
/**
 * Rewrite the shipped plan-mode guidance to the file-first delivery contract.
 * Each replacement is independent: a sentence whose anchor is absent (an
 * older or customized preset variant) is left as-is, and already-rewritten
 * text passes through unchanged, so the function is idempotent.
 * @param text - one assembled prompt section's text.
 * @param planDir - the plugin config's suggested plan directory.
 * @returns the corrected text, or the input untouched when no anchor matches.
 */
export declare function rewritePlanPolicySection(text: string, planDir: string): string;
/**
 * Register the assemble waterfall listener on one agent's scoped context.
 * The agent is the loop's assemble dispatch key, so a listener tagged with
 * that exact scope is admitted for every prompt this agent assembles.
 * Sections without the plan-mode anchor pass through untouched, so non-plan
 * requests pay one string scan per section.
 * @param ctx - the agent's scoped context (`agent.ctx`); only event
 *   registration is required, so the plain Cordis face suffices.
 * @param planDir - the plugin config's suggested plan directory.
 * @returns the listener disposer (for the caller's lifecycle effect).
 */
export declare function registerPlanPolicyOverride(ctx: CordisContext, planDir: string): () => void;
