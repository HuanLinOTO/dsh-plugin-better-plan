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

import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { EXIT_PLAN_MODE, foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { BetterPlanConfig } from './config.ts'
import type { Context } from './context.ts'
import type { PlanDeliveryRegistry } from './delivery-registry.ts'
import type { PlanReviewGate } from './review-gate.ts'
import { basenameOf, firstHeading } from './first-heading.ts'
import { resolveSessionCwd } from './resolve-cwd.ts'

/** The review question's id, echoed in the answer this tool reads. */
export const REVIEW_ID = 'plan-review'

/** The review question's approve option label (the built-in wording). */
export const APPROVE_LABEL = 'Approve'

/** The review question's keep-planning option label (the built-in wording). */
export const KEEP_PLANNING_LABEL = 'Keep planning'

/**
 * The model-facing description. The model's only new knowledge: the
 * file-first contract, the sidebar plan panel, and the unchanged review flow.
 * `planDir` is interpolated into the example path.
 * @param config - the plugin config (planDir suggestion).
 * @returns the description string.
 */
export function exitPlanDescription(config: BetterPlanConfig): string {
  return `Use only in plan mode. Before calling, write the COMPLETE plan as markdown to a file with the write tool (e.g. \`${config.planDir}/YYYY-MM-DD-<topic>.md\`), then pass its path here. `
    + 'The plan opens in the sidebar plan panel for the user\'s review; the user may approve (carry out the plan from your next step) or keep '
    + 'planning — their feedback comes back in the tool result; revise the file and present again.'
}

/**
 * The review question's detail: the full plan text. Only the no-sidebar
 * fallback reaches the question (a delivered plan parks on the review gate
 * instead), so the user always sees the whole plan on the popup card.
 * @param plan - the full plan markdown.
 * @returns the detail string for the plan-review question.
 */
export function reviewDetail(plan: string): string {
  return plan
}

/** The model-facing render of an approved delivery. */
function renderApproved(args: { path: string }, value: { approved: true; delivered: boolean }): { type: 'text'; text: string }[] {
  return [{
    type: 'text',
    text: value.delivered
      ? 'Plan approved — plan mode exited; carry out the plan starting with your next step. The plan is open in the sidebar plan panel.'
      : `Plan approved — plan mode exited; carry out the plan starting with your next step. (No sidebar plan panel is connected; the plan file is at ${args.path}.)`,
  }]
}

/** Dependencies the shadow tool closes over (all provided by the plugin entry). */
export interface ShadowToolDeps {
  /** The host plugin context (service reads at execute time). */
  ctx: Context
  /** Resolved plugin config. */
  config: BetterPlanConfig
  /** The delivery registry (per-session queue + views). */
  registry: PlanDeliveryRegistry
  /** The sidebar review gate (parks a delivered call until the user decides). */
  reviewGate: PlanReviewGate
  /** Whether the plugin fiber was disposed while a review may be pending. */
  isDisposed: () => boolean
  /** Queue the approved mode flip for the next accepted pre-step boundary. */
  onApproved: (session: object) => void
}

/**
 * Build the shadowed tool definition. Registration is the caller's job
 * (`agent.ctx.tools.register` from the session-start hook).
 * @param deps - the plugin-provided collaborators.
 * @returns a registry-ready tool definition.
 */
export function defineExitPlanTool(deps: ShadowToolDeps): ToolDefinition {
  const { ctx, config, registry } = deps
  return defineTool({
    name: EXIT_PLAN_MODE,
    description: exitPlanDescription(config),
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute or session-cwd-relative path of the markdown plan file (written with the write tool before this call).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          approved: { type: 'boolean', const: true, required: true },
          delivered: {
            type: 'boolean',
            required: true,
            description: 'Whether the plan was pushed to a connected sidebar plan panel at call time (false = queued for the next view attach, or no sidebar installed).',
          },
        },
      },
      render: renderApproved,
    },
    execute: async (args: { path: string }, exec) => {
      exec.signal.throwIfAborted()
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error(`${EXIT_PLAN_MODE} requires a calling agent (no session to switch)`)
      }
      if (!foldPlanMode(agent.session.events)) {
        throw new Error(`${EXIT_PLAN_MODE} is only available in plan mode`)
      }
      const sessionId = agent.session.id
      const cwd = await resolveSessionCwd(agent.session, sessionId, ctx.get('sessionPersistence'))
      const absolute = isAbsolute(args.path) ? args.path : join(cwd, args.path)
      let info
      try {
        info = await stat(absolute)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') {
          throw new Error(`${EXIT_PLAN_MODE} could not read the plan file "${args.path}" (resolved to "${absolute}"): it does not exist. `
            + 'Write the COMPLETE plan as markdown to a file with the write tool first, then call exit_plan_mode with its path.')
        }
        if (code === 'EACCES' || code === 'EPERM') {
          throw new Error(`the plan file "${absolute}" is not readable`)
        }
        throw new Error(`cannot read the plan file "${absolute}": ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!info.isFile()) {
        throw new Error(`"${absolute}" is not a file; pass the path of the markdown plan file`)
      }
      if (info.size > config.maxPlanBytes) {
        throw new Error(`the plan file is ${info.size} bytes, over the ${config.maxPlanBytes}-byte review limit; `
          + 'write a more concise plan (state decisions and changes, not full file contents) and present it again')
      }
      const plan = await readFile(absolute, 'utf8')
      const title = firstHeading(plan) ?? basenameOf(absolute)
      const { id, delivered } = registry.enqueue(sessionId, absolute, title)
      if (delivered) {
        // Sidebar review: park the call. The conversation stops here — no
        // approval popup renders in chat — and the user decides in the plan
        // panel. Keep/cancel/abort reject with the popup flow's wording, so
        // the model sees identical guidance from either review surface.
        await deps.reviewGate.begin(sessionId, { id, path: absolute, title }, exec.signal)
        // Queue the mode flip for the next accepted pre-step boundary (the
        // preset realm's planMode service is unreachable from here). The
        // tool result is the narration, so no extra notice is injected.
        deps.onApproved(agent.session)
        return { approved: true as const, delivered: true }
      }
      const interaction = ctx.get('userQuestions')
      if (interaction === undefined) {
        throw new Error('no user-questions channel is available to review the plan; ask the user to switch the session mode instead')
      }
      const answer = await interaction.ask({
        questions: [{
          id: REVIEW_ID,
          header: 'Plan review',
          question: 'Approve this plan and leave plan mode?',
          detail: reviewDetail(plan),
          options: [
            { label: APPROVE_LABEL, description: 'Leave plan mode; the plan is carried out from the next step.' },
            { label: KEEP_PLANNING_LABEL, description: 'Stay in plan mode; feedback goes back to the model.' },
          ],
          // Presentation only: a capable UI renders the review decision; the
          // answer encoding is identical either way.
          intent: { kind: 'plan-review', approve: APPROVE_LABEL },
        }],
        agent,
        signal: exec.signal,
      }).catch((cause: unknown) => {
        // A dismissed review is not a failed one: the user took the turn back
        // to say something the two options do not cover. An abort (turn
        // cancel, provider teardown) keeps its own message.
        if (cause instanceof UserQuestionError && cause.code === 'ASK_CANCELLED') {
          throw new Error('The user dismissed the plan review to speak instead; '
            + 'stay in plan mode, stop here, and wait for their message.')
        }
        throw cause
      })
      // A review may outlive this plugin fiber. Without this fiber's pre-step
      // listener, an approved exit could never be appended, so fail and keep
      // planning.
      if (deps.isDisposed()) {
        throw new Error('the better-plan plugin was reloaded while the plan was under review; write the plan and present it again')
      }
      const reviewItems = answer.answers.filter(entry => entry.id === REVIEW_ID)
      const item = reviewItems.length === 1 ? reviewItems[0] : undefined
      if (item?.selected.length !== 1 || item.selected[0] !== APPROVE_LABEL || item.custom !== undefined) {
        const feedback = item?.custom ?? ''
        throw new Error(feedback === ''
          ? 'The user chose to keep planning; revise the plan file and present it again.'
          : `The user chose to keep planning; their feedback: ${feedback}`)
      }
      // Queue the mode flip for the next accepted pre-step boundary (the
      // preset realm's planMode service is unreachable from here). The tool
      // result is the narration, so no extra notice is injected.
      deps.onApproved(agent.session)
      return { approved: true as const, delivered }
    },
    presentCall: args => ({
      card: 'generic',
      // Call-time projection is pure (C9): the plan file is not read here, so
      // the card titles by the file basename; the sidebar tab carries the
      // plan's first heading instead.
      title: basenameOf(args.path),
      kind: 'other',
      content: [{
        type: 'text',
        text: 'Plan file delivered for review — the complete plan opens in the sidebar plan panel; approve or keep planning there.',
      }],
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: 'Plan review',
      content: result.content,
    }),
  })
}
