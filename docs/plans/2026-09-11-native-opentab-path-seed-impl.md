# better-plan 交付推送 seed 去 path（better-sidebar v0.19 原生面适配）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付推送的 openTab seed 去掉 `path`（计划路径只走 `meta.path`），让 Plan tab（审批面）在 better-sidebar v0.19+ 原生右栏上重新出现；重复交付由新审批 id 触发正文重读。

**Architecture:** 纯 client 侧两处小改：`applyDeliveryPush` 的 seed 形状（`src/client/index.tsx`）与 PlanView 的 fs.read effect 依赖（`src/client/PlanView.tsx`）。宿主半部与审批流不动。预构建 `lib/` 入库策略——改完必须重建并提交 `lib/`。

**Tech Stack:** TypeScript + React 18（client），vitest + @testing-library/react（jsdom 组件测试），tsdown 构建。

**Spec:** `docs/plans/2026-09-11-native-openTab-path-seed-design.md`

## Global Constraints

- 插件目录：`D:\Projects\deepseek-harness\dsh-plugin-better-plan`（下述相对路径均以此为根）。
- client 半部禁止 value-import 其他插件/宿主内部模块（client 纯度门）。
- `applyDeliveryPush` 的 `socket.onmessage` 调用方有 `try { } catch { }` 静默兜底——任何抛错都表现为"面板不出现"，测试必须直接调纯函数断言 seed 形状。
- 构建产物 `lib/` 入库（预构建策略），`pnpm run build` 后须 `git add lib/`。
- 模型契约文本恒英文；本计划不触碰 `src/locale.ts` / `src/shadow-tool.ts`。

---

### Task 1: 交付推送 seed 去 path（applyDeliveryPush）

**Files:**
- Modify: `src/client/index.tsx:40-72`（模块 doc、`applyDeliveryPush` doc 与函数体）
- Test: `tests/client/delivery.spec.ts:17-60`（三个用例的期望值）

**Interfaces:**
- Consumes: 无变化（`BetterSidebarService.openTab/updateTab/activateTab`、`features` gate）。
- Produces: `applyDeliveryPush(service, payload, sessionId)` — openTab seed 形状变为 `{ type: TAB_ID, id: TAB_ID, title?, meta: { path, deliveredAt } }`（无 `path` 字段）；`updateTab` patch 变为 `{ title?, meta }`（无 `path`）。后续任务与 README 描述以此为准。

- [ ] **Step 1: 改期望，写失败断言**

`tests/client/delivery.spec.ts` 三个用例改为（第 18-41、49-60 行两处）：

```ts
  it('opens the single Plan tab with the meta-carried path (no path seed), then updates and activates (v0.12+ service)', () => {
    const service = fakeService(['updateTab', 'openFile'])
    applyDeliveryPush(service as never, { id: 'd1', path: '/repo/docs/plans/p.md', title: 'The plan' }, 's1')
    expect(service.openTab).toHaveBeenCalledExactlyOnceWith(
      {
        type: TAB_ID,
        id: TAB_ID,
        title: 'The plan',
        meta: { path: '/repo/docs/plans/p.md', deliveredAt: expect.any(Number) },
      },
      { sessionId: 's1' },
    )
    expect(service.updateTab).toHaveBeenCalledExactlyOnceWith(
      TAB_ID,
      {
        title: 'The plan',
        meta: { path: '/repo/docs/plans/p.md', deliveredAt: expect.any(Number) },
      },
    )
    expect(service.activateTab).toHaveBeenCalledExactlyOnceWith(TAB_ID, { sessionId: 's1' })
    expect(service.calls.map(call => call.method)).toEqual(['openTab', 'updateTab', 'activateTab'])
  })
```

```ts
  it('omits an empty/missing title from both the seed and the update patch', () => {
    const service = fakeService(['updateTab'])
    applyDeliveryPush(service as never, { path: '/p.md' }, 's1')
    expect(service.openTab).toHaveBeenCalledExactlyOnceWith(
      { type: TAB_ID, id: TAB_ID, title: undefined, meta: { path: '/p.md', deliveredAt: expect.any(Number) } },
      { sessionId: 's1' },
    )
    expect(service.updateTab).toHaveBeenCalledExactlyOnceWith(
      TAB_ID,
      { meta: { path: '/p.md', deliveredAt: expect.any(Number) } },
    )
  })
```

并在第一个 `describe` 末尾补一个防回归用例：

