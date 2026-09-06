# ACTIVATION DOGFOOD（P0/P1 统一激活闭环）

run_time: 2026-09-05
载体: engineering-orchestrator §9（个人包，~/.dsh/skills）+ .agent/ACTIVATION-POLICY.md + multi-model-review（repo skill，保持可见）

## 路由矩阵（7 类，orchestrator 按 §9.1 决策，实测）

| 任务类 | 样例 | 预期最小集 | 实际 SELECT | 昂贵能力误触? | PASS |
|---|---|---|---|---|---|
| SIMPLE_CODE | 改一行文案 | code-discipline + 直改 | 同左 | 无（无 multi-model/browser/vision/Archify） | ✓ |
| BUG_FIX | 修 off-by-one | code-discipline + 相关测试 | 同左 | 无 | ✓ |
| SECURITY_AUTH | token 轮换无所有权校验 | security-reviewer 前后置 + multi-model-review HIGH + gate + 先批准 | 已跑真实 multi-model HIGH（见下） | 按策略（EXPENSIVE 且 task-relevant） | ✓ |
| WEB_UI | CSS 布局改动 | code-discipline + Playwright 证据 | 同左；browser/vision 仅当工具在场+可见变化 | 无（browser 未启用） | ✓ |
| ARCHITECTURE | 跨包生命周期 | architecture-reviewer + ADR + multi-model HIGH + Archify 图 | 同左（Archify 已可用） | 按策略 | ✓ |
| DOCS_ONLY | 改 README | dsh-doc/prose | 同左 | 无 | ✓ |
| UNKNOWN | 「帮我弄下这个」 | 先 CLASSIFY+RISK，不确定保守 MEDIUM，不默认 multi-model | 同左 | 无 | ✓ |

## SECURITY 路径真实证据（bounded，2 agents）

- 输入：rotateToken 缺 caller 所有权校验（kind=security, risk=HIGH）
- 结果：scout(flash) FAIL + strong(claude) FAIL，双 blocker（无授权检查 + 签名无法就地校验），escalation=MISSING_EVIDENCE，cross_provider=true
- 证明：workflow 直跑路径（meta.name + inline script）→ HIGH 拓扑 → cross-provider → findings-only 真实可达；orchestrator → skill 工具按名加载这一跳当时断链（见下「可达性关键结论」），本轮已修复

## 误触发攻击（6 项，§16）

| 攻击 | 判定 | 是否误触 |
|---|---|---|
| 文档里出现「security」字样，实为文档任务 | 语义判定 → DOCS_ONLY | 否 |
| `.tsx` 只改类型，非视觉变化 | 无可见 UI 变化 → 不 vision/browser | 否 |
| architecture 文档只修 typo | DOCS_ONLY，非 ARCHITECTURE | 否 |
| browser 包内只改 unit test | TEST_ONLY，不 browser/vision | 否 |
| image asset 改名，无视觉判断 | 非可见变化 → 不 vision | 否 |
| release note docs-only | DOCS_ONLY，不 release 链昂贵项 | 否 |

## 漏触发攻击（4 项，§17）

| 攻击 | 判定 | 是否漏 |
|---|---|---|
| 权限检查逻辑但 prompt 未写 security | 内容语义 authorization → SECURITY_AUTH | 否 |
| CSS/layout 变更但 prompt 未写 UI | 内容 frontend-change → WEB_UI | 否 |
| cross-package lifecycle 但未写 architecture | 内容跨包语义 → ARCHITECTURE | 否 |
| dangerous persistence change 但未写 authority | persistence authority 语义 → SECURITY_AUTH | 否 |

（判定由模型按 §9 纪律语义分类；非确定性保证，符合本轮目标）

## 可达性关键结论（经 fresh review 修正）

- 首版 frontmatter 的未加引号 `": "` 使 YAML 解析失败 → skill-filesystem 静默丢弃该技能（skill 工具返回 unknown）——首轮 dogfood 的「全链路可达」结论因此**不成立**（workflow 直跑 meta.name 能走通，但 skill-tool 按名加载断链）。
- 已修复：description 加引号 → loader 同款 parser 验证 PARSE-OK → 本会话技能目录实时出现 multi-model-review（注册成功实证）。
- 保留 `disable-model-invocation` 缺省（可模型调用）：DSH skill 工具拒绝 disabled 技能，repo skill 无 ~/.dsh Read 回退，hidden 会不可达。

## Browser（HARD STOP 项，仅此一项）

- 个人 profile（~/.dsh/profiles/web）是独立 pnpm workspace，未安装未发布的 `@deepseek-ai/dsh-tool-browser` → 非「只需 wiring」，§8.1 触发 HARD STOP。待发布/安装后按 ACTIVATION-POLICY.md 的 patch 行启用。
