# Agent Note: 带四类结果分类的浏览器验证工具

Status: implemented

[English](2026-09-05-browser-verification-tool.md) | 中文

## 问题

计划的浏览器验证步骤需要一个冒烟级 Web 验证能力，但 fork 时代的 `tool-browser` 包已在基线清理（c2f62f965）中被删除，其契约不能整体恢复：加固前的版本直接导航原始 URL（`file://` 任意读取）并写未消毒的截图路径（路径穿越）。

## 决策

以历史契约为唯一参考，把能力重建为按需启用的插件 `packages/web/tool-browser`。冻结契约：动作 `goto`/`read_text`/`click`/`fill`/`screenshot`/`close`/`list`（`click`/`fill` 随可用性工作流在用户明确需求下落地；`goto` 带可选 viewport）；每个结果携带且仅携带 `PASS`/`PRODUCT_FAILURE`/`INFRA_FAILURE`/`POLICY_FAILURE` 之一；策略拒绝是结构化结果而非抛出的工具错误，且 `POLICY_FAILURE` 绝不是产品失败。`click`/`fill` 不定义产品预期，因此选择器缺失是 `INFRA_FAILURE`——只有 `expect_text` 能产生 `PRODUCT_FAILURE`。截图落入受限目录，且当可选的 attachment 服务被挂载时，同时注册为持久内容寻址 attachment 引用。安全教训是不变量：仅 http(s) 目标（含重定向后的最终 URL）、拒绝凭据、截图名单文件名限定在有界目录内、会话拥有生命周期（会话销毁、插件卸载、`close` 或策略拒绝的最终目标都会关闭页面与浏览器）。管理器的 launcher 与可执行文件解析器是构造器 seam，因此所有失败路径都有无浏览器覆盖；真实 Chromium 冒烟套件跑在本地 fixture 服务器上，无浏览器时自行跳过。

## 备选方案

- **整体恢复历史包** — 最快，但重新引入 fork 残留、其 click/fill 面，以及加固前的契约；安全修复只能盲目重打。
- **完整 Playwright capability seam**（Service Definition + provider + consumer）— 对多 provider 浏览器平台正确，但对一个没有第二个 provider 前景的 headless-Chromium 验证器而言过度构建。

## 后果

- 工具按需启用：发布预设不组合它，因此非浏览器会话不受影响，也没有规范录制会话场景能展示它；快照场景随第一次在发布预设中启用该插件的变更落地。
- 每个分类结果都是持久证据：每次尝试一条 `browser/verify` 事件（紧凑记录，绝不含页面文本），`browserVerify` 投影折叠当前 turn 的最新记录；消费者读会话日志/投影——没有 evidence store，没有 judge。
- 截图 attachment 走既有 attachment seam（`ctx.attachments`，可选）：持久引用对调用方可消费、对 UI 可通过既有会话授权图片路径加载；没有该服务时截图只是受限文件。
- 完整证据链集成推迟到后续步骤；不存在 evidence store、judge 或修复权威。
- 在没有 Chromium 的主机上覆盖仍为绿色，因为所有失败分支都跑在 stub seam 上；`v8 ignore` 注释只覆盖竞态专属或防御性分支，每条都带有说明理由。
