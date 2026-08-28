import { EXIT_PLAN_MODE, foldPlanMode } from "@deepseek-ai/dsh-plan-mode";
import z from "schemastery";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { UserQuestionError } from "@deepseek-ai/dsh-user-questions";
import { WebSocketServer } from "ws";
//#region src/config.ts
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
/** Schemastery schema validated by the cordis Loader. */
const Config = z.object({
	planDir: z.string().default("docs/plans"),
	maxPlanBytes: z.number().step(1).min(1).default(262144)
});
/** Known config keys (for strict unknown-key rejection). */
const CONFIG_KEYS = /* @__PURE__ */ new Set(["planDir", "maxPlanBytes"]);
/**
* Resolve a raw config patch through the schema, returning a full
* {@link BetterPlanConfig} with defaults applied. Unknown keys are rejected
* here so a mistyped cordis.yml row fails loud at load instead of being
* silently ignored.
* @param input - a partial or complete config object.
* @returns the schema-resolved config.
* @throws when the input carries an unknown key or a value the schema rejects.
*/
function resolveBetterPlanConfig(input) {
	if (input !== null && typeof input === "object" && !Array.isArray(input)) {
		for (const key of Object.keys(input)) if (!CONFIG_KEYS.has(key)) throw new Error(`better-plan: unknown config key "${key}" — config is { planDir, maxPlanBytes }`);
	}
	return Config(input);
}
/**
* Per-session delivery queues plus the connected views.
*/
var PlanDeliveryRegistry = class {
	pending = /* @__PURE__ */ new Map();
	subscribers = /* @__PURE__ */ new Map();
	/**
	* Queue one delivery and push it immediately when a view is attached.
	* @param sessionId - the session whose plan panel is targeted.
	* @param path - absolute path of the plan file.
	* @param title - sidebar tab title for the plan.
	* @returns the delivery id and whether a connected view received it now.
	*/
	enqueue(sessionId, path, title) {
		const delivery = {
			id: randomUUID(),
			path,
			title
		};
		const list = this.pending.get(sessionId) ?? [];
		list.push(delivery);
		if (list.length > 8) list.shift();
		this.pending.set(sessionId, list);
		const views = this.subscribers.get(sessionId);
		if (views !== void 0 && views.size > 0) {
			for (const send of views) send(delivery);
			this.pending.delete(sessionId);
			return {
				id: delivery.id,
				delivered: true
			};
		}
		return {
			id: delivery.id,
			delivered: false
		};
	}
	/**
	* Attach one sidebar view; queued deliveries replay immediately
	* (consume-on-send: a reconnect must never re-show a plan already open).
	* @param sessionId - the session the view displays.
	* @param send - the push callback for this view.
	* @returns the disposer detaching the view.
	*/
	attach(sessionId, send) {
		let views = this.subscribers.get(sessionId);
		if (views === void 0) {
			views = /* @__PURE__ */ new Set();
			this.subscribers.set(sessionId, views);
		}
		views.add(send);
		const queued = this.pending.get(sessionId) ?? [];
		if (queued.length > 0) {
			for (const delivery of queued) send(delivery);
			this.pending.delete(sessionId);
		}
		return () => {
			const current = this.subscribers.get(sessionId);
			current?.delete(send);
			if (current !== void 0 && current.size === 0) this.subscribers.delete(sessionId);
		};
	}
	/** Drop every queued delivery (kept for symmetry with the sidebar registry). */
	drainAll() {
		this.pending.clear();
	}
	/** Drop every queue and subscriber (plugin teardown). */
	dispose() {
		this.pending.clear();
		this.subscribers.clear();
	}
};
//#endregion
//#region src/first-heading.ts
/**
* Plan-title extraction, shared by the delivery registry (sidebar tab title),
* the WS push payload, and the canonical tool value.
*
* `firstHeading` mirrors the built-in plan mode's regex so both tools name a
* plan the same way. D2 keeps validation loose: a plan without any heading is
* accepted and falls back to the file basename.
*
* @module @huanlin/dsh-plugin-better-plan/first-heading
*/
/**
* The plan's first markdown heading (any level), or `undefined` when the plan
* has none. Tolerates leading whitespace before `#` and trailing whitespace
* after the text; a 7-`#` run is not a heading.
* @param plan - the full plan markdown.
* @returns the heading text, or `undefined` when no line matches.
*/
function firstHeading(plan) {
	for (const line of plan.split("\n")) {
		const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
		if (match) return match[1];
	}
}
/**
* The last path segment of a POSIX or Windows path (mirror of the sidebar
* client's FileTree baseName), used as the fallback plan title.
* @param path - the path to shorten.
* @returns the basename without trailing separators.
*/
function basenameOf(path) {
	const trimmed = path.replace(/[\\/]+$/, "");
	const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return at === -1 ? trimmed : trimmed.slice(at + 1);
}
//#endregion
//#region src/resolve-cwd.ts
/**
* Session working-directory resolution for relative plan paths.
*
* Chain (mirror of the sidebar's sessionCwdOf): the live session header wins;
* while that header carries no cwd (a stripped-down host or a session created
* without workspace metadata) the persistence index is consulted for cold
* sessions; the host process cwd is the final fallback. A persistence failure
* or a non-absolute persisted value also falls through to the process cwd —
* a delivery tool should not die because the index hiccups, and a wrong
* fallback surfaces as a clear "file does not exist" error from the caller's
* own stat.
*
* @module @huanlin/dsh-plugin-better-plan/resolve-cwd
*/
/**
* Resolve one session's working directory.
* @param session - the calling session (its header cwd is authoritative).
* @param sessionId - the session id, for the persistence lookup.
* @param persistence - the optional session-persistence service.
* @returns an absolute working directory (never empty).
*/
async function resolveSessionCwd(session, sessionId, persistence) {
	const headerCwd = session?.header?.cwd;
	if (typeof headerCwd === "string" && headerCwd !== "") return headerCwd;
	if (persistence !== void 0) try {
		const metaCwd = (await persistence.inspect(sessionId))?.meta?.cwd;
		if (typeof metaCwd === "string" && metaCwd !== "" && isAbsolute(metaCwd)) return metaCwd;
	} catch {}
	return process.cwd();
}
//#endregion
//#region src/shadow-tool.ts
/**
* The shadowed `exit_plan_mode` tool — better-plan's whole model-facing
* contract.
*
* The tool keeps the built-in plan mode's name (D1): every agent preset's
* planning group mounts `@deepseek-ai/dsh-plan-mode` inside an isolate realm,
* and preset mount lines cannot be patched, so a same-name per-agent
* registration through `agent.ctx` is the only replacement seam. Shadowing
* keeps the preset's `plan:policy` section verbatim (its statements about
* `exit_plan_mode` remain true) and leaves `/plan`, the projection, and the
* composer badge working unchanged.
*
* What changes is the delivery: the model must write the COMPLETE plan to a
* markdown file first (guided by this description — D2 verifies only that the
* file exists and is readable), then pass its path. The tool reads the file,
* pushes it to the session's sidebar plan panel through the delivery
* registry, and asks the SAME plan-review question the built-in tool asks —
* with a compact pointer as the detail when the push was delivered, the full
* plan text otherwise (no sidebar environment ⇒ the original experience).
*
* Approval keeps the built-in approval semantics AND the built-in mode
* switch: the preset realm's `planMode` service is invisible to this plugin,
* so the `plan/mode: false` append is deferred to the next accepted
* `agent/pre-step` boundary here (the same mechanism the built-in controller
* uses; the tool result is the narration, so nothing extra is injected).
*
* Conventions (per plugin-development-guide.md §3):
*   C4 — `execute` returns one canonical JSON value; `render` is separate.
*   C6 — `exec.signal.throwIfAborted()` before any fs work.
*   C9 — presentCall/presentResult are pure functions of their arguments.
*
* @module @huanlin/dsh-plugin-better-plan/shadow-tool
*/
/** The review question's id, echoed in the answer this tool reads. */
const REVIEW_ID = "plan-review";
/** The review question's approve option label (the built-in wording). */
const APPROVE_LABEL = "Approve";
/** The review question's keep-planning option label (the built-in wording). */
const KEEP_PLANNING_LABEL = "Keep planning";
/**
* The model-facing description. The model's only new knowledge: the
* file-first contract, the sidebar plan panel, and the unchanged review flow.
* `planDir` is interpolated into the example path.
* @param config - the plugin config (planDir suggestion).
* @returns the description string.
*/
function exitPlanDescription(config) {
	return `Use only in plan mode. Before calling, write the COMPLETE plan as markdown to a file with the write tool (e.g. \`${config.planDir}/YYYY-MM-DD-<topic>.md\`), then pass its path here. The plan opens in the sidebar plan panel for the user's review; the user may approve (carry out the plan from your next step) or keep planning — their feedback comes back in the tool result; revise the file and present again.`;
}
/**
* The review question's detail: a one-line pointer when the push reached a
* connected sidebar view, the full plan text otherwise (D3 — without the
* sidebar the user must still see the plan on the approval card).
* @param delivered - whether the plan was pushed to a connected view.
* @param plan - the full plan markdown (the fallback detail).
* @param path - the resolved absolute plan path.
* @returns the detail string for the plan-review question.
*/
function reviewDetail(delivered, plan, path) {
	return delivered ? `The complete plan is open in the sidebar plan panel (${path}). Approve to leave plan mode and carry it out, or keep planning with feedback.` : plan;
}
/** The model-facing render of an approved delivery. */
function renderApproved(args, value) {
	return [{
		type: "text",
		text: value.delivered ? "Plan approved — plan mode exited; carry out the plan starting with your next step. The plan is open in the sidebar plan panel." : `Plan approved — plan mode exited; carry out the plan starting with your next step. (No sidebar plan panel is connected; the plan file is at ${args.path}.)`
	}];
}
/**
* Build the shadowed tool definition. Registration is the caller's job
* (`agent.ctx.tools.register` from the session-start hook).
* @param deps - the plugin-provided collaborators.
* @returns a registry-ready tool definition.
*/
function defineExitPlanTool(deps) {
	const { ctx, config, registry } = deps;
	return defineTool({
		name: EXIT_PLAN_MODE,
		description: exitPlanDescription(config),
		parameters: { path: {
			type: "string",
			required: true,
			description: "Absolute or session-cwd-relative path of the markdown plan file (written with the write tool before this call)."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					approved: {
						type: "boolean",
						const: true,
						required: true
					},
					delivered: {
						type: "boolean",
						required: true,
						description: "Whether the plan was pushed to a connected sidebar plan panel at call time (false = queued for the next view attach, or no sidebar installed)."
					}
				}
			},
			render: renderApproved
		},
		execute: async (args, exec) => {
			exec.signal.throwIfAborted();
			const agent = exec.agent;
			if (agent === void 0) throw new Error(`${EXIT_PLAN_MODE} requires a calling agent (no session to switch)`);
			if (!foldPlanMode(agent.session.events)) throw new Error(`${EXIT_PLAN_MODE} is only available in plan mode`);
			const sessionId = agent.session.id;
			const cwd = await resolveSessionCwd(agent.session, sessionId, ctx.get("sessionPersistence"));
			const absolute = isAbsolute(args.path) ? args.path : join(cwd, args.path);
			let info;
			try {
				info = await stat(absolute);
			} catch (error) {
				const code = error.code;
				if (code === "ENOENT") throw new Error(`${EXIT_PLAN_MODE} could not read the plan file "${args.path}" (resolved to "${absolute}"): it does not exist. Write the COMPLETE plan as markdown to a file with the write tool first, then call exit_plan_mode with its path.`);
				if (code === "EACCES" || code === "EPERM") throw new Error(`the plan file "${absolute}" is not readable`);
				throw new Error(`cannot read the plan file "${absolute}": ${error instanceof Error ? error.message : String(error)}`);
			}
			if (!info.isFile()) throw new Error(`"${absolute}" is not a file; pass the path of the markdown plan file`);
			if (info.size > config.maxPlanBytes) throw new Error(`the plan file is ${info.size} bytes, over the ${config.maxPlanBytes}-byte review limit; write a more concise plan (state decisions and changes, not full file contents) and present it again`);
			const plan = await readFile(absolute, "utf8");
			const title = firstHeading(plan) ?? basenameOf(absolute);
			const { delivered } = registry.enqueue(sessionId, absolute, title);
			const interaction = ctx.get("userQuestions");
			if (interaction === void 0) throw new Error("no user-questions channel is available to review the plan; ask the user to switch the session mode instead");
			const answer = await interaction.ask({
				questions: [{
					id: REVIEW_ID,
					header: "Plan review",
					question: "Approve this plan and leave plan mode?",
					detail: reviewDetail(delivered, plan, absolute),
					options: [{
						label: APPROVE_LABEL,
						description: "Leave plan mode; the plan is carried out from the next step."
					}, {
						label: KEEP_PLANNING_LABEL,
						description: "Stay in plan mode; feedback goes back to the model."
					}],
					intent: {
						kind: "plan-review",
						approve: APPROVE_LABEL
					}
				}],
				agent,
				signal: exec.signal
			}).catch((cause) => {
				if (cause instanceof UserQuestionError && cause.code === "ASK_CANCELLED") throw new Error("The user dismissed the plan review to speak instead; stay in plan mode, stop here, and wait for their message.");
				throw cause;
			});
			if (deps.isDisposed()) throw new Error("the better-plan plugin was reloaded while the plan was under review; write the plan and present it again");
			const reviewItems = answer.answers.filter((entry) => entry.id === REVIEW_ID);
			const item = reviewItems.length === 1 ? reviewItems[0] : void 0;
			if (item?.selected.length !== 1 || item.selected[0] !== "Approve" || item.custom !== void 0) {
				const feedback = item?.custom ?? "";
				throw new Error(feedback === "" ? "The user chose to keep planning; revise the plan file and present it again." : `The user chose to keep planning; their feedback: ${feedback}`);
			}
			deps.onApproved(agent.session);
			return {
				approved: true,
				delivered
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: basenameOf(args.path),
			kind: "other",
			content: [{
				type: "text",
				text: "Plan file delivered for review — the complete plan opens in the sidebar plan panel; approve or keep planning below."
			}]
		}),
		presentResult: (_args, result) => ({
			card: "generic",
			title: "Plan review",
			content: result.content
		})
	});
}
//#endregion
//#region src/trust-fence.ts
function header(headers, name) {
	const value = headers[name];
	return typeof value === "string" ? value : void 0;
}
/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
/**
* Decide whether one request may reach the delivery WebSocket.
* @param request - the upgrade request's headers.
* @param trustedHosts - non-loopback authorities this deployment serves.
* @returns true when the Host is ours (loopback or trusted) and browser
*   markers are same-origin.
*/
function isTrustedDeliveryRequest(request, trustedHosts) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).hostname === hostUrl.hostname;
	} catch {
		return false;
	}
}
//#endregion
//#region src/ws-route.ts
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
/** The exact upgrade path registered on the host webServer. */
const DELIVERY_WS_PATH = "/better-plan/ws/delivery";
/**
* Wire one delivery socket to the registry: parse `?session=`, attach the
* view (replaying queued deliveries), and detach on close/error so later
* deliveries queue instead of accumulating on a dead socket.
* @param registry - the delivery registry.
* @param ws - the connected socket.
* @param req - the upgrade request.
*/
function attachDeliverySocket(registry, ws, req) {
	const sessionId = new URL(req.url ?? "/", "http://dsh.internal").searchParams.get("session");
	if (sessionId === null || sessionId === "") {
		ws.close(1008, "session is required");
		return;
	}
	const send = (delivery) => {
		ws.send(JSON.stringify(delivery));
	};
	const unsubscribe = registry.attach(sessionId, send);
	ws.on("close", () => {
		unsubscribe();
	});
	ws.on("error", () => {
		unsubscribe();
	});
}
/**
* Register the delivery upgrade route on the host webServer.
* @param registerUpgrade - the webServer's route registrar.
* @param registry - the delivery registry.
* @param trustedHosts - non-loopback authorities the deployment serves.
* @returns the route disposer.
*/
function registerDeliveryRoute(registerUpgrade, registry, trustedHosts) {
	const wss = new WebSocketServer({ noServer: true });
	const dispose = registerUpgrade({
		path: DELIVERY_WS_PATH,
		handler: (req, socket, head) => {
			if (!isTrustedDeliveryRequest(req, trustedHosts)) {
				socket.destroy();
				return;
			}
			wss.handleUpgrade(req, socket, head, (ws) => {
				attachDeliverySocket(registry, ws, req);
			});
		}
	});
	return () => {
		dispose();
		wss.close();
	};
}
//#endregion
//#region src/index.ts
const name = "dsh-plugin-better-plan";
/**
* Services required before mounting: the tool registry (its availability
* gates scoped registrations) and the webserver (the delivery push route).
*/
const inject = ["tools", "webServer"];
/** One approved exit awaiting the next accepted pre-step boundary. */
const pendingExits = /* @__PURE__ */ new WeakSet();
/**
* Flush one pending approved exit: append the log-only `plan/mode: false`
* event before the next request assembly. Mirrors the built-in controller's
* boundary append — the delete happens only after a successful append, so a
* failed durable write stays retryable at the next boundary.
* @param agent - the agent whose step was accepted.
* @returns whether a pending exit remains (a failed append keeps it).
*/
function flushPendingExit(agent) {
	const session = agent.session;
	if (!pendingExits.has(session)) return false;
	if (!foldPlanMode(session.events)) {
		pendingExits.delete(session);
		return false;
	}
	session.append("plan/mode", { active: false });
	pendingExits.delete(session);
	return false;
}
/**
* Wire the plugin onto a host context. Everything this registers is bound to
* `ctx`'s own fiber and cleans up on disposal (HMR-safe).
* @param ctx - the host plugin context.
* @param config - the resolved plugin config.
* @returns the created delivery registry (exposed for tests).
*/
function createBetterPlan(ctx, config) {
	const registry = new PlanDeliveryRegistry();
	let disposed = false;
	const shadowed = /* @__PURE__ */ new WeakSet();
	ctx.on("agent/session-start", ({ agent }) => {
		if (shadowed.has(agent)) return;
		shadowed.add(agent);
		agent.ctx.effect(() => agent.ctx.tools.register(defineExitPlanTool({
			ctx,
			config,
			registry,
			isDisposed: () => disposed,
			onApproved: (session) => {
				pendingExits.add(session);
			}
		})), "dsh-plugin-better-plan: shadow exit_plan_mode");
	});
	ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
		const decision = await next();
		if (decision.kind === "reject" || signal.aborted) return decision;
		try {
			flushPendingExit(agent);
		} catch (error) {
			ctx.logger.warn("dsh-plugin-better-plan: failed to append the approved plan exit at step start: %o", error);
		}
		return decision;
	});
	ctx.effect(() => registerDeliveryRoute((route) => ctx.webServer.registerUpgrade(route), registry, ctx.get("webRuntime")?.trustedHosts ?? []), "dsh-plugin-better-plan: delivery WebSocket");
	ctx.effect(() => () => {
		disposed = true;
		registry.dispose();
	}, "dsh-plugin-better-plan: service lifetime");
	return registry;
}
/**
* Plugin entry.
* @param ctx - the host plugin context.
* @param config - the composition entry config (defaults fill in via the schema).
*/
function apply(ctx, config = {}) {
	createBetterPlan(ctx, resolveBetterPlanConfig(config));
}
//#endregion
export { Config, apply, createBetterPlan, inject, name };
