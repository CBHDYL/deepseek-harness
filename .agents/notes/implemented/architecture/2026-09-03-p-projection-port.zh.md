# Agent Note：P-PROJECTION 移植（冷构建 single-flight、covered-clean 复用、无复活）

Status: implemented

[English](2026-09-03-p-projection-port.md) | 中文

## 问题

candidate 的 `SessionObservationReader` 按会话 id、持久化实例与 stat 修订号缓存已准备的冷读结果，但没有任何机制去重并发构建，也没有任何机制排序提交：两个针对同一来源同一修订号的并发读各自付出完整的日志读取加 `Session.prepare` 的代价，而且一个被更新读取代的在途构建仍可能把自己的陈旧条目在新条目提交之后落进缓存——正是已验证 PR4 不变量禁止的复活竞态。

## 决策

在 candidate 自己的 reader seam 上添加最小机制，复用其现有的以修订号为键的 prepared-entry 缓存：

- **single-flight**——以 `id@revision` 为键、绑定到产生它的持久化实例的 `inFlight` 映射。同一来源同一修订号的并发读共享一次日志读取 + prepare；只有构建发起者持有提交票据，共享者不会移动排序。实例绑定比较 Cordis traceable proxy 背后的稳定身份（`symbols.original`——重复的 `ctx.get` 调用会用全新的 proxy 包装同一个 Service），绝不比较 proxy 对象本身；普通 stub 保持自身对象身份。
- **无复活**——按 id 的 `loadGeneration` 票据在构建开始时领取；只有当该代次仍是该 id 最新时才把构建提交进缓存，因此陈旧的 in-flight 构建无处可提交。它自己的租约仍向调用者提供其精确的（较旧）cut——陈旧性被限制在该租约内，绝不复活进缓存。
- **失败语义**——失败或被中止的构建随 promise 清除其 in-flight 槽位（清理 promise 吞掉共享拒绝），下一次读取从头重试；不会存储任何部分结果。covered-clean 复用、修订号不匹配重建、容量淘汰与 pinning 均保持不变。

## 后果

- reader 上的八条永久测试：同键并发共享、跨键隔离、失败 + 重试、精确 covered-clean、陈旧修订号重建、陈旧 in-flight 构建对新提交（无复活）、中止 + 健康重试、跨租约稳定幂等读取。
- 反事实 RED 并 md5 恢复：A（禁用 single-flight）破坏共享测试；B（禁用 covered-clean）破坏八条缓存测试；C（移除提交守卫）破坏无复活测试。
- reader 缓存仍是纯粹的优化：条目可能陈旧但绝不错误，淘汰与 pinning 语义未动。

## 备选方案

- 在持久化层做逐会话 promise/borrow 缓存：否决——那是已删除的 coordinator 时代 borrow/reservation 架构；candidate 的 reader 缓存是其指定继任 seam。
- 全局 projection 锁：否决——按会话 id 键控的 per-reader 状态严格更小，且不拥有任何共享权威。
