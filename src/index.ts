/**
 * @huanlin/dsh-plugin-better-plan — replaces the built-in plan mode's plan
 * DELIVERY while keeping everything else about plan mode intact.
 *
 * The model writes the complete plan to a markdown file (guided by the tool
 * description) and calls the same-name `exit_plan_mode` with its path. This
 * plugin registers that same-name tool into EVERY agent's scope at
 * `agent/session-start` (`agent.ctx.tools.register`) — per-agent scoped
 * registrations shadow the preset-mounted built-in across scope layers, so
 * the built-in plan-mode plugin stays mounted and untouched (its `plan:policy`
 * section, `/plan` command, projection, and composer badge keep working).
 *
 * Delivery pipeline (execute): validate plan mode → resolve the path against
 * the session cwd → stat/read with a byte cap → enqueue a push on the
 * per-session delivery registry (consumed by the `/better-plan/ws/delivery`
 * WebSocket when a sidebar view is attached) → ask the SAME plan-review
 * question the built-in tool asks, with a compact pointer as the detail when
 * the push was delivered and the full plan text otherwise (D3: without the
 * sidebar the user still reviews the plan on the card).
 *
 * Approval queueing the mode flip: the preset realm's `planMode` service is
 * invisible to this plugin, so the approved `plan/mode: false` append is
 * deferred to the next accepted `agent/pre-step` boundary here — the same
 * mechanism the built-in controller uses (the tool result is the narration).
 *
 * @module @huanlin/dsh-plugin-better-plan
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { EXIT_PLAN_MODE, foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
import type { Context } from './context.ts'
import { resolveBetterPlanConfig, type BetterPlanConfig } from './config.ts'
import { PlanDeliveryRegistry } from './delivery-registry.ts'
import { defineExitPlanTool } from './shadow-tool.ts'
import { registerDeliveryRoute } from './ws-route.ts'

export const name = 'dsh-plugin-better-plan'

/**
 * Services required before mounting: the tool registry (its availability
 * gates scoped registrations) and the webserver (the delivery push route).
 */
export const inject = ['tools', 'webServer']

/** Loader schema (schemastery, strict) — validated by the cordis Loader. */
export { Config } from './config.ts'
export type { BetterPlanConfig } from './config.ts'

/** One approved exit awaiting the next accepted pre-step boundary. */
const pendingExits = new WeakSet<Session>()

/**
 * Flush one pending approved exit: append the log-only `plan/mode: false`
 * event before the next request assembly. Mirrors the built-in controller's
 * boundary append — the delete happens only after a successful append, so a
 * failed durable write stays retryable at the next boundary.
 * @param agent - the agent whose step was accepted.
 * @returns whether a pending exit remains (a failed append keeps it).
 */
function flushPendingExit(agent: Agent): boolean {
  const session = agent.session
  if (!pendingExits.has(session)) return false
  if (!foldPlanMode(session.events)) {
    pendingExits.delete(session)
    return false
  }
  session.append('plan/mode', { active: false })
  pendingExits.delete(session)
  return false
}

/**
 * Wire the plugin onto a host context. Everything this registers is bound to
 * `ctx`'s own fiber and cleans up on disposal (HMR-safe).
 * @param ctx - the host plugin context.
 * @param config - the resolved plugin config.
 * @returns the created delivery registry (exposed for tests).
 */
export function createBetterPlan(ctx: Context, config: BetterPlanConfig): PlanDeliveryRegistry {
  const registry = new PlanDeliveryRegistry()
  let disposed = false

  // Register the shadowed delivery tool in every agent's scope. The effect
  // lives on the agent's own fiber: agent disposal unwinds it, and the
  // session-start contract (once per agent) keeps registration idempotent —
  // the per-agent set below is the defensive catalog check (a scope-layer
  // lookup would also see the preset-mounted original and skip forever).
  const shadowed = new WeakSet<object>()
  ctx.on('agent/session-start', ({ agent }: { agent: Agent }) => {
    if (shadowed.has(agent)) return
    shadowed.add(agent)
    agent.ctx.effect(
      () => agent.ctx.tools.register(defineExitPlanTool({
        ctx,
        config,
        registry,
        isDisposed: () => disposed,
        onApproved: (session: object) => { pendingExits.add(session as Session) },
      })),
      'dsh-plugin-better-plan: shadow exit_plan_mode',
    )
  })

  // Flush an approved exit before the next request assembly, so the
  // `plan:policy` section (folded from the log) goes blank for the very
  // request that follows the approval.
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    try {
      flushPendingExit(agent)
    } catch (error) {
      ctx.logger.warn('dsh-plugin-better-plan: failed to append the approved plan exit at step start: %o', error)
    }
    return decision
  })

  // The delivery push route. The web runtime's trusted-host list is optional:
  // without it the fence accepts loopback hosts only, which still serves the
  // default local deployment.
  ctx.effect(
    () => registerDeliveryRoute(
      (route) => ctx.webServer.registerUpgrade(route),
      registry,
      ctx.get('webRuntime')?.trustedHosts ?? [],
    ),
    'dsh-plugin-better-plan: delivery WebSocket',
  )

  ctx.effect(() => () => {
    disposed = true
    registry.dispose()
  }, 'dsh-plugin-better-plan: service lifetime')

  return registry
}

/**
 * Plugin entry.
 * @param ctx - the host plugin context.
 * @param config - the composition entry config (defaults fill in via the schema).
 */
export function apply(ctx: Context, config: Partial<BetterPlanConfig> = {}): void {
  createBetterPlan(ctx, resolveBetterPlanConfig(config))
}
