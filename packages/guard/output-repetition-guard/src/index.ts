/**
 * Output-repetition guard: a bypass repetition detector over the assistant
 * chunk stream. It watches `agent/stream-chunk` per agent step, accumulates the
 * streamed text, and emits `output-repetition/detected` telemetry when a long
 * section (>= `minSectionChars`) repeats adjacently. It never rewrites the
 * durable session log and never vetoes a stream — the incident it targets is a
 * degenerate provider stream whose assembled message contains the same long
 * answer many times (observed: ten byte-identical 9,443-char sections in one
 * assistant message). Telemetry first, enforcement later, is the safe order.
 *
 * @module @deepseek-ai/dsh-output-repetition-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

export const name = 'output-repetition-guard'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Emitted once per agent step when the streamed text contains an adjacent
     * repeated section of at least `minSectionChars` characters. Payload
     * carries the detected section length and the occurrence count. This is a
     * telemetry signal only — the guard neither rewrites history nor aborts
     * the stream.
     * @mode emit
     */
    'output-repetition/detected'(payload: {
      agent: Agent
      turn: number
      step: number
      sectionChars: number
      repeatCount: number
    }): void
  }
}

/** Detector options, validated fail-loud in `apply` and at construction. */
export interface Config {
  /** Minimum section length in characters before a repeat is reportable (default 400). */
  minSectionChars?: number
  /** Minimum occurrence count of the section before a repeat is reportable (default 2). */
  minRepeat?: number
  /** Maximum detections emitted per agent step (default 1). */
  emitLimit?: number
  /**
   * When a repeat is detected, cancel the streaming agent turn (cause
   * `{kind:'hook'}`) so the degenerate output stops being generated live; the
   * already-streamed prefix is preserved as an interrupted assistant message.
   * Default false — telemetry only, so the safe order (observe first) is the
   * default.
   */
  abortStream?: boolean
}

export const Config: z<Config> = z.object({
  minSectionChars: z.number().default(400),
  minRepeat: z.number().default(2),
  emitLimit: z.number().default(1),
  abortStream: z.boolean().default(false),
})

export interface Detection {
  sectionChars: number
  repeatCount: number
}

/**
 * Incremental repetition detector over one text stream. Maintains the
 * accumulated characters and their KMP prefix-function online; whenever the
 * buffer's longest border implies a period `p >= minSectionChars` that divides
 * the length with `length / p >= minRepeat`, the buffer is `p`-periodic —
 * i.e. the same section of length `p` repeats — and a detection is reported
 * once. Alignment-free (periods need not divide a fixed window), linear in the
 * total streamed length, and insensitive to the delta granularity.
 */
export class RepetitionDetector {
  private chars: string[] = []
  private pi: number[] = []
  private k = 0
  private detection: Detection | undefined

  constructor(private readonly opts: { minSectionChars: number; minRepeat: number }) {
    if (!Number.isInteger(opts.minSectionChars) || opts.minSectionChars < 1) {
      throw new Error(`output-repetition-guard: invalid minSectionChars ${opts.minSectionChars} — must be an integer >= 1`)
    }
    if (!Number.isInteger(opts.minRepeat) || opts.minRepeat < 2) {
      throw new Error(`output-repetition-guard: invalid minRepeat ${opts.minRepeat} — must be an integer >= 2`)
    }
  }

  /**
   * Feed one text piece and return the detection, if this instance's single
   * detection has just been found. Subsequent pushes return undefined.
   * @param text - the next streamed text piece.
   * @returns the detection, or undefined.
   */
  push(text: string): Detection | undefined {
    if (this.detection) return undefined
    this.append(text)
    const n = this.chars.length
    if (n < this.opts.minSectionChars * 2) return undefined
    const border = this.pi[n - 1] ?? 0
    const period = n - border
    if (period < this.opts.minSectionChars) return undefined
    if (n % period !== 0) return undefined
    const repeatCount = n / period
    if (repeatCount < this.opts.minRepeat) return undefined
    this.detection = { sectionChars: period, repeatCount }
    return this.detection
  }

  /** Append one text piece, extending the KMP prefix function online (O(n) total). */
  private append(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i)
      const index = this.chars.length
      this.chars.push(ch)
      // A border is a PROPER prefix-suffix: pi[0] is always 0.
      if (index === 0) {
        this.k = 0
        this.pi.push(0)
        continue
      }
      let k = this.k
      while (k > 0 && ch !== this.chars[k]) {
        const prev = this.pi[k - 1]
        if (prev === undefined) break
        k = prev
      }
      if (ch === this.chars[k]) k += 1
      this.k = k
      this.pi.push(k)
    }
  }
}

interface StepState {
  key: string
  detector: RepetitionDetector
  emitted: number
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const minSectionChars = config.minSectionChars ?? 400
  const minRepeat = config.minRepeat ?? 2
  const emitLimit = config.emitLimit ?? 1
  const abortStream = config.abortStream ?? false
  if (!Number.isInteger(emitLimit) || emitLimit < 1) {
    throw new Error(`output-repetition-guard: invalid emitLimit ${emitLimit} — must be an integer >= 1`)
  }
  const detectorOpts = { minSectionChars, minRepeat }
  // Construct once to validate the pair fail-loud at plugin load.
  new RepetitionDetector(detectorOpts)

  const states = new WeakMap<Agent, StepState>()

  ctx.on('agent/stream-chunk', ({ agent, turn, step, chunk }: { agent: Agent; turn: number; step: number; chunk: StreamChunk }) => {
    if (chunk.type !== 'text-delta') return
    const key = `${turn}:${step}`
    let state = states.get(agent)
    if (state === undefined || state.key !== key) {
      state = { key, detector: new RepetitionDetector(detectorOpts), emitted: 0 }
      states.set(agent, state)
    }
    if (state.emitted >= emitLimit) return
    const hit = state.detector.push(chunk.text)
    if (hit === undefined) return
    state.emitted += 1
    ctx.emit('output-repetition/detected', {
      agent,
      turn,
      step,
      sectionChars: hit.sectionChars,
      repeatCount: hit.repeatCount,
    })
    if (abortStream) {
      // Live interception: cancel the streaming turn so the degenerate output
      // stops at the next chunk boundary. The loop preserves the streamed
      // prefix as an interrupted assistant message (one canonical copy), and
      // the abort is recorded durably with the hook cause.
      agent.cancel({
        kind: 'hook',
        reason: `output repetition detected: section of ${hit.sectionChars} chars repeated ${hit.repeatCount} times`,
      })
    }
  })
}
