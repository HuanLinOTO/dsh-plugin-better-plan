import { EXIT_PLAN_MODE, foldPlanMode } from "@deepseek-ai/dsh-plan-mode";
import z from "schemastery";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
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
	maxPlanBytes: z.number().step(1).min(1).default(262144),
	locale: z.union([
		"auto",
		"zh",
		"en"
	]).default("auto")
});
/** Known config keys (for strict unknown-key rejection). */
const CONFIG_KEYS = /* @__PURE__ */ new Set([
	"planDir",
	"maxPlanBytes",
	"locale"
]);
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
		for (const key of Object.keys(input)) if (!CONFIG_KEYS.has(key)) throw new Error(`better-plan: unknown config key "${key}" — config is { planDir, maxPlanBytes, locale }`);
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
//#region src/locale.ts
/**
* Normalize one client-reported locale tag (BCP 47-style, e.g. `zh-CN`)
* to a shipped {@link PlanLocale}, or undefined when unsupported.
* @param value - the raw reported value (query param / body field).
* @returns `'zh'` / `'en'`, or undefined when the value is not a supported tag.
*/
function normalizeReportedLocale(value) {
	if (typeof value !== "string") return void 0;
	const tag = value.trim().toLowerCase();
	if (tag === "" || tag.length > 12 || !/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i.test(tag)) return void 0;
	if (tag === "zh" || tag.startsWith("zh-")) return "zh";
	if (tag === "en" || tag.startsWith("en-")) return "en";
}
/**
* Per-session directory of sidebar-reported locales. The browser view is the
* authority on the user's language (the DSH locale preference is Host-backed
* and already reflected in the client's active locale), so the host learns
* the locale from the client instead of reading settings itself.
*/
var LocaleDirectory = class {
	reported = /* @__PURE__ */ new Map();
	/**
	* Record one view-reported locale for a session (invalid values ignored).
	* @param sessionId - the session the view is subscribed to.
	* @param value - the raw reported locale tag.
	*/
	report(sessionId, value) {
		const locale = normalizeReportedLocale(value);
		if (locale === void 0 || sessionId === "") return;
		this.reported.set(sessionId, locale);
	}
	/**
	* The locale a session's connected view reported, if any.
	* @param sessionId - the session to look up.
	*/
	known(sessionId) {
		if (sessionId === void 0) return void 0;
		return this.reported.get(sessionId);
	}
	/** Drop every report (plugin disposal). */
	dispose() {
		this.reported.clear();
	}
};
/**
* Resolve the locale for one session's user-facing copy.
* @param setting - the plugin config's locale knob.
* @param directory - the sidebar-reported locale directory.
* @param sessionId - the session the copy is generated for.
* @returns the resolved locale (English when nothing better is known).
*/
function resolvePlanLocale(setting, directory, sessionId) {
	if (setting !== "auto") return setting;
	return directory.known(sessionId) ?? "en";
}
/**
* The localized render content for a delivered plan (the pending and approved
* branches of the shadow tool's render). English returns undefined — the
* caller preserves the render's own baseline content.
* @param path - the delivered plan file path (for the approved note).
* @param value - the canonical exit value.
* @param locale - the resolved session locale.
* @returns the localized content blocks, or undefined to keep the baseline.
*/
function localizedRenderContent(path, value, locale) {
	if (locale !== "zh") return void 0;
	if (value.decision === "pending") return [{
		type: "text",
		text: "计划已呈现在侧边栏的「计划」面板，等待用户审阅。请立即结束回合：简单说明计划已在侧边栏等待审阅，然后停止——不要再调用任何工具。用户的决定会作为下一条消息送达：批准将关闭计划模式，你可以从下一步开始执行计划；「继续规划」的反馈会要求你修改计划文件后重新提交。"
	}];
	if (value.decision === "approved") return [{
		type: "text",
		text: `计划已批准——计划模式已退出；从下一步开始执行计划。（当前未连接侧边栏计划面板；计划文件位于 ${path}。）`
	}];
}
/**
* The steer message fired when the sidebar approval lands.
* @param locale - the resolved session locale.
* @returns the steer text.
*/
function approvalSteerText(locale) {
	if (locale === "zh") return "[计划审批] 用户已在侧边栏计划面板批准该计划。计划模式现已关闭——从这一步开始执行计划。";
	return "[Plan review] The user approved the plan in the sidebar plan panel. Plan mode is now off — carry out the plan starting with this step.";
}
/**
* The steer message fired when the sidebar approval delegates execution to a
* new conversation: the planning session is closed out (plan mode off) and
* must NOT execute the plan itself.
* @param locale - the resolved session locale.
* @returns the steer text.
*/
function delegatedSteerText(locale) {
	if (locale === "zh") return "[计划审批] 用户已批准该计划，并选择在一个新对话中执行它。本会话的规划任务已完成——不要在此会话中执行该计划；简短确认收到后结束回合即可。";
	return "[Plan review] The user approved the plan and chose to carry it out in a NEW conversation. Planning is complete in this one — do not execute the plan here; acknowledge briefly and end your turn.";
}
/**
* The steer message fired when the sidebar keeps planning.
* @param feedback - the user's optional feedback (already trimmed).
* @param locale - the resolved session locale.
* @returns the steer text.
*/
function keepPlanningSteerText(feedback, locale) {
	if (locale === "zh") return "[计划审批] 用户在侧边栏计划面板审阅计划后选择继续规划。" + (feedback === void 0 ? "" : ` 用户的反馈：${feedback}。`) + " 请保持计划模式：修改计划文件后重新调用 exit_plan_mode 提交。";
	return "[Plan review] The user chose to keep planning after reviewing the plan in the sidebar plan panel." + (feedback === void 0 ? "" : ` Their feedback: ${feedback}.`) + " Stay in plan mode: revise the plan file and present it again with exit_plan_mode.";
}
/**
* The no-sidebar plan-review question's copy (the popup fallback surface).
* @param locale - the resolved session locale.
* @returns the question copy; labels pair with the ask intent so the
*   plan-review takeover matches the approve option by label.
*/
function planReviewCopy(locale) {
	if (locale === "zh") return {
		header: "计划审批",
		question: "批准该计划并退出计划模式？",
		approveLabel: "批准",
		approveDescription: "退出计划模式；计划将从下一步开始执行。",
		keepLabel: "继续规划",
		keepDescription: "保持计划模式；反馈将回传给模型。"
	};
	return {
		header: "Plan review",
		question: "Approve this plan and leave plan mode?",
		approveLabel: "Approve",
		approveDescription: "Leave plan mode; the plan is carried out from the next step.",
		keepLabel: "Keep planning",
		keepDescription: "Stay in plan mode; feedback goes back to the model."
	};
}
//#endregion
//#region src/review-gate.ts
/**
* Per-session pending decision plus the attached view set. One pending
* review per session; a newer delivery supersedes the previous one (its
* handlers never fire — the newest plan is the one under review).
*/
var PlanReviewGate = class {
	pending = /* @__PURE__ */ new Map();
	/** Latest known state per session — attach replay + stale-window reads. */
	latest = /* @__PURE__ */ new Map();
	subscribers = /* @__PURE__ */ new Map();
	/**
	* Record one pending review and broadcast it.
	* @param sessionId - the session whose plan is under review.
	* @param review - the delivery identity (id from the delivery push).
	* @param handlers - the decision side effects (steer back to the model).
	*/
	begin(sessionId, review, handlers) {
		const existing = this.pending.get(sessionId);
		if (existing !== void 0) {
			this.pending.delete(sessionId);
			this.settle(sessionId, {
				...existing.review,
				status: "cancelled"
			});
		}
		const waiter = {
			review: {
				...review,
				status: "pending"
			},
			handlers
		};
		this.pending.set(sessionId, waiter);
		this.settle(sessionId, waiter.review);
	}
	/**
	* Settle the session's pending review from the sidebar decision.
	* @param sessionId - the session under review.
	* @param decision - the user's choice (approve_new_session settles as
	*   `delegated`: execution continues in a new conversation).
	* @param feedback - optional keep-planning feedback (trimmed; forwarded to
	*   the model verbatim in the steer message).
	* @returns the settled review state, or undefined when nothing is pending.
	*/
	decide(sessionId, decision, feedback) {
		const waiter = this.pending.get(sessionId);
		if (waiter === void 0) return void 0;
		this.pending.delete(sessionId);
		const settled = this.settle(sessionId, {
			...waiter.review,
			status: decision === "approve" ? "approved" : decision === "keep" ? "kept" : "delegated"
		});
		if (decision === "approve") waiter.handlers.onApprove();
		else if (decision === "keep") waiter.handlers.onKeep(feedback?.trim() || void 0);
		else waiter.handlers.onDelegate();
		return settled;
	}
	/**
	* Read the session's pending review (stale-click guard + GET bootstrap).
	* @param sessionId - the session to inspect.
	* @returns the pending review, or null when nothing is parked.
	*/
	peek(sessionId) {
		return this.pending.get(sessionId)?.review ?? null;
	}
	/**
	* Attach one sidebar view; the latest known review state replays
	* immediately (a `null` frame clears a stale bar), and later changes push.
	* @param sessionId - the session the view displays.
	* @param send - the review-frame sender.
	* @returns the disposer detaching the view.
	*/
	attach(sessionId, send) {
		let views = this.subscribers.get(sessionId);
		if (views === void 0) {
			views = /* @__PURE__ */ new Set();
			this.subscribers.set(sessionId, views);
		}
		views.add(send);
		send({
			kind: "review",
			review: this.latest.get(sessionId) ?? null
		});
		return () => {
			const current = this.subscribers.get(sessionId);
			current?.delete(send);
			if (current !== void 0 && current.size === 0) this.subscribers.delete(sessionId);
		};
	}
	/**
	* Settle every pending review as cancelled and drop the views (plugin
	* teardown). Handlers do not fire: a reload discards the decision surface,
	* and the user re-drives the session.
	*/
	dispose() {
		for (const [sessionId, waiter] of this.pending) {
			this.pending.delete(sessionId);
			this.settle(sessionId, {
				...waiter.review,
				status: "cancelled"
			});
		}
		this.subscribers.clear();
	}
	/**
	* Record one state as latest and broadcast it to the session's views.
	* @returns the recorded state.
	*/
	settle(sessionId, review) {
		this.latest.set(sessionId, review);
		for (const send of this.subscribers.get(sessionId) ?? []) send({
			kind: "review",
			review
		});
		return review;
	}
};
//#endregion
//#region src/prompt-override.ts
/**
* The shipped preset's delivery sentence, verbatim across the standard, ptc,
* and cordis presets. Doubles as the plan-mode-active gate for the listener.
*/
const PLAN_DELIVERY_ANCHOR = "When ready, call exit_plan_mode with the complete plan markdown, starting with a # title.";
/**
* The shipped sentence right after the delivery anchor, verbatim across the
* standard, ptc, and cordis presets. With the file-first contract the write
* tool call necessarily precedes exit_plan_mode in the delivery turn, so this
* "only and final tool call" sentence reads as forbidding exactly that call —
* the observed write-then-stop failure — and must be rewritten too.
*/
const FINAL_CALL_ANCHOR = "Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval.";
const WRITE_BAN_ANCHOR = "Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan.";
const OVERRIDE_CLAIM_ANCHOR = "those tools remain listed to keep the tool catalog unchanged.";
/**
* Rewrite the shipped plan-mode guidance to the file-first delivery contract.
* Each replacement is independent: a sentence whose anchor is absent (an
* older or customized preset variant) is left as-is, and already-rewritten
* text passes through unchanged, so the function is idempotent.
* @param text - one assembled prompt section's text.
* @param planDir - the plugin config's suggested plan directory.
* @returns the corrected text, or the input untouched when no anchor matches.
*/
function rewritePlanPolicySection(text, planDir) {
	let result = text;
	const writeException = ` The one required exception is the delivery file: before calling exit_plan_mode, write the complete plan as markdown to a single file (for example ${`\`${planDir}/YYYY-MM-DD-<topic>.md\``}) with the write tool; this delivery write is allowed in plan mode, and the delivery itself is the exit_plan_mode call that must follow the write in the same turn.`;
	if (result.includes(WRITE_BAN_ANCHOR) && !result.includes(writeException)) result = result.replace(WRITE_BAN_ANCHOR, WRITE_BAN_ANCHOR + writeException);
	const overrideException = " The exit_plan_mode file-first contract is the single exception to that override.";
	if (result.includes(OVERRIDE_CLAIM_ANCHOR) && !result.includes(overrideException)) result = result.replace(OVERRIDE_CLAIM_ANCHOR, OVERRIDE_CLAIM_ANCHOR + overrideException);
	const deliveryReplacement = `Deliver the plan in the same turn you finish it: first write the COMPLETE plan as markdown to \`${planDir}/YYYY-MM-DD-<topic>.md\` (YYYY-MM-DD is today's date, <topic> a short kebab-case slug of the plan subject, e.g. \`${planDir}/2026-08-09-dsh-pet-rust-impl-spec.md\`), then call exit_plan_mode with that path — the tool takes only the path, the complete plan markdown must already be in the file starting with a # title, and the plan text is never pasted into the tool call. Writing the plan file is preparation, not delivery: a turn that ends with the file written but exit_plan_mode not called has presented nothing.`;
	if (result.includes("When ready, call exit_plan_mode with the complete plan markdown, starting with a # title.")) result = result.replace(PLAN_DELIVERY_ANCHOR, deliveryReplacement);
	const finalCallReplacement = "exit_plan_mode is the final tool call of the delivery turn, made immediately after the plan write — the write preceding it does not disqualify the call; nothing may follow it, and implementation begins only in a later step after approval.";
	if (result.includes("Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval.")) result = result.replace(FINAL_CALL_ANCHOR, finalCallReplacement);
	return result;
}
/**
* Register the assemble waterfall listener on one agent's scoped context.
* The agent is the loop's assemble dispatch key, so a listener tagged with
* that exact scope is admitted for every prompt this agent assembles.
* Sections without the plan-mode anchor pass through untouched, so non-plan
* requests pay one string scan per section.
* @param ctx - the agent's scoped context (`agent.ctx`); only event
*   registration is required, so the plain Cordis face suffices.
* @param planDir - the plugin config's suggested plan directory.
* @returns the listener disposer (for the caller's lifecycle effect).
*/
function registerPlanPolicyOverride(ctx, planDir) {
	return ctx.on("system-prompt/assemble", async (assembly, _context, next) => {
		const result = await next();
		for (const section of result.sections) if (section.text.includes("When ready, call exit_plan_mode with the complete plan markdown, starting with a # title.") || section.text.includes("Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval.")) section.text = rewritePlanPolicySection(section.text, planDir);
		return result;
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
//#region src/review-route.ts
/** The exact pathname the route registers on the host webServer. */
const REVIEW_API_PATH = "/better-plan/api/review";
/** Request-body cap: a decision is a handful of fields, not a plan. */
const REVIEW_BODY_LIMIT = 4096;
/** The decision values the route accepts (mirrors the gate's vocabulary). */
const DECISIONS = [
	"approve",
	"keep",
	"approve_new_session"
];
/**
* Parse and validate one review decision body (wire-boundary validation).
* @param raw - the request body text.
* @returns the parsed decision, or an error message.
*/
function parseReviewDecisionBody(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: "malformed JSON body" };
	}
	if (parsed === null || typeof parsed !== "object") return { error: "the body must be a JSON object" };
	const record = parsed;
	if (typeof record.session !== "string" || record.session === "") return { error: "session is required" };
	if (typeof record.decision !== "string" || !DECISIONS.includes(record.decision)) return { error: "decision must be \"approve\", \"keep\", or \"approve_new_session\"" };
	const decision = {
		session: record.session,
		decision: record.decision
	};
	if (typeof record.feedback === "string" && record.feedback !== "") decision.feedback = record.feedback;
	if (typeof record.id === "string" && record.id !== "") decision.id = record.id;
	if (typeof record.locale === "string" && record.locale !== "") decision.locale = record.locale;
	return { value: decision };
}
/**
* Serve one review request: GET bootstraps the plan panel's action bar with
* the current state (the WS attach replay remains the live channel); POST
* settles the pending decision. Both verbs record the submitting view's
* reported locale so the host's user-facing copy follows the browser.
*
* Error bodies carry a stable machine-readable `code` alongside the English
* `error` message: the plan panel maps known codes to localized copy and
* falls back to the raw message for unknown ones.
*
* @param gate - the review gate holding the pending review.
* @param req - the request (method/headers/body iterator).
* @param res - the response.
* @param trustedHosts - non-loopback authorities the deployment serves.
* @param directory - the locale directory view reports are recorded in.
*/
async function handleReviewRequest(gate, req, res, trustedHosts, directory) {
	const json = (status, code, error) => {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify({
			ok: false,
			code,
			error
		}));
	};
	if (req.method !== "POST" && req.method !== "GET") return json(405, "method_not_allowed", "GET or POST only");
	if (!isTrustedDeliveryRequest(req, trustedHosts)) return json(403, "untrusted_origin", "untrusted origin");
	if (req.method === "GET") {
		const url = new URL(req.url ?? "/", "http://dsh.internal");
		const sessionId = url.searchParams.get("session");
		if (sessionId === null || sessionId === "") return json(400, "session_required", "session is required");
		directory.report(sessionId, url.searchParams.get("locale"));
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({
			ok: true,
			review: gate.peek(sessionId)
		}));
		return;
	}
	let raw = "";
	let bytes = 0;
	for await (const chunk of req) {
		bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
		if (bytes > 4096) return json(413, "body_too_large", `review request body exceeds the ${REVIEW_BODY_LIMIT}-byte limit`);
		raw += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
	}
	const parsed = parseReviewDecisionBody(raw);
	if (parsed.error !== void 0) return json(400, "invalid_body", parsed.error);
	const body = parsed.value;
	directory.report(body.session, body.locale);
	const pending = gate.peek(body.session);
	if (pending === null) return json(409, "no_pending", "no plan review is pending for this session");
	if (body.id !== void 0 && body.id !== pending.id) return json(409, "stale_review", "the plan panel is stale; a newer plan delivery is under review");
	const review = gate.decide(body.session, body.decision, body.feedback);
	if (review === void 0) return json(409, "no_pending", "no plan review is pending for this session");
	res.writeHead(200, { "content-type": "application/json" });
	res.end(JSON.stringify({
		ok: true,
		review
	}));
}
/**
* Register the review decision route on the host webServer.
* @param register - the webServer's route registrar.
* @param gate - the review gate.
* @param trustedHosts - non-loopback authorities the deployment serves.
* @param directory - the locale directory view reports are recorded in.
* @returns the route disposer.
*/
function registerReviewRoute(register, gate, trustedHosts, directory) {
	return register({
		kind: "exact",
		path: REVIEW_API_PATH,
		handler: (req, res) => handleReviewRequest(gate, req, res, trustedHosts, directory)
	});
}
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
* file exists and is readable), then pass its path. When the push reaches a
* connected sidebar view, the tool RETURNS IMMEDIATELY with `decision:
* 'pending'` — the render instructs the model to end its turn, so the
* conversation simply stops with no approval popup — and the user reviews the
* plan and decides in the sidebar plan panel. The decision is steered back as
* the next turn's message (approval also flips plan mode off, see the review
* handlers below). When no view is attached, the built-in plan-review
* question renders in chat with the full plan text and blocks exactly like
* the original tool (no-sidebar environment ⇒ the original experience).
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
/**
* The model-facing description. The model's only new knowledge: the
* file-first contract, the immediate-return + end-turn contract, and the
* decision arriving as the next message. `planDir` is interpolated into the
* example path.
* @param config - the plugin config (planDir suggestion).
* @returns the description string.
*/
function exitPlanDescription(config) {
	return `Use only in plan mode. MANDATORY two-step delivery, both steps in the same turn: (1) write the COMPLETE plan as markdown to \`${config.planDir}/YYYY-MM-DD-<topic>.md\` — YYYY-MM-DD is today's date and <topic> a short kebab-case slug of the plan subject (e.g. \`${config.planDir}/2026-08-09-dsh-pet-rust-impl-spec.md\`); (2) immediately after the write succeeds, call this tool with that path. Writing the file alone delivers nothing — the call is the delivery; never end the turn with the plan file written but this tool not called. The plan opens in the sidebar plan panel and the call returns immediately — end your turn right after it and wait; the user reviews and decides there. Their decision arrives as the next message: approval switches plan mode off for you to carry out the plan; keep-planning feedback asks you to revise the file and present it again.`;
}
/**
* The review question's detail: the full plan text. Only the no-sidebar
* fallback reaches the question (a delivered plan is reviewed in the sidebar
* instead), so the user always sees the whole plan on the popup card.
* @param plan - the full plan markdown.
* @returns the detail string for the plan-review question.
*/
function reviewDetail(plan) {
	return plan;
}
/**
* The model-facing render — the ENGLISH baseline. The pending branch IS the
* end-of-turn contract: the conversation stops because the model stops here.
* A non-English session locale swaps this content at finalize time (see
* `finalizeContent` below); the baseline stays English so the durable result
* and every test anchor remain stable.
*/
function renderResult(args, value) {
	if (value.decision === "pending") return [{
		type: "text",
		text: "Plan presented to the user in the sidebar plan panel. End your turn now: briefly note that the plan is awaiting their review there, then stop — do not call any more tools. Their decision arrives as the next message: approval switches plan mode off for you to carry out the plan; keep-planning feedback asks you to revise the file and present it again."
	}];
	return [{
		type: "text",
		text: `Plan approved — plan mode exited; carry out the plan starting with your next step. (No sidebar plan panel is connected; the plan file is at ${args.path}.)`
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
					delivered: {
						type: "boolean",
						required: true,
						description: "Whether the plan was pushed to a connected sidebar plan panel at call time (false = queued for the next view attach, or no sidebar installed)."
					},
					decision: {
						type: "string",
						enum: ["pending", "approved"],
						required: true,
						description: "pending = the sidebar review is open; end the turn and wait. approved = the in-chat review answered approve."
					}
				}
			},
			render: renderResult
		},
		finalizeContent: (exec, result) => {
			const agent = exec.agent;
			if (agent === void 0 || result.isError) return void 0;
			const value = result.value;
			if (value === null || typeof value !== "object") return void 0;
			const locale = deps.localeOf(agent.session.id);
			if (locale === "en") return void 0;
			const args = exec.arguments;
			return localizedRenderContent(typeof args?.path === "string" ? args.path : "", value, locale);
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
				if (code === "ENOENT") throw new Error(`${EXIT_PLAN_MODE} could not read the plan file "${args.path}" (resolved to "${absolute}"): it does not exist. Write the COMPLETE plan as markdown to a file with the write tool first (e.g. \`${config.planDir}/YYYY-MM-DD-<topic>.md\`), then call exit_plan_mode with its path in the same turn.`);
				if (code === "EACCES" || code === "EPERM") throw new Error(`the plan file "${absolute}" is not readable`);
				throw new Error(`cannot read the plan file "${absolute}": ${error instanceof Error ? error.message : String(error)}`);
			}
			if (!info.isFile()) throw new Error(`"${absolute}" is not a file; pass the path of the markdown plan file`);
			if (info.size > config.maxPlanBytes) throw new Error(`the plan file is ${info.size} bytes, over the ${config.maxPlanBytes}-byte review limit; write a more concise plan (state decisions and changes, not full file contents) and present it again`);
			const plan = await readFile(absolute, "utf8");
			const title = firstHeading(plan) ?? basenameOf(absolute);
			const { id, delivered } = registry.enqueue(sessionId, absolute, title);
			/** Flip plan mode off for a settled review: between turns the append
			* lands immediately (the built-in controller does the same when the
			* fold is idle); a failed durable append retries through the
			* pendingExits boundary flush at the steered turn's first accepted
			* pre-step. Shared by both approval paths. */
			const exitPlanMode = () => {
				try {
					agent.session.append("plan/mode", { active: false });
				} catch (error) {
					ctx.logger.warn("dsh-plugin-better-plan: the approved plan exit could not be appended directly; deferring to the next boundary: %o", error);
					deps.onApproved(agent.session);
				}
			};
			/** Steer one decision outcome back as the next turn's user message. */
			const steerDecision = (text) => {
				agent.steer(createUserMessage({
					content: [{
						type: "text",
						text
					}],
					source: { kind: "user" }
				}));
			};
			if (delivered) {
				deps.reviewGate.begin(sessionId, {
					id,
					path: absolute,
					title
				}, {
					onApprove: () => {
						exitPlanMode();
						steerDecision(approvalSteerText(deps.localeOf(sessionId)));
					},
					onKeep: (feedback) => {
						steerDecision(keepPlanningSteerText(feedback, deps.localeOf(sessionId)));
					},
					onDelegate: () => {
						exitPlanMode();
						steerDecision(delegatedSteerText(deps.localeOf(sessionId)));
					}
				});
				return {
					delivered: true,
					decision: "pending"
				};
			}
			const interaction = ctx.get("userQuestions");
			if (interaction === void 0) throw new Error("no user-questions channel is available to review the plan; ask the user to switch the session mode instead");
			const copy = planReviewCopy(deps.localeOf(sessionId));
			const answer = await interaction.ask({
				questions: [{
					id: REVIEW_ID,
					header: copy.header,
					question: copy.question,
					detail: reviewDetail(plan),
					options: [{
						label: copy.approveLabel,
						description: copy.approveDescription
					}, {
						label: copy.keepLabel,
						description: copy.keepDescription
					}],
					intent: {
						kind: "plan-review",
						approve: copy.approveLabel
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
			if (item?.selected.length !== 1 || item.selected[0] !== copy.approveLabel || item.custom !== void 0) {
				const feedback = item?.custom ?? "";
				throw new Error(feedback === "" ? "The user chose to keep planning; revise the plan file and present it again." : `The user chose to keep planning; their feedback: ${feedback}`);
			}
			deps.onApproved(agent.session);
			return {
				delivered: false,
				decision: "approved"
			};
		},
		presentCall: (args) => ({
			card: "generic",
			title: basenameOf(args.path),
			kind: "other",
			content: [{
				type: "text",
				text: "Plan file delivered for review — the complete plan opens in the sidebar plan panel; the conversation waits for the user's decision there."
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
//#region src/ws-route.ts
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
/** The exact upgrade path registered on the host webServer. */
const DELIVERY_WS_PATH = "/better-plan/ws/delivery";
/**
* Wire one delivery socket to the registries: parse `?session=` (and the
* view-reported `?locale=`, recorded so the host's user-facing copy follows
* the browser's active DSH locale), attach the delivery queue (replaying
* queued pushes) and the review gate (replaying the latest review state),
* and detach on close/error so later pushes queue instead of accumulating
* on a dead socket.
* @param registry - the delivery registry.
* @param gate - the review gate.
* @param ws - the connected socket.
* @param req - the upgrade request.
* @param directory - the locale directory the reported locale is recorded in.
*/
function attachDeliverySocket(registry, gate, ws, req, directory) {
	const url = new URL(req.url ?? "/", "http://dsh.internal");
	const sessionId = url.searchParams.get("session");
	if (sessionId === null || sessionId === "") {
		ws.close(1008, "session is required");
		return;
	}
	directory.report(sessionId, url.searchParams.get("locale"));
	const send = (frame) => {
		ws.send(JSON.stringify(frame));
	};
	const detachDelivery = registry.attach(sessionId, (delivery) => send({
		kind: "deliver",
		...delivery
	}));
	const detachReview = gate.attach(sessionId, send);
	const detach = () => {
		detachDelivery();
		detachReview();
	};
	ws.on("close", detach);
	ws.on("error", detach);
}
/**
* Register the delivery upgrade route on the host webServer.
* @param registerUpgrade - the webServer's route registrar.
* @param registry - the delivery registry.
* @param gate - the review gate.
* @param trustedHosts - non-loopback authorities the deployment serves.
* @param directory - the locale directory view reports are recorded in.
* @returns the route disposer.
*/
function registerDeliveryRoute(registerUpgrade, registry, gate, trustedHosts, directory) {
	const wss = new WebSocketServer({ noServer: true });
	const dispose = registerUpgrade({
		path: DELIVERY_WS_PATH,
		handler: (req, socket, head) => {
			if (!isTrustedDeliveryRequest(req, trustedHosts)) {
				socket.destroy();
				return;
			}
			wss.handleUpgrade(req, socket, head, (ws) => {
				attachDeliverySocket(registry, gate, ws, req, directory);
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
* gates scoped registrations), the webserver (the delivery push route), and
* the system-prompt registry (the assemble waterfall this plugin rewrites
* plan-mode guidance through).
*/
const inject = [
	"tools",
	"webServer",
	"systemPrompt"
];
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
* @returns the created delivery registry and review gate (exposed for tests).
*/
function createBetterPlan(ctx, config) {
	const registry = new PlanDeliveryRegistry();
	const reviewGate = new PlanReviewGate();
	const locales = new LocaleDirectory();
	let disposed = false;
	const shadowed = /* @__PURE__ */ new WeakSet();
	ctx.on("agent/session-start", ({ agent }) => {
		if (shadowed.has(agent)) return;
		shadowed.add(agent);
		agent.ctx.effect(() => agent.ctx.tools.register(defineExitPlanTool({
			ctx,
			config,
			registry,
			reviewGate,
			localeOf: (sessionId) => resolvePlanLocale(config.locale, locales, sessionId),
			isDisposed: () => disposed,
			onApproved: (session) => {
				pendingExits.add(session);
			}
		})), "dsh-plugin-better-plan: shadow exit_plan_mode");
		agent.ctx.effect(() => registerPlanPolicyOverride(agent.ctx, config.planDir), "dsh-plugin-better-plan: plan policy prompt override");
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
	ctx.effect(() => registerDeliveryRoute((route) => ctx.webServer.registerUpgrade(route), registry, reviewGate, ctx.get("webRuntime")?.trustedHosts ?? [], locales), "dsh-plugin-better-plan: delivery WebSocket");
	ctx.effect(() => registerReviewRoute((route) => ctx.webServer.register(route), reviewGate, ctx.get("webRuntime")?.trustedHosts ?? [], locales), "dsh-plugin-better-plan: review API route");
	registerPlanPolicyOverride(ctx, config.planDir);
	ctx.effect(() => () => {
		disposed = true;
		registry.dispose();
		reviewGate.dispose();
		locales.dispose();
	}, "dsh-plugin-better-plan: service lifetime");
	return {
		registry,
		reviewGate,
		locales
	};
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
