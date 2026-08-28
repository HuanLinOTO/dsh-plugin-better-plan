/**
 * The plan-delivery registry: a per-session queue of plan pushes plus the
 * connected sidebar views, following the sidebar's AgentOpenRegistry pattern
 * (consume-on-send) with one addition — a bounded queue.
 *
 * `enqueue` adds a delivery and, when at least one view for the session is
 * attached, pushes it immediately and clears the queue (`delivered: true`).
 * With no attached view the delivery stays queued and `attach` replays it on
 * connect. The queue holds at most {@link DELIVERY_QUEUE_LIMIT} entries per
 * session (oldest dropped first): a session delivered while no browser is
 * open must not accumulate unbounded plan pushes that all replay at once on
 * the next attach — the newest plan is the one under review.
 *
 * @module @huanlin/dsh-plugin-better-plan/delivery-registry
 */

import { randomUUID } from 'node:crypto'

/** One plan push (the wire face over the delivery WebSocket). */
export interface PlanDelivery {
  /** Opaque id (host-generated; the client uses it only for dedupe/debug). */
  id: string
  /** Absolute path of the plan file. */
  path: string
  /** Sidebar tab title: the plan's first heading, else the file basename. */
  title: string
}

/** Maximum queued deliveries per session (oldest dropped beyond this). */
export const DELIVERY_QUEUE_LIMIT = 8

/** One subscribed sidebar view's sender. */
type Sender = (delivery: PlanDelivery) => void

/**
 * Per-session delivery queues plus the connected views.
 */
export class PlanDeliveryRegistry {
  private pending = new Map<string, PlanDelivery[]>()
  private subscribers = new Map<string, Set<Sender>>()

  /**
   * Queue one delivery and push it immediately when a view is attached.
   * @param sessionId - the session whose plan panel is targeted.
   * @param path - absolute path of the plan file.
   * @param title - sidebar tab title for the plan.
   * @returns the delivery id and whether a connected view received it now.
   */
  enqueue(sessionId: string, path: string, title: string): { id: string; delivered: boolean } {
    const delivery: PlanDelivery = { id: randomUUID(), path, title }
    const list = this.pending.get(sessionId) ?? []
    list.push(delivery)
    if (list.length > DELIVERY_QUEUE_LIMIT) list.shift()
    this.pending.set(sessionId, list)
    const views = this.subscribers.get(sessionId)
    if (views !== undefined && views.size > 0) {
      for (const send of views) send(delivery)
      this.pending.delete(sessionId)
      return { id: delivery.id, delivered: true }
    }
    return { id: delivery.id, delivered: false }
  }

  /**
   * Attach one sidebar view; queued deliveries replay immediately
   * (consume-on-send: a reconnect must never re-show a plan already open).
   * @param sessionId - the session the view displays.
   * @param send - the push callback for this view.
   * @returns the disposer detaching the view.
   */
  attach(sessionId: string, send: Sender): () => void {
    let views = this.subscribers.get(sessionId)
    if (views === undefined) {
      views = new Set()
      this.subscribers.set(sessionId, views)
    }
    views.add(send)
    const queued = this.pending.get(sessionId) ?? []
    if (queued.length > 0) {
      for (const delivery of queued) send(delivery)
      this.pending.delete(sessionId)
    }
    return () => {
      const current = this.subscribers.get(sessionId)
      current?.delete(send)
      if (current !== undefined && current.size === 0) this.subscribers.delete(sessionId)
    }
  }

  /** Drop every queued delivery (kept for symmetry with the sidebar registry). */
  drainAll(): void {
    this.pending.clear()
  }

  /** Drop every queue and subscriber (plugin teardown). */
  dispose(): void {
    this.pending.clear()
    this.subscribers.clear()
  }
}
