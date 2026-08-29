/**
 * The delegation flow's client half: after a review settles as
 * `delegated`, create the execution conversation through DSH's public
 * sessions service (`ctx.get('sessions')`), queue the kickoff prompt into
 * it, and navigate there.
 *
 * The faces below are STRUCTURAL (the minimal subset of
 * `@deepseek-ai/dsh-api-session-controller/client`'s `ISessions` /
 * `SessionFace` this flow calls) — the same pattern better-sidebar uses for
 * cross-plugin services: no value import crosses the client-bundle purity
 * gate and no new tsconfig path is needed; the runtime service arrives
 * through the context proxy. The planning session's list summary supplies
 * the new conversation's cwd, so the fresh agent runs on the same
 * workspace the plan was written for.
 *
 * @module @huanlin/dsh-plugin-better-plan/client/execution-launch
 */
/** One admitted prompt's outcome (the client-result face of `prompt`). */
export interface PromptOutcome {
    ok: boolean;
    error?: {
        code?: string;
        message?: string;
    };
}
/** The structural session face the kickoff needs (the `prompt` verb). */
export interface ExecutionSessionFace {
    prompt(content: {
        type: 'text';
        text: string;
    }[], mode: 'queue'): Promise<PromptOutcome>;
}
/** The structural `ctx.sessions` face the delegation flow consumes. */
export interface SessionsServiceFace {
    /** Create a blank session (in the workspace of `cwd` when given). */
    create(opts?: {
        cwd?: string;
    }): Promise<string>;
    /** Select a session as the current conversation. */
    open(id: string): void;
    /** The session list snapshot (the planning session's cwd source). */
    list: {
        getSnapshot(): {
            byId: Record<string, {
                cwd?: string;
            } | undefined>;
        };
    };
    /** The live session face for a locally addressable session. */
    binding(id: string): {
        session: ExecutionSessionFace;
    } | undefined;
}
/**
 * Launch the execution conversation for a delegated plan: create a blank
 * session in the planning session's workspace, queue the kickoff prompt
 * pointing at the approved plan file, then navigate to the new
 * conversation. Every failure rejects with an Error whose message the
 * plan panel shows (the plan path stays visible there, so the user can
 * always start a conversation and send the plan manually).
 * @param sessions - the sessions service (`ctx.get('sessions')`).
 * @param planPath - the approved plan file's absolute path.
 * @param sessionId - the planning session (its summary carries the cwd).
 */
export declare function launchExecutionConversation(sessions: SessionsServiceFace, planPath: string, sessionId: string): Promise<void>;
