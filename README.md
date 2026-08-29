<p align="center">
  <a href="https://dshfind.com/zh/plugins/huanlinoto/dsh-plugin-better-plan"><img src="https://dshfind.com/api/card/huanlinoto/dsh-plugin-better-plan?lang=zh" alt="dsh-plugin-better-plan card"></a>
</p>

# dsh-plugin-better-plan

一个取代 DSH 内置 plan mode「计划交付体验」的插件：计划交付不再把全文渲染进聊天悬浮卡片，而是**先写成 markdown 文件，再经 better-sidebar 的专属「计划」面板展示，并在侧边栏完成审批**——计划送达侧边栏后对话直接停下，聊天里不弹审批卡；用户在 Plan 面板审阅全文后点 Approve / Keep planning 按钮。

> Replaces the built-in plan mode's plan delivery: plans are written to a markdown file first and shown in the better-sidebar **Plan panel**, where the approval happens — a delivered plan parks the conversation with no popup in chat; the user reviews the full plan in the panel and clicks Approve / Keep planning there.

## 功能

- **文件先行**：内置 `exit_plan_mode` 的参数是完整计划正文；本插件以**同名工具逐 agent 遮蔽替换**（`agent/session-start` → `agent.ctx.tools.register`，跨 scope 层遮蔽 preset 挂载的原版），新契约只有一个 `path` 参数——模型先用 `write` 工具把完整计划写成 markdown，再传路径。
- **侧边栏展示**：工具读取计划文件，经自有 `/better-plan/ws/delivery` WebSocket 推送到会话的 Plan tab（`order: 15`，single 单实例）；正文用 DSH `MarkdownText` 渲染（双代 chrome labels prop 通吃 0.1.1-rc.x / 0.1.2-alpha.1+）。
- **侧边栏审批（送达时无聊天弹窗、对话直接停止）**：推送送达已连接的侧边栏视图后，工具**立即返回**「计划已呈现，请结束回合」——模型收尾结束对话，聊天里既没有审批卡也没有挂起的调用卡片。用户在 Plan 面板的动作栏审阅全文后点 **Approve** / **Keep planning**（可附反馈文本），决定经 `POST /better-plan/api/review` 回到宿主端：批准 → 立即落 `plan/mode: false` 并以 `agent.steer` 开启新回合让模型开始执行；保留 → 反馈经 steer 开新回合回给模型修改。审批语义与模式切换语义与原版一致。
- **提示词面对齐**：preset 的 `plan:policy` 提示段仍是原版措辞（内联传正文 + 禁止写文件，且宣称压过工具描述），与本插件的工具契约直接冲突。本插件注册 `system-prompt/assemble` waterfall 监听器（逐 agent，挂在 agent scope 上——assemble 派发 key 就是 agent），把该段四处原版契约句子就地改写为文件先行契约：交付句改写为**同回合两步强制交付**（先写 `docs/plans/YYYY-MM-DD-<topic>.md`——日期 + 主题短横线命名，再立即调 `exit_plan_mode`）；原版「exit_plan_mode 是该回合唯一且最后的工具调用」句同步改写（否则模型把已发生的 write 视作违反该句，写完文件就停）；写禁句与规则压治句各带豁免。锚点句子只在计划模式激活时出现，无需自管状态。
- **无侧边栏降级**：推送未送达（better-sidebar 未安装或面板视图未连接）时，回退为**原版阻塞审批卡**——`userQuestions.ask` + `plan-review` 意图在聊天里渲染（detail 是完整计划全文），批准后原样在回合内继续。
- **审批状态双通道**：WS `review` 帧实时广播（多窗口同步、attach 回放恢复刷新）；Plan 面板挂载时再经 `GET /better-plan/api/review` 引导拉取一次（防丢帧；store 已有活动状态时让位，不会误清）。
- **i18n（跟随 DSH 语言，zh/en）**：面向用户的文案双语——侧边栏 Plan 面板与 tab 标题注册进 DSH 共享 locale 注册表（命名空间 `betterPlan`），跟随 Host-backed 语言偏好实时切换；宿主端文案（交付结果的 render 文本、steer 消息、无侧边栏审批弹窗）按会话解析 locale——config `locale` 覆盖 → 连接视图上报的 locale（WS connect 查询参数 + 审批请求携带浏览器当前 DSH 语言）→ 英文。**模型契约文本保持英文**（工具 description、`plan:policy` 改写、execute 错误指引）。审批路由的错误响应带稳定 `code`，面板按 code 映射本地化文案，未知 code 回退原文。
- **刷新可恢复**：计划路径随 tab `meta` 进 better-sidebar 的 localStorage 持久化，刷新后 Plan 面板按 `meta.path` 重读文件。

