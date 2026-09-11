/**
 * Client half of @huanlin/dsh-plugin-better-plan: registers the sidebar's
 * "Plan" tab through better-sidebar's service and subscribes the per-session
 * delivery WebSocket that opens it and feeds its review action bar.
 *
 * The tab is `single: true` (one Plan tab per session, dedupe-focused on
 * repeat deliveries). The plan path travels ONLY in the tab `meta`
 * (`meta.path`): on the native right sidebar (better-sidebar v0.19+) an
 * openTab seed carrying `path` is routed to `openResource`, where the editor
 * type claims `dsh-resource://file/**` — the plan would open in the file
 * editor and the Plan tab (the approval surface) would never mount. PlanView
 * reads `meta.path` first (`planPathOf`), and `meta` rides the tab into
 * better-sidebar's localStorage persistence, so a refresh restores the view
 * and PlanView re-reads the file from `tab.meta.path`. Because the native page
 * open dedupes by kind (an existing tab keeps its seed fields), every push is
 * still followed by `updateTab` (feature-gated, v0.12.0+) and `activateTab` —
 * they carry the refresh on the pre-0.19 sidebar and are harmless no-ops on
 * the native one. Review frames feed the shared
 * review store; the tab's action bar posts decisions back to
 * `POST /better-plan/api/review` — the sidebar IS the approval surface, the
 * chat shows no popup.
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
// Type-only: pulls the DSH locale plugin's Context merge (ctx.locale) — the
// Host-backed language preference every sidebar copy follows.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { IconPlanOutline16 } from './icons.tsx'
import { activeLocale, attachLocale, enDict, LOCALE_NS, t, zhDict } from './locales.ts'
import { PlanView } from './PlanView.tsx'
import { isReviewState, ReviewStore, reviewStore } from './review-store.ts'

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
 * The plan path travels in `meta.path` only — a path-carrying seed would open
 * the file editor on the native right sidebar instead of this tab.
 * @param service - the better-sidebar service.
 * @param payload - the parsed WS frame.
 * @param sessionId - the session the socket is subscribed to.
 */
export function applyDeliveryPush(service: BetterSidebarService, payload: unknown, sessionId: string): void {
  if (payload === null || typeof payload !== 'object') return
  const record = payload as { path?: unknown; title?: unknown }
  if (typeof record.path !== 'string' || record.path === '') return
  const title = typeof record.title === 'string' && record.title !== '' ? record.title : undefined
  // meta.path is PlanView's read source (planPathOf prefers it) and the
  // persistence key a refresh restores from — the seed itself stays path-less
  // (native surface: a path seed opens the file editor, not this tab).
  const meta = { path: record.path, deliveredAt: Date.now() }
  const scope = { sessionId }
  service.openTab({ type: TAB_ID, id: TAB_ID, title, meta }, scope)
  const features = service.features
  if (Array.isArray(features) === true && features.includes('updateTab') === true) {
    service.updateTab(TAB_ID, { ...(title !== undefined ? { title } : {}), meta })
    service.activateTab(TAB_ID, scope)
  }
}

/**
 * Route one WS frame: `deliver` opens/updates the Plan tab, `review` feeds
 * the review store (the Plan tab's action bar). Malformed frames are ignored
 * (the next push carries its own state).
 * @param service - the better-sidebar service.
 * @param store - the review store the review frames feed.
 * @param frame - the parsed WS frame.
 * @param sessionId - the session the socket is subscribed to.
 */
export function applyDeliveryFrame(service: BetterSidebarService, store: ReviewStore, frame: unknown, sessionId: string): void {
  if (frame === null || typeof frame !== 'object') return
  const kind = (frame as { kind?: unknown }).kind
  if (kind === 'review') {
    const review = (frame as { review?: unknown }).review
    // `null` is the explicit clear; a malformed payload is ignored (the next
    // frame carries its own state) so one bad frame cannot drop a live bar.
    if (review === null) store.set(null)
    else if (isReviewState(review)) store.set(review)
    return
  }
  if (kind === 'deliver') applyDeliveryPush(service, frame, sessionId)
}

/** The betterSidebar and locale services this half resolves through the context proxy. */
export const inject = ['betterSidebar', 'locale']

/**
 * Client plugin body.
 * @param ctx - the client cordis context.
 */
export function apply(ctx: Context): void {
  const betterSidebar = ctx.betterSidebar
  if (betterSidebar === undefined) return

  // Copy follows the DSH i18n system: register the plugin's dictionaries in
  // the shared locale registry and point the module-level t() at the service
  // (absent service → browser-language fallback inside locales.ts).
  attachLocale(ctx.locale)
  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zhDict)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', enDict)
    return () => { offZh(); offEn() }
  }, 'dsh-plugin-better-plan: locale dictionaries')

  ctx.effect(
    () => betterSidebar.registerTab({
      id: TAB_ID,
      title: () => t('tabTitle'),
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
      // The view reports its active locale on every (re)connect so the host's
      // user-facing copy follows the browser's DSH language.
      url.search = new URLSearchParams({ session: sessionId, locale: activeLocale() }).toString()
      socket = new WebSocket(url.toString())
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        try {
          applyDeliveryFrame(betterSidebar, reviewStore, JSON.parse(event.data) as unknown, sessionId)
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

    // Re-subscribe on session switches: the delivery queue and the review
    // state are per session (the reconnect's attach replay restores both).
    const sync = (): void => {
      const sessionId = betterSidebar.getSnapshot().sessionId
      if (sessionId === current) return
      current = sessionId
      reviewStore.reset()
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
