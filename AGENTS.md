# dsh-plugin-better-plan — Agent Guide

## 插件概览

双半（host + client）DSH 插件，取代内置 plan mode 的计划交付与审批面：模型先把完整计划写成 markdown 文件（路径约定 `<planDir>/YYYY-MM-DD-<topic>.md`，默认 `docs/plans/`，日期+kebab-case 主题命名，提示词面与工具 description 双面强制），**同回合**再调用同名 `exit_plan_mode({ path })`；插件读文件 → 经自有 WS 推送到 better-sidebar 的「Plan」tab。推送**送达已连接视图**时工具**立即返回** `decision: 'pending'`（render 指示模型结束回合——对话就此停止，聊天无弹窗也无挂起卡片），用户在 Plan 面板动作栏点 Approve / 新开对话执行 / Keep planning（可附反馈），决定经 `POST /better-plan/api/review` 结算：批准 → 立即落 `plan/mode: false` + `agent.steer` 开新回合执行；新开对话执行 → 同样翻模式，但 steer 换移交文案、结算为 `delegated`，面板 client 侧经 `ctx.sessions` 新建执行对话并导航；保留 → steer 开新回合带回反馈。推送未送达时回退原版阻塞聊天审批卡（detail=完整计划全文）。审批语义与模式切换语义与原版一致。

## 环境搭建（junction 建链）

`@deepseek-ai/*` 与 `dsh-better-sidebar` 不进 devDependencies（发布包干净）；开发/测试解析靠 `node_modules` junction 指向源码 checkout。`pnpm install` **之后**执行（pnpm 不清 Junction，但保持顺序更稳）：

```powershell
$src = "D:\Projects\deepseek-harness\dsh"
$nm  = "$PWD\node_modules"
$links = @{
  '@deepseek-ai/cordis'             = "$src\vendor\cordis"
  '@deepseek-ai/cosmokit'           = "$src\vendor\cosmokit"
  '@deepseek-ai/schemastery'        = "$src\vendor\schemastery"
  '@deepseek-ai/dsh-llm'            = "$src\packages\llm\llm"
  '@deepseek-ai/dsh-session'        = "$src\packages\core\session"
  '@deepseek-ai/dsh-agent'          = "$src\packages\core\agent"
  '@deepseek-ai/dsh-scope'          = "$src\packages\core\scope"
  '@deepseek-ai/dsh-system-prompt'  = "$src\packages\core\system-prompt"
  '@deepseek-ai/dsh-tools'          = "$src\packages\core\tools"
  '@deepseek-ai/dsh-plan-mode'      = "$src\packages\plan\plan-mode"
  '@deepseek-ai/dsh-user-questions' = "$src\packages\interaction\user-questions"
  '@deepseek-ai/dsh-client-ui-primitives' = "$src\packages\client\ui-primitives"
  'dsh-better-sidebar'              = 'D:\Projects\deepseek-harness\DSH-better-sidebar'
}
foreach ($k in $links.Keys) {
  $dir = Split-Path $k -Parent
  if ($dir) { New-Item -ItemType Directory -Force -Path (Join-Path $nm $dir) | Out-Null }
  $t = Join-Path $nm $k
  if (Test-Path $t) { Remove-Item $t -Force -Recurse }
  New-Item -ItemType Junction -Path $t -Target $links[$k] | Out-Null
}
```

类型解析另有 tsconfig `paths`（同样指向源码树 `lib/types`）；`@deepseek-ai/dsh-session/types` 子路径映射必须存在，否则 plan-mode 的 `plan/mode` 事件增强不合并（`session.append('plan/mode', …)` 类型报错）。

## 命令

```sh
pnpm run typecheck    # tsc --noEmit ×2（tsconfig.json host+tests 面、tsconfig.client.json 纯 client 面）
pnpm test             # vitest run（14 个 spec 文件）
pnpm run build        # tsdown（host ESM + client CJS closure）+ tsc -p tsconfig.build.json → lib/
pnpm run bundle:client # 仅重打 client bundle（快速 client 迭代）
```