## 开发

### 仓库结构

```
src/
├── index.ts               # host 入口: name/inject/Config/apply + 遮蔽挂接 + pre-step flush + WS/HTTP 路由
├── config.ts              # Config schema (Schemastery, strict) + resolveBetterPlanConfig
├── context.ts             # 插件视角的 Context face（cordis Context ∩ 结构化服务面）
├── shadow-tool.ts         # 同名 exit_plan_mode 工具定义（execute / render / presentCall / presentResult）
├── review-gate.ts         # 审批门：per-session 停靠 + decide/attach 回放/abort/dispose 结算
├── review-route.ts        # POST /better-plan/api/review（信任栅栏 + 体校验 + 陈旧 id 守卫）
├── delivery-registry.ts   # per-session 推送队列 + 视图 attach（consume-on-send，队列上限 8）
├── ws-route.ts            # /better-plan/ws/delivery 升级路由 + tagged 帧（deliver/review）+ socket attach
├── trust-fence.ts         # Host 回环 / trustedHosts 浏览器信任栅栏（对齐 /api 网关语义）
├── locale.ts              # locale 词表 + 会话级解析链（config → 视图上报 → en）+ 宿主端双语文案
├── resolve-cwd.ts         # 会话 cwd 解析链（header → persistence → process.cwd）
├── first-heading.ts       # 计划首 heading 提取（原版同款正则）+ basename
└── client/
    ├── index.tsx          # client 入口: Plan tab 注册 + locale 词典注册 + 交付 WS 订阅 + tagged 帧分发
    ├── PlanView.tsx       # 面板组件：状态头 + 审批动作栏 + MarkdownText 正文 + 加载/错误/重试
    ├── locales.ts         # 面板双语词典（ctx.locale 注册 + 模块级 t()）+ 路由错误 code 映射
    ├── review-store.ts    # 审批状态外部 store + submitReviewDecision（POST 回宿主端，携带 locale）
    ├── markdown-props.ts  # 双形状 MarkdownText props（内联，不得 value-import better-sidebar 内部）
    └── icons.tsx          # 内联 SVG 图标
tests/
├── composition.spec.ts    # 组合层：真实 ToolRuntime/AgentRegistry/UserQuestionService 驱动 execute 全分支（含侧边栏审批流）
├── locale.spec.ts         # locale 目录/解析链/双语文案
├── shadow-tool.spec.ts    # 工具契约：description / 紧凑卡投影 / render 双分支 / finalizeContent 本地化
├── review-gate.spec.ts / review-route.spec.ts
├── delivery-registry.spec.ts / ws-route.spec.ts / trust-fence.spec.ts / resolve-cwd.spec.ts / first-heading.spec.ts
└── client/
    ├── delivery.spec.ts   # WS tagged 帧 → openTab/updateTab/activateTab + review store 喂给
    ├── plan-view.spec.tsx # PlanView 加载/错误/重试 + 审批动作栏 (jsdom)
    └── markdown-props.spec.ts
```

### 前置依赖

- Node.js >= 22、pnpm
- 本机 `~/.dsh/source/current` 指向 DSH 源码 checkout（0.1.2-alpha.1+，已构建）

### 三件套

