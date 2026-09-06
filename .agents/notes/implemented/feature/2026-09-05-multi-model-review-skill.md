# Agent Note: Reusable multi-model review workflow as a skill

Status: implemented

English | [中文](2026-09-05-multi-model-review-skill.zh.md)

## Problem

The frozen Multi-Model Execution Policy (`.agent/MULTI-MODEL-EXECUTION-POLICY.md`) existed only as a document: every consumer had to hand-write `agent()` calls, escalation if/else, retry, and topology routing, which is how the Step-2 benchmark runner worked. The policy needed a reusable execution asset without any runtime change.

## Decision

Ship the frozen policy as a skill (`.agents/skills/multi-model-review/SKILL.md`) whose canonical script runs on the existing `workflow` tool. The script encodes: risk routing (LOW/MEDIUM/HIGH/CRITICAL), the deterministic security floor (security/authority kinds never fall below HIGH), gate precedence (a failed deterministic gate returns GATE_FAILURE with zero model calls), MEDIUM escalation to a cross-provider strong reviewer (VERDICT_FAIL as the stable route label; the model's own escalation text is evidence only), at most one retry per reviewer with the same evidence input, HIGH/CRITICAL failing loud on same-provider configuration, and a deterministic outcome aggregation that never lets any reviewer's PASS erase another reviewer's FAIL (the T2-A lesson). The first independent closure review caught five policy-conformance blockers in the first draft (strong-verdict override, unenforced cross-provider, retry evidence corruption, unrecorded gate, swallowed fatal workflow errors); all were fixed and re-verified against real routes before closure.

## Alternatives considered

- **Runtime enforcement inside the workflow engine** — automatic risk classification and topology routing would need a new runtime subsystem (RiskEngine/Router territory), which the reduction audits already removed; no new evidence justifies reintroducing them.
- **A checked-in script file only** — consumable by humans but not by agents; the skill system is the existing mechanism that loads reusable procedures into a session.

## Consequences

- The policy is executable by any agent with the skill loaded, still zero production runtime delta; provider/model names remain caller configuration.
- Dogfood evidence (`.agent/reports/w2-dogfood.md`) shows real LOW/MEDIUM/HIGH/gate-conflict/transient-retry runs over deepseek and claude routes.
- `git` tracking of `.agent/` and this skill lands with the user's commit step; the mission forbids pushing or merging, so the freeze's verifiability outside this worktree is a known limitation until then.
- CRITICAL stays provisional: the script marks `authority_required` but the approval hop itself is the existing chain's job.