```ts
  it('never seeds path on the open (the native surface would route it to the file editor)', () => {
    const service = fakeService(['updateTab'])
    applyDeliveryPush(service as never, { path: '/p.md', title: 'T' }, 's1')
    const [seed] = (service.openTab as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>]
    expect(Object.hasOwn(seed, 'path')).toBe(false)
    expect((seed.meta as { path?: string }).path).toBe('/p.md')
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- tests/client/delivery.spec.ts`
Expected: FAIL（seed 里仍有 `path`，`Object.hasOwn(seed, 'path')` 为 true / 对象不匹配）。

- [ ] **Step 3: 实现**

`src/client/index.tsx`：

模块 doc 第 8-9 行段落 `Because the dedupe focus does NOT overwrite an already
open tab's path, every push is followed by ...` 整段替换为：

```
 * The path rides ONLY in the tab `meta` (`meta.path`): on the native right
 * sidebar (better-sidebar v0.19+) an openTab seed carrying `path` is routed to
 * `openResource`, where the editor type claims `dsh-resource://file/**` — the
 * plan would open in the file editor and the Plan tab (the approval surface)
 * would never mount. PlanView reads `meta.path` first (`planPathOf`), and
 * `meta` rides the tab into better-sidebar's localStorage persistence.
 * Because the native page open dedupes by kind (an existing tab keeps its
 * seed fields), every push is still followed by `updateTab` (feature-gated,
 * v0.12.0+) and `activateTab` — they carry the refresh on the pre-0.19
 * sidebar and are harmless no-ops on the native one.
```

`applyDeliveryPush` 的 doc 块（`@param` 之间）与函数体替换为：

```ts
/**
 * Apply one delivery push to the sidebar: open (or focus) the Plan tab, then
 * overwrite its content via updateTab and focus it (both v0.12.0+; on an
 * older host the plain openTab dedupe-focus still lands the FIRST delivery).
 * The plan path travels in `meta.path` only — a path-carrying seed would open
 * the file editor on the native right sidebar instead of this tab.
 * @param service - the better-sidebar service.
 * @param payload - the parsed WS frame.
 * @param sessionId - the session the socket is subscribed to.
 */
