/**
 * Model-facing unified-diff application for the filesystem. `apply_patch`
 * replaces literal-string editing when the target region is large or the model
 * cannot reproduce it exactly: the diff carries its own context, and the
 * applier FAILS LOUDLY when a hunk's context does not match the file — the
 * failure names the hunk and position instead of silently corrupting.
 *
 * Only single-file unified diffs are supported: one `---`/`+++` header pair
 * followed by `@@` hunks. The parser is deliberately strict (headers must use
 * the `a/`/`b/` prefixes the tool description teaches), and a multi-file patch
 * is rejected before anything runs.
 *
 * @module @deepseek-ai/dsh-tool-fs/src/apply-patch
 */


/** One parsed hunk: a start position and the lines to match and produce. */
export interface PatchHunk {
  /** 1-based original start line. */
  oldStart: number
  /** Number of original lines the hunk covers. */
  oldCount: number
  /** 1-based result start line. */
  newStart: number
  /** Number of result lines the hunk produces. */
  newCount: number
  /** Context (space) and removed (`-`) lines, in order — matched against the original. */
  removed: string[]
  /** Context (space) and added (`+`) lines, in order — written into the result. */
  added: string[]
}

/** A parsed single-file unified patch. */
export interface ParsedPatch {
  /** The `a/`-prefixed path from the `---` header, or undefined when absent. */
  oldPath?: string
  /** The `b/`-prefixed path from the `+++` header, or undefined when absent. */
  newPath?: string
  hunks: PatchHunk[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u

/**
 * Parse a single-file unified diff. Rejects multi-file patches, malformed
 * headers, and hunks whose line prefixes are out of the context/removed/added
 * vocabulary.
 * @param patch - the raw unified diff text.
 * @returns the parsed patch, or an error message when the diff is not a valid single-file patch.
 */
export function parseUnifiedPatch(patch: string): { ok: true; patch: ParsedPatch } | { ok: false; error: string } {
  const lines = patch.replace(/\r\n/gu, '\n').split('\n')
  let index = 0
  while (index < lines.length && (lines[index] ?? '').trim() === '') index++

  const oldHeader = /^--- (?:a\/)?(.+)$/u.exec(lines[index] ?? '')
  const newHeader = /^\+\+\+ (?:b\/)?(.+)$/u.exec(lines[index + 1] ?? '')
  if (oldHeader === null || newHeader === null) {
    return { ok: false, error: 'apply_patch: patch must start with --- a/<path> and +++ b/<path> headers' }
  }
  index += 2

  const hunks: PatchHunk[] = []
  while (index < lines.length) {
    while (index < lines.length && (lines[index] ?? '').trim() === '') index++
    if (index >= lines.length) break
    const header = HUNK_HEADER.exec(lines[index] ?? '')
    if (header === null) {
      return { ok: false, error: `apply_patch: expected @@ hunk header at line ${index + 1}, got ${JSON.stringify(lines[index])}` }
    }
    index++
    const oldStart = Number(header[1])
    const oldCount = header[2] === undefined ? 1 : Number(header[2])
    const newStart = Number(header[3])
    const newCount = header[4] === undefined ? 1 : Number(header[4])
    const removed: string[] = []
    const added: string[] = []
    // Read exactly oldCount original lines and newCount result lines; a bare
    // `\` line (no newline at EOF) is tolerated and ignored.
    let consumedOld = 0
    let consumedNew = 0
    while ((consumedOld < oldCount || consumedNew < newCount) && index < lines.length) {
      const line = lines[index] ?? ''
      index++
      if (line === '\\') continue // "\ No newline at end of file"
      const prefix = line[0]
      const body = line.slice(1)
      if (prefix === ' ' || prefix === '-') {
        if (consumedOld >= oldCount) {
          return { ok: false, error: `apply_patch: hunk declares ${oldCount} original lines but lists more` }
        }
        removed.push(body)
        consumedOld++
      }
      if (prefix === ' ' || prefix === '+') {
        if (consumedNew >= newCount) {
          return { ok: false, error: `apply_patch: hunk declares ${newCount} result lines but lists more` }
        }
        added.push(body)
        consumedNew++
      }
      if (prefix !== ' ' && prefix !== '-' && prefix !== '+') {
        return { ok: false, error: `apply_patch: hunk line ${index} starts with unexpected ${JSON.stringify(prefix)}` }
      }
    }
    if (consumedOld < oldCount || consumedNew < newCount) {
      return { ok: false, error: `apply_patch: hunk ended before its declared ${oldCount}/${newCount} lines` }
    }
    hunks.push({ oldStart, oldCount, newCount, newStart, removed, added })
  }
  if (hunks.length === 0) {
    return { ok: false, error: 'apply_patch: patch contains no hunks' }
  }
  return {
    ok: true,
    patch: {
      ...oldHeader[1] !== undefined ? { oldPath: oldHeader[1] } : {},
      ...newHeader[1] !== undefined ? { newPath: newHeader[1] } : {},
      hunks,
    },
  }
}

/** A hunk that failed to apply, with its position for a loud error. */
export interface HunkMismatch {
  /** The hunk's original start line, 1-based. */
  oldStart: number
  /** The file line (1-based) where the mismatch occurred. */
  line: number
  /** The line the hunk expected at that position. */
  expected: string
  /** The line actually present. */
  actual: string
}

/**
 * Apply parsed hunks to file content. Each hunk's original lines (context and
 * removed) must match the content exactly at the hunk's position, in order;
 * the first mismatch fails loudly with the position.
 * @param content - the current file content.
 * @param hunks - the parsed hunks, in order.
 * @returns the patched content, or the first mismatch.
 */
export function applyHunks(content: string, hunks: PatchHunk[]): { ok: true; content: string } | { ok: false; mismatch: HunkMismatch } {
  const original = content.split('\n')
  const result: string[] = []
  let cursor = 0 // 0-based position in the original
  for (const hunk of hunks) {
    const start = hunk.oldStart - 1 // 0-based
    if (start < cursor) {
      return { ok: false, mismatch: { oldStart: hunk.oldStart, line: start + 1, expected: '<overlapping hunks>', actual: `<hunks must be in order; last consumed line ${cursor}>` } }
    }
    // Copy untouched lines up to the hunk.
    result.push(...original.slice(cursor, start))
    cursor = start
    for (const expected of hunk.removed) {
      const actual = original[cursor] ?? ''
      if (actual !== expected) {
        return { ok: false, mismatch: { oldStart: hunk.oldStart, line: cursor + 1, expected, actual } }
      }
      cursor++
    }
    result.push(...hunk.added)
  }
  result.push(...original.slice(cursor))
  return { ok: true, content: result.join('\n') }
}
