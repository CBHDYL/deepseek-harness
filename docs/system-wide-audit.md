# Final Convergence Audit and System Remediation Plan

审计日期：2026-08-24（第四轮，收敛轮）

方式：只读产品代码。在未跟踪的 `.audit-tmp/` 脚手架中构造 E1–E31 共 31 组实验（19 个 spec、75 个断言），全部通过真实插件装配、真实 ACP 桥、真实 JSON-RPC transport、真实 MCP client bridge 与真实 subprocess 运行；连续多次运行结果一致。未修改任何生产代码、配置或 fixture；未刷新任何 snapshot；未运行 `--update` / `test:snapshot:record` / `doc-sync`。

---

# 阶段一：Final Convergence Audit

## A. Final audit reconciliation

第四轮对前三轮的每条影响架构决策的结论做了独立复核。下表只列会改变设计的条目。

| 结论 | 前轮判定 | 第四轮 | 关键证据 | 等级 |
|---|---|---|---|---|
| 默认 profile 为 observe，副作用工具照常执行 | CONFIRMED | **CONFIRMED** | `packages/bundle/base/cordis.patch.yml:415-422`；`action-policy-guard/src/index.ts:89-101`；E18 | L4 |
| callId 复用击穿 `tools.guard()` fence | CONFIRMED | **CONFIRMED，且被 E31 精确限定** | E1 正反两例；E31 证明**普通管线路径**对重复 callId 仍会逐次询问，漏洞只在 pre-execute 短路路径 | L4 |
| 两套审批语义矛盾（批准后拒绝 / 一次调用两次问） | CONFIRMED | **CONFIRMED** | E16（prepend `ask` → 人已批准仍被 fence 拒）；E17（guard 先注册 → 两次 `approval/asked`） | L3 |
| 取消不终止 guard 审批 | CONFIRMED | **UPGRADED：会阻塞 teardown** | E9 turn 挂起；**E24 新增**：ACP `session/cancel` 后 prompt 不 settle，且 `dispose()` 3s 内未完成（`AUDIT-E24 disposal: hung`），而 core ask 路径 E23 正常 `disposed` | L3 |
| ACP approval cancellation 未传播 | UNPROVEN | **RESOLVED：core 路径正确，guard 路径致命** | E23 core ask：prompt settle 为 `cancelled`、工具未跑、client permission 请求仍挂着（一个孤儿 prompt，可接受）；E24 guard 路径：整条链挂死 | L3 |
| 直接 `ctx.fs`/`ctx.shell` caller 自选最终权限 | CONFIRMED | **CONFIRMED** | E7（自选 `danger-full-access` 越界写成功；仅放宽 `workspaceRoot` 亦成功；省略 policy 时**忽略 session 收紧**回落 deployment 默认）；E15（`ctx.shell.resolve()` 同构） | L3 |
| MCP 无 effects | CONFIRMED | **REFRAMED：不是漏洞，是正确的信任姿态** | **E28 新增**：server 伪造 `effects: 'read-only'` 与 `annotations.readOnlyHint` 均被完全忽略；**E29 新增**：MCP 工具在 enforce 默认下确实被 gate 并可拒绝 | L3 |
| MCP 输入 schema / description 无界 | 未覆盖 | **NEW / CONFIRMED** | E28：畸形 `type` 原样注册进模型可见 schema；500 KB description 无长度上界（工具数量有 `maxToolsPerServer` 上界） | L3 |
| JSONL 中段损坏静默截断 | CONFIRMED | **UPGRADED：损坏被伪装成正常 interrupted turn** | **E27 新增**：损坏后重启加载，`load()` 在被截断的前缀上合成 closers，日志以 `turn/end {reason:{kind:'interrupted'}}` 正常收尾，与真实中断**无法区分** | L3 |
| 崩溃恢复无完整性信号 | 部分 | **CONFIRMED** | E26：torn tail 重载成功且返回值不含 `integrity`/`truncated` 任何字段；真实 `kill -9` e2e（`crash-recovery.e2e.ts`）本轮实跑，仅因 attempt 事件断言不匹配而失败，崩溃语义本身正确 | L3 |
| cwd 恢复无重新验证 | CONFIRMED | **CONFIRMED** | E21（删除/symlink 换靶/换成文件均原样返回）+ E22（symlink cwd 成为合法 sandbox root） | L3 |
| telemetry 首投失败后丢失 | CONFIRMED | **CONFIRMED，为 documented at-most-once** | E3 四例；`session-telemetry/src/coordinator.ts:151-163` 明确写出 | L3 |
| projection 重叠 flush 丢失更新 | PARTIALLY | **CONFIRMED，但自愈** | E10 丢失更新且 dirty 归零；E12 冷读重折叠修复；存储 seq 诚实 | L3 |
| compaction 请求不可重建 | 已推翻 | **维持推翻** | E4 逐字段相等；残留问题是重建需 seq-aware（E5/E6） | L3 |
| request invariant 漏 provider/effort | 已推翻 | **维持推翻** | E19：dispatch 请求是已记录 header 的展开且 deepFreeze | L4 |
| subprocess 清理不完整 | 已推翻 | **维持推翻** | E20 五类故障全部正确 | L3 |
| SDK malformed JSON 静默忽略 | UNPROVEN | **RESOLVED：确认且量化** | **E25 新增**：畸形行、非对象帧、未匹配响应 id 全部静默丢弃且无诊断；**但**部分帧被正确缓冲、后续有效帧不失步；**notification handler 抛错不产生错误帧**（request handler 抛错则会） | L3 |
| 缺全局 prompt 预算 | UNPROVEN | **RESOLVED：确认缺失并量化** | **E30 新增**：50 KB persona + 40 个大 description 工具 + 200 KB 用户输入 → 单次请求 **1,053,485 字节**全额发出，无任何聚合裁剪 | L3 |
| hooks authority | UNPROVEN | **归类为 product decision** | `hook-protocol/src/runner.ts` 不接受 Agent/Session/policy；代码无法自证应然语义 | 不适用 |

## B. Remaining unknowns

以下仍未验证，且已判断**不值得在进入改造前继续验证**，理由随附：

1. **真实远程 MCP server 的传输层敌意行为**（TLS 中断、慢速攻击）。`syncTimeoutMs`/`maxSyncPages`/`maxToolsPerServer` 已有界（E28 验证其一），剩余风险属运维配置，不改变授权模型设计。
2. **Windows 平台的崩溃恢复与沙箱**。CI 有 Windows lane；本轮结论均为平台无关的语义问题（授权绑定、日志完整性、事件序号）。
3. **多进程并发写同一 session 日志**。`session-persistence/src/coordinator.ts` 用 stale-revision 重试处理；本轮未构造，但它不影响本轮的任何架构决策。
4. **OTel 导出端到端**。telemetry 已被判定为 best-effort observability（见 E-Target），其导出细节不进入核心不变量。
5. **hooks 应有的 authority**：这是产品决策，不是代码 finding。必须由人决定 hooks 是 session-scoped 还是 trusted-host，代码才有正确目标。

## C. Audit completeness judgment

- **Audit completeness confidence：高（约 85%）** —— 覆盖了授权、持久化、派生状态、事件模型、信任边界五条主轴；每条主轴都有 L3 级实验，且第四轮新增的 8 组实验（E23–E31）**没有推翻任何已有 root cause，只是把两个 UNPROVEN 变成 RESOLVED、把一个 finding（MCP effects）重新归类**。这是饱和信号。
- **Remaining unknown-risk surface：中等偏低。** 主要集中在平台矩阵（Windows）、远程传输敌意行为、多进程并发——三者都不改变本报告的目标架构。
- **Evidence saturation level：高。** 第二轮 0 组实验、第三轮 22 组、第四轮 9 组新增；新增实验的"每组新发现"产出率从第三轮的约 40% 降到本轮的约 22%，且本轮新发现全部落在**已知 root cause 的既有类别内**（E24 属授权取消、E27 属日志完整性、E28/E29 属信任边界、E30 属资源边界），没有开辟新类别。
- **是否建议继续通用审计：否。**
- **为什么：** 继续自由形式审计的边际产出已明显低于改造收益。当前五个 root cause 已经能解释本轮所有 31 个实验的行为；再找到的问题极可能是同一 root cause 的第 N 个表现，而这些表现会在 root fix 后一并消失。相反，最大的剩余不确定性是**"修复本身是否会引入更复杂的问题"**——这需要通过设计与实施来回答，而不是通过更多审计。

**GENERAL AUDIT COMPLETE**

## D. Root-cause model

前三轮列了五条 root cause。本轮复核后**合并为四条**，并明确指出第三轮的一处错误合并。

### RC-1 授权不是一个对象，而是一个可复用的字符串键

`ToolExecutionInput.callId`（`packages/core/tools/src/index.ts:326`）由调用方提供，是授权的唯一键（`action-policy-guard/src/index.ts:65,77,128`）。它不绑定工具名、参数、session、agent、scope，不消费，不过期。

由此派生的全部失效模式：跨工具重放（E1）、批准后拒绝（E16）、双重询问（E17）、取消不终止（E9/E24）、审计不能证明执行（E16 的日志显示 `allowed-once` 但工具没跑）。

**第三轮的错误合并**：第三轮把"权限最终决定权下放给调用方"（`sandboxPolicy?` 可选参数）与 RC-1 归为一类。本轮认为**必须拆开**——它们的修复方式完全不同：RC-1 需要一个授权对象的生命周期；沙箱授权需要的是**移除一个可选参数并让 policy owner 计算**。见 RC-2。

### RC-2 沙箱权限的最终计算权在调用方手上

`FileSystem.writeText(..., sandboxPolicy?)`（`packages/fs/fs/src/index.ts:222-249`）与 `ShellExecutor.resolve(request.sandboxPolicy?)`（`packages/shell/bash-sandbox/src/index.ts:84-86`）都把最终 policy 作为**可选入参**。两种滥用都已实测：显式传更宽的 policy（E7）、省略参数从而拿到 deployment 默认而绕过 session 收紧（E7 第 4 例、E15）。

这不是 RC-1 的表现：即使授权变成一次性对象，只要 `sandboxPolicy` 仍是可选入参，这条路径依然敞开。

### RC-3 缺失与损坏被建模为"更短的正确日志"

