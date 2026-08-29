# better-plan 插件设计（dsh-plugin-better-plan）

> 日期：2026-08-29 · 状态：已实施（v0.1.0，实施偏差见仓库 README「与设计文档的实施偏差」）
> 目标：一个取代 DSH 内置 plan mode「交付体验」的插件——计划交付不再渲染悬浮 toolcall 卡片全文，而是写入计划文件后经 better-sidebar 侧边栏「计划面板」展示；审批流与原版一致。

---

## 1. 背景与目标

DSH 内置 plan mode（`@deepseek-ai/dsh-plan-mode`）的交付工具 `exit_plan_mode` 把**完整计划正文**作为参数传入，聊天里的 toolcall 卡片（`presentCall` generic card）渲染全文——计划一长就刷屏。better-plan 的改变：

1. **文件先行**：模型必须先用 `write` 工具把完整计划写成 markdown 文件，再调用交付工具传 `path`。
2. **侧边栏展示**：计划正文展示在 better-sidebar 的专属「计划」面板（自动打开、随 tab 持久化、刷新可恢复）；聊天里只剩紧凑的「计划已交付」卡片。
3. **审批流不变**：仍走 `userQuestions.ask` + `plan-review` 意图（Approve / Keep planning / Chat about it），workspace 树的「计划待审」徽章照常。

与原版一致的部分**全部保留**：`/plan` 命令、`plan/mode` 日志状态、`plan` 投影与 composer 徽章、`plan:policy` 系统提示段。

## 2. 已确认的设计决策

| # | 决策 | 结论 |
|---|------|------|
| D1 | 工具名 | **沿用 `exit_plan_mode`**，per-agent 同名遮蔽替换（preset 内 policy 段不可 patch，同名可让 policy 段保持正确、零 prompt 漂移） |
| D2 | write 校验强度 | **仅验证文件存在可读**（不扫会话日志核对 write 调用；引导靠工具 description） |
| D3 | 审批卡 detail | **动态**：侧边栏推送送达（delivered）→ 一行指引 + 文件路径；未送达 → 回退完整计划全文（无 better-sidebar 环境获得原版体验） |
| D4 | 总体方案 | **方案 A**：阴影替换 + 自有 WS 推送 + 专属 Plan tab（弃用「复用内置 editor tab」的方案 B；「禁用内置插件重实现」的方案 C 已被调研证伪） |

## 3. 调研结论（机制事实，实施时的源码锚点）

1. **preset 挂载行不可 patch**：`packages/bundle/base/cordis.patch.yml` 根部有一行 `plan-mode`，但真正对 web agent 生效的挂载在每个 agent preset 的 `planning` group（`isolate: { planMode: true }`）内（`packages/preset/agent-presets/presets/{standard,ptc,cordis}/agent.cordis.yml`）。preset 经 `Include`（`{ path }` only）挂载，不接受 patches；且 patch 机制只校验 `name` 不允许替换它（`vendor/include/src/index.ts` 的 `applyEntryPatches`：name mismatch → skip）。⇒ 「禁用内置插件」不可行，「替换其 config 段」对 preset agent 不可达。
2. **per-agent 作用域工具遮蔽是官方机制**：工具注册表按 scope 分层，agent 作用域注册同名工具遮蔽全局（`packages/core/tools/src/index.ts` ToolView 的 scoped shadowing；重复注册报错文案明示 "for a per-agent variant, register through that agent's `agent.ctx` instead"）。挂接点：`agent/session-start` 事件（`{ agent, source }`，`packages/core/agent/src/runtime-types.ts`）。
3. **原版工具可复用的部分**：`foldPlanMode(events)` 是 `@deepseek-ai/dsh-plan-mode` 的公开导出（value import，host 半无纯度门问题）；审批语义（approve → `{ approved: true }`、keep planning → throw with feedback、`ASK_CANCELLED` → throw 指引用户接手）照搬原版 `execute`。
4. **`plan-review` 意图**：`ui-user-questions` 的 `PlanReviewPanel` 渲染 `intent: { kind: 'plan-review', approve }` 的问题；`ask()` 强制 intent 必须有 `detail`（BAD_INTENT）；detail 是什么就渲染什么 ⇒ 传指引文案即得紧凑审批卡。`ui-workspace` 树按 interaction kind 显示「计划待审」徽章。
5. **better-sidebar 接入面**（其 `AGENTS.md`）：client 半 `ctx.betterSidebar.registerTab` / `openTab`（`meta` 随 tab 进 localStorage 持久化）/ `updateTab`（v0.12.0+，`features.includes('updateTab')` gate）；内容型 openTab（带 path seed）自动展开面板；`single: true` 去重聚焦但**不覆写**已打开 tab 的 path ⇒ 重复交付需 `updateTab` 跟进。文件内容读取走其 `/sidebar/api/fs.read` 路由（同源、浏览器已鉴权）。host 半没有 `betterSidebar` 服务——host→client 只能走自有路由。
6. **host→client 推送范式**：better-sidebar `src/agent-opens.ts` 的 `AgentOpenRegistry`——per-session 队列 + attach 回放 + consume-on-send；WS 经 `ctx.webServer.registerUpgrade`，HTTP 经 `ctx.webServer.register({ kind: 'prefix'|'exact', path, handler })`。
7. **会话 cwd 解析范式**：session header → client-supplied cwd → persistence index → process cwd 兜底（agent-opens 的 `resolveCwd` 注释）。
8. **卡片渲染**：`exit_plan_mode` 现由 `ui-tool` 的 `GenericToolCard` 按 `presentCall` 返回值渲染全文；插件的 presentCall/presentResult 是纯函数投影（C9），返回紧凑 content 即得紧凑卡片。
9. **better-sidebar 的 openpath-intercept**：聊天侧文件打开漏斗（`ctx.workspaces.openPath`）可被接管进侧边栏 ⇒ 卡片 content 里的路径文本在 pref 开启时可点击直达侧边栏 editor（免费获得的次级通路）。

