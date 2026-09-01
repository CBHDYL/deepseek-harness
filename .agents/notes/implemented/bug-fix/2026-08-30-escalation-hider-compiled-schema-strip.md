# Agent Note: Strip escalation parameters from compiled tool schemas

Status: implemented

English | [中文](2026-08-30-escalation-hider-compiled-schema-strip.zh.md)

## Problem

`escalation-hider` strips `sandbox_permissions`/`justification` from matching tools at `system-prompt/assemble` time, but `stripEscalationParameters` filtered only top-level keys of `tool.parameters`. The tools registry compiles every registered parameter spec through `defineTool` into a JSON Schema (`{ type, properties, required }`), so the escalation fields live under `properties` — the top-level filter never matched and the tools passed through untouched. A session at `danger-full-access` under `never` therefore kept seeing the escalation knob (and kept failing on it), which is exactly the failure the hider exists to prevent. The package tests used flat `ToolSchema` fixtures, which match the old filter shape, so the defect was invisible to the suite.

## Decision

`stripEscalationParameters` now handles both shapes a `parameters` object can take:

- The compiled JSON Schema: escalation fields are removed from `properties`, and any stripped name is also dropped from `required`.
- A flat field map: top-level escalation keys are removed as before.

Stripping rebuilds only the tools it changes; untouched tools keep their object identity, and tools outside the `tools` patterns still pass through unchanged. The assembly-wiring test now registers a real tool through `defineTool` and asserts on the assembled catalog, so a future regression in either the compiled shape or the wiring fails the suite.

## Alternatives considered

**Have `dsh-tools` hand the hider flat specs.** Rejected: `wireSchemas`/`schemaOf` intentionally project the compiled schema for every assembly consumer, and changing that contract for one guard's benefit spreads the hider's shape assumption across packages.

**Strip only the compiled shape.** Rejected: `stripEscalationParameters` is an exported function and the flat map is a legal `ToolSchema` shape; keeping both handled costs little and preserves behavior for any caller that assembles flat schemas directly.

## Consequences

`danger-full-access`/`never` sessions now lose the escalation fields from the model-visible schema of `bash`/`pwsh`/`edit`/`write` (and any pattern-matched tool), restoring the hider's intended behavior. Identity semantics for untouched tools and pattern matching are unchanged; the flat-shape path behaves exactly as before. Tools outside the default patterns (e.g. `apply_patch`) still expose their escalation fields by design.
