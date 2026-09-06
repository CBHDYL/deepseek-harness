# ACTIVATION POLICY（统一能力激活，P0/P1 闭环产物）

> 状态：implemented（2026-09-05）。执行载体 = `engineering-orchestrator`（个人包）§9 + 本文件 + 既有路由表。
> 不是 Runtime Router：任务类→能力的判定由模型按本节纪律执行，git hooks 与 session 机制保持唯一 LEVEL 3。

## 核心判定标准（沿用 Activation Audit）

```
存在但正常使用到不了        = NOT ACTIVATED
暴露但靠模型偶尔想到        = MODEL-DISCOVERABLE（LEVEL 1）
workflow 内自动             = WORKFLOW-AUTOMATIC（LEVEL 2）
正常任务入口自动            = NORMAL-USE AUTOMATIC（LEVEL 3）
```

## 默认最低成本

普通开发任务默认 = `engineering-orchestrator` + `code-discipline` + 适用确定性检查。
默认**不开**：multi-model / browser / vision / Archify / requirement-gatherer / 全量评审栈。

## 任务类 → 能力（orchestrator §9.1 的权威副本）

| 类 | 额外能力 | 默认禁止 |
|---|---|---|
| SIMPLE_CODE | code-discipline + 直改 + 轻评审 | multi-model/browser/vision/Archify/security |
| BUG_FIX | + 相关测试（真跑） | 同左 |
| REFACTOR | + 相关测试；跨包才考虑 Archify | vision/browser |
| SECURITY_AUTH | security-reviewer 前后置 + **multi-model-review HIGH** + gate + 先批准 | 降级 cheap |
| WEB_UI | code-discipline + Playwright 证据；真实页面验证且工具在场才 browser；可见变化且有截图才 vision | 无图自证；JS/TS 改动就开 Chromium |
| ARCHITECTURE | architecture-reviewer + ADR + **multi-model-review HIGH** + Archify 图 | 无 ADR 开改；图当 authority |
| RELEASE_PROMOTION | pre-push + M1–M6 链 | browser/vision/Archify/multi-model 默认 |
| DOCS_ONLY / TEST_ONLY | 对应文档/测试技能 | 昂贵路径 |
| UNKNOWN | 先分类；明显 security/authority 信号不降级；否则保守 MEDIUM 不默认 multi-model | 直接昂贵路径 |

## 安全底线

语义优先于关键词：内容含 authorization/permission/sandbox/credential/secret/persistence-authority/promotion-activation/release-authority → SECURITY_AUTH；文档里出现「security」字样 ≠ 安全任务。

## 成本三层

```
CHEAP      orchestrator + code-discipline + deterministic   ← 默认
TARGETED   requirement / security-reviewer / browser / vision / Archify
EXPENSIVE  multi-model-review HIGH/CRITICAL（task-relevant + bounded + 可观测）
```

## 可达性事实（本轮关键发现，已修复验证）

- DSH 的 skill 工具**拒绝** `disable-model-invocation: true` 技能；个人包靠「Read ~/.dsh/skills/…」绕过。
- `multi-model-review` 是 **repo** skill（`.agents/skills/`），不在 ~/.dsh 读取路径 → 必须 `disable-model-invocation` 非 true（可模型调用）才能被 skill 工具按名加载。
- **已修复**：frontmatter description 含未加引号的 `": "` 曾导致 YAML 解析失败、被 skill-filesystem 静默丢弃（skill("multi-model-review") 返回 unknown）。已加引号；独立复核用 loader 同款 parser 复现并验证 PARSE-OK，且本会话技能目录已实时出现 multi-model-review（list() 注册成功的实证）。
- 路由引用 repo skill 的方式 = skill 工具按名加载，不是 Read ~/.dsh。
- 两处路由表（orchestrator §9.1 与本节）以本文件为权威副本；§9.1 为会话内可执行表，出现差异以本文件为准。

## Browser 现状（本轮 HARD STOP 项）

- 包已存在并通过验证，但**未安装进个人 profile 的 workspace**（~/.dsh/profiles/web 是独立 pnpm 树，不依赖 repo 未发布包）。纯 preset wiring 做不到 → 非「只需 wiring」，按 §8.1 触发 HARD STOP，仅此一项。
- 待发布/安装后，个人 profile 的 `cordis.patch.yml` 加 `- insert: {id: tool-browser, name: '@deepseek-ai/dsh-tool-browser'}` + 重启 dsh web 即可（不全局、不动 sandbox/文件策略）。

## 不自动化的清单

multi-model 每任务、vision 每 UI 改动、Archify 每任务出图、browser 每改动、全技能加载、任何 activation 获得 write/approval/promotion/M6/repair 权。