## 4. 架构总览

```
模型: write 计划文件 ──► exit_plan_mode({ path })
                              │
┌───────────────── Host 半 (src/index.ts) ──────────────────┐
│ agent/session-start → agent.ctx.tools.register(同名遮蔽)   │
│ execute: foldPlanMode 校验 → 解析 path + stat + 读文件      │
│        → DeliveryRegistry.enqueue(sessionId, …)           │
│        → userQuestions.ask(plan-review, 动态 detail)       │
│ WS: /better-plan/ws/delivery?session=<id> (registerUpgrade)│
└──────────────────────────┬────────────────────────────────┘
                           │ push { path, title }  (consume-on-send)
┌───────────────── Client 半 (src/client/index.tsx) ─────────┐
│ registerTab('better-plan:plan', single, order 15)          │
│ WS 订阅 → openTab(path seed, meta) + updateTab + 聚焦      │
│ PlanView: 状态头 + MarkdownText(fs.read 拉 /sidebar/api)   │
└────────────────────────────────────────────────────────────┘
```

内置 plan-mode 保持挂载、不做任何 patch。better-plan 只遮蔽工具 + 增加交付管线。

## 5. 详细设计

### 5.1 Host 半

#### 5.1.1 遮蔽注册

```ts
ctx.on('agent/session-start', ({ agent }) => {
  // 注册进 agent.ctx ⇒ 绑定 agent fiber，agent 释放即清理；幂等性由
  //「每个 agent 只触发一次 session-start」保证，防御式再注册前查 catalog。
  return agent.ctx.effect(() => agent.ctx.tools.register(defineTool({ … })))
})
```

#### 5.1.2 工具契约（模型可见面）

- **name**: `exit_plan_mode`
- **parameters**: `{ path: string, required }` — 计划文件路径，绝对或会话 cwd 相对
- **description**（完整契约，模型唯一的新知识来源；`planDir` 配置拼入建议路径）：
  > Use only in plan mode. Before calling, write the COMPLETE plan as markdown to a file with the write tool (e.g. `<planDir>/YYYY-MM-DD-<topic>.md`), then pass its path here. The plan opens in the sidebar plan panel for the user's review; the user may approve (carry out the plan from your next step) or keep planning — their feedback comes back in the tool result; revise the file and present again.
- **output schema**: `{ approved: true }`（与原版同规范值）；`render`：确认文案 + delivered 时附「已展示于侧边栏计划面板」
- **presentCall**: 紧凑卡——`title` = 计划首 heading（`firstHeading()`，原版同款正则）?? 文件 basename；content = 单行指引文本 + 路径（**不含计划正文**）
- **presentResult**: 紧凑确认卡

#### 5.1.3 execute 流程

