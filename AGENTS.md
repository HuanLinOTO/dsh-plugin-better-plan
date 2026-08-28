# dsh-plugin-better-plan — Agent Guide

## 插件概览

双半（host + client）DSH 插件，取代内置 plan mode 的计划交付：模型先把完整计划写成 markdown 文件，再调用同名 `exit_plan_mode({ path })`；插件读文件 → 经自有 WS 推送到 better-sidebar 的「Plan」tab → 发起与原版相同的 plan-review 审批。审批语义与模式切换语义与原版一致。

## 环境搭建（junction 建链）

`@deepseek-ai/*` 与 `dsh-better-sidebar` 不进 devDependencies（发布包干净）；开发/测试解析靠 `node_modules` junction 指向源码 checkout。`pnpm install` **之后**执行（pnpm 不清 Junction，但保持顺序更稳）：

```powershell
$src = "$env:USERPROFILE\.dsh\source\current"
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
pnpm test             # vitest run（10 个 spec 文件）
pnpm run build        # tsdown（host ESM + client CJS closure）+ tsc -p tsconfig.build.json → lib/
pnpm run bundle:client # 仅重打 client bundle（快速 client 迭代）
```

## 机制锚点（改动前先读）

- **同名遮蔽**：`agent/session-start` → `agent.ctx.effect(() => agent.ctx.tools.register(...))`。agent scope 层遮蔽 preset standing scope 层的内置注册；effect 绑 agent fiber，agent 释放即清理。幂等守卫用 per-agent `WeakSet`（不要用 `tools.get(name)` 判断——全局视图看不到 preset 层的内置工具，而带 scope 的视图会看到它导致永远跳过注册）。
- **模式切换**：preset isolate realm 的 `planMode` 服务对 agent ctx 不可见，不能调原版控制器。批准后 `pendingExits`（WeakSet<Session>）记账，下一个被接受的 `agent/pre-step` 边界 append `plan/mode: { active: false }`；append 失败保留记账（logger.warn），下个边界重试；与原版 onBoundary 的 delete-after-success 语义一致。
- **client 半纯度门**：client bundle 禁止 value-import 其他插件/宿主内部模块。better-sidebar 的交互全部走 `ctx.betterSidebar` 方法；`markdownTextProps` 双形状逻辑内联在 `src/client/markdown-props.ts`（勿改成 import）。
- **updateTab 序列**：`single: true` 的 dedupe 聚焦不覆写已开 tab 的 path，重复交付必须紧跟 `updateTab`（`features.includes('updateTab')` gate）+ `activateTab`。`meta.path` 随 tab 持久化，刷新后 PlanView 按 `meta.path` 重读。
- **文件读取走 better-sidebar 路由**：PlanView 用 `POST /sidebar/api/fs.read`（同源、浏览器已鉴权）；本插件不建自有 HTTP 读路由。
- **WS 栅栏**：`/better-plan/ws/delivery` 过 `isTrustedDeliveryRequest`（Host 回环 / trustedHosts / sec-fetch-site / Origin hostname）。`webRuntime` 为 optional 注入（`ctx.get`），缺席时仅回环可连。

## 文件职责

| 文件 | 职责 |
|------|------|
| `src/index.ts` | host 入口：遮蔽挂接、pre-step flush、WS 路由注册、service lifetime |
| `src/shadow-tool.ts` | 工具契约全部面：description / parameters / output schema+render / execute / presentCall / presentResult |
| `src/delivery-registry.ts` | per-session 推送队列（上限 8、consume-on-send、attach 回放） |
| `src/ws-route.ts` | `/better-plan/ws/delivery` 升级注册 + `attachDeliverySocket` |
| `src/trust-fence.ts` | 浏览器信任栅栏（对齐 /api 网关语义） |
| `src/resolve-cwd.ts` | header → persistence → process.cwd 解析链 |
| `src/first-heading.ts` | 原版同款首 heading 正则 + basename |
| `src/context.ts` | Context 结构化 face（intersection，勿改 augmentation） |
| `src/client/index.tsx` | Plan tab 注册 + 交付 WS 订阅（会话切换重连、失败退避）+ `applyDeliveryPush` |
| `src/client/PlanView.tsx` | 面板组件 + `planPathOf` + fs.read 封装 |
| `src/client/markdown-props.ts` | MarkdownText 双代 props（内联） |

## 已知约束

- 需要 better-sidebar ≥ v0.12.0 才有 updateTab/activateTab/meta 持久化；更老版本退化为 openTab dedupe 聚焦（首个交付仍正确落地）。
- presentCall 是 args-only 纯函数，卡片标题只能用 basename；首 heading 在 execute 内计算（进 WS push title）。
- 组合测试的 `agentWithSession` 仿照 plan-mode 官方 spec：fake Agent + 真 Session + `createScope` 铸造 agent ctx + `agents.enter/announce` + `agentEvents(...).emit('agent/session-start')`。
- 发布前过一遍根 AGENTS.md 的 SOP §0 合规自检（dshfind card、双语描述、topic `dsh-plugin` + `dsh-better-sidebar`）。
