# Agent Note：带文本结果的命令在 blank 会话中可见

Status: implemented

[English](2026-09-12-command-outcome-visible-in-a-blank-session.md) | 中文

## Problem

只包含独立命令历史的会话会保持 `blank`，于是 `conversationPhase()` 返回 `blank`，`ConversationSession` 不渲染任何正文。宿主已经把命令结果持久化，连接也把 `command/run` 与 `command/done` 投递给了客户端，但读者看到的仍是一个未动过的新会话：结果**根本不在 DOM 里**，只在日志里。

暴露这一点的场景是"在全新会话里跑一条长命令"。`/test` 要跑数十秒，然后回答 `40/40 tests passed. Report: …`。该会话里没有别的内容时，这个回答是不可见的——用户打开新会话、输入命令、等待，却拿不到"它跑过"的任何证据。同一条命令在一个已经有一条消息的会话里渲染正常，这把差异定位到外壳阶段（shell phase），而不是命令链路。

## Decision

当命令节点的 outcome 带有非空文本时，`chatViewDefinition.isActive` 报告为"可见活动"。没有文本 outcome 的命令保持原行为。

会话生命周期规则被刻意保持不变。`blank` 仍然只在**被接受的** prompt（即已落盘的 `turn/start`）上翻转，因此会话上浮、列表过滤、`connectWorkspace` 复用资格都不变，`session.ts` 里记录的论证依然成立。`activeTargets` 只有一个消费者 `conversationPhase()`（头部、View 环、输入区布局读它），所以放宽它只改变"当前打开的会话是否渲染自己的正文"。

该谓词以结构化方式读取被擦除的视图载荷，不导入节点类型，与本仓库 `ChatView.tsx` 中既有的读法一致。

## Consequences

- 跑过一条命令的新会话会显示该命令的结果，且结果里带着读者可以打开的产物路径。不打印任何内容的普通命令行为与之前完全一致。
- 会话依然是 blank：不会在列表中上浮，也仍然可被 `connectWorkspace` 复用。读者若刷新后不重新打开它，看到的仍是与之前相同的空白外壳。
- 已经含有其它节点（消息、工具行、回合）的会话不受影响：对它们谓词本来就返回 true。
- 钉住"普通纯命令历史保持非活动"的那条既有用例无需改动即可通过，因为它的 fixture 是 `kind: 'success'` 且没有 `text`。
- 这个行为是**已知**的，不是疏漏：`apps/web/tests/feedback-command.e2e.ts` 在输入命令前先驱动一个模型回合，并把原因写在注释里——空会话下命令行不渲染。该用例仍然需要那次驱动（因为它断言的是回放的回复），但注释给出的那个理由已不成立，注释已同步更正。
- 覆盖放在 Chat/Conversation 的接缝用例上，而不是录制快照。无密钥的 Web 快照比对的是**宿主落盘的 session log**，而本次改动不落盘任何事件——它是一条客户端渲染谓词，任何回放 fixture 都观测不到它。接缝用例同时驱动 `chatViewDefinition` 与 `conversationPhase`（缺陷所在的那一对），并在旧谓词下失败。
- 另在真实组装浏览器中验证：在刚连接好的空会话里输入命令，结果行会渲染出来，且该会话内没有任何模型回合。同一场景换成旧谓词会在等待该行时超时。

## Alternatives considered

- **为独立命令结果翻转 `blank`。** 否决：`blank` 是绑定 `turn/start` 的宿主生命周期事实，客户端的 blank 镜像只会单向下降，提前翻转会让一个宿主仍判定为 blank 的会话上浮，并破坏它的 `connectWorkspace` 复用资格。渲染问题不需要这份权限。
- **任何命令节点都激活 Chat target。** 否决：一条普通的静默命令会把新会话外壳替换成一篇几乎空的正文，而这正是那条既有用例要防止的行为。
- **经由 `command/executed` 客户端事件呈现结果。** 对本次缺陷否决：它是一个瞬时的、客户端本地的确认，没有正文身份；一个会滚走的持久回答不等价于一个读者能回看、能链接的节点。若将来需要瞬时提示面，它仍然可用。
- **在命令执行期间报告进度。** 本次不做：命令词汇恰好只有 `command/run` 与 `command/done`，进度面需要宿主 session event 加客户端插件，两者目前都不存在。
