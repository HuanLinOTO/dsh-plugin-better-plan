# better-plan 交付推送在 better-sidebar v0.19 原生右栏上丢失 Plan 面板（seed 去 path）设计

- 日期：2026-09-11
- 状态：已批准（用户选定方案 A）
- 受损组合：better-plan ≤ v0.5.1 + dsh-better-sidebar ≥ v0.19.0（DSH 0.1.5-rc.x 原生右栏）

## 1. 根因

`src/client/index.tsx` 的 `applyDeliveryPush` 以带 `path` 的 seed 打开 Plan tab：

```ts
service.openTab({ type: TAB_ID, id: TAB_ID, path: record.path, title, meta }, scope)
```

better-sidebar `51546f7`（v0.19.0 线，原生右栏改写）给 `service.openTab` 加了原生分支（`src/client/service.ts` L705-710）：**seed 带 `path` 一律改道 `surface.openResource(fileAddress(...))`**，而 `editor` 类型以 `extension` 优先级认领 `dsh-resource://file/**`（`src/client/native/index.ts` L179）——计划 markdown 因此被打开在文件编辑器 tab（路径输入框 + 预览/编辑 chrome），PlanView（审批动作栏所在）从未挂载。宿主侧 WS 视图已连接，`delivered: true`，聊天无降级弹窗；待决审批挂在 review gate 上无任何 UI 可结算。`updateTab(TAB_ID)`/`activateTab(TAB_ID)` 在原生面按 dockkit tab id 键控（`NativeTabRecords`），对旧版 `TAB_ID` 全部 no-op。

v0.18.x 自绘侧栏上该 seed 走 reducer 分支、以 `tab.path` 正常打开组件 tab——better-plan 真机走查在该版本线上完成，回归由此漏检。

## 2. 方案取舍

- **A（选定）— seed 去 path，路径只走 `meta`**：`PlanView.planPathOf` 本就优先读 `tab.meta.path`、回退 `tab.path`（PlanView.tsx L49-55），两面兼容。原生面走 `else` 分支变成页面型 openTab（params 带 title/meta），`revealIfOpened`（descriptor 无 createTab → true）经 dockkit 页面去重聚焦既有 tab。改动面最小，不依赖上游。
- B — 等 better-sidebar 上游改原生分支（组件型 tab 的 path seed 打开页面而非资源）：生态受益但发版不受控，期间审批面不可用；作为配套 issue 提出。
- C — 按 `features`/`version` 探测分支 seed 形状：两面行为分叉，测试面翻倍，无收益，弃。

## 3. 改动

1. **`src/client/index.tsx` — `applyDeliveryPush`**：seed 去掉 `path` 字段；`meta: { path, deliveredAt }` 保留（PlanView 读它，且随 tab 进 localStorage 持久化，刷新可恢复）。注释写明原生面 path seed = 文件资源打开（editor 认领），组件 tab 禁止 seed path。`updateTab`/`activateTab` 调用保留（无 surface 的旧版面上仍是内容刷新/聚焦机制；原生面上按记录 id 键控、对 `TAB_ID` 是无害 no-op）。
2. **`src/client/PlanView.tsx`**：fs.read effect 依赖加 `review?.id`。重复交付通常写同一个日期+主题命名文件，原生页面去重不会刷新已挂载记录的 meta（`NativeTabRecords.ensure` 的导航合并只认 path/diff/url，不认 meta），新审批 id 到达即重读文件，修掉「同名文件改写后正文不刷新」（旧面上 `updateTab` 写同路径字符串同样不触发重跑，属既有缺陷，一并修复）。
3. **测试**：
   - `tests/client/delivery.spec.ts`：断言 openTab seed 不含 `path`、`meta.path` 为计划绝对路径。
   - `tests/client/plan-view.spec.tsx`：新增「review id 变化触发重读」用例。
4. **文档**：README「侧边栏展示」「刷新可恢复」两处的 seed 契约措辞；补一行前置说明（better-sidebar v0.19 原生面：带 path 的 openTab 会打开文件编辑器，组件 tab 携带路径只能走 meta）。插件 AGENTS.md 的「updateTab 序列」锚点同步。

## 4. 验证

```sh
pnpm run typecheck   # host + client 两面
pnpm test            # 14 个 spec 文件
pnpm run build       # 预构建 lib/（入库），link: 安装下即生效
```

收尾：重启 `dsh web` + 浏览器硬刷新；真机走查一次计划交付（Plan tab + 审批栏出现，批准 steer 回对话）。

## 5. 上游 issue（omdsh-dev/DSH-better-sidebar）

报告原生分支 L705-710 对组件型 tab 的 path seed 无差别改道 `openResource`，与指南 §4 `TabDescriptor`（dedupe 按 `tab.path`、组件经 `tab.path` 取种子）及 §7 WebDocsView 示例矛盾；建议非 editor 类型保留页面型打开、path 进 params。附 better-plan v0.5.1 作为受损消费者与复现步骤。
