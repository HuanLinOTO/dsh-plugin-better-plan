/**
 * The Context face this plugin's host half consumes: the vendored cordis
 * `Context` intersected with structural mirrors of the services it touches.
 *
 * Intersection (not `declare module` augmentation) mirrors the sidebar's
 * approach: DSH's own packages already augment `@deepseek-ai/cordis`, and
 * restating members structurally avoids TS2717 merge conflicts with any
 * other plugin's augmentation. The augmentations that DO reach this program
 * through workspace types (the typed `agent/session-start` /
 * `agent/pre-step` events from `@deepseek-ai/dsh-agent`) stay untouched.
 *
 * @module @huanlin/dsh-plugin-better-plan/context
 */

import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { PersistenceInspect } from './resolve-cwd.ts'

/** The upgrade route face this plugin registers on the host webServer. */
export interface BetterPlanUpgradeRoute {
  path: string
  handler: (req: {
    url?: string
    headers: Record<string, string | string[] | undefined>
  }, socket: { destroy(): void }, head: Uint8Array) => void | Promise<void>
}

/** The exact HTTP route face this plugin registers on the host webServer. */
export interface BetterPlanHttpRoute {
  kind: 'exact'
  path: string
  handler: (req: never, res: never) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface BetterPlanWebServer {
  registerUpgrade(route: BetterPlanUpgradeRoute): () => void
  register(route: BetterPlanHttpRoute): () => void
}

/** The web runtime trust list (bind-derived; absent on non-web hosts). */
export interface BetterPlanWebRuntime {
  trustedHosts: readonly string[]
}

/** The user-questions service face (structural mirror of the ask seam). */
export interface BetterPlanUserQuestions {
  ask(request: {
    questions: {
      id: string
      question: string
      detail?: string
      header?: string
      options?: { label: string; description?: string }[]
      intent?: { kind: 'plan-review'; approve: string }
    }[]
    agent?: unknown
    signal?: AbortSignal
  }): Promise<{
    answers: { id: string; selected: string[]; custom?: string }[]
  }>
}

/** The shape this plugin consumes. */
export interface BetterPlanContextShape {
  /** The host webserver (upgrade routes). */
  webServer: BetterPlanWebServer
  /** The web runtime trust list (optional: non-web hosts have none). */
  webRuntime?: BetterPlanWebRuntime
  /** The user-questions seam (optional: review degrades without it). */
  userQuestions?: BetterPlanUserQuestions
  /** The session-persistence service (optional: cwd fallback source). */
  sessionPersistence?: PersistenceInspect
}

/** The Context this plugin's host half sees. */
export type Context = CordisContext & BetterPlanContextShape
