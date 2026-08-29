window.__ModuleLoader__.load({
	id: "@huanlin/dsh-plugin-better-plan",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/icons.tsx
		/**
		* Inline SVG icon for the Plan tab (client bundles must not value-import
		* other plugins' internals, and a one-glyph icon does not justify a
		* react-icons dependency).
		*
		* @module @huanlin/dsh-plugin-better-plan/client/icons
		*/
		/**
		* The Plan tab glyph: a checklist document.
		* @param props - size in pixels.
		* @returns the icon element.
		*/
		function IconPlanOutline16(props) {
			return (0, react.createElement)("svg", {
				width: props.size,
				height: props.size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.3,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true
			}, (0, react.createElement)("path", { d: "M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5l-3.5-3.5Z" }), (0, react.createElement)("path", { d: "M9.5 1.5V5H13" }), (0, react.createElement)("path", { d: "M5.5 8.5 6.5 9.5 8.5 7" }), (0, react.createElement)("path", { d: "M5.5 11.5h5" }));
		}
		//#endregion
		//#region src/client/markdown-props.ts
		/** Build the dual-shape chrome labels from a flat copy-button pair. */
		function markdownChromeLabels(labels) {
			return {
				copyLabel: labels.copyLabel,
				copiedLabel: labels.copiedLabel,
				code: {
					copyLabel: labels.copyLabel,
					copiedLabel: labels.copiedLabel
				},
				footnotes: ""
			};
		}
		/**
		* MarkdownText props carrying the labels under BOTH prop names. The cast is
		* load-bearing: this plugin builds against one generation's declaration where
		* the other prop does not exist.
		* @param text - the markdown source.
		* @param labels - the flat copy-button pair.
		* @returns props spreadable onto `MarkdownText`.
		*/
		function markdownTextProps(text, labels) {
			const chrome = markdownChromeLabels(labels);
			return {
				text,
				codeLabels: chrome,
				labels: chrome
			};
		}
		//#endregion
		//#region src/client/PlanView.tsx
		/**
		* The Plan tab view: a status header (title, path, actions) over the plan
		* rendered through DSH's shared `MarkdownText`.
		*
		* The file content comes from better-sidebar's `/sidebar/api/fs.read` route
		* (same-origin, browser-authenticated) — the plan file lives in the session
		* workspace, and the host half has no route of its own for reading it. The
		* path is `tab.meta.path` (persisted with the tab, so a refresh restores the
		* view) falling back to `tab.path`.
		*
		* @module @huanlin/dsh-plugin-better-plan/client/PlanView
		*/
		/**
		* Extract the plan path from a tab (meta first, then the seed path).
		* @param tab - the sidebar tab instance.
		* @returns the plan file path, or undefined when the tab carries none.
		*/
		function planPathOf(tab) {
			const meta = tab.meta;
			if (meta !== null && typeof meta === "object" && typeof meta.path === "string" && meta.path !== "") return meta.path;
			return typeof tab.path === "string" && tab.path !== "" ? tab.path : void 0;
		}
		/** Read the sidebar fs API for one session-scoped path. */
		async function fsRead(sessionId, path, signal) {
			const response = await fetch("/sidebar/api/fs.read", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sessionId,
					path
				}),
				signal
			});
			const parsed = await response.json().catch(() => null);
			if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === void 0) throw new Error(parsed?.error?.message ?? `HTTP ${response.status}`);
			const value = parsed.value;
			if (value.kind === "binary") throw new Error("the plan file is binary; review it in the editor instead");
			if (typeof value.content !== "string") throw new Error("unexpected fs.read response");
			return {
				content: value.content,
				truncated: value.truncated === true
			};
		}
		/** Shared style tokens (alias tokens with plain fallbacks, no hardcoded theme). */
		const styles = {
			root: {
				display: "flex",
				flexDirection: "column",
				height: "100%",
				minHeight: 0,
				overflow: "hidden"
			},
			header: {
				display: "flex",
				flexDirection: "column",
				gap: 4,
				padding: "10px 14px",
				borderBottom: "1px solid var(--ds-border, rgba(127,127,127,0.25))",
				background: "var(--dsw-alias-bg-layer-1, transparent)"
			},
			titleRow: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				minWidth: 0
			},
			title: {
				fontSize: 13,
				fontWeight: 600,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			actions: {
				display: "flex",
				gap: 6,
				marginLeft: "auto",
				flexShrink: 0
			},
			button: {
				fontSize: 11,
				padding: "3px 8px",
				borderRadius: 6,
				cursor: "pointer",
				border: "1px solid var(--ds-border, rgba(127,127,127,0.35))",
				background: "transparent",
				color: "inherit"
			},
			path: {
				fontSize: 11,
				fontFamily: "var(--ds-font-mono, ui-monospace, monospace)",
				color: "var(--ds-text-muted, var(--ds-text-3, #888))",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			body: {
				flex: 1,
				minHeight: 0,
				overflow: "auto",
				padding: "14px 16px",
				fontSize: 13,
				lineHeight: 1.65
			},
			notice: {
				padding: "14px 16px",
				fontSize: 12,
				lineHeight: 1.6
			}
		};
		/**
		* The Plan tab component (better-sidebar TabDescriptor.component).
		* @param props - the tab component props (ctx/store/scope/tab/visible).
		* @returns the rendered view.
		*/
		function PlanView(props) {
			const { ctx, scope, tab } = props;
			const path = planPathOf(tab);
			const [load, setLoad] = (0, react.useState)({ status: "loading" });
			const [attempt, setAttempt] = (0, react.useState)(0);
			const [copied, setCopied] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (path === void 0) {
					setLoad({
						status: "error",
						message: "this plan tab carries no file path"
					});
					return;
				}
				const controller = new AbortController();
				setLoad({ status: "loading" });
				fsRead(scope.sessionId, path, controller.signal).then((result) => {
					setLoad({
						status: "ok",
						...result
					});
				}).catch((cause) => {
					if (controller.signal.aborted) return;
					setLoad({
						status: "error",
						message: cause instanceof Error ? cause.message : String(cause)
					});
				});
				return () => {
					controller.abort();
				};
			}, [
				path,
				scope.sessionId,
				attempt
			]);
			const betterSidebar = ctx.get("betterSidebar");
			const canOpenInEditor = path !== void 0 && Array.isArray(betterSidebar?.features) === true && betterSidebar.features.includes("openFile") === true;
			const copyPath = (0, react.useCallback)(() => {
				if (path === void 0) return;
				(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(path);
				setCopied(true);
				window.setTimeout(() => {
					setCopied(false);
				}, 1500);
			}, [path]);
			return (0, react.createElement)("div", { style: styles.root }, (0, react.createElement)("div", { style: styles.header }, (0, react.createElement)("div", { style: styles.titleRow }, (0, react.createElement)("span", {
				style: styles.title,
				title: path ?? void 0
			}, tab.title), (0, react.createElement)("span", { style: styles.actions }, canOpenInEditor && betterSidebar !== void 0 && path !== void 0 ? (0, react.createElement)("button", {
				style: styles.button,
				onClick: () => {
					betterSidebar.openFile(scope, path);
				}
			}, "Open in editor") : null, path !== void 0 ? (0, react.createElement)("button", {
				style: styles.button,
				onClick: copyPath
			}, copied ? "Copied" : "Copy path") : null)), path !== void 0 ? (0, react.createElement)("div", { style: styles.path }, path) : null), load.status === "loading" ? (0, react.createElement)("div", { style: styles.notice }, "Loading plan…") : load.status === "error" ? (0, react.createElement)("div", { style: styles.notice }, (0, react.createElement)("div", null, `Failed to read the plan: ${load.message}`), path !== void 0 ? (0, react.createElement)("button", {
				style: {
					...styles.button,
					marginTop: 8
				},
				onClick: () => {
					setAttempt(attempt + 1);
				}
			}, "Retry") : null) : (0, react.createElement)("div", { style: styles.body }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, { ...markdownTextProps(load.content, {
				copyLabel: "Copy",
				copiedLabel: "Copied"
			}) }), load.truncated ? (0, react.createElement)("div", { style: {
				...styles.notice,
				paddingLeft: 0,
				paddingRight: 0
			} }, "The file was truncated by the sidebar read limit; open it in the editor for the rest.") : null));
		}
		//#endregion
		//#region src/client/index.tsx
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
		/** The Plan tab type id (also the minted tab id — single instance). */
		const TAB_ID = "better-plan:plan";
		/** The delivery WebSocket path (mirror of the host half's route). */
		const DELIVERY_WS_PATH = "/better-plan/ws/delivery";
		/** Reconnect attempts before the loop stops (mirrors the sidebar's socket loops). */
		const FAILURE_LIMIT = 5;
		/**
		* Apply one delivery push to the sidebar: open (or focus) the Plan tab, then
		* overwrite its content via updateTab and focus it (both v0.12.0+; on an
		* older host the plain openTab dedupe-focus still lands the FIRST delivery).
		* @param service - the better-sidebar service.
		* @param payload - the parsed WS frame.
		* @param sessionId - the session the socket is subscribed to.
		*/
		function applyDeliveryPush(service, payload, sessionId) {
			if (payload === null || typeof payload !== "object") return;
			const record = payload;
			if (typeof record.path !== "string" || record.path === "") return;
			const title = typeof record.title === "string" && record.title !== "" ? record.title : void 0;
			const meta = {
				path: record.path,
				deliveredAt: Date.now()
			};
			const scope = { sessionId };
			service.openTab({
				type: TAB_ID,
				id: TAB_ID,
				path: record.path,
				title,
				meta
			}, scope);
			const features = service.features;
			if (Array.isArray(features) === true && features.includes("updateTab") === true) {
				service.updateTab(TAB_ID, {
					...title !== void 0 ? { title } : {},
					path: record.path,
					meta
				});
				service.activateTab(TAB_ID, scope);
			}
		}
		/** The betterSidebar service this half resolves through the context proxy. */
		const inject = ["betterSidebar"];
		/**
		* Client plugin body.
		* @param ctx - the client cordis context.
		*/
		function apply(ctx) {
			const betterSidebar = ctx.betterSidebar;
			if (betterSidebar === void 0) return;
			ctx.effect(() => betterSidebar.registerTab({
				id: TAB_ID,
				title: () => "Plan",
				icon: (size) => (0, react.createElement)(IconPlanOutline16, { size }),
				order: 15,
				single: true,
				component: (props) => (0, react.createElement)(PlanView, props)
			}), "dsh-plugin-better-plan: plan tab");
			ctx.effect(() => {
				let socket = null;
				let retry;
				let disposed = false;
				let failures = 0;
				let current;
				const clearRetry = () => {
					if (retry !== void 0) {
						window.clearTimeout(retry);
						retry = void 0;
					}
				};
				const connect = (sessionId) => {
					if (disposed) return;
					clearRetry();
					socket?.close();
					const url = new URL(DELIVERY_WS_PATH, window.location.origin);
					url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
					url.search = new URLSearchParams({ session: sessionId }).toString();
					socket = new WebSocket(url.toString());
					socket.onmessage = (event) => {
						if (typeof event.data !== "string") return;
						try {
							applyDeliveryPush(betterSidebar, JSON.parse(event.data), sessionId);
						} catch {}
					};
					socket.onclose = () => {
						if (disposed || current === void 0) return;
						failures += 1;
						if (failures >= FAILURE_LIMIT) {
							console.error("[dsh-plugin-better-plan] delivery socket failed; stopping reconnect loop", current);
							return;
						}
						retry = window.setTimeout(() => {
							if (current !== void 0) connect(current);
						}, 2e3);
					};
					socket.onerror = () => {
						socket?.close();
					};
				};
				const sync = () => {
					const sessionId = betterSidebar.getSnapshot().sessionId;
					if (sessionId === current) return;
					current = sessionId;
					failures = 0;
					if (sessionId === void 0) {
						clearRetry();
						socket?.close();
						socket = null;
						return;
					}
					connect(sessionId);
				};
				sync();
				const unsubscribe = betterSidebar.subscribeState(sync);
				return () => {
					disposed = true;
					unsubscribe();
					clearRetry();
					socket?.close();
				};
			}, "dsh-plugin-better-plan: delivery socket");
		}
		//#endregion
		exports.DELIVERY_WS_PATH = DELIVERY_WS_PATH;
		exports.TAB_ID = TAB_ID;
		exports.apply = apply;
		exports.applyDeliveryPush = applyDeliveryPush;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map