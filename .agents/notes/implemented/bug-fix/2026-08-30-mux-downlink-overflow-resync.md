# Agent Note: Announce mux downlink overflow instead of dropping frames silently

Status: implemented

English | [中文](2026-08-30-mux-downlink-overflow-resync.zh.md)

## Problem

Every mux downlink holds a bounded `FrameQueue` (`DEFAULT_MAX_QUEUED_FRAMES`, 10,000 frames) so a stalled or slow consumer cannot grow host memory without bound. At the bound the queue discarded its oldest undelivered frame and incremented a `dropped` counter that nothing ever read: no frame carried it, no RPC exposed it, and no log line reported it. A client slower than the host's event rate therefore lost session events with no signal at all. Its connection stayed open and healthy, so none of the existing recovery paths fired — the reconnect rebuild is driven by `onConnected`, and there was no reconnect. The window kept rendering whatever it had when the gap opened, and stayed wrong until the user reloaded or the transport happened to fail for an unrelated reason. Silent staleness in a live view is worse than a visible disconnect, because nothing tells the user the view stopped tracking the session.

## Decision

The queue reports its own gaps. `FrameQueue` takes an optional `overflowFrame(dropped)` factory; each drop mints a marker from the running `dropped` total, and `iterate` yields that marker ahead of the frames that outlived the gap. The mux downlink supplies the factory and mints a `session/resync` frame.

The marker is held in a `pendingOverflow` field, outside the ring buffer, and occupies no slot. That is the point of the design rather than an implementation convenience: a marker stored *in* the queue would sit at the head, which is exactly the position the next drop discards, so the frame reporting the loss would be the first casualty of further loss. Holding it outside also means the bound is never exceeded to make room for it, and a further drop before delivery simply replaces the pending marker, keeping the count current. The marker re-arms after delivery, so every later gap is reported again.

`session/resync` is connection-scoped and carries no `sessionId`. The queue multiplexes every attached session and discards by age without reading what it discards, so which sessions lost events is not recoverable; `dropped` is diagnostic only, and a client cannot reconcile from a count. The client answers by rebuilding every resident view from history — the list and catalog baselines plus each opened window — which is exactly what a reconnect already does. `SessionManager.handleConnected` and the new frame therefore share one private `resyncAll()`, because both mean the same thing: the stream can no longer be trusted to have carried every event.

The host downlink queue passes no factory and still drops silently. Its frames are whole snapshots that the next change re-sends, so a gap there does not strand a view the way a missed `session/event` does.

## Alternatives considered

**End the stream on overflow (force a reconnect).** Rejected. It reuses the existing reconnect recovery with no new wire surface, but it converts a recoverable gap into a visible disconnect: the client tears down both streams, backs off, re-runs the readiness handshake, and re-replays every baseline for every session — far more work than the gap requires, and a UI state flip the user sees. It also risks a reconnect loop, since a consumer slow enough to overflow once will overflow again on the heavier post-reconnect replay.

**Give the marker a slot in the queue.** Rejected for the reason above: at the head it is the next frame dropped, so under sustained overflow the marker is repeatedly discarded and re-minted and may never reach the consumer. Reserving capacity for it instead adds bound arithmetic that degenerates when `maxFrames` is small.

**Per-session resync frames.** Rejected: the queue does not know which sessions the discarded frames belonged to, so producing per-session markers would require inspecting frames on the drop path and would still be wrong for sessions whose frames were dropped earlier in the same burst.

**Carry `since` in the marker for an incremental tail.** Rejected as unsound here. The host's `since` cursor is a mux-open parameter, and this recovery does not reopen the stream; the client's own per-session cursor is the history window it is about to rebuild. A count cannot substitute for a cursor, so the honest signal is "your view is incomplete", not "resume from N".

## Consequences

A slow client now recovers to a correct view on its own, without a reload and without dropping its connection. The cost is one new frame in the `MuxFrame` union and its zod branch, plus a `console.warn` naming the drop total for diagnosis. `dropped` remains approximate as a diagnostic — it is the total at delivery, not per session and not per gap — which is acceptable because no client decision depends on its value.

Recovery is only as good as the client's history rebuild: a session that was never opened has no window to rebuild and is correctly left alone, and the projection/queue/jobs mirrors re-baseline on the `session/subscribed` frames that follow. A client that ignores the frame is no worse off than before this change.

## Testing

`frame-queue.spec.ts` covers the queue mechanism: the marker precedes the survivors, it survives sustained overflow that would discard a slot-holding marker, it re-arms after delivery, and a queue with no factory still drops silently. `mux-overflow.spec.ts` drives the real mux stream past the bound and asserts the `session/resync` frame is the first frame out, which is also what covers the wiring. `manager.client.spec.ts` asserts the frame triggers the same list refresh and history repull as a reconnect. `rpc-schemas.spec.ts` covers the wire branch, including the rejection of a non-positive `dropped`.
