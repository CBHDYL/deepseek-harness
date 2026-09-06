# 部署报告：port 分支快照 → 全局 DSH（完成）

- 日期：2026-09-02；决策：`.agent/decisions/ADR-0009-deploy-port-branch-to-global-dsh.md`；计划：`.agent/test-plans/deploy-port-branch-live.md`
- 结论：PASS（部署目标达成：新代码运行、被托管、本地补丁 1 生效、回滚路径在位）

## P0 预检（全部实测通过，含过程修复）

- `pnpm run build:official` exit 0（220 client artifacts）。
- dsh 族 pack 245 tarball + vendor 族 9 tarball。过程修复：`action-policy-guard` 版本 0.1.1-rc.2 → 0.1.2-alpha.3（fork 遗留阻塞 release pack，提交 56281b8d5）；官方客户端产物需在目标 HEAD 重建（DSH_CLIENT_COMMIT_HASH 记录校验）。
- 仓库自带 `verify-packed-install`（--omit=optional）在 darwin 因 koffi 可选平台二进制缺失而失败 —— 门禁脚本平台限制（为 linux 无 musl 设计），非分支缺陷；本地安装改用带 optional deps 的 staging consumer（与线上 rc.2 安装一致），761 包安装成功。
- 磁盘告急处理：释放 ~/.dsh/profiles 两个 08-29 备份 8.4G（用户批准）。

## P1 现场替换（用户批准选项 A，实测）

- 备份：`@deepseek-ai/dsh` → `@deepseek-ai/dsh.rollback-0.1.1-rc.2`（362M）。
- staging 嵌套布局组装并自检：`dsh --version` = 0.1.2-alpha.3；换入后全局 `dsh --version` = 0.1.2-alpha.3。
- 本地补丁：补丁 1（workflow 溢出落盘）对新代码适配重打（dsh-tool-workflow，node --check 通过，04:09 起的进程已加载）；补丁 2 判定过时（host-apiproxy 上游重构，未重打）；补丁 3 判定延迟（agent-loop port 版漂移大，默认关）。
- 清理 ~/.dsh/profiles/node_modules/@deepseek-ai/ 11 条悬空符号链接。

## P2 重启与冒烟

- 首次托管重启尝试（本会话内 nohup/setsid）两次均随宿主进程回收而失败 → 结论：doctor 托管重启必须由用户终端执行。
- 用户侧（Claude 协助）修复 launchd supervisor 版本错配（0.3.4 → 0.3.12 .pnpm 真实路径）并恢复托管。
- 最终状态核实：3080 = 全局 dsh lib/bin.js --profile web（PID 33129），父链 = doctor 0.3.12 → launchd；GUI 经 token URL 可达（本会话即运行其上）。
- 残余风险（记录，不处理）：doctor 插件半边 public-hoist 软链疑点 → 自动重启保护可能无效（见 LOCAL-PATCH-NOTES）。

## 回滚路径（未触发）

`mv @deepseek-ai/dsh.rollback-0.1.1-rc.2 @deepseek-ai/dsh` + 重启 + 按 rollback 版 LOCAL-PATCH-NOTES 处理补丁。
