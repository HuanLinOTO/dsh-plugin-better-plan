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

import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

/**
 * The shipped preset's delivery sentence, verbatim across the standard, ptc,
 * and cordis presets. Doubles as the plan-mode-active gate for the listener.
 */
export const PLAN_DELIVERY_ANCHOR =
  'When ready, call exit_plan_mode with the complete plan markdown, starting with a # title.'

const WRITE_BAN_ANCHOR =
  'Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan.'

const OVERRIDE_CLAIM_ANCHOR = 'those tools remain listed to keep the tool catalog unchanged.'

/**
 * Rewrite the shipped plan-mode guidance to the file-first delivery contract.
 * Each replacement is independent: a sentence whose anchor is absent (an
 * older or customized preset variant) is left as-is, and already-rewritten
 * text passes through unchanged, so the function is idempotent.
 * @param text - one assembled prompt section's text.
 * @param planDir - the plugin config's suggested plan directory.
 * @returns the corrected text, or the input untouched when no anchor matches.
 */
export function rewritePlanPolicySection(text: string, planDir: string): string {
  let result = text

  // Carve the delivery file out of the write ban instead of deleting the ban:
  // plan mode must stay read-only for everything except the one required file.
  const deliveryExample = `\`${planDir}/YYYY-MM-DD-<topic>.md\``
  const writeException =
    ` The one required exception is the delivery file: before calling exit_plan_mode, ` +
    `write the complete plan as markdown to a single file (for example ${deliveryExample}) ` +
    'with the write tool; this delivery write is allowed in plan mode.'
  if (result.includes(WRITE_BAN_ANCHOR) && !result.includes(writeException)) {
    result = result.replace(WRITE_BAN_ANCHOR, WRITE_BAN_ANCHOR + writeException)
  }

  // The shipped text claims the plan-mode rules override tool descriptions;
  // without this carve-out that claim pits the prompt against the shadowed
  // tool's own file-first description.
  const overrideException =
    ' The exit_plan_mode file-first contract is the single exception to that override.'
  if (result.includes(OVERRIDE_CLAIM_ANCHOR) && !result.includes(overrideException)) {
    result = result.replace(OVERRIDE_CLAIM_ANCHOR, OVERRIDE_CLAIM_ANCHOR + overrideException)
  }

  // Replace the inline-plan delivery sentence with the path-only contract.
  const deliveryReplacement =
    'When ready, call exit_plan_mode with the path of the plan file you wrote: the tool takes ' +
    'only that path, and the complete plan markdown must already be in the file, starting with ' +
    'a # title. Never paste the plan text into the tool call.'
  if (result.includes(PLAN_DELIVERY_ANCHOR)) {
    result = result.replace(PLAN_DELIVERY_ANCHOR, deliveryReplacement)
  }

  return result
}

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
export function registerPlanPolicyOverride(ctx: CordisContext, planDir: string): () => void {
  return ctx.on('system-prompt/assemble', async (assembly: PromptAssembly, _context, next) => {
    const result = await next()
    for (const section of result.sections) {
      if (section.text.includes(PLAN_DELIVERY_ANCHOR)) {
        section.text = rewritePlanPolicySection(section.text, planDir)
      }
    }
    return result
  })
}