三处共用同一模式：

- JSONL 中段损坏 → 截断 → `load()` 合成 closers → 呈现为正常 interrupted turn（E13/E14/E27）。
- telemetry 首投失败 → cursor 被后续事件推进 → 记录永久消失（E3）。
- projection 重叠 flush → 旧值覆盖新值 → dirty 归零 → 无重试触发（E10）。

**这是最危险的一条**，因为它使不变量失效：agent-loop 的 request 不变量比较"当前日志的派生"与"当前请求"，日志变短时两者同步变短并继续通过。**不变量对一致的缺失是盲的。**

### RC-4 canonical sequence 是被过度共享的全局资源

`session.append()` 的 `seq` 同时服务：durable truth、model-visible 派生、`sourceEventSeqs` 引用、SDK wire、snapshot 期望输出。`ignorable: true`（`core/session/src/index.ts:607-609`）只让**未知类型的读取者**可以跳过，不让序号不占位。因此新增一个纯诊断事件会导致 132 个 fixture 全部漂移（第三轮 NEW-1，本轮 crash-recovery e2e 再次命中同一原因）。

### 不构成独立 root cause 的（本轮明确降级）

- **"缺全局预算"**（E30 量化的 1 MB 请求）：真实存在，但它是**能力缺失**而非架构缺陷，修复不需要改变任何现有语义。
- **"MCP 无 effects"**：E28 证明当前姿态是正确的——server 说什么都不采信。真正的缺口是 harness 侧没有把"MCP = 永远未声明"这一事实写进任何权威产物。

### 信任模型（本轮明确定义，不再用"同进程所以可信"带过）

| 主体 | 可以决定 | 不可以决定 | 当前是否符合 |
|---|---|---|---|
| trusted core（`core/*`、`session/*`、`sandbox-policy`） | 一切 | — | 是 |
| trusted in-process plugin（bundle 内、随发行版审阅） | 请求什么操作、提供工具实现 | 最终 sandbox mode、是否跳过审批 | **否**（E7/E15） |
| partially trusted plugin（用户从 cordis.yml 挂载的第三方） | 同上 | 同上，且不应能通过 pre-execute 短路绕过 fence | **否**（E1） |
| MCP server | 提供工具名/描述/schema、返回结果 | 自己的 effects 分类、名字空间之外的名称、无界 advertisement | **部分**（effects/名称正确；schema 与 description 无界） |
| hook process | 建议 deny / 附加 context | 提权、静默通过 enforcement | **未定义**（产品决策） |
| model-generated tool call | 请求哪个工具、什么参数、请求提权 | 自己的 callId 语义、绕过审批 | **否**（callId 是授权键，见 E1/E31） |
| subagent | 在其继承 scope 内操作 | 扩大自身 scope | 是（`subagent/README.md` 的委派策略已实现） |
| external ACP/SDK caller | 发起 prompt、取消、回答审批 | 代替 policy owner 决定权限 | 是 |

## 阶段一遗留：修复后才会出现的二阶问题

对每个拟议修复，本轮主动检查了它会制造什么新问题。

| 拟议修复 | 二阶风险 | 本轮证据/判断 | 缓解 |
|---|---|---|---|
| operation-bound 一次性授权 token | **重试语义破裂**：LLM 重试同一 tool call 时 callId 相同，一次性 token 会把合法重试变成拒绝 | E31 实测：模型两次发同一 callId 时，普通管线**已经**问了两次；说明"一次执行一次授权"是现有事实，token 只需与之对齐 | token 绑定 execution token（`ToolExecutionToken`，registry 自己铸造，`core/tools/src/index.ts:315-318`）而非 callId；每次 `execute()` 铸一个新的 |
| 单一授权点（合并 core ask 与 guard） | **审批重复消失后，hooks 的 `ask` 语义无处安放** | E16/E17 证明当前两点并存必然产生矛盾 | 保留 `ask` 作为**decision**，但只由 registry 一处调用 approval；guard 不再自己调 approval |
| policy-owner 计算 sandbox authority | **插件破坏**：任何现在传 policy 的调用点都要改 | `grep` 显示传 policy 的生产调用点集中在 `tool-fs`/`tool-bash`/`tool-str-replace-editor`/terminal，数量有限 | 把 `sandboxPolicy?` 从可选入参改为**必填的、由 policy owner 铸造的不可伪造值**；类型系统一次性暴露全部调用点 |
| corruption diagnostics | **旧 session 全部变成"未知完整性"** → 用户看到大量告警 | E27 显示当前无法区分，加上标记后**历史日志无标记**也无法区分 | 完整性状态用三值：`intact` / `repaired` / `unknown`；无 per-record 校验和的历史日志一律 `unknown`，UI 默认不打扰，仅在 `repaired` 时提示 |
| projection sequencing | **过度工程风险**：加锁/CAS/generation 三选一，容易全上 | E12 已证明冷读自愈，E10 的窗口只在活会话内 | 只做 **single-flight 串行化**（每 session 一条 promise 链），不引入 CAS 或 generation token |
| event taxonomy 拆分 | **replay 不兼容 + migration 成本** | `SESSION_FORMAT_VERSION = 0`（`core/session/src/types.ts:56`）且 AGENTS.md 明确"无兼容承诺" | 见 K 节：不拆 seq，改 fixture 生成方式（成本低一个数量级） |
| 全局 prompt budget | **静默截断历史 → 模型行为退化** | E30 的 1 MB 请求是极端构造，真实部署更接近上限而非超限 | 只做**可观测 + 硬上限拒绝**，不做静默裁剪；裁剪交给已有的 compaction |

---

# 阶段二：System Remediation & Modernization Plan

## E. Target architecture

### E-1 授权：一个 operation，一个 authority

引入三个不可变类型，全部住在 `packages/core/tools`（授权的天然所有者，因为它已经拥有 `ToolExecutionToken` 和执行调度）：

```
OperationIdentity   由 ToolRuntime 在 createExecution() 铸造
  token: ToolExecutionToken   // registry 私有 symbol，caller 无法伪造
  callId: CallId              // 保留，仅用于关联与展示
  name: string
  argsDigest: string          // sha256(canonical JSON)
  sessionId / agentId / scope
  parentToken?                // 嵌套/Code Mode 子派发

AuthorizationGrant  由 ApprovalService 签发，one-shot
  identity: OperationIdentity // 全等匹配才有效
  outcome: 'allowed-once'
  issuedAt / expiresAt

AuthorityContext    由 SandboxPolicyService 计算，不可由 caller 构造
  mode / workspaceRoot / sessionId
  brand: unique symbol        // 见下
```

**谁创建**：`ToolRuntime.createExecution()` 铸造 identity。
**谁签发**：`ApprovalService.request()` 返回 grant（而非裸字符串）。
**谁消费**：`ToolRuntime.guardReason()` 消费并作废。
**one-shot**：是。消费后从 map 移除。
**retry**：每次 `execute()` 铸新 token，因此重试天然重新授权——与 E31 观测到的现有行为一致，不是新语义。
**nested/subagent**：子派发携带 `parentToken`；策略是"父已授权则子在同一 token 树内免问"，这正是 Code Mode 现有的 `parent` 语义（`core/tools/src/index.ts:337-346`）的自然延伸。
**args digest**：需要。没有它，同名同 session 的不同参数（`rm -rf /` vs `ls`）共享授权。
**audit correlation**：`OperationIdentity.token` 的字符串投影作为 `operationId`，写入 `approval/asked`、`approval/decided`、`tool/call`、`tool/result` 四个已有事件的可选字段——**不新增事件类型**，因此不触发 RC-4 的 fixture 漂移。

### E-2 沙箱：intersection，不是 caller 选择

最终 policy = **deployment default ∩ session override ∩ tool requirement ∪ approved escalation**，全部由 `SandboxPolicyService.resolve()` 计算。

三个候选方案的比较见 I 节。选 intersection 而非 capability token 或 policy lattice 的理由：当前只有三个有序 mode（`read-only < workspace-write < danger-full-access`，见 `sandbox-policy/src/index.ts` 的 Config union），一个全序集上的 min 运算就是完整答案；lattice 需要偏序，当前没有偏序需求。

`sandboxPolicy` 参数从 `SandboxExecutionPolicy | undefined` 改为**branded 的 `ResolvedSandboxAuthority`**（用 `dsh-brand` 的 `Branded<'SandboxAuthority'>`，仓库已有此约定）。caller 无法构造 branded 值，只能从 `ctx.sandboxPolicy.resolve()` 取得。省略不再可能——参数变为必填。

**direct `ctx.fs` / `ctx.shell` 是否允许 caller 传最终 policy：不允许。** 它可以传一个 **request**（"我想要 workspace-write"），policy owner 返回 authority。这与仓库既有的 request/spec 分离模式一致（AGENTS.md：`dsh-shell` 的 request/spec split 是模板）。

### E-3 审批：一个调用点

- `ToolRuntime.serviceAsk()`（`core/tools/src/index.ts:1700-1740`）是**唯一**调用 `approval.request()` 的地方。
- `action-policy-guard` 不再自己调 approval；它降级为一个 **pre-execute 决策器**，对未声明/side-effectful 工具返回 `{kind:'ask'}`，由 registry 统一执行审批并签发 grant。
- `tools.guard()` 的单调 fence 保留，但检查 **grant 是否存在且匹配 identity**，而非 `approved.has(callId)`。
- 这一步同时消灭 E16（批准后拒绝：因为签发者与消费者是同一路径）与 E17（双重询问：因为只有一个调用点）。
- **生命周期**：`allowed-once` 绑定 identity、消费即失效；`rejected` 立即终止；`cancelled` 由 signal 触发（registry 已正确传 `exec.signal`，见 `core/tools/src/index.ts:1722` 与 E23）；**late response 天然被丢弃**，因为 `ApprovalService.decide()` 的 abort 竞速已经这样做（`user-approval/src/index.ts:331-343`）。
- **不引入** `allowed-session`：当前没有产品需求，且它会重新引入一个可复用凭证。

### E-4 持久化：截断必须留痕

JSONL 中段损坏的处理选 **truncate-with-diagnostic + integrity marker**，不选 fail-hard，不选 quarantine：

