# DSH 系统审计与收益评估（2026-08）

基线：tag `dsh-v0.1.1-rc.2`；分支 `dsh-core-stopgap`。
方法：8 个并行域审计（core-runtime / providers-llm / tools-shell-sandbox /
persistence-jobs-workflow / host-client-web / governance-skills / test-ci-dev /
bundles-boot）+ 会话日志取证（含 packed-rows 修正版）。
原则：收益优先；不破坏功能不是硬约束。

## 一、系统理解（总览）

- **运行时**：Cordis 插件树；profile=bundle 有序叠加（base/web-app/headless）；
  无特权核心，一切可替换。事件三分域：session 事件（持久事实）、agent 事件
  （在飞拦截）、capability 事件（接缝）。瀑布流事件（agent/pre-step、agent/request、
  llm/stream、tools/pre-execute/execute/post-execute、system-prompt/assemble、
  approval/request）通过 next() 委托。
- **会话**：append-only 事件日志为唯一事实源；模型可见=已记录（运行时不变式）。
  JSONL persistence 把连续 assistant/chunk delta **打包为无损 packed rows**
  （text/reasoning/tool-call-chunks）。
- **工具管线**：pre-execute（策略/否决）→ 单调 guard → execute → post-execute
  （替换/附加上下文）→ tools/result；调用按模型顺序提交，独占调用成屏障。
- **接缝**（~50 个 ctx.* 服务）：sessionPersistence、storage、shell、subprocess、
  sandbox、fs、terminals、jobs、workflowEngine、subagents、llm、skills、goals、
  approval、settings、credentials、sessionProjections、typertGateway 等。
- **治理**：approval fail-closed 一次性授权；plan-mode 仅提示非强制；hook 桥接
  外部策略到瀑布流；goal 有 CAS 与轮次上限；skill 有分层与调用策略。

## 二、取证修正（重要）

- 展开 packed rows 后：流式 delta 文本与最终 assistant/message **逐字节一致**
  （SHA-256 8e52c8d3…，标题各 11 次）。重复在**供应商交付的流中已存在**，
  排除 BlockAssembler/最终化引入。output-repetition-guard 落在持久化前的
  agent/stream-chunk，落点正确。
- 附带发现：packed rows 使基于日志的诊断工具（grep/session-query/未展开读取）
  看不见真实事件——首次取证因此得出错误结论。这是诊断工具链的实质弱点。

## 二·五、实施状态（截至 2026-08，分支 dsh-core-stopgap）

以下 P0 已实施并验证（每项红测→绿、build:lib 通过、oxlint 0 错误）：

| P0 项 | 提交 |
|---|---|
| 重复调用熔断 + 失败链（repeat-tool-reminder vetoAt/失败指纹） | dbfb10b88, eb7486e5f |
| 无效升级参数隐藏（escalation-hider） | dbfb10b88 |
| 输出重复检测 + 活体中止（output-repetition-guard） | dbfb10b88, 82e686e96 |
| 流终止语法强制（EOF 无 finish 即结构化错误） | 82e686e96 |
| packed-rows 日志取证工具（scripts/expand-session-log.mjs） | 82e686e96 |
| Stop-hook 续跑预算（stopContinuationLimit） | 4f78e37f2 |
| 部署级 goal 轮次 ceiling（maxGoalRoundsCeiling） | 4f78e37f2 |
| SSRF 防护（web-fetch-http 私网封锁） | 6392a4cb8 |
| 事务化 step 准入（准备失败恢复已认领输入） | 2b8dc1ce4 |
| 补丁契约断言（patch require） | 018097fd7 |
| 工具调用/结果闭合契约（TOOL_OUTCOME_UNKNOWN） | 71a046b3e |
| 请求尝试台账 + 核心 retry 预算 | 4ff49dfc7 |
| MCP 发现有界化（游标/页数/工具数/超时） | ed90413e6 |
| 有界 FrameQueue（丢旧 + 计数） | 581c24ec8 |
| 投影缓存重试事务化（dirtyStats 观测） | 6d8ba8fca |
| 类型化补丁操作（\$merge/\$unset） | 06135d51e |
| 持久编排日志（job/start + job/end 入会话） | dd9b78740 |
| 中央动作策略拦截器（action-policy-guard） | 51dfa5808 |
| 游标续传（mux since 增量重放，host 端） | fb768e955 |

## 三、收益排序行动清单

### P0（收益最高，建议先做）

