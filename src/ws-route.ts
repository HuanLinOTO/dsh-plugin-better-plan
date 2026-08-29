/**
 * The `/better-plan/ws/delivery` push WebSocket: the host→browser channel
 * for the sidebar's Plan tab (query `session=<sessionId>` attaches one view).
 *
 * The socket exists because the host half has no `betterSidebar` service —
 * host→client pushes must ride a route the plugin owns. Two tagged JSON
 * frames flow server→view:
 *   `{ kind: 'deliver', id, path, title }`      — one plan delivery;
 *   `{ kind: 'review', review: ReviewState|null }` — the review state
 *     (replayed on attach, pushed on every change).
 *
 * @module @huanlin/dsh-plugin-better-plan/ws-route
 */

import { WebSocketServer, type WebSocket } from 'ws'
import type { PlanDeliveryRegistry } from './delivery-registry.ts'
import type { PlanReviewGate } from './review-gate.ts'
import { isTrustedDeliveryRequest, type FenceRequest } from './trust-fence.ts'

/** The exact upgrade path registered on the host webServer. */
export const DELIVERY_WS_PATH = '/better-plan/ws/delivery'

/** The upgrade request face the route handler receives (headers + url). */
export interface DeliveryUpgradeRequest extends FenceRequest {
  url?: string
}

/** The upgrade socket face the attach helper needs (the subset of `ws`'s WebSocket). */
export interface DeliverySocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: 'close' | 'error', listener: () => void): unknown
}

/**
 * Wire one delivery socket to the registries: parse `?session=`, attach the
 * delivery queue (replaying queued pushes) and the review gate (replaying
 * the latest review state), and detach on close/error so later pushes queue
 * instead of accumulating on a dead socket.
 * @param registry - the delivery registry.
 * @param gate - the review gate.
 * @param ws - the connected socket.
 * @param req - the upgrade request.
 */
export function attachDeliverySocket(
  registry: PlanDeliveryRegistry,
  gate: PlanReviewGate,
  ws: DeliverySocket,
  req: DeliveryUpgradeRequest,
): void {
  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const sessionId = url.searchParams.get('session')
  if (sessionId === null || sessionId === '') {
    ws.close(1008, 'session is required')
    return
  }
  const send = (frame: unknown): void => {
    ws.send(JSON.stringify(frame))
  }
  const detachDelivery = registry.attach(sessionId, delivery => send({ kind: 'deliver', ...delivery }))
  const detachReview = gate.attach(sessionId, send)
  const detach = (): void => {
    detachDelivery()
    detachReview()
  }
  ws.on('close', detach)
  ws.on('error', detach)
}

/**
 * Register the delivery upgrade route on the host webServer.
 * @param registerUpgrade - the webServer's route registrar.
 * @param registry - the delivery registry.
 * @param gate - the review gate.
 * @param trustedHosts - non-loopback authorities the deployment serves.
 * @returns the route disposer.
 */
export function registerDeliveryRoute(
  registerUpgrade: (route: {
    path: string
    handler: (req: DeliveryUpgradeRequest, socket: { destroy(): void }, head: Uint8Array) => void | Promise<void>
  }) => () => void,
  registry: PlanDeliveryRegistry,
  gate: PlanReviewGate,
  trustedHosts: readonly string[],
): () => void {
  const wss = new WebSocketServer({ noServer: true })
  const dispose = registerUpgrade({
    path: DELIVERY_WS_PATH,
    handler: (req, socket, head) => {
      if (!isTrustedDeliveryRequest(req, trustedHosts)) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(
        req as unknown as import('node:http').IncomingMessage,
        socket as unknown as import('node:stream').Duplex,
        head as Buffer,
        (ws: WebSocket) => { attachDeliverySocket(registry, gate, ws, req) },
      )
    },
  })
  return () => {
    dispose()
    wss.close()
  }
}
