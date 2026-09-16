# Agent Note: 沙箱策略的授权由所有者铸造

Status: implemented

[English](2026-09-16-sandbox-policy-minted-authority.md) | 中文
## Problem

强制的沙箱后端从交给它的 `SandboxExecutionPolicy` 读取模式。该接口是结构化的，任何消费者都能拼出满足它的对象 —— 例如 `{ mode: 'danger-full-access', workspaceRoot: '/tmp' }`。没有任何东西把这个策略与解析它的服务关联起来，于是调用方构造的对象就能选择强制模式。工具的升级路径正是这么做的（`{ ...standingPolicy, mode: approvedMode }`），文件系统与 shell 的测试替身也一样。

该服务同样没有部署上限。`resolve()` 原样返回会话覆盖或已批准的升级模式，因此部署无法限制任何会话能到达的模式。

## Decision

本决定扩展[子进程沙箱决定](../feature/2026-07-06-sandbox.zh.md)；后者拥有隔离链、升级路径与按会话模式，这些决定依然成立。本 note 增加的是「谁可以选择模式」以及其上的部署上限。

`ctx.sandboxPolicy` 拥有模式选择权，并且是唯一签发强制后端所接受策略对象的来源。

- `Config.maxMode`（默认 `danger-full-access`，即此前可达的模式）为每次解析封顶。部署的 `mode` 若超过其 `maxMode`，在加载时即失败。
- `resolve()` 深冻结其返回值并记录进一个私有 `WeakSet`；`isMinted(policy)` 回答该对象是否由本所有者产出。
- 强制型消费者 —— 文件系统后端、两个 shell 执行器与 PTC Node 运行时 —— 仅在 `isMinted` 成立时接受调用方提供的策略；否则发出警告并重新解析为部署默认值，于是伪造的对象只会收窄，而不会变宽。
- 升级路径经由所有者铸造（`resolve({ session, mode: approvedMode })`），而不是展开既有策略，因此 `maxMode` 同样约束已批准的升级。
- `SandboxPolicyRequest.workspaceRoot` 让「从另一个世界收到模式与路径」的调用方为它们铸造本地授权，其优先级高于会话 cwd。SSH helper 用它把客户端发来的策略翻译进自己的文件系统：线上传来的值是意图，本地所有者才签发授权。
- shell 执行器在 `resolve`、`run` 与 `start` 三处校验溯源。只在 `resolve` 校验会让 spec 在解析与执行之间保持可变。

## Alternatives considered

**给策略接口加品牌。** 品牌化接口会把每个构造点变成编译错误，同进程消费者无需运行时检查，符合仓库对不透明跨边界值的规定。它无法覆盖 SSH helper —— 后者从线上解析策略，无论如何都必须在本地铸造，因此那条路径仍然需要运行时检查。作为后续工作推迟，以保持本次改动可评审。

**只在强制点检查。** 调用点更少，但伪造的策略会在任何检查之前就到达 `run` 里的模式分支。

**遇到未铸造策略直接抛错。** 失败得很响，但一次被拒绝的升级会让用户已经批准的调用直接中止，而不是在既有模式下运行。

## Consequences

部署可以用 `maxMode` 限制可达模式。此前自行拼装策略的消费者不再能生效：所有升级路径改为经由所有者铸造，文件系统、shell 与 SSH 的测试替身也已更新为铸造。仍然自行拼装的消费者会拿到部署默认值与一条日志警告，而不是它请求的模式。

覆盖情况：解析器测试钉住了「已批准覆盖封顶」「会话覆盖封顶」「加载期上限失败」「请求根优先」，以及「已铸造策略的浅拷贝无法通过 `isMinted`」。文件系统、shell 与 PTC 运行时测试钉住了「伪造的按次策略被忽略」与「所有者铸造的升级生效」；shell 测试另外钉住了「`resolve` 之后被换进 spec 的策略」，Seatbelt e2e 端到端钉住了升级重试。