- fail-hard 会让一个坏字节毁掉整个会话，与"缓存可以 stale 但日志不能骗人"的目标冲突。
- quarantine 需要新的存储位置与生命周期，复杂度不成比例。
- 选定方案：`SessionLogScan` 增加 `integrity: 'intact' | 'repaired' | 'unknown'` 与可选 `truncatedAtLine`；`load()` 把它传到 `SessionSnapshot`；合成 closers 时**额外写一条 `session/repaired` durable 事件**记录截断位置与丢失行数。

这条新事件是**唯一**需要新增的事件类型，理由充分：它是恢复语义的一部分，必须持久（否则重启后又丢失），且必须模型可见（模型需要知道自己的历史不完整）。

**旧 session 兼容**：无 per-record 校验和的历史日志一律 `unknown`；这是诚实的，也不需要迁移。

### E-5 派生状态：single-flight，不是分布式共识

- **projection cache**：每 session 一条 `Promise` 链串行化 `flushSoft`。这直接消灭 E10 的丢失更新，代价是一行代码级的复杂度。
- **不做** CAS、generation token、版本向量：E12 已证明冷读自愈，剩余窗口只在活会话内且被 single-flight 完全关闭。
- **stale 语义**：保持"可以 stale，seq 说明有多 stale"，这个设计本身是对的（E10 实测存储 seq 诚实）。

### E-6 telemetry：明确定为 best-effort observability

判定依据：`session-telemetry/src/coordinator.ts:151-163` 的注释已经写明 at-most-once 是**有意选择**；E3 证明实现与文档一致。

因此：**不做** durable queue、不做 at-least-once、不做 Kafka。唯一改动是把"首次 deliver 失败即永久丢失"写进 `session-telemetry/README.md` 的 Known Limitations，并暴露一个失败计数供运维观测。

**如果**未来 telemetry 要作为合规审计证据，那时才引入 durable ledger——但那应该是一条独立的 audit 通道，不是把 observability 升级。

### E-7 事件模型：不拆 seq

判断：`ignorable` 事件**应当继续占用 canonical seq**。

理由：`sourceEventSeqs` 用 seq 做引用（`core/agent-loop/src/tool-calls.ts:303,328`），`interruptedTurnClosers` 用顺序推断开放状态（`core/session/src/repair.ts`），持久化用连续 seq 检测 gap（`session-persistence-jsonl/src/format.ts:364-373`）。把诊断事件移出 canonical 序列需要给它们**第二套**引用与 gap 检测机制——这是典型的"为了统一而拆分"。

真正的问题不是事件模型，是**fixture 的记录方式**：期望输出把绝对 seq 写死了。修复在测试基础设施侧（见 J 节），成本低一个数量级。

## F. Architectural invariants

改造后系统必须满足，且每条都可机器检查：

**AUTHORITY**

- A1 每个 side-effectful 执行至多消费一个 `AuthorizationGrant`，且该 grant 的 `OperationIdentity` 与执行全等。
- A2 `AuthorizationGrant` 消费后失效；同一 grant 不能授权第二次执行。
- A3 `AuthorityContext` 只能由 `SandboxPolicyService` 铸造；任何 caller 提供的值在类型层不可构造。
- A4 一次工具调用最多产生一对 `approval/asked`+`approval/decided`。
- A5 执行取消后，其审批在有限时间内 settle 为 `cancelled`，且不阻塞 turn 结束或 fiber disposal。
- A6 `approval/decided: allowed-once` 之后，同一 operation 要么执行、要么产生一条说明未执行原因的 `tool/result`。

**DURABILITY**

- D1 `load()` 返回的快照携带 `integrity`；`repaired` 必然伴随一条 `session/repaired` 事件。
- D2 committed 区的损坏永远不呈现为"正常的短日志"。
- D3 crash/restart 后，未知完整性状态不得标记为 `intact`。
- D4 durable log 是唯一 canonical source；cache/projection/telemetry 都不得成为恢复输入。

**DERIVED STATE**

- E1 同一 session 的 checkpoint 写入串行化；后发起的写不被先发起的写覆盖。
- E2 cache 行携带的 seq 不高于它实际反映的事件。
- E3 cache 永远不作为恢复权威（已成立，`session-projection-cache/src/index.ts:6-9` 的注释即此契约）。

**EVENTS**

- V1 新增 `SessionEventMap` 成员必须同批更新 assembled 期望输出，或使用 seq 无关的期望格式。
- V2 `ignorable` 的含义精确为"未知此类型的构建可以跳过它而不误重建会话"，与"不占 seq"无关。

**VERIFICATION**

- T1 每条 A/D/E 不变量至少有一个 adversarial negative test。
- T2 snapshot 只证明稳定输出，不作为不变量证明。

## G. Detailed remediation plan / H. Roadmap

### Phase 0 — Baseline restoration

- **Objective**：让 assembled 证据重新可信。
- **组件**：`examples/*/tests/**/expected/**`、`packages/test-support/acp-snapshot/src/suite.ts`、`packages/test-support/loader-smoke/src/index.ts`、`examples/headless-agent/tests/headless.snapshot.ts`、`packages/session/session-checkpoint-policy/tests/crash-recovery.e2e.ts`。
- **改动**：(a) 把 attempt 事件补进全部 132 个 fixture（用 `test:snapshot:record`，但**逐个 review diff**，确认每处差异只是 attempt 事件与 seq 位移）；(b) 把 `expect(result.stderr).toBe('')` 改为允许已知 Node 运行时警告的匹配；(c) `session-sandbox-root` 场景的 workspace 父目录改用工作区内临时根，消除 EPERM。
- **Why**：在基线红的情况下做任何改造都无法区分新 regression 与旧漂移。
- **Dependencies**：无。
- **Risks**：批量刷新可能掩盖真实 regression。**缓解**：逐 diff review，并在 PR 中给出"每个文件的差异类别"清单。
- **Tests**：`pnpm run test:snapshot` 全绿；`crash-recovery.e2e.ts` 全绿。
- **Exit criteria**：snapshot 与 e2e 均绿，且 review 记录证明所有差异属于三类已知原因。
- **Rollback**：`git revert`，fixture 是纯数据。
- **复杂度变化**：−（删除一类持续噪声）。

### Phase 1 — Authority correctness

- **Objective**：消灭 RC-1 与 RC-2。
- **组件**：`packages/core/tools/src/index.ts`（identity 铸造、grant 消费、单一 serviceAsk）、`packages/guard/action-policy-guard/src/index.ts`（降级为决策器）、`packages/interaction/user-approval/src/index.ts`（签发 grant）、`packages/sandbox/sandbox-policy/src/index.ts`（铸造 authority）、`packages/fs/fs/src/index.ts` + `packages/fs/fs-sandbox`、`packages/shell/shell/src/types.ts` + `bash-sandbox` + `pwsh-sandbox`、全部传 policy 的工具层。
- **改动**：按 E-1/E-2/E-3。
- **Why**：一个 root fix 消掉 6 个已实测失效模式（E1、E7、E9、E15、E16、E17、E24）。
- **Dependencies**：Phase 0（否则改动的 snapshot 影响无法判读）。
- **Risks**：类型改动波及面广；嵌套/Code Mode 授权语义可能出错。
- **Migration**：`sandboxPolicy` 改必填是**编译期**变更，TypeScript 会枚举全部调用点——这正是仓库"misconfiguration fails loud"原则的应用。
- **Tests**：见 J 节 Phase-1 行。
- **Exit criteria**：A1–A6 各有一个 negative test 通过；E1/E7/E9/E15/E16/E17/E24 的复现实验全部翻绿。
- **Rollback**：按 package 分 PR，可逐个回退。
- **复杂度变化**：+ 三个类型、− 一套重复审批路径 ≈ 净持平。

### Phase 2 — Durable recovery correctness

- **Objective**：消灭 RC-3 中最危险的一支。
- **组件**：`packages/session/session-persistence-jsonl/src/format.ts`（scan 返回 integrity）、`packages/session/session-persistence/src/coordinator.ts`（传递 integrity、写 `session/repaired`）、`packages/core/session/src/types.ts`（新事件）、`known-event-types.ts`（生成）。
- **改动**：按 E-4。
- **Why**：E27 证明当前损坏被伪装成正常中断，这是"系统自洽但已丢历史"的教科书案例。
- **Dependencies**：Phase 0。
- **Risks**：新增事件类型会再次触发 fixture 漂移。**缓解**：与 Phase 0 的 fixture 修复合并到同一批，或采用 J 节的 seq 无关期望格式。
- **Tests**：mid-log corruption、torn tail、seq gap、开放 turn 四组，各断言 `integrity` 与 `session/repaired`。
- **Exit criteria**：D1–D4 有 negative test；E13/E14/E27 的行为变为"截断 + 显式标记"。
- **Rollback**：`integrity` 是新增可选字段，读侧向后兼容。
- **复杂度变化**：小幅 +。

### Phase 3 — Derived-state and resource semantics

- **Objective**：关闭 projection 丢失更新窗口；给出资源可观测性。
- **组件**：`packages/session/session-projection-cache/src/index.ts`（single-flight）、`packages/session/session-telemetry/README.md`（文档化 at-most-once）、新增一处 assembled 请求体量观测。
- **改动**：按 E-5、E-6；prompt budget 只做**观测 + 硬上限拒绝**（超限时 fail loud，而非静默裁剪）。
- **Why**：E10 有明确窗口；E30 量化了 1 MB 请求可以毫无阻碍地发出。
- **Dependencies**：无（可与 Phase 1/2 并行）。
- **Risks**：硬上限设置过低会拒绝合法长会话。**缓解**：上限做成 Config 字段（AGENTS.md 禁止硬编码 tunable），默认取一个明显高于真实使用的值。
- **Exit criteria**：E1–E3 不变量有 test；重叠 flush 实验不再丢失更新。
- **复杂度变化**：几乎为零（一条 promise 链）。

### Phase 4 — Verification architecture

- **Objective**：把本轮 31 个实验中有长期价值的部分变成仓库资产。
- **组件**：各 package 的 `tests/`、新增一个 `packages/test-support` 下的 fault-injection 工具。
- **改动**：见 J 节。
- **Exit criteria**：J 节矩阵中标 MUST 的用例全部存在并在 CI 中运行。