1. `exec.signal.throwIfAborted()`
2. agent 必须存在；`foldPlanMode(agent.session.events)` 为 false → throw（同原版文案：only available in plan mode）
3. 解析 `path`（绝对直用；相对走 resolveCwd：session header → persistence → process cwd）→ `stat` 不存在/不可读 → throw 明确指引（含解析后的绝对路径 + 「先用 write 工具写入完整计划」）
4. 读文件，超 `maxPlanBytes` → throw 指引精简；`firstHeading()` 提取标题（**不强制** `#` 开头——D2 宽松校验，无 heading 回退 basename）
5. `registry.enqueue(sessionId, { path, title })` → `{ delivered }`
6. `userQuestions.ask`：单问题 `{ id: 'plan-review', header: 'Plan review', question: 'Approve this plan and leave plan mode?', detail, options: [Approve, Keep planning], intent: { kind: 'plan-review', approve: 'Approve' } }`；detail = delivered ? 指引文案（含路径）: 计划全文
7. 应答分派（同原版）：approve → `{ approved: true }`；keep planning → throw（custom feedback 或固定文案）；`ASK_CANCELLED` → throw（用户接管，留在 plan mode）；review 挂起期间服务重载（disposed）→ throw 要求重新提交

#### 5.1.4 DeliveryRegistry + WS 路由

照 `AgentOpenRegistry` 范式：

- per-session 队列 + subscribers；`enqueue` 有连接视图即推（consume-on-send）并返回 `delivered: true`，否则暂存、`attach` 时回放
- **队列上限 8 条/session**（超出丢最旧）——防无 client 环境无限堆积（agent-opens 没有上限，这里是增量防御）
- `drainAll()`（特征关闭）/ `dispose()`（插件卸载）生命周期
- WS：`ctx.webServer.registerUpgrade`，路径 `/better-plan/ws/delivery`，query `session=<sessionId>` 定向 attach；push 载荷 `{ id, path, title }`
- 无自有 HTTP 路由：PlanView 的文件内容走 better-sidebar `/sidebar/api/fs.read`

### 5.2 Client 半

#### 5.2.1 Plan tab

```ts
inject = ['betterSidebar']   // optional peer；缺席 ⇒ apply 内整体跳过
ctx.effect(() => ctx.betterSidebar.registerTab({
  id: 'better-plan:plan',
  title: () => 'Plan',
  icon: …, order: 15,        // editor(10) 之后
  single: true,              // per-session 单实例
  component: PlanView,
}))
```

#### 5.2.2 WS 订阅与打开

- apply 时（betterSidebar 存在）建 WS 连接（sessionId 取自 `betterSidebar.getSnapshot()`），会话切换时重连
- 收到 push：`openTab({ type: 'better-plan:plan', id: 'better-plan:plan', path, title, meta: { path, deliveredAt } })`（内容型 seed 自动展开面板）→ 因 `single` 去重聚焦**不覆写**旧内容，紧跟 `updateTab(id, { path, title, meta })`（`features.includes('updateTab')` gate）→ `activateTab` 聚焦
- `meta` 随 better-sidebar localStorage 持久化 ⇒ 刷新后 tab 恢复，PlanView 按 `tab.meta.path`（或 `tab.path`）重读文件

#### 5.2.3 PlanView 组件

- 状态头：标题、路径、动作（在编辑器打开 = `openFile(scope, path)`；复制路径）
- 正文：DSH `MarkdownText` 渲染 fs.read 拉取的全文；**内联实现** `markdownTextProps` 等价的双形状 props 逻辑（0.1.1-rc.x 扁平 `codeLabels` / 0.1.2-alpha.1+ 嵌套 `labels` 两代契约通吃）——**不得** value-import better-sidebar 内部模块（构建纯度门）
- 加载/错误态：读取失败显示内联错误 + 重试

### 5.3 降级矩阵

| 环境 | 行为 |
|------|------|
| better-sidebar 在装 + 面板视图已连接 | push 即开 tab 自动展开；审批卡 = 指引文案 |
| better-sidebar 在装但视图未连接 | 队列暂存，attach 回放；`delivered=false` ⇒ 审批卡回退全文 |
| better-sidebar 未安装 | 无 tab / 无 WS；`delivered=false` ⇒ 原版体验（审批卡全文）+ 紧凑交付卡 |
| tab 被用户关闭后需再看 | 审批卡指引文案含路径，可经 openpath-intercept 点击进 editor；或等下次交付重开 |

## 6. 配置（Schemastery，A4/A5 合规）

| 字段 | 类型/默认 | 说明 |
|------|-----------|------|
| `planDir` | `string = 'docs/plans'` | 工具 description 中建议的计划目录 |
| `maxPlanBytes` | `number = 262144` | 计划文件读取上限 |

