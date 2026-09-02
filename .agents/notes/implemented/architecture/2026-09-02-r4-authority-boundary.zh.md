# Agent Note：R4 诊断与修复权威边界

Status: implemented

[English](2026-09-02-r4-authority-boundary.md) | 中文

## 问题

三方都可能声称拥有 DSH 的诊断与修复职责：已验证基线的健康入口（R3）、已删除的旧 fork M3 doctor、以及接入 web profile 的第三方 `@linxin666/dsh-doctor`。没有任何记录说明谁权威、谁只是建议性、谁可以改动运行时状态。

## 决策

基于 2026-09-02 R4 审计证据，权威边界声明如下。

**诊断权威（已验证基线）**：fork 的只读 `verify-health` 入口（R3）与 R2 关键血统门禁的聚合。它们是 `dsh-0.1.2-alpha.5-verified` 血统的权威 PASS / WARN / BLOCK 判定，永不写入。

**修复权威（已验证基线）**：无。fork 刻意不拥有任何修复编排器：R1–R3 只读，PR1–PR6 只管运行时内部语义，旧 M3 doctor 已在 baseline sanitation 中删除。构建修复编排器是另一项大型决策，本轮不承担。

**第三方 doctor**：`@linxin666/dsh-doctor@0.3.12`，以 `web-ui-doctor` 接入 web profile（profile `cordis.patch.yml` 设 `autoMigrate: false`，即 2026-08-30 M3 决策），其 `/api/doctor/*` 表面在运行中的 web 里是活的（认证门控，无凭据返回 401）。它提供 Supervisor、launcher 监护、救援胶囊（以 0600 镜像凭据；`DSH_DOCTOR_CREDENTIALS=off` 可关闭）、带门控晋级的分阶段确定性修复、隔离区回滚、插件隔离。分类：**建议性（advisory）**——用户调用且受门控（`autoRepair` 默认 `false`），位于已验证血统之外（未经评审的第三方代码），其凭据镜像表面需要 owner 明确接受。当 owner 选择通过它修复时它是事实上的执行者，但没有任何 fork 门禁或声明背书它为权威。

## 后果

- 不存在自动的重复权威：R3 从不写入，doctor 的自动干预受 `autoRepair: false` 门控。
- 两个用户触发的写入者可能触碰同一批 profile 文件（`dsh plugin` 与 `dsh-doctor repair`）；二者不得并发运行。记为操作注意事项，非代码缺陷。
- 修复失败语义按 doctor 自身契约是 fail-loud：分阶段事务、原子晋级或回滚、隔离区、退出码 0 正常 / 1 已修复并验证 / 2 需注意 / 3 阻塞。
- 任何未来 fork 侧修复能力都必须消费 R1/R2/R3 信号与 doctor 现有事务原语，而不是另建一套检查或修复路径。

## 备选方案

- 把第三方 doctor 定为权威：否决——它是未经验证的第三方代码，位于已封板血统之外；背书为权威会让未经评审的修复代码获得与已验证基线同等的地位。
- 现在就构建 fork 自有的修复编排器：否决——那是修复架构，本轮明确不承担。
- 把第三方 doctor 从 profile 移除：否决——它是 owner 安装的 profile 组合，且其 `autoRepair: false` / `autoMigrate: false` 姿态与审计一致；移除是 owner 的决定，不是审计要求。
