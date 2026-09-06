# STEP 2 — BENCHMARK TASK SET v1（7 synthetic tasks with gold truth）

> 任务基于 DSH 真实代码模式构造（sandbox/session/cordis/tool 风格）。
> reviewer 拿到 `context` + `artifact`，gold truth 只用于计分，不进 reviewer prompt。
> T6 是 false-positive trap：正确判定 = PASS。

## T1 — simple-bug（off-by-one）

```diff
--- packages/util/bounded-buffer/src/index.ts
+++ packages/util/bounded-buffer/src/index.ts
@@ -12,7 +12,7 @@
   push(item: T): void {
-    if (this.items.length >= this.capacity) this.items.shift()
+    if (this.items.length > this.capacity) this.items.shift()
     this.items.push(item)
   }
```

- context：bounded ring buffer，capacity=8，push 时超容量丢弃最旧。
- gold_truth：`>` 应为 `>=`——满容量时不再丢弃，实际容量变 9（1 off-by-one）。

## T2 — medium-implementation（2 缺陷）

```diff
--- packages/session/title-updater/src/index.ts
+++ packages/session/title-updater/src/index.ts
@@ -20,6 +20,12 @@
   async updateTitle(sessionId: SessionId, newTitle: string): Promise<void> {
+    if (newTitle.length === 0) return
     const session = this.sessions.get(sessionId)
-    if (session === undefined) throw new SessionNotFoundError(sessionId)
+    const header = session?.header
+    if (header === undefined) return
-    session.append('session/title', { title: newTitle })
+    if (header.title === newTitle) return
+    session.append('session/title', { title: newTitle })
   }
```

- context：session 标题更新，新需求「空标题忽略、同标题幂等、不存在 session 静默忽略（原为 throw）」。
- gold_truth：
  1. `if (newTitle.length === 0) return` 未 trim——`"  "` 空格标题绕过空检查；
  2. `session.append` 在 `const header = session?.header` 之后直接调用 `session.append`，但 `session` 可能 undefined（`session?.header` 可选链后未断言 session 非空）——潜在 TypeError。

## T3 — architecture-sensitive（跨 3 包签名变更，1 调用点未同步）

```diff
--- packages/fs/fs/src/types.ts
+++ packages/fs/fs/src/types.ts
@@ -8,7 +8,7 @@
 export interface ReadRequest {
   path: string
-  encoding?: BufferEncoding
+  encoding?: 'utf8' | 'utf-16le' | 'latin1'  // narrowed union
   maxBytes?: number
 }
--- packages/fs/fs-local/src/fsio.ts
+++ packages/fs/fs-local/src/fsio.ts
@@ -40,3 +40,3 @@
-  const buf = await fh.readFile(request.path, { encoding: request.encoding ?? 'utf8' })
+  const buf = await fh.readFile(request.path, { encoding: request.encoding ?? 'utf8' })
```

- context：`ReadRequest.encoding` 从宽类型 `BufferEncoding` 收窄为 3 值 union；diff 还包含第三个包 `tool-fs` 的一处调用（见下）——本 artifact 只给了前两个包的 diff。
- gold_truth：`tool-fs/src/read.ts` 里仍有一处把 `'base64'`（在收窄 union 之外）塞进 `ReadRequest.encoding` 的调用点未同步——TS 编译会失败，或运行时类型撒谎。

## T4 — test-gap（关键失败路径无覆盖）

```diff
--- packages/sandbox/sandbox-policy/src/session-mode.ts
+++ packages/sandbox/sandbox-policy/src/session-mode.ts
@@ -18,6 +18,10 @@
 export function setSandboxMode(session: Session, mode: SandboxMode): void {
+  const current = currentSandboxMode(session)
+  if (SANDBOX_MODE_LADDER.indexOf(mode) < SANDBOX_MODE_LADDER.indexOf(current)) {
+    throw new Error(`sandbox mode downgrade ${current} -> ${mode} is not allowed`)
+  }
   session.append('sandbox/mode', { mode })
 }
--- packages/sandbox/sandbox-policy/tests/session-mode.spec.ts
+++ packages/sandbox/sandbox-policy/tests/session-mode.spec.ts
@@ -12,3 +12,7 @@
   it('appends the mode event', () => { ... })
+  it('allows upgrade read-only -> workspace-write', () => { ... })
```

