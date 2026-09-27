/**
 * The delegation flow's client half: after a review settles as
 * `delegated`, create the execution conversation through DSH's public
 * sessions service (`ctx.get('sessions')`), queue the kickoff prompt into
 * it, and navigate there.
 *
 * The faces below are STRUCTURAL (the minimal subset of
 * `@deepseek-ai/dsh-api-session-controller/client`'s `ISessions` /
 * `SessionReference` / `SessionFace` and `@deepseek-ai/dsh-client-ui-workspace`'s
 * `UiWorkspace` this flow calls) — the same pattern better-sidebar uses for
 * cross-plugin services: no value import crosses the client-bundle purity
 * gate and no new tsconfig path is needed; the runtime services arrive
 * through the context proxy.
 *
 * Addressing rules (session-controller since its references rework):
 * `create()` only catalogues the session — the local generation becomes
 * addressable once a caller retains it. The kickoff therefore runs inside
 * `sessions.using(newId, …)`, which retains the session, awaits its initial
 * open, and releases the reference after the callback settles. Navigation is
 * NOT a sessions-service verb: `openSession` belongs to the uiWorkspace
 * service (it re-retains with source `mainView` and selects the
 * conversation), so it is a separate optional face. Navigating inside the
 * `using` callback hands the session from our reference to the main view
 * before release — no teardown/reopen round-trip.
 *
 * The new conversation lands in the SAME workspace as the planning session
 * when the workspaces service can resolve it (`create({ workspaceId })`
 * groups the session and derives its cwd from the workspace path — a
 * cwd-only create attaches no workspace, which is exactly how an ungrouped
 * execution conversation happens); otherwise it falls back to the planning
 * session's list-summary cwd, then to the default location.
 *
 * @module @huanlin/dsh-plugin-better-plan/client/execution-launch
 */

import { executionKickoffPrompt } from './locales.ts'

/** One admitted prompt's outcome (the client-result face of `prompt`). */
export interface PromptOutcome {
  ok: boolean
  error?: { code?: string; message?: string }
}

/** The structural session face the kickoff needs (`getSnapshot` + `prompt`). */
export interface ExecutionSessionFace {
  /** The lifecycle read side; only the open settlement fields matter here. */
  getSnapshot(): { openState: string; openError?: { code?: string; message?: string } | null }
  prompt(
    content: { type: 'text'; text: string }[],
    mode: 'queue',
  ): Promise<PromptOutcome>
}

/** The structural retained-reference face the kickoff consumes. */
export interface ExecutionReferenceFace {
  readonly sessionId: string
  readonly binding: { session: ExecutionSessionFace }
}

/** The structural `ctx.sessions` face the delegation flow consumes. */
export interface SessionsServiceFace {
  /** Create a blank session (grouped under `workspaceId`'s workspace, in `cwd`, or default). The returned id is catalogued but not yet retained. */
  create(opts?: { workspaceId?: string; cwd?: string }): Promise<string>
  /** Retain a session, await its initial open, run the operation, then release. */
  using<T>(
    id: string,
    options: { source: string },
    operation: (reference: ExecutionReferenceFace) => T | Promise<T>,
  ): Promise<T>
  /** The session list snapshot (the planning session's cwd source). */
  list: { getSnapshot(): { byId: Record<string, { cwd?: string } | undefined> } }
}

/** The structural `ctx.uiWorkspace` face the delegation flow consumes. */
export interface UiWorkspaceFace {
  /** Select a session as the main conversation (re-retains it for the main view). */
  openSession(id: string): void
}

/** The structural `ctx.workspaces` face the delegation flow consumes. */
export interface WorkspacesServiceFace {
  /** The workspace list snapshot (each row carries its accounted sessions). */
  list: { getSnapshot(): { items: readonly { workspaceId: string; sessionIds: readonly string[] }[] } }
}

/**
 * Launch the execution conversation for a delegated plan: create a blank
 * session in the planning session's workspace (falling back to its cwd, then
 * the default location), queue the kickoff prompt pointing at the approved
 * plan file, then navigate to the new conversation. Every failure rejects
 * with an Error whose message the plan panel shows (the plan path stays
 * visible there, so the user can always start a conversation and send the
 * plan manually).
 * @param sessions - the sessions service (`ctx.get('sessions')`).
 * @param workspaces - the workspaces service (`ctx.get('workspaces')`), or
 *   undefined when absent (the cwd fallback takes over).
 * @param uiWorkspace - the workspace navigation service
 *   (`ctx.get('uiWorkspace')`), or undefined when absent (the kickoff is
 *   still queued; the new conversation waits in the sidebar list).
 * @param planPath - the approved plan file's absolute path.
 * @param sessionId - the planning session (its workspace/cwd seeds the new one).
 */
export async function launchExecutionConversation(
  sessions: SessionsServiceFace,
  workspaces: WorkspacesServiceFace | undefined,
  uiWorkspace: UiWorkspaceFace | undefined,
  planPath: string,
  sessionId: string,
): Promise<void> {
  // Workspace-first: the lookup silently degrades when the service is
  // absent, its snapshot is not ready, or the planning session belongs to no
  // workspace (e.g. a subagent session).
  const workspace = workspaces?.list.getSnapshot().items
    .find(item => item.sessionIds.includes(sessionId))
  let createOpts: { workspaceId?: string; cwd?: string }
  if (workspace !== undefined) {
    createOpts = { workspaceId: workspace.workspaceId }
  } else {
    const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
    createOpts = cwd === undefined ? {} : { cwd }
  }
  const newId = await sessions.create(createOpts)
  // `create` only catalogues the session; `using` retains it (making the
  // binding addressable), settles the initial open, and releases afterwards.
  await sessions.using(newId, { source: 'betterPlanDelegation' }, async (reference) => {
    const session = reference.binding.session
    const state = session.getSnapshot()
    if (state.openState !== 'open') {
      const failure = state.openError
      throw new Error(`the new session "${newId}" did not open: ${failure?.code ?? 'unknown'}: ${failure?.message ?? ''}`)
    }
    const admitted = await session.prompt(
      [{ type: 'text', text: executionKickoffPrompt(planPath) }],
      'queue',
    )
    if (!admitted.ok) {
      throw new Error(`the kickoff prompt was rejected: ${admitted.error?.code ?? 'unknown'}: ${admitted.error?.message ?? ''}`)
    }
    // Navigate while our reference still holds the session: the main-view
    // retain inside openSession takes over before `using` releases, so the
    // fresh session never tears down between kickoff and navigation.
    uiWorkspace?.openSession(newId)
  })
}
