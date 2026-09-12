# Agent Note: A command outcome that carries text is visible in a blank session

Status: implemented

English | [中文](2026-09-12-command-outcome-visible-in-a-blank-session.zh.md)

## Problem

A session whose only content is standalone command history stays `blank`, so `conversationPhase()` returns `blank` and `ConversationSession` renders no transcript. The host had durably logged the command's outcome, the connection delivered `command/run` and `command/done` to the client, and the reader still saw an untouched new session: the outcome was not in the DOM at all, only in the log.

The case that exposed it is a long-running command in a fresh session. `/test` runs for tens of seconds and answers with `40/40 tests passed. Report: …`. With nothing else in that session the answer was invisible, so a user who opened a new session, typed the command and waited had no evidence it ever ran. The same command in a session that already carried one message rendered normally, which placed the difference in the shell phase rather than in the command path.

## Decision

`chatViewDefinition.isActive` reports visible activity when a command node's outcome carries non-empty text. A command with no text outcome keeps the previous behaviour.

The session-lifecycle rule is deliberately untouched. `blank` still flips only on an accepted prompt — a logged `turn/start` — so session surfacing, list filtering, and `connectWorkspace` reuse eligibility are unchanged, and the recorded rationale in `session.ts` still holds. `activeTargets` has one consumer, `conversationPhase()`, which the header, View ring, and composer layout read; widening it therefore changes only whether the open session renders its own transcript.

The predicate reads the erased view payload structurally rather than importing a node type, matching the existing reader in `ChatView.tsx`.

## Consequences

- A fresh session that ran one command shows that command's outcome, and the outcome names the artifact the reader can open. An ordinary command that prints nothing behaves exactly as before.
- The session is still blank: it does not surface in the list, and it remains reusable by `connectWorkspace`. A reader who reloads and does not reopen it sees the same blank shell as before.
- A session that has any other node — a message, a tool row, a turn — is unaffected: the predicate already answered true for it.
- The pinned spec that keeps ordinary command-only history inactive still passes unchanged, because its fixture carries `kind: 'success'` with no `text`.
- The behaviour was known, not overlooked: `apps/web/tests/feedback-command.e2e.ts` drives a model turn before typing its command and recorded why in a comment — a command row does not render while a fresh session is still blank. That test still drives the turn because it asserts on the replayed reply, but the reason the comment gave no longer holds, and the comment now says so.
- Coverage is the Chat/Conversation seam spec rather than a recorded-session snapshot. The keyless Web snapshots compare the session log the host persisted, and this change persists no event: it is a client render predicate, so no replay fixture can observe it. The spec drives `chatViewDefinition` and `conversationPhase` together — the pair the defect lived in — and fails under the previous predicate.
- Verified in a real assembled browser as well: a command typed into a freshly connected blank session renders its acknowledgement row with no model turn in the session. The same scenario against the previous predicate times out waiting for the row.

## Alternatives considered

- **Flip `blank` for a standalone command outcome.** Rejected: `blank` is a host-lifetime fact tied to `turn/start`, and the client mirror only ever lowers, so flipping it early would surface a session the host still calls blank and strip its `connectWorkspace` eligibility. The rendering question does not need that authority.
- **Activate the Chat target for any command node.** Rejected: an ordinary silent command would then replace the new-session shell with an almost empty transcript, which is the behaviour the pinned spec exists to prevent.
- **Present the outcome through the `command/executed` client event.** Rejected for this defect: it is a transient, client-local acknowledgement with no transcript identity, and a durable answer that scrolls away is not equivalent to a node the reader can revisit or link to. It stays available for a transient surface if one is ever wanted.
- **Report progress while the command runs.** Out of scope here: the command vocabulary is exactly `command/run` and `command/done`, so a progress surface needs a host session event and a client plugin, neither of which exists.