## 机制锚点（改动前先读）

- **同名遮蔽**：`agent/session-start` → `agent.ctx.effect(() => agent.ctx.tools.register(...))`。agent scope 层遮蔽 preset standing scope 层的内置注册；effect 绑 agent fiber，agent 释放即清理。幂等守卫用 per-agent `WeakSet`（不要用 `tools.get(name)` 判断——全局视图看不到 preset 层的内置工具，而带 scope 的视图会看到它导致永远跳过注册）。
- **提示词面覆盖**：preset 的 `plan:policy` 段落教原版内联契约且禁写文件，与工具契约冲突 → `registerPlanPolicyOverride` 把 `system-prompt/assemble` waterfall 监听器**逐 agent 注册在 `agent.ctx`**。assemble 派发 key = agent 本身（`assembleContextFor` 返回 `{ agent, scope: agent }`），scope 链准入只向上流——挂在插件 fiber 上的注册会被过滤，**不要「简化」成全局注册**（有测试固化该约束）。改写是锚点句子替换（幂等、缺锚跳过，兼容 preset 变体），共四处：交付句 → **同回合两步强制契约**（先写 `docs/plans/YYYY-MM-DD-<topic>.md`，日期+kebab-case 主题命名，紧跟 exit 调用；「写文件只是准备，写完不调工具 = 什么都没呈现」）；**原版「exit_plan_mode 是该回合唯一且最后的工具调用」句（`FINAL_CALL_ANCHOR`）必须一并改写**——文件先行下 write 先于 exit，该句原样保留会被模型读成「本回合不许再调工具」，正是「光 write 不 exit」的根因；写禁句与规则压治句各带豁免。锚点出现 ⇔ 计划模式激活，无需自管状态。
- **模式切换**：preset isolate realm 的 `planMode` 服务对 agent ctx 不可见，不能调原版控制器。两条批准路径分工：**侧边栏批准**是回合间决定——直接 append `plan/mode: { active: false }`（与原版控制器空闲时行为一致），append 失败退回 `pendingExits` 记账由下个边界重试；**弹窗降级路径**的批准发生在回合内——仍走 `pendingExits` + 下一个被接受的 `agent/pre-step` 边界 append（WeakSet 记账、失败保留重试）。
- **审批门（侧边栏审批面）**：推送 `delivered: true` 时 execute **不调 `userQuestions.ask`**（无聊天弹窗）、也**不阻塞**——立即返回 `decision: 'pending'`，render 指示模型结束回合（对话停止 = 模型停止调工具；阻塞工具只会留一张永远「运行中」的卡片，**不要改回停靠等待**）。`review-gate.begin(sessionId, review, handlers)` 只记录待决 + 广播 pending 帧；`decide()`（`POST /better-plan/api/review` 触发，决定词 `approve` / `keep` / `approve_new_session`）结算状态并触发 handlers——`onApprove` 落模式翻转 + `agent.steer`（**空闲 driver 直接开新回合**，运行中则最近 step 注入）、`onKeep` 经 steer 带回反馈、`onDelegate` 同样翻模式但 steer 移交文案（结算状态 `delegated`，**不要**复用 `approved`——那会让别的窗口/刷新后面板谎称「模型正在本对话执行」）。steer 消息用 `createUserMessage({ source: { kind: 'user' } })`（`/plan` 命令同款）。陈旧 `id` 守卫（409）防多窗口旧窗口误结算新计划；`dispose()` 结算 cancelled 且不触发 handlers。`delivered: false` 永远走原版 ask 弹窗——不要「统一」成 gate，无侧边栏环境会失去审批能力。
- **delegation（新开对话执行）**：新建执行会话在 **client 侧**完成（`src/client/execution-launch.ts`）——经公开 `ctx.get('sessions')` 契约 `create({cwd})` → `binding(id).session.prompt(kickoff,'queue')` → `open(id)`，cwd 取 sessions 列表里规划会话 summary 的 `cwd`。**不要**搬去宿主 `agents.create`（sidechat 那套）：会引入会话列表竞态、破坏「与手点新建会话同构」语义，还丢了 provider/model 继承不必要的复杂度。sessions face 用**结构化接口**（同 better-sidebar 的 `SidebarConversation` 模式），零 value import、零 tsconfig paths 新增；`ctx.get('sessions')` 缺席时第三按钮不渲染（能力探测，不是降级）。kickoff 是新对话的首条用户消息（计划文件绝对路径锚点，本地化），在 `client/locales.ts` 的 `executionKickoffPrompt`。无侧边栏弹窗降级**保持两选项**——delegation 依赖 client sessions 服务，宿主弹窗路径做不到。
- **i18n（用户文案双面、模型契约恒英文）**：本地化只覆盖**用户可见面**——宿主端（交付 render 文本经工具 `finalizeContent` 接缝替换、steer 消息在 decide 时刻解析、无侧边栏审批弹窗 copy；approve 匹配用 `copy.approveLabel` 与 ask intent 同源配对，本地化标签不会破坏 plan-review takeover 的按 label 匹配）与 client 端（PlanView 文案走 `client/locales.ts` 的 `t()`，词典注册进 DSH 共享 locale 注册表 `betterPlan` 命名空间，跟随 Host-backed `locale.preference` 实时切换；better-sidebar 的 tab-content memo 以 localeRevision 为键，切语言自动重渲染）。locale 解析链：config `locale`（≠ auto 强制）→ `LocaleDirectory` 视图上报（WS connect 查询参数 + review GET/POST 携带浏览器当前 DSH 语言）→ `'en'`。**模型契约文本永远英文**（description、plan:policy 改写、execute 错误指引）——不要「顺手」本地化它们。审批路由错误带稳定 `code`（`no_pending`/`stale_review`/…），client 按 code 映射、未知 code 回退原文。render 基线恒英文（finalize 只在非 en 会话替换），测试锚点稳定。
- **client 半纯度门**：client bundle 禁止 value-import 其他插件/宿主内部模块。better-sidebar 的交互全部走 `ctx.betterSidebar` 方法；`markdownTextProps` 双形状逻辑内联在 `src/client/markdown-props.ts`（勿改成 import）。`ctx.locale` 只需 type-only import（`@deepseek-ai/dsh-client-locale/client`）拉 Context merge——运行时经 context proxy 取服务，无 value import。
- **交付推送 seed 不带 path**：better-sidebar v0.19+ 原生右栏把带 `path` 的 openTab 一律改道文件资源打开（editor 认领 `dsh-resource://file/**`），Plan tab 不出现——计划路径只放 `meta.path`（`planPathOf` 优先读 meta）；旧自绘面靠 `updateTab`（`features.includes('updateTab')` gate）+ `activateTab` 刷新/聚焦（原生面上二者按 dockkit tab id 键控、对 `TAB_ID` 是无害 no-op）。重复交付写同一约定文件名时原生页面去重不刷新已挂载记录的 meta，PlanView 以新审批 id 作为重读触发。`meta.path` 随 tab 持久化，刷新后按 `meta.path` 重读。
- **文件读取走 better-sidebar 路由**：PlanView 用 `POST /sidebar/api/fs.read`（同源、浏览器已鉴权）；本插件不建自有 HTTP 读路由。
- **WS 栅栏**：`/better-plan/ws/delivery` 过 `isTrustedDeliveryRequest`（Host 回环 / trustedHosts / sec-fetch-site / Origin hostname）。`webRuntime` 为 optional 注入（`ctx.get`），缺席时仅回环可连。

