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
/** The session-header slice this resolver reads. */
export interface SessionCwdProbe {
    readonly header?: {
        readonly cwd?: string;
    };
}
/** The session-persistence face this resolver consults (structural mirror). */
export interface PersistenceInspect {
    inspect(sessionId: string): Promise<{
        meta: {
            cwd?: string;
        };
    }>;
}
/**
 * Resolve one session's working directory.
 * @param session - the calling session (its header cwd is authoritative).
 * @param sessionId - the session id, for the persistence lookup.
 * @param persistence - the optional session-persistence service.
 * @returns an absolute working directory (never empty).
 */
export declare function resolveSessionCwd(session: SessionCwdProbe | undefined, sessionId: string, persistence: PersistenceInspect | undefined): Promise<string>;