不注入额外系统提示段——新契约全部由工具 description 携带（policy 段保持原版原文，`exit_plan_mode` 名称未变故其陈述依然为真）。

## 7. 错误处理汇总

| 场景 | 行为 |
|------|------|
| 非 plan mode 调用 | throw（同原版文案） |
| path 不存在 / 不可读 | throw + 解析后绝对路径 + write 引导 |
| 文件超限 | throw + 上限值 + 精简引导 |
| Keep planning | throw + custom feedback（同原版） |
| 审批被放弃（ASK_CANCELLED） | throw + 用户接管提示（同原版） |
| review 挂起中插件重载 | throw + 重新提交提示（disposed 检查，同原版） |
| WS 无订阅者 | 队列暂存 + `delivered=false` 路径 |
| client fs.read 失败 | PlanView 内联错误 + 重试 |

## 8. 测试计划（G 分层）

- **Unit**（vitest，跟代码同目录）：`firstHeading` 边界；路径解析（绝对/相对/Windows 盘符）；registry enqueue/attach 回放/consume-on-send/队列上限/drain/dispose；delivered 分支的 detail 选择；presentCall/presentResult 纯函数快照
- **组合**（真实 Loader + cordis.yml，plan-mode 官方 `plan-mode.spec.ts` 同款模式）：挂载后断言 agent 工具目录中 `exit_plan_mode` 的 description 是 better-plan 版本（遮蔽生效）→ 驱动 execute 三分支（approve / keep / cancel，临时目录真实写文件、真实 stat/读）→ `ASK_CANCELLED` 与 disposed 分支
- **Client**（jsdom）：PlanView 加载/错误/重试；WS push → openTab + updateTab 序列（service mock 按 better-sidebar tests/service.spec.ts 的真实接口面）；双形状 markdownTextProps 等价逻辑单测
- 不做 web e2e 门禁（非 better-sidebar 本体；Unit + 组合 + client 组件层已覆盖）

## 9. 实施计划（落盘备查，本轮不执行）

1. **骨架**：`dsh-plugin-better-plan/` 按 turtle-ui 范式建仓（package.json + `dsh.bundle.patch` + cordis.patch.yml insert 行 + tsconfig/tsdown 双配置 + README + AGENTS.md）；peerDeps 见 §10；**预构建 `lib/` 入库策略**（含 private peer，无 `prepare`）
2. **Host 半**：`src/first-heading.ts` / `src/resolve-cwd.ts` / `src/delivery-registry.ts` / `src/shadow-tool.ts`（工具定义 + execute）/ `src/ws-route.ts` / `src/index.ts`（session-start 挂接 + Config）
3. **Client 半**：`src/client/index.tsx`（tab 注册 + WS 订阅）/ `PlanView.tsx` / `markdown-props.ts`（双形状内联）
4. **测试**：§8 三层
5. **验证**：`pnpm typecheck && pnpm test && pnpm run build`；`dsh plugin --profile web add link:<路径>`（由人类执行 `dsh web` 重启 + 硬刷新）；真机走查「/plan → 探索 → write → 交付 → 侧边栏展示 → Approve/Keep」全链路
6. **发布**：按 AGENTS.md SOP（dshfind card、双语描述、topic `dsh-plugin` + `dsh-better-sidebar`、`@huanlin/dsh-plugin-better-plan`）

## 10. 发布形态对齐

- 包名 `@huanlin/dsh-plugin-better-plan`，repo `huanlinoto/dsh-plugin-better-plan`（basename 一致）
- peerDependencies：`cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-plan-mode`、`@deepseek-ai/dsh-user-questions`、`dsh-better-sidebar`（optional）、`react`（client）；`dependencies/peerDependencies` **不得出现 `cordis`**（市场硬拒——以 `@deepseek-ai/cordis` 形式声明，与 better-sidebar v0.15.2+ 同款处理）
- cordis.patch.yml：仅 insert 本插件行（id `better-plan`，name 用包名），不触碰内置 plan-mode 行
- files：`lib/` + `cordis.patch.yml`；README 中文、含开发/运行/检查三节 + 顶部 dshfind card

## 11. v1 明确不做

> 真机走查后第 1、2 条已被推翻并实施（见 §12「审批面迁移」）——保留原文以记录设计演变。