export function applyDeliveryPush(service: BetterSidebarService, payload: unknown, sessionId: string): void {
  if (payload === null || typeof payload !== 'object') return
  const record = payload as { path?: unknown; title?: unknown }
  if (typeof record.path !== 'string' || record.path === '') return
  const title = typeof record.title === 'string' && record.title !== '' ? record.title : undefined
  // meta.path is PlanView's read source (planPathOf prefers it) and the
  // persistence key a refresh restores from — the seed itself stays path-less
  // (native surface: a path seed opens the file editor, not this tab).
  const meta = { path: record.path, deliveredAt: Date.now() }
  const scope = { sessionId }
  service.openTab({ type: TAB_ID, id: TAB_ID, title, meta }, scope)
  const features = service.features
  if (Array.isArray(features) === true && features.includes('updateTab') === true) {
    service.updateTab(TAB_ID, { ...(title !== undefined ? { title } : {}), meta })
    service.activateTab(TAB_ID, scope)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- tests/client/delivery.spec.ts`
Expected: PASS（含防回归用例）。

- [ ] **Step 5: 提交**

```bash
git add src/client/index.tsx tests/client/delivery.spec.ts
git commit -m "fix(client): deliver the plan path via meta only — the native sidebar opens path seeds in the file editor"
```

### Task 2: PlanView 以新审批 id 触发正文重读

**Files:**
- Modify: `src/client/PlanView.tsx:177-191`（fs.read effect 的依赖数组及注释）
- Test: `tests/client/plan-view.spec.tsx:68-130`（`PlanView` describe 内新增一例）

**Interfaces:**
- Consumes: Task 1 的 meta.path 交付（`planPathOf` 不改，仍 meta 优先）。
- Produces: 无导出面变化；行为契约 = `review?.id` 变化 ⇒ 重新 fs.read 当前路径。

- [ ] **Step 1: 写失败测试**

`tests/client/plan-view.spec.tsx` 的 `describe('PlanView', ...)` 内、`'flags a binary read result…'` 用例之前插入：

```ts
  it('re-reads the plan file when a new review id arrives (a re-delivery rewrites the same file)', async () => {
    const fetchMock = stubUrlFetch([
      { ok: true, value: { kind: 'text', content: '# Draft', truncated: false } },
      { ok: true, value: { kind: 'text', content: '# Revised', truncated: false } },
    ])
    reviewStore.set({ id: 'r1', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    render(createElement(PlanView, tabProps()))
    await waitFor(() => {
      expect(screen.getByTestId('markdown').textContent).toBe('# Draft')
    })
    // The model revised the same conventional file and re-delivered: a new
    // pending review id is the only signal a mounted native tab gets.
    reviewStore.set({ id: 'r2', path: '/repo/meta.md', title: 'The plan', status: 'pending' })
    await waitFor(() => {
      expect(screen.getByTestId('markdown').textContent).toBe('# Revised')
    })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith(REVIEW_API_PATH))).toHaveLength(1)
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test -- tests/client/plan-view.spec.tsx`
Expected: FAIL（重读未触发，markdown 仍是 `# Draft`）。

- [ ] **Step 3: 实现**

`src/client/PlanView.tsx` 的 fs.read effect（现 L177-191）改为：

```ts
  useEffect(() => {
    if (path === undefined) {
      setLoad({ status: 'error', message: t('noPath') })
      return
    }
    const controller = new AbortController()
    setLoad({ status: 'loading' })
    fsRead(scope.sessionId, path, controller.signal)
      .then((result) => { setLoad({ status: 'ok', ...result }) })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setLoad({ status: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => { controller.abort() }
  }, [path, scope.sessionId, attempt, review?.id])
```

（唯一变化是依赖数组加 `review?.id`，并在数组上方加一行注释：`// A re-delivery rewrites the same conventional filename; the native page dedupe never refreshes a mounted record's meta, so a new review id is the re-read trigger.`）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test -- tests/client/plan-view.spec.tsx`
Expected: PASS（全部既有用例不回归）。

- [ ] **Step 5: 提交**

```bash
git add src/client/PlanView.tsx tests/client/plan-view.spec.tsx
git commit -m "fix(client): re-read the plan file when a new review id arrives (re-delivery rewrites the same file)"
```

### Task 3: 文档同步 + 三件套 + lib/ 重建

**Files:**
- Modify: `README.md:14,21,92`
- Modify: `AGENTS.md`（机制锚点「updateTab 序列」条目）

- [ ] **Step 1: README 三处**

L14 条目末尾追加一句：

```markdown
推送 seed 不带 `path`——计划路径只放 `meta.path`（better-sidebar v0.19+ 原生右栏把带 `path` 的 openTab 一律按文件资源打开、由 editor 类型认领，Plan tab 会因此根本不出现；组件 tab 携带路径必须走 meta）。
```

L21 条目改为：

```markdown
- **刷新可恢复**：计划路径随 tab `meta` 进 better-sidebar 的 localStorage 持久化，刷新后 Plan 面板按 `meta.path` 重读文件；重复交付（同一约定文件名改写后再推）由新审批 id 触发 PlanView 重读。
```

L92 前置行改为：

```markdown
安装后重启 `dsh web`，浏览器硬刷新（`Ctrl+Shift+R`）。前置：profile 内安装 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（v0.12.0+；v0.19.0 原生右栏起交付推送必须为本修复之后的版本——seed 带 `path` 会被打开成文件编辑器；未安装时插件照常工作，走全文降级路径）。
```

- [ ] **Step 2: 插件 AGENTS.md 锚点同步**

「机制锚点」的 `**updateTab 序列**` 条目整条替换为：

```markdown
- **交付推送 seed 不带 path**：better-sidebar v0.19+ 原生右栏把带 `path` 的 openTab 一律改道文件资源打开（editor 认领 `dsh-resource://file/**`），Plan tab 不出现——计划路径只放 `meta.path`（`planPathOf` 优先读 meta）；旧自绘面靠 `updateTab`（`features.includes('updateTab')` gate）+ `activateTab` 刷新/聚焦（原生面上二者按 dockkit tab id 键控、对 `TAB_ID` 是无害 no-op）。重复交付写同一约定文件名时原生页面去重不刷新已挂载记录的 meta，PlanView 以新审批 id 作为重读触发。`meta.path` 随 tab 持久化，刷新后按 `meta.path` 重读。
```

- [ ] **Step 3: 三件套**

```bash
pnpm run typecheck   # host + client 两面
pnpm test            # 全量 14 个 spec
pnpm run build       # tsdown + tsc → lib/
```

Expected: 全绿。`lib/client.js` 以 `window.__ModuleLoader__.load({ id: ... })` 包裹不变。

- [ ] **Step 4: 提交（含 lib/）**

```bash
git add README.md AGENTS.md lib/
git commit -m "docs: note the meta-carried plan path and the v0.19 native-surface delivery contract; rebuild lib"
```

---

## Self-Review

- 覆盖：设计 §3 的 4 条改动 ⇒ Task 1（seed）、Task 2（重读）、Task 3（文档+构建）；测试两条各归其任务。✓
- 占位符：无 TBD/TODO；所有代码步骤含完整代码。✓
- 类型一致：`applyDeliveryPush` 新 seed 形状在 Task 1 测试、模块 doc、README/AGENTS 措辞三处一致（`meta: { path, deliveredAt }`，无 `path`）。✓
