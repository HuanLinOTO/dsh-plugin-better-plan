/**
 * Config schema for the better-plan plugin (Schemastery, strict).
 *
 * The plugin injects no extra system-prompt section: the new delivery contract
 * travels entirely inside the shadowed `exit_plan_mode` tool description, so
 * the built-in `plan:policy` section stays verbatim and these two knobs are
 * the whole configuration surface.
 *
 * @module @huanlin/dsh-plugin-better-plan/config
 */
/** Deployment-tunable configuration for the better-plan plugin. */
export interface BetterPlanConfig {
    /**
     * Plan-directory suggestion interpolated into the shadow tool's description
     * (the example path the model is told to write plans under).
     */
    planDir: string;
    /**
     * Read cap of one plan file (bytes). A larger file is refused with guidance
     * to trim the plan, so an unbounded write cannot flood the review channel.
     */
    maxPlanBytes: number;
}
/** Schemastery schema validated by the cordis Loader. */
export declare const Config: import("C:/Users/Administrator/.dsh/source/current/vendor/schemastery/lib/types").default<Schemastery.ObjectS<{
    planDir: import("C:/Users/Administrator/.dsh/source/current/vendor/schemastery/lib/types").default<string, string>;
    maxPlanBytes: import("C:/Users/Administrator/.dsh/source/current/vendor/schemastery/lib/types").default<number, number>;
}>, Schemastery.ObjectT<{
    planDir: import("C:/Users/Administrator/.dsh/source/current/vendor/schemastery/lib/types").default<string, string>;
    maxPlanBytes: import("C:/Users/Administrator/.dsh/source/current/vendor/schemastery/lib/types").default<number, number>;
}>>;
/**
 * Resolve a raw config patch through the schema, returning a full
 * {@link BetterPlanConfig} with defaults applied. Unknown keys are rejected
 * here so a mistyped cordis.yml row fails loud at load instead of being
 * silently ignored.
 * @param input - a partial or complete config object.
 * @returns the schema-resolved config.
 * @throws when the input carries an unknown key or a value the schema rejects.
 */
export declare function resolveBetterPlanConfig(input: Partial<BetterPlanConfig>): BetterPlanConfig;
