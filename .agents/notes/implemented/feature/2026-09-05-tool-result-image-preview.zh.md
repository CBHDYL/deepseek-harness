# Agent Note: 通过已注册 slot 模式实现工具结果图片预览

Status: implemented

[English](2026-09-05-tool-result-image-preview.md) | 中文

## 问题

browser 工具把截图注册为持久 attachment 引用，但 Web UI 只把工具显示为文本行——调用方看不到捕获的页面。渲染某个工具的截图需要客户端路径，而选项都以不同方式触碰既有 seam。

## 决策

通过既有 slot 与注册模式交付截图预览，而不是新卡片类型或 loader seam：宿主工具的 `output.presentationMeta` 把 `{ screenshotAttachment }` 持久化在 `tool/result` 上；客户端 model（`screenshot-model`）按工具名 `browser` 加有效 meta 做门控；`ui-tool` 声明一个新 slot `tool.call.screenshot`（仿 `conversation.trajectory.images` 先例）；`ui-attachment` 用其既有 `MessageImages` 组件填充该 slot（复用 `MessageImage`/画廊/lightbox），loader 来自 `uiConversation.imageUrl/peekImageUrl`——与消息图片同一会话授权来源。assembled expected e2e 钉住缩略图 blob URL 与点击打开原图 lightbox。

## 备选方案

- **新的 `card: 'image'` 结果视图** — 更宽的 union + presenter + renderer 表面，为一个工具写更多代码。
- **把工具输出文件路径当 markdown 图片渲染** — markdown 渲染器的协议 allowlist 有意禁止任意路径；attachment 才是被认可的图片来源。

## 后果

- 宿主契约稳定且工具无关：任何未来工具只要发出 screenshot attachment meta 即可免费渲染，无需每个工具改客户端。
- 无新 store、runtime 或 loader seam；attachment 读取保持会话授权。
- 仍按需启用：工具与其渲染面只在组合了该工具的地方出现。
