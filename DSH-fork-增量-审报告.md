# DeepSeek Harness 个人 fork 增量专项审报告

> 审查对象：你的 fork（`dsh-core-stopgap`，基于 v0.1.1-rc.2 的 **35 个本地提交**，159 文件 / +8339 行）
> 方法：三路并行，逐文件 `git diff origin/master...HEAD` + 当前文件通读，只读未构建/测试。
> 分簇：A=新增模型工具 · B=加固改动 · C=可靠性/编排改动

---

## 0. 一句话结论
**底层可靠性改造（事务化 step 准入、tool/call↔result 闭合契约）可信、无数据损坏类缺陷；但你新加的 `tool-browser`/`tool-service` 引入了"回到原版安全短板"的高危问题（SSRF/任意文件读/绕沙箱任意命令），且你为堵 SSRF 加的那层既把公网抓取弄挂（回归）、又没真堵住（IPv4-mapped/NAT64 仍可绕过）；`action-policy`/`output-repetition` 两个 guard 的实际效果弱于预期。** 建议在依赖这套做产品前，先修"高危 + 回归"这批。

---

## 1. 高危 / 必须修（先于一切）

### 1.1 tool-browser = 无策略的 SSRF + 任意本地文件读（A）
- **SSRF**：`page.goto(args.url)`（`packages/extensions/tool-browser/src/index.ts:99`）**不校验协议/地址**。模型可导航 `http://127.0.0.1:<port>` / `http://169.254.169.254/latest/meta-data/` / 任意内网，再 `read_text`（index.ts:124-129）把页面读回上下文。重定向自动跟随无逐跳检查，无 DNS-rebinding 防护；恶意站点页面内 JS 还能向内部服务发请求（盲 SSRF）。
  → **与你刚在 `web-fetch-http` 加的 `isBlockedAddress`/`checkTarget`（policy.ts:56 / provider.ts:112）直接矛盾：你修掉的那个洞，在新工具上原样复活。** 工具自带测试就用 `http://127.0.0.1:<port>`（tool-browser.spec.ts:41），佐证回环可达。
- **`file://` 任意文件读**：`goto('file:///Users/xx/.ssh/id_rsa')` + `read_text` = 无上限、无日志化的第二本地读通道。
- **`screenshot_name` 路径穿越**（index.ts:107-109）：`join(screenshotDir, name)` 不校验，`../` 逃逸，且直接 `node:fs` 写 PNG → **绕过 fs-sandbox 围栏**。

### 1.2 tool-service = 无沙箱的任意命令执行器（A）
- `spawn(input.command, { shell: true, detached: true })`（`packages/extensions/tool-service/src/registry.ts:199`）以 harness 完整权限跑**任意 shell 命令**，**不经过 bash 沙箱（SandboxBashExecutor/Seatbelt）也不经过 fs-sandbox**，且 `action-policy-guard` 默认 observe（base/cordis.patch.yml:425-429）→ **start 无审批**。
- 影响：你全套 workspace-write 围栏/escalation 语义对这条通道**整体失效**。模型可 `service_manage start` 一个 `cat /etc/shadow`/写任意文件/任意外联的进程。

### 1.3 SSRF 加固 = 功能回归 + 真绕过（B）
- **回归（高）**：`isBlockedAddress` 对**任何非 IP 字符串直接 `return true`**（`packages/web/web-fetch-http/src/policy.ts:94`）；而 `checkTarget` 把 hostname（如 `example.com`）直接喂给它（provider.ts:121-124）。默认 `blockPrivateAddresses:true` → **所有公网域名 fetch 全被拒**（`WEB_BLOCKED_URL`）。**测试全用 `blockPrivateAddresses:false`，漏检了这次回归。**
- **绕过（高）**：Node `lookup` 返回 IPv4-mapped 为十六进制（`::ffff:127.0.0.1` → `::ffff:7f00:1`），policy.ts:89 正则只认点分十进制 → `::ffff:7f00:1`、`::7f00:1`、NAT64 `64:ff9b::…` 全部放行；叠加 lookup→fetch 间可重解析的 TOCTOU = **DNS rebinding / NAT64 绕过仍成立**。
- **死代码**：`url.hostname` 带方括号 `[::1]` → IPv6 分支是死代码；字面量靠 `lookup` ENOTFOUND "碰巧"失败关闭（但报 `WEB_PROVIDER_ERROR` 而非 `WEB_BLOCKED_URL`）。

