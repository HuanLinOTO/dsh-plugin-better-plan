/**
 * Client half of @huanlin/dsh-plugin-better-plan: registers the sidebar's
 * "Plan" tab through better-sidebar's service and subscribes the per-session
 * delivery WebSocket that opens it.
 *
 * The tab is `single: true` (one Plan tab per session, dedupe-focused on
 * repeat deliveries). Because the dedupe focus does NOT overwrite an already
 * open tab's path, every push is followed by `updateTab` (feature-gated,
 * v0.12.0+) so a re-delivered plan replaces the tab's content, then
 * `activateTab` focuses it. `meta` rides the tab into better-sidebar's
 * localStorage persistence, so a refresh restores the view and PlanView
 * re-reads the file from `tab.meta.path`.
 *
 * With better-sidebar absent this half stays pending on its inject (legal
 * per the client runner) and, defensively, apply() skips everything when the
 * service is unreachable — the host half's `delivered: false` path covers
 * the no-sidebar deployment.
 *
 * @module @huanlin/dsh-plugin-better-plan/client
 */

import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls better-sidebar's `declare module '@deepseek-ai/cordis'`
// Context merge (ctx.betterSidebar) and the service vocabulary. Erased at
// build time, so it never hits the client-bundle purity gate.
import type {} from 'dsh-better-sidebar/client/service'
import type { BetterSidebarService } from 'dsh-better-sidebar/client/service'
import { IconPlanOutline16 } from './icons.tsx'
import { PlanView } from './PlanView.tsx'

/** The Plan tab type id (also the minted tab id — single instance). */
export const TAB_ID = 'better-plan:plan'

/** The delivery WebSocket path (mirror of the host half's route). */
export const DELIVERY_WS_PATH = '/better-plan/ws/delivery'

/** Reconnect attempts before the loop stops (mirrors the sidebar's socket loops). */
const FAILURE_LIMIT = 5

/**
 * Apply one delivery push to the sidebar: open (or focus) the Plan tab, then
 * overwrite its content via updateTab and focus it (both v0.12.0+; on an
 * older host the plain openTab dedupe-focus still lands the FIRST delivery).
 * @param service - the better-sidebar service.
 * @param payload - the parsed WS frame.
 * @param sessionId - the session the socket is subscribed to.
 */
export function applyDeliveryPush(service: BetterSidebarService, payload: unknown, sessionId: string): void {
  if (payload === null || typeof payload !== 'object') return
  const record = payload as { path?: unknown; title?: unknown }
  if (typeof record.path !== 'string' || record.path === '') return
  const title = typeof record.title === 'string' && record.title !== '' ? record.title : undefined
  const meta = { path: record.path, deliveredAt: Date.now() }
  const scope = { sessionId }
  // Content-type open (path seed) auto-expands the panel; single dedupe
  // focuses an existing tab without overwriting it — hence updateTab next.
  service.openTab({ type: TAB_ID, id: TAB_ID, path: record.path, title, meta }, scope)
  const features = service.features
  if (Array.isArray(features) === true && features.includes('updateTab') === true) {
    service.updateTab(TAB_ID, { ...(title !== undefined ? { title } : {}), path: record.path, meta })
    service.activateTab(TAB_ID, scope)
  }
}

/**
 * Client plugin body.
 * @param ctx - the client cordis context.
 */
export function apply(ctx: Context): void {
  const betterSidebar = ctx.betterSidebar
  if (betterSidebar === undefined) return

  ctx.effect(
    () => betterSidebar.registerTab({
      id: TAB_ID,
      title: () => 'Plan',
      icon: (size: number) => createElement(IconPlanOutline16, { size }),
      // editor(10) 之后、git(20) 之前。
      order: 15,
      single: true,
      component: (props) => createElement(PlanView, props),
    }),
    'dsh-plugin-better-plan: plan tab',
  )

  ctx.effect(() => {
    let socket: WebSocket | null = null
    let retry: number | undefined
    let disposed = false
    let failures = 0
    let current: string | undefined

    const clearRetry = (): void => {
      if (retry !== undefined) {
        window.clearTimeout(retry)
        retry = undefined
      }
    }

    const connect = (sessionId: string): void => {
      if (disposed) return
      clearRetry()
      socket?.close()
      const url = new URL(DELIVERY_WS_PATH, window.location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.search = new URLSearchParams({ session: sessionId }).toString()
      socket = new WebSocket(url.toString())
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        try {
          applyDeliveryPush(betterSidebar, JSON.parse(event.data) as unknown, sessionId)
        } catch {
          // Malformed push: ignore (the next push carries its own delivery).
        }
      }
      socket.onclose = () => {
        if (disposed || current === undefined) return
        failures += 1
        if (failures >= FAILURE_LIMIT) {
          console.error('[dsh-plugin-better-plan] delivery socket failed; stopping reconnect loop', current)
          return
        }
        retry = window.setTimeout(() => { if (current !== undefined) connect(current) }, 2000)
      }
      socket.onerror = () => { socket?.close() }
    }

    // Re-subscribe on session switches: the delivery queue is per session.
    const sync = (): void => {
      const sessionId = betterSidebar.getSnapshot().sessionId
      if (sessionId === current) return
      current = sessionId
      failures = 0
      if (sessionId === undefined) {
        clearRetry()
        socket?.close()
        socket = null
        return
      }
      connect(sessionId)
    }
    sync()
    const unsubscribe = betterSidebar.subscribeState(sync)

    return () => {
      disposed = true
      unsubscribe()
      clearRetry()
      socket?.close()
    }
  }, 'dsh-plugin-better-plan: delivery socket')
}
