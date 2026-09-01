# better-plan 委托执行两处修正（v0.4.1）

## 目标

修复「新开对话执行」（delegation）流程的两个问题：

1. **决定后不得再向原对话发任何内容**：`approve_new_session` 结算后，原规划对话不再收到 steer 消息、不再开启新回合；执行完全交给新对话。
2. **新对话与规划会话在同一个工作区**：新建的执行会话应挂到规划会话所属的 DSH workspace 下（与手点「工作区里新建会话」同构），而不是游离在工作区之外。

## 根因（已核实）

### 问题 1 — steer 残留

`src/shadow-tool.ts` L261-264：

```ts
onDelegate: () => {
  exitPlanMode()
  steerDecision(delegatedSteerText(deps.localeOf(sessionId)))
},
```

`agent.steer(...)` 向**原规划对话**注入一条用户消息；空闲 driver 直接开新回合，模型在原对话里生成「简短确认收到」的收尾回合。用户看到原对话仍有新动静/新内容，而执行其实发生在新对话。`delegatedSteerText`（`src/locale.ts` L143-150）就是这条移交文案，随之成为死代码。

**保留 `exitPlanMode()`**（`plan/mode: { active: false }` 的 log-only append）：它不是「发内容」——不产生消息、不唤醒模型，只让原对话的 plan 徽标随审批结算关闭；若直接 append 失败，仍走既有 `pendingExits` 边界重试（用户下次在该会话发言时冲刷），无需新机制。

### 问题 2 — cwd-only 创建不挂 workspace

`src/client/execution-launch.ts` L63-64：取 sessions 列表 summary 的 `cwd`，调 `sessions.create({ cwd })`。

宿主 `session.create`（`packages/api/session-controller/src/commands.ts` L73-108）语义：`workspaceId` 与 `cwd` **互斥**；只给 `cwd` 时**不执行** `workspace.attachSession(sessionId)` → 新会话不属于任何 workspace，在工作区分组视图里不与规划会话同组。

对照官方「工作区新建会话」流（`packages/client/ui-workspace/src/client/navigation.ts` `connectWorkspace`）：用 `create({ workspaceId })`，宿主以 `workspace.path` 为 cwd **并** attachSession。客户端可经 `ctx.get('workspaces')`（`IWorkspaces`）读 `list.getSnapshot().items: WorkspaceView[]`，每行含 `workspaceId` / `path` / `sessionIds`——足以反查规划会话所属 workspace。

## 改动清单

### 宿主端

| 文件 | 改动 |
|------|------|
| `src/shadow-tool.ts` | `onDelegate` 只保留 `exitPlanMode()`，删除 steer 调用；注释改为「本会话静默关闭，不向原对话注入任何消息，执行由新对话负责」；删去 `delegatedSteerText` import |
| `src/locale.ts` | 删除 `delegatedSteerText`；文件头注释里 steer 文案清单去掉 delegation 项 |
| `src/review-gate.ts` | 仅注释：`onDelegate` 描述去掉「steer 移交」表述 |
| `src/review-route.ts` | 仅注释：文件头 L10-11「closed out with a handoff steer」改为「closed out silently」 |

### 客户端

| 文件 | 改动 |
|------|------|
| `src/client/execution-launch.ts` | 新增结构化 face `WorkspacesServiceFace`（`list.getSnapshot(): { items: readonly { workspaceId: string; path: string; sessionIds: readonly string[] }[] }`，零 value import，沿 `SessionsServiceFace` 同款模式）；`launchExecutionConversation(sessions, workspaces, planPath, sessionId)` 增加第三参：先在 workspaces 快照里找 `sessionIds.includes(sessionId)` 的行，命中 → `create({ workspaceId })`；未命中 → 回退 summary cwd 的 `create({ cwd })`；再无 → `create({})`。模块头注释同步（同工作区语义 + 回退链） |
| `src/client/PlanView.tsx` | `const workspaces = ctx.get('workspaces') as WorkspacesServiceFace \| undefined`（与 sessions 同款能力探测）；传入 `launchExecutionConversation`。`workspaces` 缺席不隐藏按钮，只走 cwd 回退 |

### 测试

| 文件 | 改动 |
|------|------|
| `tests/composition.spec.ts` | L513 delegation 用例改为断言：结算 `delegated`、模式已关、**`agent.steered` 长度为 0**（原对话零注入） |
| `tests/shadow-tool.spec.ts` | 删除 `delegatedSteerText` import 及其用例块（L142-146） |
| `tests/client/plan-view.spec.tsx` | `propsWithSessions` 的 ctx stub 增加 `workspaces` 键；delegation 用例改三向断言：① 规划会话在某 workspace → `create` 收到 `{ workspaceId: 'ws-…' }`（且不含 cwd）；② 不在任何 workspace → 回退 `{ cwd: '/from-list' }`；③ workspaces 服务缺席 → 同样回退 `{ cwd }`。kickoff 排队 / open 导航断言不变 |

### 文档与元数据

| 文件 | 改动 |
|------|------|
| `AGENTS.md`（插件内） | 概览段 delegation 句去掉「steer 换移交文案」→「不向原对话发任何内容，本会话静默关闭」；机制锚点 delegation 条目同步，并补「create({workspaceId}) 优先、cwd 回退」的工作区语义 |
| `README.md` | 特性段「新开对话执行」条目改写（无 steer、同工作区 workspaceId 创建）；设计决策 §8 追加 v0.4.1 修订说明 |
| `package.json` | `version` 0.4.0 → 0.4.1 |

## 边界与失败模式

- **规划会话不属于任何 workspace**（未注册 workspace / subagent 会话）：workspace 反查落空 → 回退 summary cwd → 再回退默认 cwd。行为不劣于现状。
- **workspaces 快照未就绪**（phase=pending，items 为空）：反查落空走 cwd 回退——静默降级，不报错、不阻塞。
- **宿主 attachSession 失败**（`session/workspace-attach-failed`）：`create` reject → PlanView 既有 catch 在状态行下就地报错，计划路径仍可见可手动重试（不变）。
- **append 失败且无 steer**：`pendingExits` 重试等到用户下次在原会话发言的 pre-step 边界；模式翻转是记账性质，延迟可接受（注释说明）。
- **client 纯度门**：`WorkspacesServiceFace` 为纯结构化 interface，无 value import、无 tsconfig paths 新增。

## 验收标准

1. 批准 → 新开对话执行后：原对话无新回合、无模型生成内容（composition 测试 `agent.steered` 为空）；面板结算 `delegated`；原会话 plan 模式关闭。
2. 规划会话属于某 workspace 时，新会话以 `workspaceId` 创建并出现在同一工作区分组；kickoff 首条消息、导航行为不变。
3. 无 workspace / 无 workspaces 服务时行为与 v0.4.0 相同（cwd 回退）。
4. `pnpm run typecheck`、`pnpm test`（14 个 spec）、`pnpm run build` 全绿。

## 实施后（发布向）

- `pnpm run build` 重建 `lib/`（预构建策略，`lib/` 入库）；提交 v0.4.1。
- profile 若为 `link:` 引用则重建后即生效；重启 `dsh web` + 浏览器硬刷新由人类执行。