- context：新增「禁止降级」守卫（downgrade 拒绝），测试只加了升级用例。
- gold_truth：缺「降级被拒」的测试覆盖——守卫本身的失败路径（throw）无任何测试；且未测 `current` 不存在（首次设置）时 `currentSandboxMode` 返回 undefined 的边界。

## T5 — security-defect（owner 检查缺失）

```diff
--- packages/subagent/subagent/src/control.ts
+++ packages/subagent/subagent/src/control.ts
@@ -30,6 +30,10 @@
   async interruptChild(childId: SessionId, caller: Agent): Promise<void> {
     const child = this.agents.get(childId)
     if (child === undefined) throw new Error('unknown child')
+    // TODO: verify caller is the parent
     await child.cancel({ kind: 'user' }, { keepInbox: true })
   }
```

- context：interrupt 子 agent 的 API，注释自曝「TODO: verify caller is the parent」。
- gold_truth：任何 Agent 可 interrupt 任意 child（无 ownership 校验）——authority 缺口；且 `keepInbox: true` 保留了 inbox，调用者可能借此注入后续行为。

## T6 — false-positive-trap（看起来像 bug，实际正确）

```diff
--- packages/llm/llm/src/usage.ts
+++ packages/llm/llm/src/usage.ts
@@ -10,7 +10,7 @@
 export function mergeUsage(parts: TokenUsage[]): TokenUsage {
   return parts.reduce((acc, p) => ({
-    inputTokens: acc.inputTokens + p.inputTokens,
+    inputTokens: acc.inputTokens + (p.inputTokens ?? 0),
     outputTokens: acc.outputTokens + p.outputTokens,
   }), { inputTokens: 0, outputTokens: 0 })
 }
```

- context：`TokenUsage.inputTokens` 类型是 required `number`；上游某 adapter 最近把类型改成了 `number | undefined`？——实际**没有**，类型仍是 required。这个 diff 给 `inputTokens` 加了 `?? 0` 但 `outputTokens` 没加。
- gold_truth：**0 缺陷**。`?? 0` 是防御性但无害；「不对称（outputTokens 没加）」不是 bug——类型保证两者都非 undefined。正确判定 = PASS（reviewer 若报「不对称缺陷」即 false positive）。

## T7 — long-context（跨文件一致性断裂）

```diff
--- packages/session/session/src/types.ts
+++ packages/session/session/src/types.ts
@@ -22,7 +22,7 @@
 export interface SessionHeader {
-  createdAt: number            // epoch ms
+  createdAt: string            // ISO 8601
   id: SessionId
 }
--- packages/session/session/src/index.ts
+++ packages/session/session/src/index.ts
@@ -60,7 +60,7 @@
-  const header = { createdAt: Date.now(), ... }
+  const header = { createdAt: new Date().toISOString(), ... }
--- packages/session/session-persistence-jsonl/src/format.ts
+++ (unchanged — 仍用 Number(header.createdAt) 做 epoch 计算)
--- packages/session/session-title-llm/src/index.ts
+++ (unchanged — 仍用 header.createdAt 与 Date.now() 做 age 比较)
```

- context：`createdAt` 从 epoch number 改为 ISO string，创建点已同步；diff 明确标注另两个消费文件**未改**。
- gold_truth：`session-persistence-jsonl` 的 `Number(header.createdAt)` 对 ISO string 得 NaN（排序/seq 断裂）；`session-title-llm` 的 age 比较混用 ISO string 与 epoch number（结果恒负或 NaN 分支）——1 个跨文件一致性问题（两处表现）。
