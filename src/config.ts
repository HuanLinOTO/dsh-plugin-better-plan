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

import z from 'schemastery'

/** Deployment-tunable configuration for the better-plan plugin. */
export interface BetterPlanConfig {
  /**
   * Plan-directory suggestion interpolated into the shadow tool's description
   * (the example path the model is told to write plans under).
   */
  planDir: string
  /**
   * Read cap of one plan file (bytes). A larger file is refused with guidance
   * to trim the plan, so an unbounded write cannot flood the review channel.
   */
  maxPlanBytes: number
}

/** Schemastery schema validated by the cordis Loader. */
export const Config = z.object({
  planDir: z.string().default('docs/plans'),
  maxPlanBytes: z.number().step(1).min(1).default(262144),
})

/** Known config keys (for strict unknown-key rejection). */
const CONFIG_KEYS = new Set(['planDir', 'maxPlanBytes'])

/**
 * Resolve a raw config patch through the schema, returning a full
 * {@link BetterPlanConfig} with defaults applied. Unknown keys are rejected
 * here so a mistyped cordis.yml row fails loud at load instead of being
 * silently ignored.
 * @param input - a partial or complete config object.
 * @returns the schema-resolved config.
 * @throws when the input carries an unknown key or a value the schema rejects.
 */
export function resolveBetterPlanConfig(input: Partial<BetterPlanConfig>): BetterPlanConfig {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of Object.keys(input)) {
      if (!CONFIG_KEYS.has(key)) {
        throw new Error(`better-plan: unknown config key "${key}" — config is { planDir, maxPlanBytes }`)
      }
    }
  }
  return Config(input) as BetterPlanConfig
}