- ~~Plan tab 内 Approve/Refuse 按钮（需 tab→host 双向命令通道；审批留在聊天审批条）~~（已实现：审批门 + `/better-plan/api/review`，见 §12）
- ~~tab 内审批状态回显（review 状态在聊天卡片上已可见）~~（已实现：`review` WS 帧 + 动作栏状态行）
- 替换/禁用内置 plan-mode 状态机、`/plan` 命令、徽章（不可达且无必要）
- 会话日志级 write 纪律核对（D2 已选宽松校验；如需收紧再引入）

---

## 12. 实施记录（2026-08-29）

按 §9 落地完成，偏差四项（详见 README）：

1. 规范值 `{ approved: true, delivered }`（render 需要 delivered；`sidebar_open` 先例）。
2. presentCall 纯函数拿不到文件内容 → 卡片标题 = basename；首 heading 在 execute 内算，进 WS push 的 tab title。
3. 批准后的 `plan/mode: false` 由本插件在 `agent/pre-step` 边界 append（preset realm 的 planMode 服务对 agent ctx 不可见；机制与原版控制器一致：WeakSet 记账、失败保留、工具结果即叙述）。
4. WS 路由补了与 /api 网关同语义的浏览器信任栅栏（webRuntime optional 注入）。

另：幂等守卫用 per-agent WeakSet 而非 catalog 查询——scope 视图会看到 preset 层的内置工具导致永不注册（AGENTS.md「机制锚点」有记录）。

### 真机走查修正（同日）：提示词面覆盖

首次真机走查失败：模型看到了遮蔽工具（请求工具表已确认是新 `{ path }` 契约）却只写文件不调用。原因不在工具面，而在提示词面——preset 的 `plan:policy` 静态段落教的是原版契约（内联传正文、禁写文件、宣称规则压过工具描述），两份指令冲突时模型放弃交付。§5 的工具 description 对冲不了 preset 段落的显式压过声明。

修复（偏差 5，详见 README）：`system-prompt/assemble` waterfall 监听器逐 agent 注册在 `agent.ctx`，把该段三处原版契约句子锚点替换为文件先行契约。注册必须在 agent scope——`assembleContextFor` 以 agent 为 assemble 派发 key，scope 链准入只向上，插件 fiber 上的注册会被过滤（scope-lifecycle 语义，测试固化）。设计教训：**同名遮蔽要同时覆盖工具 schema 与模型可见提示词两个面**，缺一面即契约自相矛盾。

### 审批面迁移（同日，真机走查反馈）：弹窗抑制 + 侧边栏按钮

走查通过后用户推翻了 §1「审批流不变」与 §11 的两条非目标：聊天里弹出的原版审批卡（`PlanReviewPanel`）不是想要的效果——**送达侧边栏后对话应直接停止，聊天不渲染任何审批卡，审阅与批准全部发生在 Plan 面板内**（按钮是原始计划的诉求）。

实现（偏差 6，详见 README）：

1. **审批门**（`src/review-gate.ts`）：推送 `delivered: true` 时 execute 不再 `userQuestions.ask`，改停靠 `begin()`——工具调用挂起即 agent loop 停止，这正是「直接停止对话」的机制形态。`decide()`（HTTP 路由触发）/ exec.signal abort / `dispose()` 三路结算；错误文案与弹窗路径逐字一致（keep 反馈、重载提示），模型视角的契约不因决定面不同而漂移。
2. **tab→host 命令通道**（`src/review-route.ts`）：`POST /better-plan/api/review`（§11 当初预判的「双向命令通道」），信任栅栏 + 4KB 体上限 + 陈旧 `id` 守卫（409，防多窗口旧窗口误结算新计划）。
3. **状态回传**：WS 帧升级为 tagged（`{ kind: 'deliver' … }` / `{ kind: 'review', review }`）；gate 状态变更广播 + attach 回放（含 pending），页面刷新、多窗口、会话切换（store reset + 回放）全部一致。
4. **动作栏**（PlanView）：pending → 指引 + 反馈输入 + Approve / Keep planning；结算 → 状态行（approved / kept；cancelled 静默）。决策 POST 的 echo 即时更新提交窗口，其余窗口跟 WS 帧。
5. **降级不变**：`delivered: false`（无侧边栏环境）仍走原版 ask 弹窗（detail=完整计划全文）——**审批能力在无侧边栏环境不丢失**，这是不把 gate 路径「统一化」的硬理由。

设计教训：审批这类「等用户」的交互，宿主端的等待点（工具挂起）与用户面前的操作面（卡片 or 面板）是两个独立决策；同一契约迁移操作面时，错误文案必须逐字共享，否则模型看到两套措辞。
