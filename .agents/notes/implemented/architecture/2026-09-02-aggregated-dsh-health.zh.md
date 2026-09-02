# Agent Note：聚合的机器可判定 DSH 健康检查（verify-health）

Status: implemented

[English](2026-09-02-aggregated-dsh-health.md) | 中文

## 问题

已验证基线拥有部署所需的每个独立信号——产物源身份、R2 关键血统门禁、profile 文件、宿主机前置条件——但没有任何一个机器可判定的入口把它们聚合成一个 PASS / WARN / BLOCK 总判定。判断整体健康只能靠人工逐个读命令输出。

## 决策

`scripts/verify-health.ts` 只是聚合层。它消费既有结果，不重新裁决任何一项：

- **identity** —— 已安装核心 manifest 的版本与 `dsh.sourceRevision`，走 R1 的读取器。
- **lineage** —— R2 检查器的判定（`checkCriticalResolutions` + 纯 Node 子进程解析器）；核心域的 MISMATCH 或 UNKNOWN 是 BLOCK，plugin-private pin 按 R2 的定义照常接受。
- **profiles** —— 对每个 profile 的 `package.json` 与 `cordis.yml`/`cordis.patch.yml` 做只读静态解析，并扫描 profile 顶层 `node_modules` 里被提升的关键包。刻意不用 `dsh --dump-config`：它会重写 profile 文件，既会改动用户 home，也会在写受限的执行环境里报假 BLOCK。profile 文件不可读/不可解析是 BLOCK；关键包出现在 profile 顶层是 WARN（R2 已证明解析拓扑使其无法遮蔽核心运行时，但这提示版本混乱）。
- **prerequisites** —— 代码运行时的 CPython ≥ 3.10 与 PTY 可用性，均为 WARN 级环境债。

判定规则：BLOCK 是本构建能证明已损坏的事实；WARN 是环境债或非遮蔽性信号；其余为 PASS。退出码：0 PASS、1 BLOCK、2 WARN。入口是 `pnpm run verify-health -- --install <核心包根目录>`。

## 后果

- 五个 R2/健康场景由 `scripts/verify-health.spec.ts` 钉住：健康 → PASS；错血统 → BLOCK；缺出处 → BLOCK；环境债 → WARN；plugin-private 兼容 → 绝不 BLOCK。
- 对真实全局安装运行：identity PASS、lineage 7/7 PASS、profiles PASS，仅对宿主机 Python 3.9 与沙箱屏蔽 PTY 报 WARN——与已记录的环境债一致，而不是假 BLOCK。
- 未引入任何修复权威或运行时语义：入口只读。R4（doctor/恢复）仍不在范围内。

## 备选方案

- 恢复旧 fork 的 `dsh assess` 命令：否决——其实现已不存在，其表面（patch manifest、drift）已被 R1/R2 取代；在现有信号上新建薄聚合层比重建它更小。
- 用 `dsh --dump-config` 做 profile 组合检查：否决——非只读（重写 profile 文件），会在沙箱里产生假 BLOCK，并在健康检查时改动用户 home。
- 把入口放进 `apps/cli`：本轮否决——会改变发布的 CLI 表面并要求重新部署全局候选；仓库侧 gate 消费相同信号，日后可再提升进 CLI。
