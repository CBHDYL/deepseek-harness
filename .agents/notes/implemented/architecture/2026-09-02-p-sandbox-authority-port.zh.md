# Agent Note：P-SANDBOX 权威端口（部署上限 + 铸造出处）

Status: implemented

[English](2026-09-02-p-sandbox-authority-port.md) | 中文

## 问题

候选上游的 sandbox policy 每次调用都解析出一个普通 `SandboxExecutionPolicy` 对象，而强制执行的 fs/shell 后端信任调用者盖章的任何对象。调用者构造的 policy——spread 克隆、JSON 往返、或声称 `danger-full-access` 的普通字面量——都携带完整权威；并且不存在高于会话覆盖、工具请求或已批准升级之上的部署上限。

## 决策

不变量在候选 seam 上恢复，不 cherry-pick：

- `packages/sandbox/sandbox-policy` —— `Config.maxMode`（默认 `danger-full-access`；schema 校验）。每个 `resolve()` 结果被截断为 `min(requested, maxMode)`，随后 `deepFreeze` 并登记进私有铸造 `WeakSet`；`isMinted(policy)` 是唯一出处。解析出的 policy 是唯一权威形态。
- `packages/fs/fs-sandbox` —— `checkedTarget` 只接受铸造过的 policy；伪造对象回落到部署默认（≤ maxMode）。
- `packages/shell/bash-sandbox` / `pwsh-sandbox` —— `resolve()` 只盖章铸造过的调用者 policy；`run()` 在消费点复检，resolve 之后被替换的 policy 同样回落到部署默认。
- `packages/fs/tool-fs` / `tool-bash` / `tool-pwsh` —— 升级不再组装 `{...policy, mode: approved}`；已批准模式经 owner 重新铸造（`sandboxPolicy.resolve({ session, mode })`），结果被截断且保留出处。

编码了过时"调用者自盖章"语义的上游测试已改为经 owner 铸造（升级意图不变）。新增永久测试：`sandbox-policy/tests/authority.spec.ts`（铸造/伪造/spread/JSON/上限/重铸/schema）以及 fs 与 bash 套件中的"伪造与铸造"执行用例；pwsh 执行与 bash 构造性同构（本机 pwsh-gated）。

## 后果

- 反事实 RED 并恢复（md5 校验）：`isMinted` 恒真 → 6 个伪造测试失败；maxMode 截断移除 → 3 个上限测试失败。
- 回归：sandbox 家族 + tool-fs/tool-bash/tool-pwsh 套件全绿（482 passed / 7 平台 skip）；typecheck 0；oxlint 0。
- 遗留（与已验证不变量一致）：伪造 policy 在会话收窄默认下解析为部署默认而非会话模式——直接 capability 调用者不由 policy owner 做会话收窄；会话收窄由工具层负责。

## 备选方案

- 直接拒绝伪造 policy 而非回落部署默认：否决——已验证的回落语义让伪造输入保持惰性，而不是把缺戳 bug 变成硬失败面。
- 用可复制字段盖出处：否决——任何字段都可复制；WeakSet 成员资格是唯一不可复制的出处。
