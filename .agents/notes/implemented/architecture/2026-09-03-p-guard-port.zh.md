# Agent Note：P-GUARD 移植（candidate seam 上的中央 action-policy 拦截）

Status: implemented

[English](2026-09-03-p-guard-port.md) | 中文

## 问题

M4 确认 candidate 完全缺失 action-policy guard：不存在中央 policy 拦截，敏感工具体只有在它们自愿请求审批时才被门控，base bundle 不编排任何 guard 行，因此打包的 candidate 缺失关键能力（R2 candidate-absent）并产生真实的 profile 兼容性故障。

## 决策

把已验证 guard 的语义移植到 candidate 自己的 seam 上，而非移植其源码：

- **中央拦截**——在 `ctx.inject(['tools'])` 下安装 `tools/pre-execute` 监听器，按 deny > ask > allow 与调度器折叠，使 ToolRuntime 权威域内的每次执行无论监听器顺序如何都经过同一 policy seam。
- **shipped 分类**——`ToolDefinition.effects`（`'read-only' | 'side-effectful'`），仅由发布定义声明。fs write/edit、bash、pwsh 发布 `side-effectful`；fs read/read-image 发布 `read-only`；其余未声明者（含 MCP 工具——其元数据从不填充该字段）按 `treatUndeclaredAsSideEffectful` 默认被门控。MCP/自报 effects 保持不可信。
- **observe/enforce**——`observe`（默认，base bundle 的模式）记录最小 `action-policy/candidate` 事件并放行；`enforce` 结构性失败关闭（无审批服务或无 agent ⇒ deny）或返回 `ask`，进入 P-AUTHZ 的单一审批点。guard 从不铸 grant、从不二次询问、从不授权——P-AUTHZ 仍是唯一执行权威。
- **bundle 集成**——base bundle 编排该行（observe 模式）并在依赖中声明该包，使 `verify-cordis-config` 可解析、打包的 candidate 携带该能力（R2 既有的七名关键清单随之关闭）。

## 后果

- 新包 `@deepseek-ai/dsh-action-policy-guard`，含移植的 observe/enforce 套件（18 条永久测试，包括执行尝试授权契约）；base bundle 规格钉住编排行与依赖声明。
- 反事实 RED 并 md5 恢复：A（移除拦截器）破坏 observe/enforce 拒绝测试；B（ask 短路为 allow）破坏七条授权测试；C（折叠旁路发起第二次审批）破坏八条单审批测试；D（移除 bundle 行）破坏编排测试。
- 审计链测试断言 asked→call→result 按 operation id 连接，decided 按审批 id 配对（`approval/decided` 上的 operationId 仍为 deferred P2）。

## 备选方案

- 第二套 policy DSL 或 guard 自有的审批服务：否决——candidate 的 `tools/pre-execute` 折叠与 P-AUTHZ 的单次询问才是权威 seam；guard 只分类并委托。
- 从 MCP `tool.execution` 元数据发射 effects：否决——桥接传输的元数据绝不是信任权威。
