# Agent Note: `dsh assess` — 只读运行时身份与健康报告

Status: implemented

English | [中文](2026-08-30-dsh-assess-command.zh.md)

## Problem

`dsh` 只有配置/启动/插件三种模式，缺少一个**不启动 tree、不写任何路径**的命令来回答「当前安装实际运行的是什么」：版本、node、profile 组合、patch layer digest、registry 通道与一组安全健康探针。此前这类事实分散在外部脚本与部署文档里，无法由一个命令绑定到同一运行身份；升级/回滚评估因此缺少可复现的 baseline。

## Decision

新增 `dsh assess`（`apps/cli/src/assess.ts`）：boot-free、side-effect-free。它读取 profile 目录与 registry 通道，运行一组只读探针（`identity.complete`、`profile.patches`、`update.stable`、`update.prerelease`、`liveness.process`、`gui.reachable`、`credential.isolation`、`readiness.files`），输出 `PASS/WARN/BLOCK/NOT_TESTED/STALE` 与 `overall`。`--json` 输出版本化 JSON；`--profile`/`--port` 可选，默认 profile 取 `$DSH_PROFILE` 后 `web`，默认 port 3080。

不做：本命令永不获取/散列凭据，永不写入 profile 目录，永不触发更新或晋级。需要 booted tree、候选运行时、完整测试或外部密钥的检查一律 `NOT_TESTED`，留给 candidate gate。特定部署的更深度本机分析（source-vs-runtime 漂移、Doctor supervisor、patch-set manifest）刻意不放进这个可移植命令，而由部署自有工具绑定到显式运行身份。

`args.ts` 的 `DshInvocation` 增加 `mode:'assess'`；`bin.ts` 动态 import `./assess.ts` 并 `await printAssess(...)` 后 `process.exit`。

## Consequences

- 新增一个 launcher 模式，`--help` 示例与 `apps/cli/README.{md,zh.md}` 已列 `dsh assess`。
- 无新增运行时依赖（复用 `@deepseek-ai/dsh-home-paths` 与 node 内置）。
- 测试：`apps/cli/tests/args.spec.ts`（解析）与 `apps/cli/tests/assess.spec.ts`（临时 DSH_HOME + profile 的行为）。
- 退出码：`BLOCK`→2，`WARN`/`STALE`→1，否则 0，使 CI/脚本可按严重度 gate。
- 更深的个人平台分析仍由 `~/Projects/dsh-assess` 承担；本命令保持可移植。

## Alternatives considered

- 只在部署自有脚本里保留分析、不新增 CLI 命令。否决：事实分散、无法绑定到一次运行的可复现 baseline。
- 复用 `--dump-config` 式的组合来做更深的 tree 报告。否决：需要进入/导入组合会让 `assess` 不再只读，并耦合组合有效性。
- 让 `assess` 同时跑完整测试或候选运行时。否决：那属于 candidate gate；`assess` 保持快速、boot-free、始终安全的一层。
