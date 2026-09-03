# Agent Note：P-DURABILITY 移植（candidate 句柄 seam 上的撕裂尾部恢复证据）

Status: implemented

[English](2026-09-03-p-durability-port.md) | 中文

## 问题

candidate 的持久化架构已经携带了已验证 PR3 不变量所需的物理修复机制：JSONL 后端在读取时检测撕裂尾部，只提供已提交前缀，在写路径首次追加前持久截断撕裂字节，重写从撕裂 Zstandard 帧中恢复的完整事件，并在已证实的存储内容损坏时响亮失败，同时把格式拒绝与基础设施故障保留在各自的错误类别中。它缺少的是可验证的证据：恢复只表现为进程日志警告，因此被修复的历史会静默恢复，任何消费者都无法区分干净日志、撕裂尾部恢复与不可恢复的损坏。

## 决策

保留 candidate 架构——句柄 seam、JSONL provider，以及 agent 层对语义崩溃修复的所有权。在两个原生表面上添加证据：

- **seam 证据**——`SessionTornTailRecovery`（`{kind:'torn-tail', tornBytes, recoveredEvents}`）位于 `SessionHandle.tornTailRecovery` 上，仅由检测到撕裂尾部的 `write` 打开填充，并在打开时固定，使该事实在截断落地后仍可验证。读打开、干净日志与新建会话不携带该字段；不可恢复的损坏以 `SessionPersistenceCorruptionError` 使打开失败。
- **持久的模型可见证据**——新增的 `session/repaired` surface 事件。agent loop 的恢复路径在句柄报告恢复时，把它追加在合成闭合事件之后，使恢复后的模型读到"更早的历史可能不完整"。干净的恢复什么也不追加。

撕裂与损坏的边界保持不变并与已验证参照一致：只有在后面跟有包含 `turn/end` 的已提交内容时，一个不可解析的换行终止记录才被证明为损坏（corruption，响亮失败）；尾部的不可解析字节仍是可恢复的撕裂尾部。

## 后果

- `session/repaired` 为 required-on-read 且 surface-eligible；`deriveEventMessage` 投影其通知；`session-reference` 在人类对话摘录中跳过它。
- 永久测试：共享句柄契约在两种 JSONL 编码上断言恢复事实；JSONL 规格固定精确的撕裂字节数与损坏边界（格式损坏的已提交记录、日志中部损坏、基础设施错误不受影响）；agent-loop 恢复规格固定有/无合成闭合事件时的持久通知。
- 反事实 RED 并 md5 恢复：A（不可解析的已提交记录退化为撕裂而非抛出）破坏六个损坏测试；B（写打开停止暴露恢复事实）破坏证据断言。

## 备选方案

- 从持久化后端发出通知：否决——candidate 文档把语义崩溃修复定义为 agent 层的职责；后端报告物理事实，agent 层写持久记录。
- 复活已验证 PR3 的 coordinator/`TornMarker` 修复事务：否决——candidate 句柄的单变更链已提交"截断→重写→批次"且逐步重试；第二个修复机制只会重复它。
