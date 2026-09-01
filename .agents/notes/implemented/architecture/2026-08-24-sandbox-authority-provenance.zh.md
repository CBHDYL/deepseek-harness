# Agent Note: 带部署上限的铸造式沙箱授权

Status: implemented

[English](2026-08-24-sandbox-authority-provenance.md) | 中文

## Problem

沙箱策略所有者（`SandboxPolicyService`）解析每次能力调用的 `SandboxExecutionPolicy`，但执行侧后端原样接受调用方提供的任何策略对象：`FileSystem.writeText(..., sandboxPolicy?)` 与 `ShellExecRequest.sandboxPolicy` 直接携带调用方选择的字段，而省略参数时回落部署默认值并忽略会话收窄后的模式。因此部分可信的进程内插件可以构造 `{ mode: 'danger-full-access', workspaceRoot: '/…' }` 并在一切授予之外执行。另外，没有任何机制把已批准的升级或会话覆盖限制在部署自身策略之内——一个只打算允许 `workspace-write` 的部署仍可能达到 `danger-full-access`。

## Decision

`SandboxPolicyService` 铸造每一个解析出的授权：`resolve()` 冻结返回的策略对象并记入私有 `WeakSet`，`isMinted(policy)` 回答来源。执行侧后端（`dsh-fs-sandbox` 的 `checkedTarget`；`dsh-bash-sandbox` 与 `dsh-pwsh-sandbox` 的 `resolve`、`run`、`start`）只接受铸造过的授权；遇到伪造对象时记录警告并自所有者默认值重新解析——伪造对象声明的字段永不生效。`tool-fs`、`tool-bash` 与 `tool-pwsh` 的升级路径改为通过 `sandboxPolicy.resolve({ session, mode })` 铸造已批准的模式，而不是展开一个自行构造的对象。

服务新增 `maxMode` 配置：部署硬上限，默认 `danger-full-access`（保留原有语义——批准的升级可以到达最宽模式）。`resolve()` 把生效模式（默认值、会话覆盖或批准升级）封顶在 `maxMode`，且部署默认值宽于自身上限时在加载阶段报错。

`ResolvedSandboxAuthority` 品牌类型供调用方在编译期表达意图，但运行时边界是 WeakSet 成员检查。本检查不宣称以下内容：伪造回落是部署默认值（可能宽于会话收窄后的当前模式）；铸造出的授权可被捕获重放；`resolve({ session, mode })` 仍可直接调用到 `maxMode` 上限。这些是操作绑定授权（PR-2）的收口。它也不是恶意代码边界：能够补丁服务或接触无限制能力的插件仍在威胁模型之外。

## Verification

`sandbox-policy` 测试钉死上限对批准升级与会话覆盖的封顶、铸造与伪造的来源区分，以及默认值高于上限时的加载报错。`fs-sandbox` 测试证明伪造的按调用策略被忽略并由部署默认值约束、所有者铸造的升级通过栅栏，并钉死 PR-1/PR-2 边界语义（伪造回落可能宽于会话收窄）。`bash-sandbox` 与 `pwsh-sandbox` 测试在 `resolve()` 及 run/start 替换攻击处钉死伪造对象拒绝（换入已解析 spec 的策略会重新解析为部署默认值，而不是按伪造字段执行）。`tool-pwsh` 测试钉死超出 `maxMode` 的批准升级被封顶。既有的按调用升级测试改为经所有者铸造策略。升级类 ACP 快照（escalation-approved/rejected）不变，因为铸造不增加任何持久化字段。

## Alternatives considered

- **仅品牌类型** — 拒绝：TypeScript 品牌在运行时被擦除，编译后的 JS 插件可以构造结构相同的对象；WeakSet 检查才是边界。
- **密码学能力签名** — 拒绝：对同进程信任边界而言是过度工程；注册表铸造的成员检查效果相同且无需密钥管理。
- **fs/shell 服务定义改为必填授权参数** — 推迟：裸（无约束）后端合法地运行在没有策略服务的组合里，而运行时来源检查已在不破坏该组合的前提下关闭伪造对象路径。

## Consequences

升级请求仍在工具层经 `approveEscalation` 批准；`resolve({ session, mode })` 仍可被直接调用，因此进程内调用方可以无需批准地把升级授权铸造到 `maxMode` 上限。默认 `danger-full-access` 上限保留了历史的自助语义；要求批准认证升级的部署必须把 `maxMode` 设为受限模式，或等待操作绑定的批准授权（remediation PR-2），后者从构造上关闭该路径。伪造授权在后端消费策略的所有位置被拒绝；省略策略仍回落部署默认值而非会话收窄模式——在服务定义要求必填授权之前，这是会话作用域直接调用方的已记录缺口。
