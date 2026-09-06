# Agent Note: Tool-result image preview through the registered slot pattern

Status: implemented

English | [中文](2026-09-05-tool-result-image-preview.zh.md)

## Problem

The browser tool registers screenshots as durable attachment references, but the Web UI showed tools only as text rows — the caller could not see the captured page. Rendering one tool's screenshot needed a client path, and the options all touched existing seams differently.

## Decision

Ship the screenshot preview through the existing slot-and-registration pattern instead of a new card type or loader seam: the host tool's `output.presentationMeta` persists `{ screenshotAttachment }` on `tool/result`; a client model (`screenshot-model`) gates on tool name `browser` plus valid meta; `ui-tool` declares one new slot `tool.call.screenshot` (mirroring the `conversation.trajectory.images` precedent); `ui-attachment` fills that slot with its existing `MessageImages` component (reusing `MessageImage`/gallery/lightbox), and the loader comes from `uiConversation.imageUrl/peekImageUrl` — the same session-authorized source as message images. An assembled expected e2e pins the thumbnail blob URL and the click-to-open lightbox dialog.

## Alternatives considered

- **New `card: 'image'` result view** — a wider union + presenter + renderer surface, more code for one tool.
- **Render raw tool-output file paths as markdown images** — the markdown renderer's protocol allowlist intentionally forbids arbitrary paths; attachments are the sanctioned image source.

## Consequences

- Host contract is stable and tool-agnostic: any future tool that emits a screenshot attachment meta renders for free, no client change per tool.
- No new store, runtime, or loader seam; the attachment read stays session-authorized.
- Still opt-in: the tool and this rendering surface appear only where the tool is composed.
