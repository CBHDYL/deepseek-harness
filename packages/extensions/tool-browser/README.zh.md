# @deepseek-ai/dsh-tool-browser

[English](README.md) | 中文

面向模型的 `browser` 工具，用于冒烟级 UI 验证：每个会话一个无头 Chromium 页面，支持 goto、screenshot、click、fill、read_text、close、list。页面与其浏览器在所属会话销毁或插件卸载时关闭，UI 检查会话不会泄漏浏览器进程。

## 功能

- `goto` 加载 URL 并报告页面标题与最终 URL。
- `screenshot` 将 PNG 保存到配置目录（默认操作系统临时目录）并返回路径。
- `click` / `fill` 驱动 CSS 选择器。
- `read_text` 返回整页或某选择器的可见文本。
- `close` / `list` 管理会话页面。

浏览器可执行文件按 `DSH_BROWSER_EXECUTABLE`、playwright 浏览器缓存或系统 Chrome 解析。动作需要 agent 会话（页面生命周期所有者）；无 agent 的调用被拒绝。

## 配置

```yaml
- id: tool-browser
  name: '@deepseek-ai/dsh-tool-browser'
  config:
    screenshotDir: /tmp/dsh-browser   # optional; defaults to the OS temp dir
```

## 模型体验

### 页面动作结果

#### 模型看到的内容

每次调用返回简短确认：加载的标题与 URL、截图路径、click/fill 确认、可见文本，或 `no live page`。截图路径为绝对路径，位于会话工作区内时可配合 describe-image 工具使用。

##### 结果示例

```markdown
loaded Browser Spec at http://127.0.0.1:5173/
screenshot saved to /var/folders/.../dsh-browser/page-1712345678901.png
```

#### Token 影响

结果文本对该次调用可见，并保留在历史中直到压缩；页面内容从不流式输出。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **仅冒烟级** —— 无断言、等待或多页面编排；深层交互属于专门测试框架。
- **每会话一页** —— 再次 `goto` 会在同一页面导航；不支持并行浏览。
- **需要无头 Chromium** —— 工具自行启动浏览器，不接入用户的现有浏览器。
- **截图可能在工作区之外** —— describe-image 插件的工作区守卫适用于返回路径。
