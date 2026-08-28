/**
 * The `/better-plan/ws/delivery` push WebSocket: the host→browser channel
 * that carries plan deliveries from the shadowed `exit_plan_mode` tool to the
 * sidebar's Plan tab (query `session=<sessionId>` attaches one view).
 *
 * The socket exists because the host half has no `betterSidebar` service —
 * host→client pushes must ride a route the plugin owns. The payload is one
 * JSON object per delivery: `{ id, path, title }`.
 *
 * @module @huanlin/dsh-plugin-better-plan/ws-route
 */
import type { PlanDeliveryRegistry } from './delivery-registry.ts';
import { type FenceRequest } from './trust-fence.ts';
/** The exact upgrade path registered on the host webServer. */
export declare const DELIVERY_WS_PATH = "/better-plan/ws/delivery";
/** The upgrade request face the route handler receives (headers + url). */
export interface DeliveryUpgradeRequest extends FenceRequest {
    url?: string;
}
/** The upgrade socket face the attach helper needs (the subset of `ws`'s WebSocket). */
export interface DeliverySocket {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    on(event: 'close' | 'error', listener: () => void): unknown;
}
/**
 * Wire one delivery socket to the registry: parse `?session=`, attach the
 * view (replaying queued deliveries), and detach on close/error so later
 * deliveries queue instead of accumulating on a dead socket.
 * @param registry - the delivery registry.
 * @param ws - the connected socket.
 * @param req - the upgrade request.
 */
export declare function attachDeliverySocket(registry: PlanDeliveryRegistry, ws: DeliverySocket, req: DeliveryUpgradeRequest): void;
/**
 * Register the delivery upgrade route on the host webServer.
 * @param registerUpgrade - the webServer's route registrar.
 * @param registry - the delivery registry.
 * @param trustedHosts - non-loopback authorities the deployment serves.
 * @returns the route disposer.
 */
export declare function registerDeliveryRoute(registerUpgrade: (route: {
    path: string;
    handler: (req: DeliveryUpgradeRequest, socket: {
        destroy(): void;
    }, head: Uint8Array) => void | Promise<void>;
}) => () => void, registry: PlanDeliveryRegistry, trustedHosts: readonly string[]): () => void;
