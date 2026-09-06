# STEP 2b — BENCHMARK FREEZE RECORD（run 开始前冻结）

```
freeze_time           = 2026-09-05
protocol_version      = step2-benchmark-protocol.md（v1）
task_set_version      = step2-benchmark-tasks.md（v1，T1-T7）
prototype_source      = step1-review-policy-prototype.md（REVIEW_SCHEMA 已按 assertObjectJsonSchema 子集修正：对象级 required + enum）
repository HEAD       = 2b3491d97（dev/next）
DSH sourceRevision    = 55101cc59（全局运行时 provenance）
preset                = 全局 GUI 会话（workflow 工具可用，实测 4 agents preflight 通过）
provider/model 映射   = deepseek-flash: deepseek-official/deepseek-v4-flash
                        deepseek-pro:   deepseek-official/deepseek-v4-pro
                        claude:         claude/claude-opus-5
                        codex:          codex/gpt-5.6-sol
preflight 结果        = 4/4 routes OK（flash 1677ms / pro 2645ms / claude 2280ms / codex 2943ms）
cross_provider        = AVAILABLE
arm_order 方法        = deterministic rotation（无 seed 随机，固定顺序，可复现）
retry 上限            = 每 run 1 次协议内重试，再失败记 INFRA_FAILURE
```

## ARM ORDER（冻结，开始后不改）

```
T1 = C A F D B E
T2 = B E A C F D
T3 = F C B A D E
T4 = A D C B E F
T5 = D F A E C B
T6 = E A D F B C
T7 = A C E B F D
```

## ARM → prototype 分支映射（冻结）

```
A = MEDIUM    cheap=flash strong=flash     (single-Flash)
B = MEDIUM    cheap=pro   strong=pro       (single-Pro)
C = HIGH      cheap=flash strong=flash     (Flash×2 fresh parallel)
D = MEDIUM    cheap=flash strong=pro       (Flash→escalate→Pro)
E = HIGH      cheap=flash strong=claude    (Flash + cross-provider)
F = CRITICAL  strong=pro                   (strong-fresh reviewer)
```
