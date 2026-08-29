#!/usr/bin/env node
/**
 * Expand a DSH session log for forensics.
 *
 * DSH JSONL persistence PACKS consecutive assistant/chunk delta events into
 * `text-chunks` / `reasoning-chunks` / `tool-call-chunks` rows (lossless, ~60%
 * smaller). Raw-log tools (grep, editors, naive readers) therefore cannot see
 * the actual chunk stream — this tool expands packed rows back into individual
 * `assistant/chunk` events so streamed content is inspectable and greppable.
 *
 * Usage:
 *   node scripts/expand-session-log.mjs <session.jsonl|session.jsonl.zstd> [--summary] [--grep <text>]
 *
 * Output: one JSON object per line (verbatim events plus expanded deltas);
 * `--grep` prints only lines containing the text (still line-oriented JSON);
 * `--summary` prints scale counters to stderr.
 *
 * Example (the incident that motivated this tool):
 *   node scripts/expand-session-log.mjs ~/.dsh/sessions/.../session.jsonl.zstd \
 *     --grep '# DSH Harness 改造方案' | wc -l
 */
import { createReadStream, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'

const [fileArg, ...flags] = process.argv.slice(2)
if (!fileArg) {
  console.error('usage: node scripts/expand-session-log.mjs <file> [--summary] [--grep <text>]')
  process.exit(2)
}
if (!existsSync(fileArg)) {
  console.error(`no such file: ${fileArg}`)
  process.exit(2)
}
const summary = flags.includes('--summary')
const grepIndex = flags.indexOf('--grep')
const grepText = grepIndex >= 0 ? flags[grepIndex + 1] : undefined

/** Return a readable stream of decompressed bytes for the file. */
function openStream(path) {
  if (!path.endsWith('.zstd')) return Readable.from(createReadStream(path))
  // Prefer the zstd CLI; fall back to python3 + zstandard (used by dsh dev machines).
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn('zstd', ['-dc', path], { stdio: ['ignore', 'pipe', 'inherit'] })
    child.on('error', () => {
      if (settled) return
      settled = true
      const py = spawn('python3', ['-c', 'import sys,zstandard; sys.stdout.buffer.write(zstandard.ZstdDecompressor().stream_reader(sys.stdin.buffer).read())'], { stdio: ['pipe', 'pipe', 'inherit'] })
      py.on('error', reject)
      createReadStream(path).pipe(py.stdin)
      resolve(py.stdout)
    })
    child.on('spawn', () => {
      if (settled) return
      settled = true
      resolve(child.stdout)
    })
  })
}

/**
 * Yield complete lines from a byte stream, splitting on '\n' and carrying the
 * partial tail across chunk boundaries (createReadStream yields 64KB chunks,
 * NOT lines — treating a chunk as a line corrupts parsing).
 */
async function* lines(stream) {
  let buffer = ''
  for await (const raw of stream) {
    buffer += raw.toString('utf8')
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      yield buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
    }
  }
  if (buffer.length > 0) yield buffer
}

function expandRow(record) {
  const out = []
  const { seq0, time0, data } = record
  const { turn, step, index, dt } = data
  let time = time0
  if (record.type === 'tool-call-chunks') {
    for (let i = 0; i < data.args.length; i++) {
      const chunk = { type: 'tool-call-delta', index, id: data.id, argumentsDelta: data.args[i] }
      if (data.name !== undefined) chunk.name = data.name
      out.push({ type: 'assistant/chunk', seq: seq0 + i, time, data: { turn, step, chunk } })
      if (dt[i] !== undefined) time += dt[i]
    }
    return out
  }
  const kind = record.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta'
  for (let i = 0; i < data.texts.length; i++) {
    out.push({
      type: 'assistant/chunk',
      seq: seq0 + i,
      time,
      data: { turn, step, chunk: { type: kind, index, text: data.texts[i] } },
    })
    if (dt[i] !== undefined) time += dt[i]
  }
  return out
}

const PACKED = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])
let packedRows = 0
let expandedEvents = 0
let verbatimEvents = 0
let linesCount = 0

const input = await openStream(fileArg)
for await (const trimmed of lines(input)) {
  if (trimmed.trim().length === 0) continue
  let record
  try {
    record = JSON.parse(trimmed)
  } catch {
    // Not a JSON record (e.g. a torn tail); pass through for forensics.
    if (!summary) console.log(trimmed)
    continue
  }
  linesCount += 1
  if (PACKED.has(record?.type)) {
    packedRows += 1
    for (const event of expandRow(record)) {
      expandedEvents += 1
      if (!summary) {
        const rendered = JSON.stringify(event)
        if (grepText === undefined || rendered.includes(grepText)) console.log(rendered)
      }
    }
    continue
  }
  verbatimEvents += 1
  if (!summary) {
    const rendered = JSON.stringify(record)
    if (grepText === undefined || rendered.includes(grepText)) console.log(rendered)
  }
}

if (summary) {
  console.error(`lines=${linesCount} packedRows=${packedRows} expandedDeltas=${expandedEvents} verbatimEvents=${verbatimEvents}`)
}
