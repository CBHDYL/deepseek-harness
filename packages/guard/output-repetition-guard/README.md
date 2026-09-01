# @deepseek-ai/dsh-output-repetition-guard

English | [中文](README.zh.md)

A bypass repetition detector over the assistant chunk stream. It is not a model-facing tool and never rewrites the durable session log: it watches `agent/stream-chunk` per agent step, accumulates the streamed text, and emits `output-repetition/detected` telemetry once a long section (at least `minSectionChars`) repeats adjacently. Telemetry first, enforcement later, is the safe order.

## Why

A degenerate provider stream can assemble a message containing the same long answer many times — observed: one `assistant/message` holding ten byte-identical 9,443-character sections plus a truncated eleventh. Detection at the stream level (before finalization) is the only place that can see the repetition without post-hoc rewriting of canonical history.

## Detection

`RepetitionDetector` maintains the accumulated characters and their KMP prefix-function online. Whenever the buffer's longest border implies a period `p >= minSectionChars` that divides the length with `length / p >= minRepeat`, the buffer is `p`-periodic — the same section of length `p` repeats — and a detection is reported once per step. Alignment-free (periods need not divide a fixed window), linear in total streamed length, and insensitive to delta granularity (per-char or per-paragraph deltas both work).

## Config

```yaml
- id: output-repetition-guard
  name: '@deepseek-ai/dsh-output-repetition-guard'
  config:
    minSectionChars: 400
    minRepeat: 2
    emitLimit: 1
```

Misconfiguration fails loud at plugin load. The emitted event:

```ts
declare const detected: {
  agent: unknown
  turn: number
  step: number
  sectionChars: number
  repeatCount: number
}
detected.turn // number
detected.sectionChars // number
detected.repeatCount // number
```

## Model Experience

### Repetition telemetry (default) and aborted stream (opt-in)

#### What the model sees

In the default telemetry mode nothing is model-visible. With `abortStream: true`, a detected repetition aborts the assistant stream and the model sees the accumulated output up to the abort; no error text is injected.

#### Token effect

Telemetry events add no model tokens. An aborted stream stops growing, so the retained message is bounded by what streamed before the abort.

#### KV Cache effect

Append-only; the telemetry events are log-only and never join derived history, so no cache entry is invalidated by a detection.

## Known Limitations and Deferred Work

- **Adjacent repetition only** — the periodicity check fires on a buffer whose border repeats; a repetition separated by other content is not detected.
- **Telemetry by default** — enforcement (`abortStream`) is opt-in because a false positive would cut a legitimate long answer; tune `minSectionChars`/`minRepeat` before enabling it.
- **Stream-level scope** — detection runs per agent step on the chunk stream; a message assembled from multiple steps is not compared across steps.