---

## 2. 中高 / 建议近期修

### 2.1 action-policy-guard 的 enforce 不可靠（B）
- 用的**可被后注册 listener 覆盖的水瀑布**，而非单调的 `tools.guard()`；且 `effects` 元数据**几乎为空** → "副作用工具不再绕过审批"这个承诺**实际不成立**。escalation-hider 有 code-mode SDK 泄漏 + `apply_patch` 未覆盖。

### 2.2 output-repetition-guard 基本无效（B）
- 只对"整缓冲精确周期"生效；实测**带 4 字符尾缀即永久漏检**、100 字符粒度 10×64+tail 零命中。

### 2.3 MCP 同步：单个挂起的 `tools/list` 不受 `syncTimeoutMs` 约束（C）
- `packages/mcp/mcp-client/src/tools.ts:78-83` 的 `listToolsUncached` **未传 `signal`/`timeout`**（对比 `callToolUncached` 传了）；页上限只约束次数、光标循环只约束分页，**单次请求无超时** → 坏服务器可卡死启动，`syncChain` 被同一 promise 阻塞。

### 2.4 LLM 流语法强制无法终止"永不结束"的流（C）
- `packages/llm/llm/src/index.ts:947-989`：`finished` 只在收到 finish/done 时改变；adapter 一直产出 chunk 且永不 done/finish → 循环永不退；`agent-loop/src/agent.ts:389-395` 每 chunk 都 durable append（内存/磁盘无界增长）→ 只能外部 cancel。

### 2.5 FrameQueue 丢头静默丢失（C）
- `packages/host/apiproxy/src/api-proxy.ts:376-384`：满 10k 时 `buffer.shift()` 丢最旧帧并 `dropped++`，但 `dropped` 从不随帧下发；重连重放会**在基线帧 `session/subscribed` 之前**一次性 push 大量帧，慢客户端连基线都被裁。客户端无带内缺口信号，UI 静默停在陈旧视图。

### 2.6 projection-cache 重试一次耗尽 + 定时器槽位陈旧（C）
- `packages/session/session-projection-cache/src/index.ts:278-286`：`markClean` 不清 `retries`/`failures`；`:267-273` 每次 `retries -= 1` → **3 次预算对整 session 一次性耗尽**，后续失败不再自动重试；interval 回调不清 `state.timer`（`:226-228`），触发后 `state.timer ??=` 不再重武装 → **"失败检查点永久陈旧"仍可发生**（恰是你声明要修的）。

---

## 3. 中低 / 打磨

- **tool-service**（A）：进程树杀不干净（`detached:true`，孤儿风险，与系统提示 "every process is killed" 不符）；`healthOk` 裸 `fetch` 无 SSRF + `isPortInUse` 是回环端口 oracle；`tailLog` 整读无上限/日志无轮转可耗尽磁盘；`id` 路径穿越（`join(root, id+'.log')`）；workdir 默认错（进程 cwd 而非会话 cwd）；PID 复用误杀。
- **MCP 页**（C）：整页构建后检查 `maxToolsPerServer`（单页 100k tool 瞬时尖峰）；新配置字段无 `.min` 约束。
- **write/observed**：`apply_patch` diff 头路径缺 `..`/绝对路径校验（注入面更大）、无文件大小上限、新文件补丁报错措辞误导；`observed-read` `tail -f`/`grep -I` 误解析（漏报安全侧）、观测版本不落会话日志（侧信道）。
- **cancel keepInbox**（C）：`cancel({keepInbox:true})` 在 preStep 准备窗口内丢失已认领批次；注释"decides whether pending work survives"未实现。
- **attempt-start 悬空**（C）：`agent/request-error` waterfall 在 try 之外抛错 → `attempt-end` 缺失，破坏自身记账。
- **assertPatchContracts 只在离线 dump 路径**（C）：真正 boot/部署路径不强制，`require` 目标仍可静默失效。

---