### Phase 5 — Hardening / observability / cleanup

- MCP description/schema 边界；`str_replace_editor` escalation 对齐；`effects` 进入 `docs/tool-catalog.md` 生成器；ACP 孤儿 permission 请求的显式撤回；SDK 畸形帧计数器。
- 这些都是**低杠杆**改动，放在最后。

## I. Alternatives and tradeoffs

### 授权

| 方案 | complexity | runtime | migration | 兼容风险 | 可靠性收益 | 判定 |
|---|---|---|---|---|---|---|
| **A. Identity+Grant（推荐）** | 中：3 个类型、1 处消费点 | 每次执行一次 sha256 | 中：类型改动可枚举 | 低（同进程 API） | 高：消 6 个失效模式 | **采纳** |
| B. 保留 callId，加 args digest 到 map key | 低 | 低 | 低 | 低 | 部分：仍可跨 session 重放、仍不消费 | 拒绝：治标 |
| C. 加密签名的 capability token | 高：密钥管理、时钟、序列化 | 每次签名/验签 | 高 | 中 | 与 A 相同 | **拒绝**：同进程边界内没有伪造威胁模型；[capability-based security 的实践](https://raw.githubusercontent.com/OneUptime/blog/refs/heads/master/posts/2026-01-30-capability-based-security/README.md) 中签名用于**跨信任边界**传递，这里 registry 与 approval 在同一进程同一 fiber 树内，branded symbol 已足够不可伪造 |

### 沙箱

| 方案 | 判定与理由 |
|---|---|
| **A. Intersection + branded authority（推荐）** | 三个 mode 是全序，min 即完整答案；branded 类型让"省略"在编译期不可能 |
| B. Capability token per operation | 与 E-1 的 grant 职责重叠，会产生两套凭证 |
| C. Policy DSL / lattice | 当前没有偏序需求，也没有第二个 policy 维度。**明确拒绝** |

### 日志损坏

| 方案 | 判定与理由 |
|---|---|
| **A. Truncate + integrity marker + repaired event（推荐）** | 保住可用性，同时消灭"伪装成正常"；与 [append-only log 的通行做法](https://github.com/grailbio/base/blob/master/logio/logio.go#L62) 一致——检测到损坏后停在损坏点并**报告**，而不是静默继续 |
| B. Fail-hard | 一个坏字节毁掉整个会话，对交互式产品不可接受 |
| C. Per-record checksum | 更强，但改变磁盘格式。**推迟**：`SESSION_FORMAT_VERSION` 尚为 0 且无兼容承诺，未来若要做仍然可以；当前 A 已解决"被伪装"这个核心问题 |
| D. Quarantine 损坏文件 | 需要新的存储位置与生命周期；A 已足够 |

### 派生状态

| 方案 | 判定 |
|---|---|
| **A. Single-flight 串行化（推荐）** | 一条 promise 链关闭全部已知窗口 |
| B. CAS / generation token | 需要在存储层引入比较写，收益与 A 相同 |
| C. 版本向量 / 分布式共识 | **明确拒绝**：单进程单写者，没有分区 |

### MCP effects

沿用现状（不采信 server 声明）。这与 MCP 生态的共识一致：[tool annotations 是提示而非安全边界](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)，[客户端不应把 untrusted server 的 hint 当作信任依据](https://4sysops.com/archives/mcp-tool-annotations-securing-mcp-servers-against-the-lethal-trifecta/)。E28 证明当前实现已经这样做。**要补的只是把这个事实写进 `docs/tool-catalog.md` 与 `mcp-client/README.md`**，让运维知道 MCP 工具永远落在"未声明 = 需审批"一侧（E29 已验证）。

## J. Verification architecture

| 层 | 证明什么 | 必须新增的 negative test |
|---|---|---|
| unit | 组件行为 | grant 消费后失效；identity 不等则拒绝；authority 无法由 caller 构造（类型层，用 `@ts-expect-error`） |
| integration | 跨组件契约 | **callId replay**（E1）；**cross-tool replay**；**args 改变后同 callId**；**listener ordering**（E16/E17 两个方向）；**sandbox authority override**（E7/E15） |
| adversarial | 失败语义 | **cancellation**（E9）；**late approval**（E23）；**double approval**（E17）；**MCP metadata deception**（E28）；**malformed SDK traffic**（E25） |
| property/invariant | A/D/E 不变量 | 每条至少一个；`./invariant` companion 检查 A1/A2 的事件关系 |
| fault injection | 恢复语义 | **JSONL corruption** 四组（E13/E14/E27）；**telemetry first-delivery failure**（E3）；**projection race**（E10） |
| restart/replay | 跨进程 | **kill -9**（复用 `crash-recovery.e2e.ts` 的 failpoint 机制，扩展到 flush/put 之间）；**symlink cwd replacement**（E21/E22） |
| assembled | shipped 系统 | ACP 取消链路的 teardown 必须 quiesce（E24 的反例） |
| snapshot | 稳定输出 | **不**用于证明不变量 |
| CI matrix | 平台 | Windows lane 保持；崩溃恢复在 Windows 上的 skip 需要显式记录为已知缺口 |

**fixture 的 seq 脆弱性**：期望输出改为记录**相对引用**（如 `sourceEventSeqs` 用"距本事件 N 条"或用事件类型序列断言），或在 normalizer 中把 seq 重编号为稠密序列。这一项属于 Phase 0/4，是 RC-4 的正确修复位置——**不是**改事件模型。

## K. Migration and compatibility strategy

- **schema/version**：`SESSION_FORMAT_VERSION` 保持 `0`。`session/repaired` 是新增事件，旧构建读到它会拒绝加载——这是**正确**行为（AGENTS.md：required-on-read by default），因为丢失"历史不完整"这一事实会导致错误重建。它**不应**标 `ignorable`。
- **existing sessions**：无 per-record 校验和 → `integrity: 'unknown'`，不告警。
- **old snapshots**：Phase 0 一次性重录。
- **plugins**：`sandboxPolicy` 变必填是 breaking change；仓库处于 pre-release 且 AGENTS.md 明确"prefer the correct foundation over compatibility shims"，因此**直接改并更新全部引用**，不加 shim。
- **hooks / MCP / ACP / SDK**：wire 格式不变。MCP 只增加 harness 侧边界检查。
- **feature flags**：**不需要**。理由：这些是同进程 API 的正确性修复，不是可选行为；flag 会让两条路径长期并存，正是 E16/E17 的成因。
- **observe → enforce rollout**：**在 Phase 1 完成并通过 J 节全部 MUST 测试之前，禁止把默认改为 enforce。** 当前 enforce 不可信（E1/E16/E17/E24 全部发生在 enforce 模式下），把默认从 observe 改成 enforce 只会把一个诚实的"不设防"换成一个不诚实的"假设防"。Phase 1 后的顺序：(1) 保持 observe，观察 `action-policy/candidate` 事件量；(2) 在测试部署开 enforce 跑一周；(3) 默认改 enforce。
- **metrics / canary**：candidate 事件计数、approval 结果分布、grant 消费失败计数（应恒为 0）、`integrity != 'intact'` 的 session 比例。

## L. Rollback strategy

- Phase 0：revert fixture 提交。
- Phase 1：按 package 分 PR（tools → approval → guard → sandbox-policy → fs/shell → 工具层），任一层可独立回退；最危险的是 sandbox 参数改必填，单独成 PR。
- Phase 2：`integrity` 是新增可选字段，读侧忽略即可回退；`session/repaired` 一旦写入无法回退（durable），因此该 PR 必须在 Phase 0 绿之后才合并。
- Phase 3：single-flight 是纯内部改动，直接 revert。

## M. Risk-ranked implementation order

| # | 项目 | Severity | Likelihood | Blast radius | Evidence | Fix leverage | Cost | Regression risk | Arch value | 排序理由 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Phase 0 基线恢复 | 中 | 确定 | 全部验证 | L4 | 高 | 低 | 低 | 一切改造的前置；不做则后续无法判读 |
| 2 | 单一授权点 + grant 绑定（E-1/E-3） | 高 | 高 | 所有副作用 | L4 | **最高**（消 6 个失效模式） | 中 | 中 | root fix |
| 3 | 沙箱 authority 由 owner 铸造（E-2） | 高 | 中 | fs/shell 全部 | L3 | 高 | 中 | 中 | 与 2 独立的第二条提权路径 |
| 4 | 日志完整性标记（E-4） | 高 | 中 | 会话历史 | L3 | 高 | 中 | 低 | 唯一能让不变量不再"对缺失盲"的改动 |
| 5 | projection single-flight（E-5） | 中 | 中 | 派生状态 | L3 | 中 | **极低** | 极低 | 成本几乎为零，顺手做 |
| 6 | 验证体系补 negative tests | 中 | — | 长期 | — | 高 | 中 | 无 | 防止 1–5 回归 |
| 7 | prompt budget 观测 + 硬上限 | 中 | 中 | 请求 | L3 | 中 | 低 | 低 | 能力缺失，非缺陷 |
| 8 | telemetry 限制文档化 | 低 | — | 认知 | L3 | 低 | 极低 | 无 | 消除误信 |
| 9 | MCP 边界 + effects 进目录 | 中 | 低 | MCP 部署 | L3 | 中 | 低 | 低 | 现状已安全，补的是可见性 |
| 10 | `str_replace_editor` / SDK 计数器 / ACP 孤儿撤回 | 低 | 低 | 局部 | L1–L3 | 低 | 低 | 低 | 收尾 |

## N. DO NOT BUILD / overengineering warnings

- **不要**做分布式共识、版本向量、CRDT。单进程单写者，没有分区。
- **不要**做完整 event-sourcing 重写。当前 session log 已经是 event log；问题在授权与完整性，不在存储范式。
- **不要**做 durable telemetry queue / Kafka。telemetry 已明确定为 best-effort observability（E-6）。
- **不要**给授权做加密签名。同进程边界内 branded symbol 已不可伪造；签名解决的是跨进程/跨网络伪造，这里没有。
- **不要**引入通用 policy DSL。三个有序 mode 上的 min 运算就是全部需求。
- **不要**再加第二层 guard。E16/E17 证明重复守卫层制造矛盾而非纵深防御。
- **不要**把 canonical seq 拆成多条序列。RC-4 的正确修复在 fixture 记录方式，不在事件模型。
- **不要**为 `sandboxPolicy` 加兼容 shim。pre-release 阶段，直接改并更新全部引用。
- **不要**做静默的 prompt 裁剪。裁剪是 compaction 的职责，预算层只观测与拒绝。
- **不要**为 MCP 引入 effects 采信机制。E28 证明忽略 server 声明是**正确的**，采信才是新漏洞。

## O. Expected end-state

- 每个副作用执行有一个不可伪造、不可重放、一次性的授权，且请求/批准/执行三者在日志中可互相印证。
- 权限只能由 policy owner 收窄或（经批准后）放宽；任何调用方无法通过"传更宽的值"或"什么都不传"获得更多权限。
- 日志损坏永远可见：恢复后的会话明确标注 `intact` / `repaired` / `unknown`，模型也知道自己的历史是否完整。
- 派生状态可以 stale，但不会丢更新，也不会成为恢复权威。
- 事件模型不变，但 assembled 期望输出不再因新增诊断事件而全面漂移。
- 每条不变量都有一个会失败的 negative test。

## P. Production-readiness acceptance criteria

1. `pnpm run test:snapshot`、`pnpm run test`、`crash-recovery.e2e.ts` 全绿，且无 stderr oracle 依赖 Node 版本。
2. A1–A6、D1–D4、E1–E3 各有至少一个 negative test，且每个 test 在移除对应修复后确实失败（"证明测试会红"）。
3. E1、E7、E9、E10、E13、E14、E15、E16、E17、E21、E24、E27 全部翻绿。
4. enforce 模式在测试部署连续运行一周，`grant 消费失败计数 == 0`。
5. `integrity != 'intact'` 的 session 在 UI/SDK 中可见。
6. 默认仍为 observe，直到 1–4 全部满足。

---

## 如果全部实施：哪些风险被消除，哪些是主动接受的 residual risk

### 被真正消除

- 跨工具/跨 session 的授权重放（A1/A2 + args digest + 一次性消费）。
- 批准后仍被拒 / 一次调用问两次（单一授权点）。
- 取消后审批挂起并阻塞 turn 与 teardown（signal 贯穿单一路径）。
- 调用方自选或省略 sandbox policy 获得超出 session 的权限（branded authority + 必填）。
- 日志中段损坏被伪装成正常中断（integrity + `session/repaired`）。
- projection 重叠 flush 丢失更新（single-flight）。
- 新增诊断事件导致 assembled 证据全面失真（fixture 记录方式）。

### 主动接受的 residual risk（设计取舍，必须写进文档）

1. **telemetry 首投失败即永久丢失、跨进程不回补。** 接受理由：它是 observability，不是审计证据。若未来需要审计级保证，走独立 durable 通道。
2. **`workspace-write` 恒含 `/tmp` 与平台临时目录**（E8/`sandbox/src/roots.ts:52-55`）。接受理由：与 Seatbelt 授予的可写集合对齐，拆开会让 fs 与 shell 的可写集合漂移。必须在威胁模型中明示：这是一条跨 session 的恒定共享通道。
3. **未 flush 的事件在硬崩溃中丢失**（E26）。接受理由：每事件 fsync 的代价与交互延迟不成比例；`session-checkpoint-policy` 已在语义检查点（请求前、工具副作用前）强制 flush，覆盖了最需要保护的两个点。
4. **历史 session 的完整性永远是 `unknown`。** 接受理由：无法追溯生成校验和；诚实标注优于伪造确定性。
5. **cwd 恢复不做 realpath 身份校验**（E21/E22）。接受理由：用户把项目目录换成 symlink 是合法操作；强制校验会破坏正常的目录迁移。缓解：在会话恢复时把解析后的 workspaceRoot 展示给用户，让替换可见。
6. **MCP 工具的 schema 与 description 不做语义校验**（E28）。接受理由：MCP 的价值在于接纳未知服务器；harness 只保证它们落在"需审批"一侧（E29 已验证）并加长度上界。
7. **SDK 畸形帧静默丢弃**（E25）。接受理由：JSON-RPC 规范允许忽略无法关联的帧；加计数器即可，不改为断连。
8. **单进程单写者假设。** 接受理由：当前部署模型如此。若未来支持多进程写同一 session，本方案的 single-flight 需要升级为存储层 CAS——但那时才做。

---

## 附：本轮实验索引

`.audit-tmp/`（未跟踪，可直接删除）：19 个 spec、75 个断言、多次运行一致。

E1/E2/E16/E17/E31 `policy-replay` · E18 `enforce-fleet` · E9 `approval-cancel` · **E23/E24 `acp-cancel`** · E3 `telemetry-fault` · E4/E5/E6 `compaction-reconstruct` · E7/E8/E22 `fs-authority` · E15 `shell-authority` · E10/E11/E12 `projection-race` · E13 `jsonl-corruption` · E14 `jsonl-e2e` · **E26/E27 `kill9`** · **E25 `sdk-wire-fault`** · **E28/E29 `mcp-deception`** · **E30 `prompt-budget`** · E19 `request-invariant` · E20 `subprocess-fault` · E21 `cwd-restore`（粗体为第四轮新增）。

另实跑：`packages/session/session-checkpoint-policy/tests/crash-recovery.e2e.ts`（真实 SIGKILL）、`examples/headless-agent/tests/headless.snapshot.ts`、`packages/guard/action-policy-guard` + `user-approval` + `session-telemetry` + `session-projection-cache` 单元套件（122 测试全绿）。
# Remediation Plan Design Review（第五轮：独立设计评审）

评审日期：2026-08-24。评审对象：第四轮《Final Convergence Audit and System Remediation Plan》的改造方案本身。方法：主审会话对决定性结论回到代码逐一复核（`core/tools`、`action-policy-guard`、`user-approval`、`sandbox-policy`、`session-persistence-jsonl`、`session-persistence`、`session-projection-cache`、`dsh-brand`、`hooks-*`、`acp-snapshot/normalize`、`mcp-client`），补充运行时探针（late-allow 竞态 ×3），并让两个隔离的独立子评审各交出一份对抗性评审（一个攻击架构设计，一个攻击安全边界与迁移回滚）。未修改任何生产代码。

## A. Overall verdict

**APPROVE WITH CHANGES**

方向成立：单一授权点、一次性的 execution-attempt 绑定 grant、由 policy owner 铸造的 sandbox authority、恢复完整性状态显式化、projection 单飞、保留 canonical seq——这些都与已实锤的失效模式一一对应，没有过度设计。但按现状不能开工，必须先落实 L 节的改动。两个独立子评审与本主审在三个 critical 项上结论一致：(1) repair marker 的 truncate-then-append 存在能把 E27 缺陷原样重造的崩溃窗口，必须改为原子替换；(2) 授权链的可审计性（A6）不能被"消费即安全"担保，需要 execution-attempt 状态机 + 终局 disposition + 事件携带 operationId；(3) TypeScript brand 对 partially-trusted 进程内插件不构成运行时边界，方案要么加最小运行时 provenance 检查，要么公开承认"信任到编译期"。

## B. Root-cause model review

**ROOT-CAUSE MODEL ACCEPTED（带两处精确化，不推翻）**

- RC-1（授权是一个可复用字符串键而非对象）成立：`action-policy-guard/src/index.ts:65,77` 的 `Map<string,true>` 键为 caller 提供的 `callId`，不绑定 tool/args/session/agent/scope，不消费。E1/E16/E17/E31 四组实验互相印证。这是 root cause 而非 symptom——E31 证明普通管线对重复 callId 逐次询问，只有短路/复用路径穿 fence，说明病根在"键的选取"，不在任何单一监听器。
- RC-2（沙箱权限最终计算权在调用方）成立，**并比报告写的更宽**：除了 `ctx.fs.writeText(..., sandboxPolicy?)`（`fs/src/index.ts:227`）与 `bash-sandbox.resolve`（`bash-sandbox/src/index.ts:84-90`）的可选参数，`SandboxPolicyRequest.mode`（`sandbox-policy/src/index.ts` 的 `resolve` 实现）本身就是一个"无证明的模式覆盖"——`resolve({mode:'danger-full-access'})` 今天不需要任何 grant。统一表述：**policy owner 的两个入口（最终 policy 参数、显式 mode 覆盖）都接受 caller 自选值**。
- RC-3（缺失/损坏被建模为更短的合法状态）成立：JSONL 扫描器把 corruption 记入私有 `issue` 字段但不暴露（`format.ts:352-377`），`load()` 在其上合成 closers（E27），telemetry cursor 越过失败记录（E3），projection 丢失更新后 dirty 归零（E10）。三者共因。
- RC-4（canonical seq 是过度共享的全局资源）成立，但**证据要修正**：主审复核 `acp-snapshot/src/normalize.ts:22-24` 发现 top-level `seq`/`seq0` 已被删除（scrub），所以 snapshot 漂移不是由"seq 位移"造成，而是：新增 attempt 事件行本身、fixture 中事件序列断言（如 `crash-recovery.e2e.ts` 的 `events.map(type).toEqual`）、以及 `sourceEventSeqs` 这类数据内嵌的绝对 seq 引用。RC-4 的机制描述（ignorable 事件仍占位、consumers 按 seq 对齐）依然成立，但"132 个 fixture 全面 seq 位移"的说法不准确——修复方案因此也要改（见 G）。
- 是否遗漏更底层 root cause：本主审与两个子评审各自排查过"policy owner 与 enforcement 分离""事件模型无显式 commit/cut"等候选，结论是它们分别被 RC-2/RC-3 覆盖；不引入第五条 root cause。

## C. Authorization design review

- **ToolExecutionToken 是对的身份，但方案对它的描述必须改两处。**
  1) `createExecutionToken()` 是 `Symbol('dsh.tool.execution')`（`core/tools/src/index.ts:1877-1878`）。Symbol 描述**不保证唯一**（任意代码可用同描述再铸一个），且 symbol 无法序列化。方案的"registry 私有 symbol 不可伪造"表述错误——真正不可伪造的是**registry 闭包内的单调计数器 + WeakMap 成员检查**。设计改为：`operationId = <模块私有计数器>`（可序列化、可审计），内部 `token` 保留为不透明句柄，enforcement 一律走 WeakMap/WeakSet 成员检查。
  2) token 不会因包装/转发而改变（registry 每次 `execute()` 铸新 token；Code Mode 子派发以 `parent` 携带祖先），**但转发方重新 `execute()` 会铸新 token——这是正确语义（新执行新授权），方案应写明而不是回避**。
- **args digest：KEEP，但角色降级。** 主审实验确认 arguments 在策略管线之前就被 `snapshotJsonValue` + `deepFreeze`（`core/tools/src/index.ts:1402-1412`），因此"同一次执行内参数被改"不可能发生；按 frozen 引用绑定 grant 足以防重放。但 frozen 引用**不能进 durable 审计**（重载后对象不复存在，无法证明"批准了什么=执行了什么"）。所以 digest 不是授权机制，是 **A6 的审计绑定**：SHA-256 对 `JSON.stringify` 的 canonical 化唯一风险是属性序，而 harness 约定 `snapshotJsonValue` 保序（`detach` 不重排），可在 digest 旁同时存序列化长度做交叉校验；bigint/undefined 在 materialization 就抛错，不会到达 digest。**不需要**引入 canonical-JSON 库。
- **grant 生命周期——"one-shot consume 是否足够"的诚实答案是：对重放足够，对 A6 不够。** 逐项：
  - replay / duplicate consume / double execution：足够（消费原子删除 + 全等 identity 检查）。
  - retry：E31 证明每次 execute 铸新 token、管线会重新询问——重试天然重新授权，与现状一致，无需设计"retry 复用"。
  - timeout：无（execution 无审批超时，answerer 挂起时由 cancellation 收口）。
  - cancellation / late approval / concurrent decide：核心服务已正确（本轮实验 ×3：abort@10ms vs allow@50ms → 结果 `cancelled` 且日志恰好一条 `approval/decided{cancelled}`；反序亦然；abort 后无状态污染）。**grant 层只需继承该语义，不得重造**。真正要修的是 guard 路径不传 `signal`（`action-policy-guard/src/index.ts:116-121`），E24 已证它挂起 prompt 和 dispose。
  - approval after operation disposal：turn 闭合是 request 前置条件（`user-approval/src/index.ts:259-265`），execution 未 settle 前 turn 不会闭合，故该场景在修复 signal 后不可达。
  - operation failure before body / partial body then retry：**这是 plan 未覆盖的缺口**。消费 grant 只保证"只执行一次"，不保证"审计能看到终局"。必须为每个 execution attempt 维护终局 disposition：`executed`（tool/result 正常/出错都算）或 `not-executed(reason)`（denied/cancelled/disposed），且每次 body 可能已产生副作用后失败时不得自动复用授权——重试需新授权（对 idempotent 工具的例外是产品决策，不是默认）。
- **allowed-once 绑定层级：execution attempt，不是 tool call，也不是 side-effect operation。** 理由：tool call（callId）已被 E1/E31 证明可复用；side-effect operation 是模型语义，harness 无从观测其内部幂等/重试边界。attempt 与 registry 铸 token 一一对应，是唯一有事实边界的层级。子评审同判。
- **parentToken：KEEP 为 provenance，禁止自动继承授权。** 当前 `parent` 只用于 Code Mode 子派发标记（`core/tools/src/index.ts:341-346`）。"父已授权则子树免问"会把授权范围扩大到未授权维度（子代可用父代 scope 外参数），构成新的提权面。若产品确需子树免问，须单独设计 bounded inheritance（同 root、同 tool、同 args-digest 的显式续批），**本轮 DEFER**。
- **审计相关性（A6）的最小事件改动**：`operationId` 同时写入 `approval/asked`、`approval/decided`、`tool/call`、`tool/result` 四个已有事件（计划已提，但需从"可选字段"升级为 decided/tool-call/tool-result 上的**必填相关性字段**）；不变式：每个 `allowed-once` 的 decided 必须恰好对应一个携带同 operationId 的终局 `tool/result`（含 `not-executed`）。这样 A6 在重启后仍可验证，callId 仅作展示。

## D. Single approval point review

- `ToolRuntime.serviceAsk()`（`core/tools/src/index.ts:1700-1740`）作为唯一 `approval.request()` 调用点是正确的，且它已正确传 `signal`、已实现 fail-closed（无 approval 服务→deny、无 agent→deny、`unavailable`→deny）。guard 降级为返回 `{kind:'ask'}` 的 pre-execute 决策器即可，E16/E17 的矛盾随之消失。
- **但方案必须明确 decision semantics——水瀑布是"第一个非 next() 返回即胜"，不是 merge。** 建议的精确语义（三层）：
  1. `tools/pre-execute` 水瀑布：**收集式**决策——所有安全相关的监听器强制 delegate（`next()`），每个返回 `allow/ask/deny` 建议；聚合规则 **deny > ask > allow**（deny 附聚合 reason）。这比"第一个返回者胜"多一个"collect"要求，但消除了注册顺序作为安全属性。
  2. `approval/request` 水瀑布：保持现状（first-claim-wins，由 service 归一化 rogue 返回值，`user-approval/src/index.ts:304-343` 已实现）。**ask 只触发一次**——由 registry 收集后统一调用。
  3. `tools.guard()` 单调 fence：作为**最后一道**在 grant 消费前运行，只 deny 不 allow，检查 exact grant/identity。
  - 顺序结论：deny（任何来源）> ask（一次）> allow（水瀑布无 deny 且 fence 通过）。取消是独立终态 `cancelled`，立即 settle，不是普通 deny。
  - 若不想改水瀑布为收集式，备选：保留 first-wins，但把 guard fence 强制为 unconditional prepend——**不推荐**，因为 prepend 依赖注册顺序，且 E16 证明 hooks 桥会自然产生 prepend 监听器。collect 语义是唯一不依赖顺序的方案。
- escalation 与 ask 的关系：工具 body 内的 `sandbox_permissions` 升级请求走同一 `approval.request()`，但必须携带拟升级的**具体维度**（mode/root），decided 记录之，policy owner 据此签发有界 authority（见 E 节）——今天 `SandboxPolicyRequest.mode` 无此证明。

## E. Sandbox Authority review

- **公式本身有缺陷，必须改为有界并集：** `deployment default ∩ session override ∩ tool requirement ∪ approved escalation` 中：
  - "tool requirement" 在代码中不存在（`SandboxPolicyRequest` 只有 session + mode；工具不声明需求）——是计划发明的输入。**REMOVE 该词项**，除非先定义 trusted tool-owned request 并为其写全部 consumer 测试。
  - 无界 `∪ approved escalation` 允许一次批准把 mode 提到 deployment 上限之上（今天 `resolve({mode})` 就是如此：显式 mode 无条件胜出）。改为：**escalation 必须命名具体维度与上限**（`approvedAuthority: {mode?: 'danger-full-access', roots?: [...], reason}`），`effective = meet(deploymentCeiling, sessionPolicy, escalation) ∩ deny-by-default 的其他维度`；deployment 是否作为硬上限（即禁止 danger-full-access）是产品决策，不是代码能决定的——默认建议提供 `maxMode` 配置字段，缺省保持现状语义（可升到 danger）。
  - session restriction 不允许被 approval 绕过：approval 只能在其显式请求的维度内放宽，其他维度一律 meet。
- **workspaceRoot 是 authority 的组成部分，不只是 mode。** `resolve` 现在把 root 与 mode 一起返回，branded authority 应整体封装 `{mode, workspaceRoot, sessionId}` 并深冻结；root 必须保持"session.header.cwd 的 canonical 化"这一语义，并在恢复时展示解析结果（承接第四轮 E21/E22 的缓解）。
- **维度扩展后全序 min 失效：承认并做演进预案。** 今天三值 mode 全序成立（min 语义正确）。未来 network/env/mount 等维度加入时，min 不再是正确算子；authority 应演进为**逐维度 meet + 默认拒绝**的能力集，而不是继续用单一 mode 字段堆叠。branded authority 类型恰好把这次演进收容在类型内。**本轮不做能力集**——那是过度设计。
- **branded type 只是编译期：runtime 伪造可行，必须做最小 provenance 检查。** `dsh-brand` 是纯类型工具（`packages/util/brand/src/index.ts`，`Branded<string>`，运行时擦除）。同进程插件可以构造 `{mode:'danger-full-access', workspaceRoot:'/…'}` 直接传 `ctx.fs`。方案声称"C 不能自选最终 mode"是**虚假边界**。最小修正：`SandboxPolicyService` 铸造 authority 时记入 WeakSet，fs/shell 各 enforcing backend 在入口做一次成员检查（O(1)，一个 `if`）。这只挡住 B/C 的构造伪造，挡不住 D（D 可 monkey-patch 或直接用合法能力）。同时必须遵守 AGENTS.md 的信任规则：typed 同进程边界不添加针对静态接口值的运行时校验——但 authority 是**显式安全边界**，与 parser/wire/durable 同列，成员检查属于边界校验而非对类型系统的补丁。若无产品需求防 C，则删除"C 不能自选最终 mode"的承诺并明示"插件可信到编译期"——二选一，本轮按前者执行。
- 公式修订后的最终形态：
  `effective = { mode: meet(deploymentCeiling, sessionPolicy.mode, escalation?.mode ?? sessionPolicy.mode), workspaceRoot: session.header.cwd ?? deployment root }`
  其中 escalation 仅在 `approval/decided` 记录该维度授权且 authority 已由 owner 铸造时生效；direct `ctx.fs`/`ctx.shell` caller 只能提交 **request**（想要什么），不能提交 authority。

## F. Durable recovery review

- **"truncate + 诊断事件"按报告原样实施会重造 E27。必须改为原子替换。** 子评审的证伪论证成立，主审复核确认：`commitRepair` 在 JSONL backend 是两步（先 `repair(truncateTo)` 再 `appendLines(closers)`，`session-persistence-jsonl/src/index.ts:436-450`），两步间崩溃→日志以干净边界结尾→下次加载无 torn tail→被当成完整日志合成 closers→"损坏被伪装成正常 interrupted turn"原样复现。主审最初设想的"append-before-truncate"**也被否**：追加在 EOF 的 marker 位于 torn tail 之后，截断到 tornStart 会把它一并删掉——子评审这一点是对的。
- **选定方案（比较 A/B/C/D 后）：A' = 原子替换 + 持久化 integrity 元数据。**
  - JSONL backend：`commitRepair` 改为构建"合法前缀 + recovered events + closers + session/repaired 事件"完整内容 → 写临时文件 → fsync → `rename` 原子替换 → 目录 fsync。这正是 append-only log 修复的标准做法（与 Redis AOF rewrite、WAL checkpoint 同构：损坏后重建合法快照并原子发布），不需要引入新存储抽象。
  - `session/repaired` 是**独立诊断事件**（记录 cut、lostLines、reason），**不**并进 `interruptedTurnClosers`（普通 interrupted 描述开放 turn，与损坏是两回事；合并会保留 E27 缺陷）。
  - 快照携带 `integrity: 'intact' | 'repaired' | 'unknown'`（B 作为读侧投影），但 **canonical 在日志/替换事务内**，投影不是权威。
  - 拒绝 fail-hard（D）：坏一个字节毁掉整个会话不可接受。
  - 拒绝 sidecar（C）：多文件一致性协议 + 身份/版本绑定复杂度高于原子替换收益。
  - **idempotency**：原子替换天然幂等（重复执行产出同一内容）；`session/repaired` 只在"本次 load 检测到未修复损伤"时生成一次。
  - **intact 的语义**：无 checksum 时 `intact = 扫描完整、无 seq gap、无 torn tail、无已知损坏`（parse-consistent，不是 bit-perfect）。诚实声明：行内静默位翻转不可检测，此类日志只能 `unknown` 或引入 per-record checksum（DEFER，format 演进时再做）。
  - **read path 是否应 mutate**：现状 `load()` 已经通过 `commitRepair` 修改日志（`coordinator.ts:945` 附近），修复不是引入新 mutation，只是把它的 commit 变成原子的；load 的只读性由 `readFrom`/inspect 路径保证。
  - **model-visible**：`session/repaired` 是 durable 诊断事件，通过既有 surface 投影进入模型历史（模型需要知道"历史不完整"，这是任务相关事实，不是实现细节）；不再另造 notice 事件。
- **版本兼容：随 `session/repaired` 同 PR 把 `SESSION_FORMAT_VERSION` 从 0 升到 1。** 依据 `types.ts` 的版本机制注释（老运行时无法以完整语义处理的新日志必须被版本拒绝）与 AGENTS.md pre-release 立场；`ignorable: true` 会让旧构建静默重建截断历史，显式违背修复目标。第 L 节的"integrity 是可选字段、读侧忽略可回滚"**是错误的**，必须改写（见 H/I）。

## G. Projection / resource review

- **single-flight 必要但不充分。** 三个子问题全部实测/静态确认：
  1. E10 重叠写：串行化关闭——正确。
  2. promise chain 永久 rejected：tail reset（`.then` 挂在已 settle 链上，失败后链重置为 resolved）——必须写进实现要求（参考 `coordinator.serialize()` 的同款"错误不毒链"模式）。
  3. **dispose 生命周期竞态：single-flight 不关，需要三个补充要求。** 现状证据：`session/disposed` 监听器 fire-and-forget `flushSoft` 后**同步** `markClean` + `dirty.delete`（`session-projection-cache/src/index.ts:234-238`），失败时 retry bookkeeping 已被抹掉；`write()` 只在 `flush` 前检查 `ctx.sessions.get(id)===session`，`flush` await 期间 session 可能 detach，随后**无条件** `put`（147-161 行）——把已退役生命周期的一行发布进 store。修正：per-session 队列覆盖**全部**写入路径（定时、计数、turn/end、detach、cold write-back、公开 `write()`）；detach 作为队列任务入队并 await/drain；`put` 前按 session 生命周期代/identity 复查（不在 registry 或代不符→跳过 put，由 persistence retirement drain 的权威快照接管）；dirty 清账只在任务 settle 后执行。cancellation：`write()` 无 signal 参数，保持"写到底或失败留 retry 预算"（不引入半途取消）。memory：per-session 单 promise 无泄漏面。
- **Prompt budget：报告的"硬拒绝"会被 compaction 前置条件卡死，必须改成 layered 方案。**
  - 攻击成立：若在 assembly 时硬拒绝超限请求，而 compaction 需要一次模型请求才能压缩历史，则超限会话永远无法自愈（每次请求都被拒绝，compactor 拿不到机会）。E30 的 1MB 请求已证明无聚合约束。
  - 分层：① 在**摄入/同步时**对不受信来源设字节上界（MCP description/schema——本轮 E28 已证 500KB description 无界直通模型，这是入口问题不是聚合问题）；② compaction 在保留额度内运行（compaction 请求本身占预算）；③ 最终 assembly 做 provider-aware 的 token 估算 + 字节上限，**仅在 compaction 无法再降**时 reject，且拒绝消息本身必须可送达（不递归走超限路径）。
  - 放弃"统一 token budget"：UTF-8 字节不能预测 token，统一预算会误杀或漏放。三个小约束比一个大系统便宜且诚实。
  - **已记录的采纳偏差（PR-6 F2 remediation，方案 B）**：③ 中的"provider-aware token 估算"落地为**provider-agnostic 的 advisory fixed-density heuristic**（chars/4，无 provider 输入参与定价）。理由：仓内无 per-provider tokenizer 数据，构造 provider 系数等于编造未验证 tunable；字节上限（UTF-8，`maxRequestBytes`）是 normative hard enforcement，`maxEstimateTokens` 仅为 opt-in 启发式提前触发。实现、设计、文档、测试已按此契约一致化。

## H. Event / fixture review

- canonical seq 继续包含 ignorable 事件：**同意保留**（seq 是引用与 gap 检测的载体，拆分会造出第二套引用体系）。
- 但计划的"改 normalizer"方向要修正：normalizer **已经**删除 top-level `seq`/`seq0`（`acp-snapshot/src/normalize.ts:22-24`）。漂移的真实来源是新增事件行、事件序列断言、`sourceEventSeqs` 等数据内嵌 seq。分层策略：
  1. **volatile 标识**（`seq`、`time`、`id`、`createdAt`）：继续 scrub（现状已做）。
  2. **数据内嵌引用**（`sourceEventSeqs`）：关系是真实语义，**不全局 scrub**；在 dedicated 单测中 pin 绝对 seq（如"tool/result 引用其 tool/call 的 seq"），在 assembled snapshot 中对该字段做结构级断言或接受重录。
  3. **事件序列本身**：fixture 断言改为类型序列 + 关键相邻关系，不 pin 绝对 seq。
  4. absolute seq 只在一个地方 pin 死：工具结果引用关系的专项测试。
- "SDK/replay consumers 是否依赖绝对 seq"：wire 投影携带 seq，但 consumers 按事件流消费；绝对 seq 不是 public contract（pre-release、无外部 consumers），不 pin 是对的。`SESSION_FORMAT_VERSION` 的 bump（见 F）才是真正的 public contract 变化。

## I. Migration / rollback review

- 依赖顺序整体成立，但有三处修正（见 M 的 PR 序列）：
  - **Phase 0 必须先行**（attempt 事件补 fixture + stderr oracle + EPERM 根目录），否则一切改动无法判读——同意。
  - **Phase 1 拆两个 PR**：sandbox authority（resolve/escalate API + 必填参数迁移）与授权 grant（operationId + 消费 + 单一审批点 + guard signal）相互独立、调用面不同，合并会制造巨型 diff。先 sandbox 后 grant（sandbox 是纯 API 迁移，风险面小；grant 改动执行状态机）。
  - **Phase 2 是原子 PR**：`session/repaired` 声明 + 生成的 `known-event-types` + `SESSION_FORMAT_VERSION=1` + 原子替换 commitRepair + coordinator 传递 integrity + refusal 测试 + fixture。任何拆分都会出现"writer 已产出、reader/版本未声明"的中间态（子评审同判）。
  - **测试资产先行**：第三/四轮的 E1/E7/E9/E13/E14/E16/E17/E21/E24/E27 在对应修复 PR 内永久化为 negative tests（先红后绿，同 PR 落地）；不单独先合一个"全红"测试 PR——与仓库绿门冲突。
- **rollback 修正**：报告第 L 节"Phase 2 可回退、integrity 可选字段读侧忽略"**不成立**——`session/repaired` 是 required-on-read，旧构建经 `assertEventsSupported` 拒绝整个日志（`coordinator.ts:1052-1065`）。回滚语义是"版本拒绝"，不是"静默忽略"：这符合 AGENTS.md（无兼容承诺、明确拒绝优于静默错读），但必须写进 rollout 文档：**新构建修复过任何会话后，回滚旧构建将拒绝该会话**（可诊断、不可恢复），部署窗口内不要执行修复。最危险的回滚场景（子评审同判）：新构建修复损坏 JSONL 并持久化 `session/repaired` 后回滚——旧二进制要么拒绝会话（选版本 bump）要么静默重建截断历史（若误选 ignorable）。
- `sandboxPolicy` 必填化：在仓调用点已全部枚举（tool-fs write/edit/apply-patch、tool-str-replace-editor、tool-bash、tool-pwsh、bash/pwsh-local、bash/pwsh-sandbox、terminal-bash、fs-sandbox 转发；hook-protocol 无生产调用点）。编译期枚举只覆盖在仓 TS 调用方；`ctx.fs`/`ctx.shell` 是公开同进程 API，仓外插件无法枚举——文档 + WeakSet provenance 检查（E 节）兜底。这是 pre-release 允许的 breaking（AGENTS.md：正确地基优于 shim），但 breaking 通知必须写进该 PR 的 README。
- 活跃会话部署：所有改动是进程内 API/类型/恢复路径，wire 格式不变（SDK）——部署只需重启进程，无持久数据迁移。`SESSION_FORMAT_VERSION=1` 是拒绝边界而非迁移器。

## J. Security-boundary review

按攻击者分级陈述（本主审 + 两个子评审一致）：

| 攻击者 | 现状 | 计划改动后 | 结论 |
|---|---|---|---|
| A 意外误用 | 类型系统 | branded authority + 必填参数 | 挡住（编译期） |
| B 有 bug 的 TS 插件 | 类型系统 + review | 同上 + WeakSet 成员检查 | 挡住 |
| C partially-trusted 进程内插件 | 仅 review/编译纪律；可构造伪造 policy 对象直调 `ctx.fs`（`dsh-brand` 运行时擦除，`fs/src/index.ts:217-228` 接受可选参数） | WeakSet 铸造检查（每 enforcing backend 入口一次 O(1) 成员判断） | **加检查后挡住构造伪造**；挡不住其调用 trusted service 路径。诚实边界：挡住"伪造 authority 对象"这一类 |
| D 恶意进程内插件 | 无 | 无 | **挡不住**（可 monkey-patch、直接使用合法能力）。需要进程隔离或 syscall 级沙箱（`native/` 的 Landlock runner 是既有方向），**不在本计划范围内，且不得用类型系统话术暗示挡住** |

- 必须写进方案的声明："TypeScript brand 是编译期工具；本 Harness 对同进程插件的运行时防线是 WeakSet 铸造检查（C 的构造伪造）与进程级沙箱（D）。没有虚假边界。"
- branded symbol / private token / monkey patching / JS 插件：如 C 节所述，token 防"猜测"，成员检查防"伪造"，都防不了"持有或改写"。
- 引用依据：仓库信任规则（AGENTS.md "Trust TypeScript at typed same-process boundaries…validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries"）把运行时校验限定在显式边界；authority 属显式安全边界，成员检查不违反该规则，反而是该规则承认的边界类校验。

## K. Overengineering review

逐项回答"删掉它，哪个已实锤失效模式会复现"：

| 抽象 | 判定 | 删掉后复现的失效模式 |
|---|---|---|
| OperationIdentity | **KEEP（简化字段）** | E1 跨工具重放、E16/E17 双重审批、A6 审计断链 |
| AuthorizationGrant | **KEEP** | E1 复用授权 |
| AuthorityContext / branded authority | **KEEP（收窄到 mode+root+sessionId，去"tool requirement"）** | E7/E15 调用方自选权限 |
| parentToken | **KEEP 为 provenance；REMOVE 自动继承授权** | Code Mode 关联；继承是未实锤的新提权面 |
| argsDigest | **KEEP 为审计绑定；不用于防重放** | A6 无法跨重启证明 |
| session/repaired 事件 | **KEEP，但改为原子替换事务的一部分** | E27 损坏伪装成正常中断 |
| integrity 三值 | **KEEP** | D1/D3 无法表达 |
| prompt 统一 budget | **REMOVE → 换成源端字节上界 + compaction 保留额 + 终局估算拒绝** | 无（统一预算不解决任何已实锤问题，还会造死锁态） |
| fault-injection framework | **DEFER（作为测试 helper 而非运行时抽象）** | 无（vitest + 既有 failpoint 机制已够） |

## L. Required changes before implementation

1. **L1（critical）** JSONL `commitRepair` 改原子替换（temp + fsync + rename + 目录 fsync），`session/repaired` 作为独立诊断事件随事务发布；`integrity` 三值由扫描结果直接推导（intact/unknown 不需要 checksum 也成立，repaired 只由替换事务标记）。子评审结论一致。
2. **L2（critical）** execution-attempt 状态机：operationId 写入 asked/decided/tool-call/tool-result（decided 与 tool/result 上必填）；每个 allowed-once 必须恰好一个终局 disposition（含 not-executed）；grant 消费与 disposition 写入耦合。guard 的 `approval.request` 必须传 `exec.signal`（修 E24）。
3. **L3（high）** 单一审批点 + collect 式决策语义：pre-execute 收集（deny > ask > allow）、ask 一次、guard 单调 fence 在消费前。写明注册顺序不再是安全属性。
4. **L4（high）** 沙箱公式删除"tool requirement"，escalation 改为按维度有界（meet + deny-by-default），`SandboxPolicyRequest.mode` 的无证明覆盖改为要求签发证明；authority 深冻结、含 root；fs/shell backend 入口做 WeakSet 铸造检查；威胁模型文档按 J 表重写。
5. **L5（high）** projection：single-flight 覆盖全部写入路径 + tail reset + detach 入队 await + put 前生命周期复查 + dirty 清账只在 settle 后。
6. **L6（high）** 迁移/回滚：`SESSION_FORMAT_VERSION` 0→1 与 `session/repaired`、生成 registry、refusal 测试、fixture 同 PR；重写第 L 节（回滚=版本拒绝，非静默忽略）；rollout 文档写明"修复后不可回滚到旧构建读该会话"。
7. **L7（medium）** prompt 预算改 layered（源端上界 + compaction 保留额 + 终局 provider-aware 估算 + 可送达的拒绝）；MCP description/schema 在 sync 时设界。（"provider-aware 估算"按 G 节记录的采纳偏差落地为 advisory provider-agnostic heuristic；字节上限为 normative enforcement。）
8. **L8（medium）** fixture 策略按 H 节分层；不做 normalizer 大改。

## M. Recommended implementation / PR sequence

1. **PR-0** 基线恢复：attempt 事件入 fixture、stderr oracle 排除已知 Node 警告、EPERM 根目录迁入工作区。Exit：`test:snapshot` 全绿。
2. **PR-1** Sandbox authority：resolve/escalate API 拆分、authority 深冻结 + WeakSet 铸造检查 + fs/shell 必填参数迁移（全部在仓调用点）。测试先行（先红后绿）：E7/E15 永久化、构造伪造对象被成员检查拒绝。
3. **PR-2** Authorization：operationId + grant 消费 + 状态机 disposition + guard signal + collect 式 pre-execute + 单一审批点。测试先行：E1/E16/E17/E24 + late-allow 三例永久化。
4. **PR-3（原子）** Durability：`session/repaired` + `known-event-types` 生成 + `SESSION_FORMAT_VERSION=1` + JSONL 原子替换 + coordinator 传递 integrity + refusal 测试 + 新 fixture。测试先行：E13/E14/E27 翻转为"截断+显式 repaired"。
5. **PR-4** Projection single-flight + 生命周期竞态修正。测试先行：E10 + dispose-mid-flush 注入。
6. **PR-5** 验证资产：全部 31 实验按分层矩阵落库为 negative tests。
7. **PR-6** prompt/MCP 源端边界 + telemetry 限制文档化 + effects 目录生成。

依赖：PR-0 → {PR-1, PR-2}（并行）→ PR-3 → {PR-4, PR-6}；PR-5 与对应修复同 PR 或紧随其后。PR-3 是唯一 atomic PR。

## N. Design decisions that are still product decisions

1. deployment 是否为沙箱硬上限（是否禁止 escalation 到 danger-full-access）。
2. hooks 的 authority 语义（session-scoped vs trusted-host）——决定 hooks 决策能否参与 deny/ask 聚合。
3. 是否把 C（partially-trusted 插件）纳入威胁模型——若否，删除相关承诺，不加 WeakSet。
4. `session/repaired` 的模型可见形态（raw 事件 vs surface 摘要文本）。
5. MCP description/schema 的具体字节上限值。
6. idempotent 工具失败后的自动重试是否免二次审批。

## O. Residual risks after implementation

- 恶意进程内插件（D）：不受控；需进程/系统级隔离，本计划不覆盖，必须如实标注。
- 行内静默位翻转：无 per-record checksum 前检测不到；标注为 known limitation（future format 演进）。
- `/tmp` 与平台临时目录是 workspace-write 的恒定共享通道；威胁模型明示。
- 未 flush 事件在硬崩溃中丢失（checkpoint-policy 已覆盖两个关键点）；每事件 fsync 不引入。
- cwd symlink 换靶：保持 path-based 语义，恢复时展示解析结果（不强制 realpath 身份）。
- 历史 session 的 integrity 永为 `unknown`（无法追溯生成证据）。
- telemetry at-most-once（best-effort observability，非审计账本）。
- SDK 畸形帧静默丢弃（JSON-RPC 允许忽略无法关联的帧；加计数器）。

## P. Final answer

**是——在落实 L 节 8 项要求之后，本改造计划已安全且成熟到可以开始实施。**

理由：(1) 四个 root cause 全部经本轮独立复核成立（两处精确化不改变根因结构），不存在会推翻设计的更底层原因；(2) 三个 critical 缺陷（修复事务非原子、A6 不可验证、brand 虚假边界）都已被定位到具体机制和文件，且修复方案都是收敛性的（原子替换、状态机、WeakSet），没有引入新系统；(3) 全部需要的新机制（原子替换、collect 聚合、成员检查、single-flight）在仓库内已有同构先例（coordinator serialize、user-approval 竞态语义、repair closers、Landlock），不需要外部技术栈；(4) 过工程清单经过"删掉会复现哪个失效模式"的逐一拷问，只有 prompt 统一预算被删、fault-injection framework 被推迟，其余保留项均有实锤失败模式背书。按 PR-0 → PR-3 的序列执行，每步 exit criteria 明确、rollback 边界（版本拒绝）诚实，可以开工。

## 附：本轮评审证据索引

- 运行时探针（`.audit-tmp/approval-late-race.spec.ts`，3 例全过）：abort@10ms/allow@50ms → `cancelled` + 恰好一条 `approval/decided{cancelled}`；反序 → `allowed-once`；abort 后无状态污染。
- 静态复核：`normalize.ts:22-24`（seq 已被 scrub）、`commitRepair` 两步非原子（`session-persistence-jsonl/src/index.ts:436-450`）、`Branded` 纯类型（`packages/util/brand/src/index.ts`）、`assertEventsSupported` 拒绝路径（`coordinator.ts:1052-1065`）、`SandboxPolicyRequest.mode` 无证明覆盖、arguments 冻结先于策略管线（`core/tools/src/index.ts:1402-1412`）、sandboxPolicy 全部在仓调用点（tool-fs/tool-str-replace-editor/tool-bash/tool-pwsh/*-local/*-sandbox/terminal-bash；hook-protocol 无生产调用点）。
- 独立子评审 ×2（架构设计攻击、安全边界与迁移回滚攻击），各自结论与主审在 L1/L2/L4 上一致；子评审的关键反证（append-before-truncate 无效、A6 双缺口、C 级伪造可行）已吸收进本评审。