```sh
pnpm install
# 建链 @deepseek-ai/* 与 dsh-better-sidebar 的 node_modules junction（见 AGENTS.md「环境搭建」）
pnpm run typecheck   # tsc --noEmit (host 面 + client 面)
pnpm test            # vitest run
pnpm run build       # tsdown 双 bundle + tsc 类型产物 → lib/
```

### 构建策略

**预构建 `lib/` 入库**（不含 `prepare` 脚本）。client 半部依赖 `@deepseek-ai/dsh-client-ui-primitives` 等 private 包，pnpm 在 git install 的 `prepare` 阶段会在临时目录拉不到这些包，所以 `lib/` 必须预构建并提交。改源码后需 `pnpm run build` + commit `lib/`。

## 运行

### 安装到 profile

```sh
# 本地开发（热更新）
dsh plugin --profile web add "link:D:/Projects/deepseek-harness/dsh-plugin-better-plan"

# 从 GitHub 安装（预构建 lib/，开箱即用）
dsh plugin --profile web add "github:huanlinoto/dsh-plugin-better-plan"
```

安装后重启 `dsh web`，浏览器硬刷新（`Ctrl+Shift+R`）。前置：profile 内安装 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（v0.12.0+；未安装时插件照常工作，走全文降级路径）。

### 配置（cordis.patch.yml 插件行 config）

| 字段 | 类型/默认 | 说明 |
|------|-----------|------|
| `planDir` | `string = 'docs/plans'` | 工具 description 中建议的计划目录 |
| `maxPlanBytes` | `number = 262144` | 计划文件读取上限；超限拒绝并提示精简 |
| `locale` | `'auto' \| 'zh' \| 'en' = 'auto'` | 宿主端用户可见文案的语言：`auto` 跟随连接视图上报的 locale（浏览器当前 DSH 语言），`zh`/`en` 强制指定；模型契约文本不受影响 |

不注入额外系统提示段——新契约全部由工具 description 携带（`plan:policy` 段保持原版原文，`exit_plan_mode` 名称未变故其陈述依然为真）。

## 检查

```sh
pnpm run typecheck   # 类型门禁（host + client 两个 tsc 面）
pnpm test            # 124 个单元/组合/组件测试
pnpm run build       # 产物: lib/index.js, lib/client.js (+ lib/types/*.d.ts)
```

### 合规自检

- [x] 零源码 patch：未修改 DSH checkout 任何文件（内置 plan-mode 行未触碰）
- [x] B1: `package.json` 声明 `dsh.bundle.patch`
- [x] B2: 自带 `cordis.patch.yml`（insert 行 id `better-plan` / name 用包名 / config 默认值齐全）
- [x] B3: patch 行 `name` 用包名（Loader 从 profile node_modules 解析）
- [x] F1: `files` 含 `lib/` + `cordis.patch.yml`
- [x] F2: `peerDependencies` 含 `@deepseek-ai/cordis` + 用到的 `@deepseek-ai/*`（全部 optional；市场约束的裸名 `cordis` 未出现）
- [x] F3: typecheck/test/build 三 script 齐全（无 `prepare`，预构建策略）
- [x] A4: Config 用 Schemastery `z.object`（strict，未知 key 拒绝）
- [x] A5: 部署可变值只有 `planDir` / `maxPlanBytes` 两个配置字段
- [x] A6: 不导出 default
- [x] C4/C9: 工具返回规范 JSON 值 + render 分离；presentCall/presentResult 纯函数（不读文件系统）
- [x] G: Unit + 组合（真实服务组合，临时目录真实文件 I/O）+ Client 组件三层
- [x] README 中文，含开发/运行/检查三节 + 顶部 dshfind card

### 与设计文档（docs/plans/2026-08-29-better-plan-plugin-design.md）的实施偏差

