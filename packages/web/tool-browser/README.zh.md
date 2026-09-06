---
description: "面向模型的冒烟级 Web 验证浏览器工具：如何启用、配置和观察模型驱动的每会话 headless-Chromium 页面验证。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

[English](README.md) | 中文

## 概述

使用 `dsh-tool-browser`，模型可以通过 `browser` 工具在每个 agent 会话的一个 headless Chromium 页面上做冒烟级 Web 验证与交互：`goto` 打开页面（可选 viewport 与可见文本断言）、`read_text`（有界）、`click`、`fill`、`screenshot`（写入受限目录；挂载了 attachment 服务时同时注册为持久 attachment）、`close` 和 `list`。每个结果携带且仅携带一个 outcome 类别——`PASS`、`PRODUCT_FAILURE`、`INFRA_FAILURE`、`POLICY_FAILURE`——让消费方区分产品失败、浏览器失败与策略拒绝。插件按需启用：发布预设不启用它；会话拥有自己的页面（会话销毁或插件卸载时关闭）。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时选用

当模型需要冒烟级验证一个 Web UI 时选用：加载页面并检查可见文本或截图。它不是通用浏览器自动化平台、judge 或修复权威——只产出验证证据。

### 最小配置

加载工具运行时与本包；headless Chromium 在首次使用时按 `DSH_BROWSER_EXECUTABLE` → Playwright 缓存 → 系统浏览器解析。

```yaml
- name: '@deepseek-ai/dsh-tool-browser'
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `screenshotDir` | 系统临时目录 `dsh-browser` | 受限截图输出目录（`0o700` 创建） |
| `gotoTimeoutMs` | `30000` | `goto` 导航超时 |
| `actionTimeoutMs` | `10000` | 截图/读取操作超时 |
| `maxTextChars` | `8000` | 单次调用返回可见文本的上限 |

<a id="understand-the-implementation"></a>
## 理解实现

`src/index.ts` 拥有工具 schema、四类 outcome 分类与按需启用的插件装配。`click`/`fill` 是浏览器级操作：选择器缺失为 INFRA_FAILURE，绝不是 PRODUCT_FAILURE（只有 `expect_text` 定义产品预期）。挂载时截图通过 `ctx.attachments` 注册。`src/manager.ts` 拥有每会话惰性 Chromium 生命周期（每会话一页；会话销毁、插件卸载、`close` 或策略拒绝的最终目标时关闭）。`src/policy.ts` 拥有确定性策略：仅 http(s) 目标（含重定向后的最终 URL）、拒绝凭据、截图名单文件名受限、导航错误分类、可执行文件解析与协作式 deadline。安全拒绝是结构化 `POLICY_FAILURE` 结果，绝不抛为工具错误，也绝不是产品失败。

每个分类结果同时也是持久证据：工具向所属会话追加一条 `browser/verify` 事件（action、outcome、url、title、截断元数据、截图路径、reason——不含页面文本），`browserVerify` 投影折叠当前 turn 的最新记录。消费者读会话日志或投影；没有 evidence store，也没有 judge。

不发布 `./invariant` 伴随件：本包不拥有任何可产生独立观察分歧的关系；投影注册的销毁契约由 `tests/projection.spec.ts` 的 HMR 安全测试证明。

<a id="model-experience"></a>
## 模型体验

### 成功的 goto / read_text

#### 模型看到什么

`goto` 渲染 `PASS — loaded "<title>" at <url>`，给定 `expect_text` 时附带受限可见文本。`read_text` 渲染 `PASS` 加受限文本（`truncated`/`text_length` 报告截断）。`screenshot` 渲染保存路径；`close` 渲染 `PASS — page closed`；`list` 渲染页面 URL 或 `no live page`。

#### Token 影响

可见文本受 `maxTextChars` 限制；只有返回的结果增加 token。

#### KV Cache 影响

只追加；新可见内容跟在可复用请求前缀之后，不使已有 KV-cache 条目失效。

### 验证与策略结果

#### 模型看到什么

`PRODUCT_FAILURE: expected text "<text>" not found on the page`（附受限页面文本作为证据）。`INFRA_FAILURE: <reason>` 覆盖启动失败、超时与传输错误。`POLICY_FAILURE: <reason>` 覆盖不允许的 scheme、凭据、不安全重定向与不安全的截图名。

#### Token 影响

只有返回的结果增加 token；策略拒绝绝不附带页面内容。

#### KV Cache 影响

只追加；失败跟在可复用请求前缀之后，不使已有 KV-cache 条目失效。

### 参数与调用方错误

#### 模型看到什么

无 agent 的调用失败为 `Error: browser: the tool requires an agent session to own the page lifecycle`；`goto` 缺 `url` 与空 `expect_text` 在任何浏览器使用前即作为参数错误失败。

#### Token 影响

只有失败的调用保留这些 token。

#### KV Cache 影响

只追加；新可见内容跟在可复用请求前缀之后，不使已有 KV-cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义该工具尚不完整或需要部署方配合之处。它们是当前包的约束。

- **截图 attachment 是可选的** — 只有部署挂载了 attachment 服务（`ctx.attachments`）才会出现持久 attachment 引用；否则截图只是受限文件。
- **暂无快照场景** — 插件按需启用、不组合任何发布预设，因此没有规范录制会话能展示它；快照场景随第一次在发布预设中启用它的变更落地。
- **导航完成后的 `POLICY_FAILURE` 只能关闭页面** — 重定向进入不允许的 scheme 在导航完成后才被检测；页面被关闭、内容绝不返回，但浏览器确实加载过一次。
- **无 evidence-store 集成** — 截图只是受限文件；证据链集成是计划的下一步。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本 Dev Note 是维护者的工作上下文：未决问题与未定方向。它明确非权威——已发布的行为、限制与理由见上文各节及链接的 Agent Notes。

`BrowserManager` 上的 launcher 与可执行文件解析器 seam 是为无浏览器失败路径覆盖而存在；把它们当作模块 seam 而非运行时配置。`v8 ignore` 注释只覆盖竞态专属或防御性分支，每条都带理由。
</details>
