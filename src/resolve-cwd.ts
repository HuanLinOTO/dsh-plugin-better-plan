/**
 * Session working-directory resolution for relative plan paths.
 *
 * Chain (mirror of the sidebar's sessionCwdOf): the live session header wins;
 * while that header carries no cwd (a stripped-down host or a session created
 * without workspace metadata) the persistence index is consulted for cold
 * sessions; the host process cwd is the final fallback. A persistence failure
 * or a non-absolute persisted value also falls through to the process cwd —
 * a delivery tool should not die because the index hiccups, and a wrong
 * fallback surfaces as a clear "file does not exist" error from the caller's
 * own stat.
 *
 * @module @huanlin/dsh-plugin-better-plan/resolve-cwd
 */

import { isAbsolute } from 'node:path'

/** The session-header slice this resolver reads. */
export interface SessionCwdProbe {
  readonly header?: {
    readonly cwd?: string
  }
}

/**
 * The session-persistence face this resolver consults (structural mirror).
 * dsh 0.1.2-rc.1 rewrote the contract as handle-based snapshots: the old
 * `inspect(id)` became `stat(id)` returning a `SessionPersistenceSnapshot`
 * (the header lives under `snapshot.header`), or undefined when unknown.
 */
export interface PersistenceStat {
  stat(sessionId: string): Promise<{ header: { cwd?: string } } | undefined>
}

/**
 * Resolve one session's working directory.
 * @param session - the calling session (its header cwd is authoritative).
 * @param sessionId - the session id, for the persistence lookup.
 * @param persistence - the optional session-persistence service.
 * @returns an absolute working directory (never empty).
 */
export async function resolveSessionCwd(
  session: SessionCwdProbe | undefined,
  sessionId: string,
  persistence: PersistenceStat | undefined,
): Promise<string> {
  const headerCwd = session?.header?.cwd
  if (typeof headerCwd === 'string' && headerCwd !== '') return headerCwd
  if (persistence !== undefined) {
    try {
      const snapshot = await persistence.stat(sessionId)
      const metaCwd = snapshot?.header?.cwd
      if (typeof metaCwd === 'string' && metaCwd !== '' && isAbsolute(metaCwd)) return metaCwd
    } catch {
      // Persistence is a fallback source, not an authority: an inspect
      // failure degrades to the process cwd instead of failing the delivery.
    }
  }
  return process.cwd()
}
