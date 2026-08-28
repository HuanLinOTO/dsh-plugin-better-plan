/**
 * Browser-trust fence for the delivery WebSocket, behaviorally identical to
 * the sidebar's fence (and to the /api gateway's fence in
 * @deepseek-ai/dsh-client-connection, from which both derive): Host-header
 * loopback or a configured trusted authority passes; cross-site browser
 * markers refuse. This is a DNS-rebinding / cross-site defense, not
 * authentication — the push payload (plan path + title) is chat-adjacent
 * data, so the fence keeps off-host pages from harvesting it.
 *
 * @module @huanlin/dsh-plugin-better-plan/trust-fence
 */
/** The request facts the fence reads. */
export interface FenceRequest {
    headers: Record<string, string | string[] | undefined>;
}
/** Whether a normalized URL hostname names the local loopback authority. */
export declare function isLoopbackHostname(hostname: string): boolean;
/**
 * Decide whether one request may reach the delivery WebSocket.
 * @param request - the upgrade request's headers.
 * @param trustedHosts - non-loopback authorities this deployment serves.
 * @returns true when the Host is ours (loopback or trusted) and browser
 *   markers are same-origin.
 */
export declare function isTrustedDeliveryRequest(request: FenceRequest, trustedHosts: readonly string[]): boolean;