## 文件职责

| 文件 | 职责 |
|------|------|
| `src/index.ts` | host 入口：遮蔽挂接（工具 + 提示词面）、pre-step flush、WS/HTTP 路由注册、service lifetime |
| `src/shadow-tool.ts` | 工具契约全部面：description / parameters / output schema+render / finalizeContent（本地化接缝）/ execute / presentCall / presentResult |
| `src/locale.ts` | locale 词表 + 会话级解析链（`LocaleDirectory` 视图上报 + config 覆盖 → en 兜底）+ 宿主端双语文案（render 文本 / steer 消息 / 审批弹窗 copy） |
| `src/review-gate.ts` | 审批门：per-session 待决记录 + `begin`（记录+广播）/`decide`（结算+触发 handlers）/`peek`/attach 回放/dispose |
| `src/review-route.ts` | `/better-plan/api/review`：GET 引导当前状态 + POST 结算决定；信任栅栏 + 体校验（4KB 上限）+ 陈旧 id 守卫；错误响应带稳定 `code`；双动词都记录视图上报 locale |
| `src/prompt-override.ts` | `plan:policy` 段落锚点改写（`rewritePlanPolicySection`）+ assemble waterfall 注册（`registerPlanPolicyOverride`） |
| `src/delivery-registry.ts` | per-session 推送队列（上限 8、consume-on-send、attach 回放） |
| `src/ws-route.ts` | `/better-plan/ws/delivery` 升级注册 + tagged 帧（`deliver`/`review`）+ `attachDeliverySocket`（registry + gate 双 attach） |
| `src/trust-fence.ts` | 浏览器信任栅栏（对齐 /api 网关语义） |
| `src/resolve-cwd.ts` | header → persistence → process.cwd 解析链 |
| `src/first-heading.ts` | 原版同款首 heading 正则 + basename |
| `src/context.ts` | Context 结构化 face（intersection，勿改 augmentation） |
| `src/client/index.tsx` | Plan tab 注册 + 词典注册（`ctx.locale.register('betterPlan', …)`）+ 交付 WS 订阅（会话切换重连、失败退避，connect 携带 `locale` 上报）+ tagged 帧分发（`applyDeliveryFrame`） |
| `src/client/PlanView.tsx` | 面板组件（文案全走 `t()`）+ 审批动作栏（三决定，delegation 按钮按 `ctx.get('sessions')` 能力渲染）+ delegation 流编排 + `planPathOf` + fs.read 封装 |
| `src/client/locales.ts` | 面板双语词典（zh 源 + en key-set-equal）+ `attachLocale`/`t()`/`activeLocale` + 路由错误 `code` → 本地化文案映射 + `executionKickoffPrompt` |
| `src/client/review-store.ts` | 审批状态外部 store（状态含 `delegated`）+ `submitReviewDecision`（POST 回宿主端并 echo，携带 locale；错误按 code 本地化） |
| `src/client/execution-launch.ts` | delegation 流：`ctx.sessions` 结构化 face + `launchExecutionConversation`（create({cwd}) → kickoff prompt 排队 → open） |
| `src/client/markdown-props.ts` | MarkdownText 双代 props（内联） |

## 已知约束

- 需要 better-sidebar ≥ v0.12.0 才有 updateTab/activateTab/meta 持久化；更老版本退化为 openTab dedupe 聚焦（首个交付仍正确落地）。
- 审批门与 `pendingExits` 记账都在 host 内存（不落会话日志）：`dsh web` 重启会把待决审批静默取消（不触发 steer，用户重新驱动）；`delivered` 判定取 enqueue 时刻的视图连接数，浏览器关掉再开要靠下一次交付。
- presentCall 是 args-only 纯函数，卡片标题只能用 basename；首 heading 在 execute 内计算（进 WS push title）。
- 组合测试的 `agentWithSession` 仿照 plan-mode 官方 spec：fake Agent + 真 Session + `createScope` 铸造 agent ctx + `agents.enter/announce` + `agentEvents(...).emit('agent/session-start')`。
- 发布前过一遍根 AGENTS.md 的 SOP §0 合规自检（dshfind card、双语描述、topic `dsh-plugin` + `dsh-better-sidebar`）。