| 项 | 域 | 收益 |
|---|---|---|
| 强制 LLM 流终止语法（EOF 无 finish 即协议错误） | llm | 防止半截输出被当成功提交 |
| 事务化 step 准入（claimed 消息在装配失败时保留/恢复） | core | 消除最高影响用户工作丢失路径 |
| 中央强制动作策略拦截器（approval/sandbox 覆盖所有副作用工具） | governance | 消除"工具自愿调用 approval"的漏洞 |
| 工具调用/结果闭合契约（step/end 前必须有结果或显式 UNKNOWN） | core | 日志无歧义，续跑/修复可靠 |
| 活体输出重复拦截（重复证据即中止，保留一份 canonical 副本） | host/guard | 根治重复输出事故 |
| SSRF 安全 web 传输（拦截回环/私网/元数据/重绑定） | shell | 消除最高危远程攻击面 |
| 持久编排日志（job/workflow 生命周期入会话事件） | persistence | 崩溃可恢复、事后可追溯 |
| 投影缓存重试事务化（成功后清脏） | persistence | 消除静默过期检查点 |
| 严格流就绪 + 游标续传（session/subscribed since） | host | 消除陈旧 UI、增量重放 |
| 有界队列/流控（host frameQueue / inbox / liveBuffer） | host | 防止高吞吐流内存失控 |
| Stop-hook 硬预算 + 真实 stop_hook_active | governance | 防止无条件 Stop hook 无限循环 |
| 部署级 goal 预算（硬上限 + token/时间/工具预算） | governance | 防失控自主运行 |
| 补丁契约带必需目标断言 | bundles | 升级/覆盖不再静默失效 |
| 类型化结构补丁操作（merge/set/delete 替代整行替换） | bundles | 新安全字段不再被旧覆盖抹除 |
| 运行时流协议校验器（单 finish、无后 finish、块生命周期） | llm | 所有 adapter 对直接消费者安全 |
| 失败安全增量用量（部分失败流保留已计费 usage） | llm | 用量不失真 |
| 持久定价/成本台账 | llm | 历史花费可复现 |
| MCP 发现有界化（游标去重、超时、取消） | llm | 防坏服务器无限分页 |
| 让 repeat 链真正连续（success/用户介入重置失败链） | guard | 防误熔断（本轮已修） |

### P1（收益中高）

- 一等公民请求尝试（retry 持久身份 + 核心预算）
- 失败指纹链的 post-execute 限制（无法预阻参数不同的失败调用）
- 输出重复强制模式的保守阈值与显式结果标记
- escalation-hider 改用权威服务（sandboxPolicy.resolve + approval 有效策略）
- 沙箱超越文件效果（容器/microVM/远程执行 + 网络策略）
- 安全策略成为 bundle 必需项（timeout/observation/sandbox 内在化）
- 增量 JSONL 索引/分段日志（readFrom/查询刷新 O(tail)）
- 默认增长域迁 SQLite（投影缓存等）
- 持久有索引 jobs provider
- Provider-aware token 校准
- 服务化用户问答超时/取消竞态
- plan-mode 真实只读工具档
- 可信技能来源策略（项目技能 opt-in）
- 关键重放/脚本按显式身份键控
- 原生 Windows 成为必需 PR 通道 / macOS 有 CI 信号
- GUI 覆盖率换成浏览器级
- 严格 assistant 折叠不变式（拒绝 block-end 后 delta）
- 流完整性元数据（每步 chunk 数/字节/哈希/终止原因）
- 补丁契约：缺失目标失败而非警告

### P2（后续）

- 持久文件观察缓存；事务化 schedule outbox；spill 留存策略
- 统一运维遥测；内容寻址 preset 代；版本化 profile schema
- 拆分单体 web roster 为能力 bundle；密钥重放脚本按身份键控
- 变更感知 pre-push 检查

## 四、审计发现的关键弱点（供决策参考）

- plan-mode 是建议不是安全边界；approval 'never' 只拦自愿请求 approval 的调用
- Codex Stop hook 存在无界续跑；hook 配置失败静默降级
- 项目级 skill 无信任分级，可被未受信仓库指令遮蔽
- goal 轮次上限默认 256 且模型可自定（工具描述允许推断意图）
- settings 无效热重载段静默保留旧值，配置漂移不可见
- 预设代（preset generation）泄漏 watcher/资源，reload 不回收
- patch 整行替换 + 缺失目标仅警告 → 升级静默失效风险
- macOS/Windows 原生 CI 缺失；GUI 覆盖被豁免
- web 服务器允许 0.0.0.0 且无 TLS/认证
- web fetch 无 SSRF 防护
- 沙箱仅约束文件效果，不约束网络/进程可见性
- MCP 断开重连期间死工具仍注册
- JSON storage 全域写放大；JSONL 读放大
- job/workflow 状态仅内存，崩溃即失
- packed rows 对诊断工具不可见（本次取证已踩）
