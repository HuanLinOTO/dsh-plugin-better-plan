/**
 * The delegation flow's client half: after a review settles as
 * `delegated`, create the execution conversation through DSH's public
 * sessions service (`ctx.get('sessions')`), queue the kickoff prompt into
 * it, and navigate there.
 *
 * The faces below are STRUCTURAL (the minimal subset of
 * `@deepseek-ai/dsh-api-session-controller/client`'s `ISessions` /
 * `SessionFace` and `@deepseek-ai/dsh-api-workspace-controller/client`'s
 * `IWorkspaces` this flow calls) — the same pattern better-sidebar uses for
 * cross-plugin services: no value import crosses the client-bundle purity
 * gate and no new tsconfig path is needed; the runtime services arrive
 * through the context proxy. The new conversation lands in the SAME
 * workspace as the planning session when the workspaces service can resolve
 * it (`create({ workspaceId })` groups the session and derives its cwd from
 * the workspace path — a cwd-only create attaches no workspace, which is
 * exactly how an ungrouped execution conversation happens); otherwise it
 * falls back to the planning session's list-summary cwd, then to the
 * default location.
 *
 * @module @huanlin/dsh-plugin-better-plan/client/execution-launch
 */

import { executionKickoffPrompt } from './locales.ts'

/** One admitted prompt's outcome (the client-result face of `prompt`). */
export interface PromptOutcome {
  ok: boolean
  error?: { code?: string; message?: string }
}

/** The structural session face the kickoff needs (the `prompt` verb). */
export interface ExecutionSessionFace {
  prompt(
    content: { type: 'text'; text: string }[],
    mode: 'queue',
  ): Promise<PromptOutcome>
}

/** The structural `ctx.sessions` face the delegation flow consumes. */
export interface SessionsServiceFace {
  /** Create a blank session (grouped under `workspaceId`'s workspace, in `cwd`, or default). */
  create(opts?: { workspaceId?: string; cwd?: string }): Promise<string>
  /** Select a session as the current conversation. */
  open(id: string): void
  /** The session list snapshot (the planning session's cwd source). */
  list: { getSnapshot(): { byId: Record<string, { cwd?: string } | undefined> } }
  /** The live session face for a locally addressable session. */
  binding(id: string): { session: ExecutionSessionFace } | undefined
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
 * @param planPath - the approved plan file's absolute path.
 * @param sessionId - the planning session (its workspace/cwd seeds the new one).
 */
export async function launchExecutionConversation(
  sessions: SessionsServiceFace,
  workspaces: WorkspacesServiceFace | undefined,
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
  const binding = sessions.binding(newId)
  if (binding === undefined) {
    throw new Error(`the new session "${newId}" is not locally addressable yet`)
  }
  const admitted = await binding.session.prompt(
    [{ type: 'text', text: executionKickoffPrompt(planPath) }],
    'queue',
  )
  if (!admitted.ok) {
    throw new Error(`the kickoff prompt was rejected: ${admitted.error?.code ?? 'unknown'}: ${admitted.error?.message ?? ''}`)
  }
  sessions.open(newId)
}
