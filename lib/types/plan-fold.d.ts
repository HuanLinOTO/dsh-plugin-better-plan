/**
 * Local fold of the logged plan-mode state (last `plan/mode` wins; a log
 * with none folds to inactive). Replaces the `foldPlanMode` export that
 * dsh 0.1.2-alpha.2 removed from @deepseek-ai/dsh-plan-mode when plan
 * state moved into the `plan` session projection.
 *
 * dsh 0.1.2-rc.1 removed the public `session.events` array (seq/offset
 * split, commit 27bf1039db): callers now pass the session itself and the
 * fold reads `snapshotEvents()`.
 * @module @huanlin/dsh-plugin-better-plan/plan-fold
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/** The session-log face this fold reads (structural mirror of `Session`). */
export interface SessionEventLog {
    snapshotEvents(): readonly SessionEvent[];
}
export declare function isPlanModeActive(session: SessionEventLog): boolean;
