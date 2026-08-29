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
		//#region src/client/locales.ts
		/**
		* Client-half copy for the Plan tab, following the DSH i18n system: the
		* dictionaries register into the shared locale registry (namespace
		* `betterPlan`), and `t()` resolves the active locale from the attached
		* `ctx.locale` service (`@deepseek-ai/dsh-client-locale`) — the Host-backed
		* `locale.preference` wins over the raw browser language and switches live.
		* Absent the service (locale plugin not mounted), the browser language is
		* the fallback.
		*
		* The module-level attach mirrors better-sidebar's own locales.ts: the Plan
		* tab renders inside the sidebar's React tree, so the component reads copy
		* through `t()` at render time; the sidebar re-renders tab content on locale
		* switches (its tab-content memo keys on the locale revision), so no extra
		* subscription is needed here.
		*
		* @module @huanlin/dsh-plugin-better-plan/client/locales
		*/
		/** The zh dictionary (source of truth for the key set). */
		const zhDict = {
			tabTitle: "计划",
			openInEditor: "在编辑器中打开",
			copyPath: "复制路径",
			copied: "已复制",
			copy: "复制",
			copiedLabel: "已复制",
			reviewHint: "在此审阅计划——聊天中不会弹出审批卡。点「批准」在本对话执行，点「新开对话执行」移到全新对话执行，或附反馈选择「继续规划」。",
			feedbackPlaceholder: "「继续规划」时可附反馈（可选）…",
			approve: "批准",
			keepPlanning: "继续规划",
			approveNewSession: "新开对话执行",
			delegatingStatus: "计划已批准——正在新建执行对话…",
			delegatedStatus: "计划已批准——执行已移交到新对话。",
			errDelegateFailed: "新开执行对话失败",
			approvedStatus: "计划已批准——模型正在执行该计划。",
			keptStatus: "反馈已发送——模型正在修改计划。",
			loading: "正在读取计划…",
			readFailed: "读取计划失败",
			retry: "重试",
			truncated: "文件因侧边栏读取上限被截断；其余内容请在编辑器中查看。",
			noPath: "该计划标签页未携带文件路径",
			binaryFile: "计划文件是二进制文件；请在编辑器中查看",
			unexpectedRead: "fs.read 响应格式异常",
			errStale: "当前面板已过期——有更新的计划正在审批。",
			errNoPending: "当前没有等待审批的计划。",
			errSubmitFailed: "提交决定失败"
		};
		/** The en dictionary (key-set-equal to zh, enforced by the type annotation). */
		const enDict = {
			tabTitle: "Plan",
			openInEditor: "Open in editor",
			copyPath: "Copy path",
			copied: "Copied",
			copy: "Copy",
			copiedLabel: "Copied",
			reviewHint: "Review this plan here — the chat shows no approval popup. Approve to execute in this conversation, execute in a new chat, or keep planning with feedback.",
			feedbackPlaceholder: "Optional feedback for \"Keep planning\"…",
			approve: "Approve",
			keepPlanning: "Keep planning",
			approveNewSession: "Execute in new chat",
			delegatingStatus: "Plan approved — starting the execution conversation…",
			delegatedStatus: "Plan approved — execution continues in a new conversation.",
			errDelegateFailed: "Failed to start the execution conversation",
			approvedStatus: "Plan approved — the model is carrying out the plan.",
			keptStatus: "Feedback sent — the model is revising the plan.",
			loading: "Loading plan…",
			readFailed: "Failed to read the plan",
			retry: "Retry",
			truncated: "The file was truncated by the sidebar read limit; open it in the editor for the rest.",
			noPath: "this plan tab carries no file path",
			binaryFile: "the plan file is binary; review it in the editor instead",
			unexpectedRead: "unexpected fs.read response",
			errStale: "This panel is stale — a newer plan delivery is under review.",
			errNoPending: "No plan is awaiting review.",
			errSubmitFailed: "Submitting the decision failed"
		};
		const DICTS = {
			zh: zhDict,
			en: enDict
		};
		/** The locale namespace this plugin owns in the DSH locale registry. */
		const LOCALE_NS = "betterPlan";
		/** The DSH locale service attached by the client apply (absent → browser detection). */
		let localeService;
		/**
		* Attach (or detach, with undefined) the DSH locale service.
		* @param service - the client context's locale service.
		*/
		function attachLocale(service) {
			localeService = service;
		}
		/**
		* The active copy locale: the DSH locale service's snapshot when attached
		* (zh → zh, anything else → en), else the browser language.
		* @returns `'zh'` or `'en'`.
		*/
		function activeLocale() {
			const active = localeService?.getSnapshot().active;
			if (active !== void 0) return active === "zh" ? "zh" : "en";
			return (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase().startsWith("zh") ? "zh" : "en";
		}
		/**
		* Translate one copy key in the active locale.
		* @param key - the copy key.
		* @returns the localized string.
		*/
		function t(key) {
			return DICTS[activeLocale()][key];
		}
		/**
		* The kickoff prompt the delegation flow queues into the NEW conversation:
		* the model there has no context, so the message anchors it on the approved
		* plan file (an absolute path) and orders execution. It is both
		* user-visible (a chat bubble) and model-directed, so it localizes with the
		* view like the steer copy does.
		* @param path - the absolute plan file path.
		* @returns the kickoff prompt text.
		*/
		function executionKickoffPrompt(path) {
			if (activeLocale() === "zh") return `[计划执行] 用户已在上一对话中制定并批准了以下计划文件：${path}。这是一个全新对话——请先读取该计划文件，然后严格按计划开始执行，无需重新规划或再次确认。`;
			return `[Plan execution] The user planned and approved the following plan file in a previous conversation: ${path}. This is a fresh conversation — read that plan file first, then carry it out exactly as written; no re-planning or re-confirmation needed.`;
		}
		/**
		* Localize one review-route error for the action bar: known error codes map
		* to copy; unknown codes fall back to the route's raw English message.
		* @param code - the route's stable error code, when present.
		* @param raw - the route's raw error message (or an HTTP fallback).
		* @returns the text the action bar shows.
		*/
		function submitErrorText(code, raw) {
			if (code === "stale_review") return t("errStale");
			if (code === "no_pending") return t("errNoPending");
			if (code === void 0 || code === "") return `${t("errSubmitFailed")}: ${raw}`;
			return `${t("errSubmitFailed")}: ${raw}`;
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
		//#region src/client/execution-launch.ts
		/**
		* The delegation flow's client half: after a review settles as
		* `delegated`, create the execution conversation through DSH's public
		* sessions service (`ctx.get('sessions')`), queue the kickoff prompt into
		* it, and navigate there.
		*
		* The faces below are STRUCTURAL (the minimal subset of
		* `@deepseek-ai/dsh-api-session-controller/client`'s `ISessions` /
		* `SessionFace` this flow calls) — the same pattern better-sidebar uses for
		* cross-plugin services: no value import crosses the client-bundle purity
		* gate and no new tsconfig path is needed; the runtime service arrives
		* through the context proxy. The planning session's list summary supplies
		* the new conversation's cwd, so the fresh agent runs on the same
		* workspace the plan was written for.
		*
		* @module @huanlin/dsh-plugin-better-plan/client/execution-launch
		*/
		/**
		* Launch the execution conversation for a delegated plan: create a blank
		* session in the planning session's workspace, queue the kickoff prompt
		* pointing at the approved plan file, then navigate to the new
		* conversation. Every failure rejects with an Error whose message the
		* plan panel shows (the plan path stays visible there, so the user can
		* always start a conversation and send the plan manually).
		* @param sessions - the sessions service (`ctx.get('sessions')`).
		* @param planPath - the approved plan file's absolute path.
		* @param sessionId - the planning session (its summary carries the cwd).
		*/
		async function launchExecutionConversation(sessions, planPath, sessionId) {
			const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd;
			const newId = await sessions.create(cwd === void 0 ? {} : { cwd });
			const binding = sessions.binding(newId);
			if (binding === void 0) throw new Error(`the new session "${newId}" is not locally addressable yet`);
			const admitted = await binding.session.prompt([{
				type: "text",
				text: executionKickoffPrompt(planPath)
			}], "queue");
			if (!admitted.ok) throw new Error(`the kickoff prompt was rejected: ${admitted.error?.code ?? "unknown"}: ${admitted.error?.message ?? ""}`);
			sessions.open(newId);
		}
		//#endregion
		//#region src/client/review-store.ts
		/**
		* The client-side review state: a tiny external store fed by the delivery
		* WebSocket's `{ kind: 'review', review }` frames and by the decision POST's
		* echoed response, consumed by the Plan tab's action bar through
		* `useSyncExternalStore`.
		*
		* The state mirrors the host gate's per-session review; a session switch
		* resets it (the reconnect's attach replay restores the current state).
		*
		* @module @huanlin/dsh-plugin-better-plan/client/review-store
		*/
		/** Whether an unknown wire value is a well-formed review state. */
		function isReviewState(value) {
			if (value === null || typeof value !== "object") return false;
			const record = value;
			return typeof record.id === "string" && record.id !== "" && typeof record.path === "string" && record.path !== "" && typeof record.title === "string" && (record.status === "pending" || record.status === "approved" || record.status === "delegated" || record.status === "kept" || record.status === "cancelled");
		}
		/** External store for the current session's review state. */
		var ReviewStore = class {
			state = null;
			listeners = /* @__PURE__ */ new Set();
			/** The current review state (null = nothing to review). */
			get = () => this.state;
			/** Replace the state and notify subscribers. */
			set = (next) => {
				this.state = next;
				for (const listener of this.listeners) listener();
			};
			/** Clear the state (session switch); attach replay restores it. */
			reset = () => {
				this.set(null);
			};
			/** @returns the unsubscribe disposer. */
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
		};
		/** The singleton store the WS handler writes and the Plan tab reads. */
		const reviewStore = new ReviewStore();
		/** The exact pathname of the host's review decision route. */
		const REVIEW_API_PATH = "/better-plan/api/review";
		/**
		* Bootstrap the review state over HTTP (the WS attach replay remains the
		* live channel): fills the bar when a review frame was missed (stale bundle,
		* reconnect gap). A live frame already in the store wins — the GET result is
		* only applied while the store is empty, so a late null response can never
		* clear a pending bar. The request reports the view's active locale so the
		* host's user-facing copy follows the browser.
		* @param sessionId - the session whose review state to read.
		*/
		async function fetchReviewState(sessionId) {
			try {
				const url = `${REVIEW_API_PATH}?session=${encodeURIComponent(sessionId)}&locale=${encodeURIComponent(activeLocale())}`;
				const response = await fetch(url);
				const parsed = await response.json().catch(() => null);
				if (!response.ok || parsed === null || parsed.ok !== true) return;
				if (reviewStore.get() !== null) return;
				if (parsed.review === null) reviewStore.set(null);
				else if (isReviewState(parsed.review)) reviewStore.set(parsed.review);
			} catch {}
		}
		/**
		* Post one review decision to the host route and, on success, echo the
		* settled state into the store (the submitting view updates immediately;
		* other views follow over the WebSocket). The body reports the view's active
		* locale; failures map the route's stable error codes to localized copy.
		* @param sessionId - the session whose plan is under review.
		* @param decision - the user's choice.
		* @param feedback - optional keep-planning feedback.
		* @param reviewId - the reviewed delivery's id (stale-click guard).
		* @returns the outcome; failures keep the pending bar up for a retry.
		*/
		async function submitReviewDecision(sessionId, decision, feedback, reviewId) {
			try {
				const response = await fetch(REVIEW_API_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						session: sessionId,
						decision,
						locale: activeLocale(),
						...decision === "keep" && feedback !== void 0 && feedback !== "" ? { feedback } : {},
						id: reviewId
					})
				});
				const parsed = await response.json().catch(() => null);
				if (!response.ok || parsed === null || parsed.ok !== true) {
					const raw = typeof parsed?.error === "string" ? parsed.error : `HTTP ${response.status}`;
					return {
						ok: false,
						error: submitErrorText(typeof parsed?.code === "string" ? parsed.code : void 0, raw)
					};
				}
				if (!isReviewState(parsed.review)) return {
					ok: false,
					error: t("errSubmitFailed")
				};
				reviewStore.set(parsed.review);
				return {
					ok: true,
					review: parsed.review
				};
			} catch (cause) {
				return {
					ok: false,
					error: cause instanceof Error ? cause.message : String(cause)
				};
			}
		}
		//#endregion
		//#region src/client/PlanView.tsx
		/**
		* The Plan tab view: a status header (title, path, actions), the review
		* action bar (the sidebar approval surface — the chat shows no popup), and
		* the plan rendered through DSH's shared `MarkdownText`.
		*
		* The file content comes from better-sidebar's `/sidebar/api/fs.read` route
		* (same-origin, browser-authenticated) — the plan file lives in the session
		* workspace, and the host half has no route of its own for reading it. The
		* path is `tab.meta.path` (persisted with the tab, so a refresh restores the
		* view) falling back to `tab.path`.
		*
		* The review state comes from the delivery WebSocket's review frames (via
		* the shared review store, restored by the attach replay after a refresh).
		* While a review is pending the bar offers Approve / Execute in new chat /
		* Keep planning; a decision POSTs to the host's review route and the echo
		* updates the store. The delegation choice then launches the execution
		* conversation through the sessions service (see execution-launch.ts) and
		* navigates there.
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
			if (value.kind === "binary") throw new Error(t("binaryFile"));
			if (typeof value.content !== "string") throw new Error(t("unexpectedRead"));
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
			primaryButton: {
				fontSize: 12,
				padding: "5px 12px",
				borderRadius: 6,
				cursor: "pointer",
				fontWeight: 600,
				border: "1px solid var(--ds-border-strong, var(--ds-border, rgba(127,127,127,0.5)))",
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
			reviewBar: {
				display: "flex",
				flexDirection: "column",
				gap: 8,
				padding: "10px 14px",
				borderBottom: "1px solid var(--ds-border, rgba(127,127,127,0.25))",
				background: "var(--dsw-alias-bg-layer-2, transparent)"
			},
			reviewText: {
				fontSize: 12,
				lineHeight: 1.55
			},
			reviewInput: {
				fontSize: 12,
				padding: "5px 8px",
				borderRadius: 6,
				border: "1px solid var(--ds-border, rgba(127,127,127,0.35))",
				background: "transparent",
				color: "inherit",
				width: "100%",
				boxSizing: "border-box"
			},
			reviewButtons: {
				display: "flex",
				gap: 8
			},
			reviewError: {
				fontSize: 11,
				color: "var(--ds-text-critical, #b3261e)"
			},
			reviewStatus: {
				padding: "8px 14px",
				fontSize: 12,
				lineHeight: 1.55,
				borderBottom: "1px solid var(--ds-border, rgba(127,127,127,0.25))"
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
		/** The one-line status a settled review renders (cancelled stays quiet). */
		function settledReviewText(status, delegating) {
			if (status === "approved") return t("approvedStatus");
			if (status === "delegated") return delegating ? t("delegatingStatus") : t("delegatedStatus");
			if (status === "kept") return t("keptStatus");
			return null;
		}
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
			const review = (0, react.useSyncExternalStore)(reviewStore.subscribe, reviewStore.get);
			const [feedback, setFeedback] = (0, react.useState)("");
			const [submitting, setSubmitting] = (0, react.useState)(false);
			const [submitError, setSubmitError] = (0, react.useState)(void 0);
			const [delegating, setDelegating] = (0, react.useState)(false);
			const [delegateError, setDelegateError] = (0, react.useState)(void 0);
			const sessions = ctx.get("sessions");
			const pendingReview = review !== null && review.status === "pending" && review.path === path ? review : null;
			const settledReview = review !== null && review.path === path && review.status !== "pending" ? settledReviewText(review.status, delegating) : null;
			(0, react.useEffect)(() => {
				setFeedback("");
				setSubmitError(void 0);
				setDelegateError(void 0);
			}, [review?.id]);
			(0, react.useEffect)(() => {
				fetchReviewState(scope.sessionId);
			}, [scope.sessionId]);
			(0, react.useEffect)(() => {
				if (path === void 0) {
					setLoad({
						status: "error",
						message: t("noPath")
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
			const decide = (0, react.useCallback)((decision) => {
				if (pendingReview === null) return;
				setSubmitting(true);
				setSubmitError(void 0);
				submitReviewDecision(scope.sessionId, decision, decision === "keep" ? feedback : void 0, pendingReview.id).then((outcome) => {
					if (outcome.ok === false) {
						setSubmitError(outcome.error);
						return;
					}
					if (decision !== "approve_new_session") return;
					if (sessions === void 0) return;
					setDelegating(true);
					launchExecutionConversation(sessions, pendingReview.path, scope.sessionId).catch((cause) => {
						setDelegateError(`${t("errDelegateFailed")}: ${cause instanceof Error ? cause.message : String(cause)}`);
					}).finally(() => {
						setDelegating(false);
					});
				}).finally(() => {
					setSubmitting(false);
				});
			}, [
				pendingReview,
				scope.sessionId,
				feedback,
				sessions
			]);
			return (0, react.createElement)("div", { style: styles.root }, (0, react.createElement)("div", { style: styles.header }, (0, react.createElement)("div", { style: styles.titleRow }, (0, react.createElement)("span", {
				style: styles.title,
				title: path ?? void 0
			}, tab.title), (0, react.createElement)("span", { style: styles.actions }, canOpenInEditor && betterSidebar !== void 0 && path !== void 0 ? (0, react.createElement)("button", {
				style: styles.button,
				onClick: () => {
					betterSidebar.openFile(scope, path);
				}
			}, t("openInEditor")) : null, path !== void 0 ? (0, react.createElement)("button", {
				style: styles.button,
				onClick: copyPath
			}, copied ? t("copied") : t("copyPath")) : null)), path !== void 0 ? (0, react.createElement)("div", { style: styles.path }, path) : null), pendingReview !== null ? (0, react.createElement)("div", { style: styles.reviewBar }, (0, react.createElement)("div", { style: styles.reviewText }, t("reviewHint")), (0, react.createElement)("input", {
				style: styles.reviewInput,
				value: feedback,
				placeholder: t("feedbackPlaceholder"),
				onChange: (event) => {
					setFeedback(event.target.value);
				}
			}), (0, react.createElement)("div", { style: styles.reviewButtons }, (0, react.createElement)("button", {
				style: styles.primaryButton,
				disabled: submitting,
				onClick: () => {
					decide("approve");
				}
			}, t("approve")), sessions !== void 0 ? (0, react.createElement)("button", {
				style: styles.primaryButton,
				disabled: submitting,
				onClick: () => {
					decide("approve_new_session");
				}
			}, t("approveNewSession")) : null, (0, react.createElement)("button", {
				style: styles.button,
				disabled: submitting,
				onClick: () => {
					decide("keep");
				}
			}, t("keepPlanning"))), submitError !== void 0 ? (0, react.createElement)("div", { style: styles.reviewError }, submitError) : null) : settledReview !== null ? (0, react.createElement)("div", { style: styles.reviewStatus }, settledReview, delegateError !== void 0 ? (0, react.createElement)("div", { style: styles.reviewError }, delegateError) : null) : null, load.status === "loading" ? (0, react.createElement)("div", { style: styles.notice }, t("loading")) : load.status === "error" ? (0, react.createElement)("div", { style: styles.notice }, (0, react.createElement)("div", null, `${t("readFailed")}: ${load.message}`), path !== void 0 ? (0, react.createElement)("button", {
				style: {
					...styles.button,
					marginTop: 8
				},
				onClick: () => {
					setAttempt(attempt + 1);
				}
			}, t("retry")) : null) : (0, react.createElement)("div", { style: styles.body }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, { ...markdownTextProps(load.content, {
				copyLabel: t("copy"),
				copiedLabel: t("copiedLabel")
			}) }), load.truncated ? (0, react.createElement)("div", { style: {
				...styles.notice,
				paddingLeft: 0,
				paddingRight: 0
			} }, t("truncated")) : null));
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Client half of @huanlin/dsh-plugin-better-plan: registers the sidebar's
		* "Plan" tab through better-sidebar's service and subscribes the per-session
		* delivery WebSocket that opens it and feeds its review action bar.
		*
		* The tab is `single: true` (one Plan tab per session, dedupe-focused on
		* repeat deliveries). Because the dedupe focus does NOT overwrite an already
		* open tab's path, every push is followed by `updateTab` (feature-gated,
		* v0.12.0+) so a re-delivered plan replaces the tab's content, then
		* `activateTab` focuses it. `meta` rides the tab into better-sidebar's
		* localStorage persistence, so a refresh restores the view and PlanView
		* re-reads the file from `tab.meta.path`. Review frames feed the shared
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
		/**
		* Route one WS frame: `deliver` opens/updates the Plan tab, `review` feeds
		* the review store (the Plan tab's action bar). Malformed frames are ignored
		* (the next push carries its own state).
		* @param service - the better-sidebar service.
		* @param store - the review store the review frames feed.
		* @param frame - the parsed WS frame.
		* @param sessionId - the session the socket is subscribed to.
		*/
		function applyDeliveryFrame(service, store, frame, sessionId) {
			if (frame === null || typeof frame !== "object") return;
			const kind = frame.kind;
			if (kind === "review") {
				const review = frame.review;
				if (review === null) store.set(null);
				else if (isReviewState(review)) store.set(review);
				return;
			}
			if (kind === "deliver") applyDeliveryPush(service, frame, sessionId);
		}
		/** The betterSidebar and locale services this half resolves through the context proxy. */
		const inject = ["betterSidebar", "locale"];
		/**
		* Client plugin body.
		* @param ctx - the client cordis context.
		*/
		function apply(ctx) {
			const betterSidebar = ctx.betterSidebar;
			if (betterSidebar === void 0) return;
			attachLocale(ctx.locale);
			ctx.effect(() => {
				const offZh = ctx.locale.register(LOCALE_NS, "zh", zhDict);
				const offEn = ctx.locale.register(LOCALE_NS, "en", enDict);
				return () => {
					offZh();
					offEn();
				};
			}, "dsh-plugin-better-plan: locale dictionaries");
			ctx.effect(() => betterSidebar.registerTab({
				id: TAB_ID,
				title: () => t("tabTitle"),
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
					url.search = new URLSearchParams({
						session: sessionId,
						locale: activeLocale()
					}).toString();
					socket = new WebSocket(url.toString());
					socket.onmessage = (event) => {
						if (typeof event.data !== "string") return;
						try {
							applyDeliveryFrame(betterSidebar, reviewStore, JSON.parse(event.data), sessionId);
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
					reviewStore.reset();
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
		exports.applyDeliveryFrame = applyDeliveryFrame;
		exports.applyDeliveryPush = applyDeliveryPush;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map