1. **规范值带 `delivered`**：canonical value 为 `{ approved: true, delivered: boolean }`（原版仅 `{ approved: true }`）。render 的「已展示于侧边栏计划面板」分支需要它，且 `sidebar_open` 先例（`delivered` 进规范值）支持该形状；`approved` 的 const 语义不变。
2. **presentCall 标题用 basename**：设计写「title = 计划首 heading ?? basename」，但 presentCall 是 args-only 纯函数（C9 回放约束），拿不到文件内容。首 heading 改为在 execute 内计算，用于 WS 推送的 tab 标题；聊天卡片标题 = 文件 basename。
3. **批准后的模式切换由本插件承载**：preset isolate realm 里的 `planMode` 服务对 agent ctx 不可见，无法直接驱动原版控制器的 `pendingIntents`。本插件以同机制补齐——`plan/mode: false` 延迟到下一个被接受的 `agent/pre-step` 边界 append（WeakSet 记账、append 失败保留重试、工具结果即叙述不额外注入）。语义与原版 execute 完全一致。
4. **WS 路由加了信任栅栏**：设计未提及；比照 better-sidebar 的路由防护补齐（Host 回环 / trustedHosts / sec-fetch-site / Origin hostname），防 DNS-rebinding 与跨站页面收割推送载荷。
5. **提示词面覆盖（真机走查发现）**：工具遮蔽生效后首测仍失败——preset 的 `plan:policy` 提示段教的是原版契约（「call exit_plan_mode with the complete plan markdown」+「Do not edit or write files」+「规则压过工具描述」），模型被两份矛盾指令夹住后写完文件直接收尾，从未调用交付工具。修复：`system-prompt/assemble` waterfall 监听器把该段三处句子就地改写为文件先行契约（`rewritePlanPolicySection` 锚点替换、幂等、缺锚跳过以兼容 preset 变体）。监听器必须逐 agent 注册在 `agent.ctx` 上——`assembleContextFor` 以 agent 为派发 key，scope 链准入只向上流，插件 fiber 上的全局注册会被过滤（测试固化了这一约束）。
6. **审批面从聊天卡迁到侧边栏 + 交付不再阻塞（真机走查反馈）**：设计 §1/§11 曾把「Plan tab 内 Approve/Refuse 按钮」列为 v1 非目标（审批留在聊天审批条）。真机走查后按用户要求推翻并迭代两步：(a) 首版把工具调用停靠在审批门上等决定——被走查否决：聊天里留下一个永远「运行中」的卡片，观感即卡死，且用户此刻输入无处落地。(b) 终版：**送达后工具立即返回** `decision: 'pending'`，render 指示模型结束回合（对话自然停止）；用户在 Plan 面板动作栏决定后，宿主端**立即落 `plan/mode: false`（回合间 append，与原版控制器空闲时行为一致；失败退回 pendingExits 边界重试）并 `agent.steer` 开启新回合**把批准/反馈告诉模型（`steer` 契约：空闲 driver 直接开回合）。未送达时仍回退原版阻塞弹窗（detail=完整计划全文）。关键机制事实：阻塞工具 ≠ 停止对话——停止对话的唯一自然形态是模型停止调用工具，工具结果文本就是那个指令。
7. **交付提示词二次加硬（真机走查反馈：模型光写文件不调工具）**：首轮提示词覆盖后模型仍写完计划文件就收尾、从不调用 `exit_plan_mode`。诊断出两处措辞缺陷：(a) 改写后的交付句以「When ready」开头——太软，模型自行判断「还没准备好」；(b) 致命的是原版**紧随其后的「Make exit_plan_mode the only and final tool call in that assistant response」句未被改写**——文件先行契约下 write 必然发生在 exit 调用之前，模型把已发生的 write 读成违反该句，于是直接停笔。修复（v0.2.1）：交付句改写为无条件**同回合两步强制契约**（写 `docs/plans/YYYY-MM-DD-<topic>.md`，日期+kebab-case 主题命名，紧跟 exit 调用；「写文件只是准备不是交付，写完不调工具的回合等于什么都没呈现」），final-call 句改写为「write 在前不失格，exit 是交付回合最后一个调用、其后无物」；工具 description 与 ENOENT 错误文本同步加硬（MANDATORY two-step + 命名示例 `2026-08-09-dsh-pet-rust-impl-spec.md`）。

## License

AGPL-3.0
