# @deepseek-ai/dsh-output-repetition-guard

[English](README.md) | 中文

针对助手输出块流的旁路重复检测器。它不是模型可见工具，也从不改写持久化 会话日志：它监听每个智能体步骤的 `agent/stream-chunk`，累积已流式输出的 文本，并在某个长段落（至少 `minSectionChars`）相邻重复时发出 `output-repetition/detected` 遥测事件。先遥测、后强制的顺序是安全的。

## 为什么需要

退化的供应商流可能组装出包含同一长答案多次的消息——实测：一条 `assistant/message` 内含 10 段逐字节相同的 9,443 字符段落，外加一段被截断的 第 11 段。在流式层面（最终化之前）检测，是唯一能看到重复、又无需事后改写 canonical 历史的时机。

## 检测原理

`RepetitionDetector` 在线维护已累积字符及其 KMP 前缀函数。只要缓冲区的最长 border 蕴含一个周期 `p >= minSectionChars`，且该周期整除长度并满足 `length / p >= minRepeat`，缓冲区即为 `p` 周期——即长度 `p` 的段落重复出现—— 每个步骤只上报一次。免对齐（周期无需整除固定窗口）、总复杂度线性、与增量 粒度无关（逐字符或逐段增量均可）。

## 配置

```yaml
- id: output-repetition-guard
  name: '@deepseek-ai/dsh-output-repetition-guard'
  config:
    minSectionChars: 400
    minRepeat: 2
    emitLimit: 1
```

配置错误在插件加载时立即失败。事件载荷：

```ts
declare const detected: {
  agent: unknown
  turn: number
  step: number
  sectionChars: number
  repeatCount: number
}
detected.turn // number
detected.sectionChars // number
detected.repeatCount // number
```

## 模型体验

### 重复遥测（默认）与中止流（可选启用）

#### 模型看到的内容

默认遥测模式下没有模型可见内容。启用 `abortStream: true` 后，检测到重复会中止助手流，模型看到中止前累积的输出；不注入任何错误文本。

#### Token 影响

遥测事件不产生模型 token。中止的流停止增长，因此保留的消息以中止前已流式输出为界。

#### KV Cache 影响

仅追加；遥测事件是仅记录（log-only）事件，从不进入派生历史，因此检测不会使任何缓存条目失效。

## 已知限制与暂缓事项

- **仅相邻重复** —— 周期性检查针对 border 重复的缓冲区；被其他内容隔开的重复不会被检测到。
- **默认仅遥测** —— 强制（`abortStream`）为可选，因为误报会切断合法的长回答；启用前请先调优 `minSectionChars`/`minRepeat`。
- **流级作用域** —— 检测按智能体步骤在块流上运行；跨多个步骤组装的消息不做跨步骤比较。