## 4. 做得对（避免误报，值得肯定）
- **事务化 step 准入**（C）：claim/restore 是 append-only 日志下唯一正确的"事务"形态；单 driver 互斥保证无并发二次 claim；崩溃窗口与基线相同，非回归。
- **tool/call↔result 闭合契约**（C）：无孤儿、无"永久欠账"；session invariant 硬性校验同 step 配对；scheduler 失败对 `[committed,started)` 逐个落 outcome-unknown。
- **重试预算硬有界**（`maxRequestAttempts`=16，超限抛 `REQUEST_ATTEMPTS_EXCEEDED`），无无限重试。
- **goal ceiling 不可绕过**（create/edit 均 clamp；`roundsStarted` 只能由 `<goal_round>` 增加；edit 至多到部署预算）。
- **MCP 分页**：页上限/光标重复检测/页间 deadline 正确。
- **escalation 同级归一化**（B）：正确、无授权绕过、审计保留。
- **hooks-codex / mux 游标续传 / session 事件信封 / known-event-types 同步**（C）均正确、无孤儿泄漏。

---

## 5. 一致性偏差（框架惯例）
1. 新 log-only 事件（`request/attempt-*`、`job/start|end`）append 时**未标 `{ ignorable: true }`**（而 `action-policy/candidate` 标了）→ 旧构建读本 fork 日志会整体拒读（required-on-read）。
2. `switch(action)` 无 `assertNever` 兜底（tool-browser/index.ts:95-140、tool-service/index.ts:131-170）。
3. 硬编码 tunables 未进 Config：`tool-browser` `timeout:30000/10000`、`tool-service` `2000/1500/100ms`、`DEFAULT_MAX_QUEUED_FRAMES`（api-proxy.ts:360）。
4. `ownerSessionId?: string` 忘了用 branded `SessionId`；`ServiceOwnerAgent = Agent` 无使用者（YAGNI）。
5. README 未披露 tool-browser 的 SSRF/file:///screenshot 穿越风险；系统提示与进程树事实不符。
6. `effects` 声明策略不对称（browser/service 声明 side-effectful，apply_patch/edit/write/bash 不声明）。
7. `dirtyStats` 前叠了两个 JSDoc（残留草稿）；`failures` JSDoc 声称 "consecutive" 实为累计值。
8. FrameQueue `shift()` 是 O(n) memmove（不改内存上界，属不必要 CPU）。

---

## 6. 优先级修复清单（建议先修这些）
| 优先级 | 问题 | 修法（方向） |
|---|---|---|
| **P0** | 1.3 公网抓取回归 | `isBlockedAddress`：非 IP 输入当 hostname 交给 DNS 解析判断，而非一律 `return true`；补 `blockPrivateAddresses:true` 下的公网 hostname 测试 |
| **P0** | 1.3 SSRF 绕过 | 用 `node:net`/`dns.lookup` 的 `all:true` 解析并把 IPv4-mapped/NAT64 归一化到点分十进制再判；DNS 结果 pin 到 socket（复用 `web-fetch-http` 的 `network.ts` lexing） |
| **P0** | 1.1 tool-browser SSRF/file/穿越 | 协议白名单 http/https；goto 前后 + 重定向后解析 hostname 拒绝回环/私网/链路本地；`screenshot_name` 用 `basename`/拒绝路径分隔符，写入改走 `ctx.fs` |
| **P0** | 1.2 tool-service 绕沙箱 | start 强制走 `ctx.shell` 沙箱（带 sandboxPolicy）或强制每 start 走 approval；README 明示"不受沙箱约束" |
| **P1** | 2.1 action-policy enforce | 改用单调 `tools.guard()` 而非可覆盖水瀑布；为副作用工具补全 `effects` 元数据 |
| **P1** | 2.3 MCP 单请求超时 | 为每次 `listToolsUncached` 传从 deadline 派生的 timeout/AbortSignal |
| **P1** | 2.4 流语法失控 | adapter 加 wall-clock 截止 / max-chunk 预算，超限合成 `STREAM_UNTERMINATED` 错误 finish |
| **P1** | 2.5 FrameQueue 丢头 | 基线帧或首个 drop 时下发带 `dropped` 计数的 `session/resync`，客户端据此带游标重订阅 |
| **P1** | 2.2 output-repetition | 改"前缀重复 + 滑动窗口"检测，覆盖真实粒度与尾缀 |
| **P2** | 2.6 / 3 系列 | `markClean` 重置 retries/failures；interval 回调先清 timer；进程组 `kill(-pid)`；log-only 事件补 `ignorable`；把 `assertPatchContracts` 挂进 boot 路径 |

---

*审查证据基于三路子代理：A=新增工具（tool-browser/tool-service/apply_patch/observed-read）、B=加固（SSRF/escalation/action-policy/escalation-hider/output-repetition）、C=可靠性集群。每条含 file:line+证据，详见各集群报告。*
