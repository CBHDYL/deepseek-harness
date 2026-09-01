/**
 * Conservative pure-read detection for the bash tool: which filesystem paths a
 * bash command provably READ, so the filesystem observation policy can treat
 * them like a `read` tool call and satisfy the read-before-edit gate.
 *
 * The parser is deliberately strict: it only recognizes a SINGLE command with
 * NO separators, redirects, pipes, subshells, or writes (`-i`, `>`, `tee`,
 * `dd`, …). Any ambiguity returns no paths, because a false observation would
 * weaken the version CAS the observation policy supplies to write/edit — the
 * cost of missing an observation is a `FS_NOT_OBSERVED` error the model can
 * recover from by reading; the cost of a false one is a stale-version edit.
 *
 * @module @deepseek-ai/dsh-tool-bash/observed-read
 */

/** Commands whose every remaining non-flag token is a read path (no pattern position). */
const PATH_LIST_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'wc', 'sha256sum', 'md5', 'shasum'])

/** Commands whose LAST remaining non-flag token is the read path (earlier tokens are the pattern). */
const PATH_LAST_COMMANDS = new Set(['grep', 'sed', 'awk', 'rg', 'ag'])

/** Flags that CONSUME the next token as their argument, per command. */
const FLAG_ARGUMENTS: Record<string, ReadonlySet<string>> = {
  head: new Set(['-n', '-c']),
  tail: new Set(['-n', '-c', '-s']),
  grep: new Set(['-m', '-e', '-f', '-A', '-B', '-C']),
  sed: new Set(['-e', '-f']),
  awk: new Set(['-v', '-F']),
  rg: new Set(['-e', '-g', '-A', '-B', '-C', '-m']),
  ag: new Set(['-G', '-m', '-A', '-B', '-C']),
}

/** Flag-only tokens (no argument) per command; anything else starting with `-` is ambiguous. */
const FLAG_ONLY: Record<string, ReadonlySet<string>> = {
  cat: new Set(['-n', '-b', '-s', '-A', '-E', '-T', '-v', '-e', '-t', '-u']),
  head: new Set(['-q', '-v']),
  tail: new Set(['-q', '-v', '-f', '-F', '--follow']),
  less: new Set(['-N', '-S', '-R', '-F', '-X']),
  more: new Set([]),
  wc: new Set(['-l', '-w', '-c', '-m', '-L']),
  sha256sum: new Set(['-b', '-c']),
  md5: new Set(['-b', '-c']),
  shasum: new Set(['-b', '-c']),
  grep: new Set(['-n', '-v', '-r', '-i', '-w', '-l', '-c', '-h', '-o', '-s', '-q', '-F', '-E', '-P', '-a', '-I']),
  sed: new Set(['-n', '-u', '-E', '-r', '-s', '-z']),
  awk: new Set([]),
  rg: new Set(['-n', '-v', '-i', '-w', '-l', '-c', '-F', '-E', '-S', '-a', '-s', '-q', '-u', '-t']),
  ag: new Set(['-v', '-i', '-w', '-l', '-c', '-s', '-q', '-a', '-t']),
}

/** sed's in-place flag — the one sed form that WRITES its operand. */
const SED_WRITE_FLAGS = new Set(['-i'])

/** Characters that make a command compound rather than one pure read. */
const SEPARATOR_PATTERN = /[;&|<>`$()\n]/u

/**
 * Return the file paths a command provably reads, or an empty array when the
 * command is not a recognized single pure read. Never throws.
 * @param command - the exact bash command string.
 * @returns the read paths in occurrence order, deduplicated.
 */
export function pureReadTargets(command: string): string[] {
  const trimmed = command.trim()
  if (trimmed.length === 0 || SEPARATOR_PATTERN.test(trimmed)) return []
  const tokens = trimmed.split(/\s+/u)
  const [program, ...rest] = tokens
  if (program === undefined) return []
  if (!PATH_LIST_COMMANDS.has(program) && !PATH_LAST_COMMANDS.has(program)) return []
  if (program === 'sed' && rest.some(token => SED_WRITE_FLAGS.has(token))) return []

  const flagArgs = FLAG_ARGUMENTS[program] ?? new Set<string>()
  const flagOnly = FLAG_ONLY[program] ?? new Set<string>()
  const operands: string[] = []
  let flagsEnded = false
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] ?? ''
    if (!flagsEnded && token === '--') { flagsEnded = true; continue }
    if (!flagsEnded && token.startsWith('-') && token !== '-') {
      if (flagArgs.has(token)) { i++ /* consume its argument */; continue }
      if (flagOnly.has(token)) continue
      return [] // unknown or combined flags — ambiguous, record nothing
    }
    operands.push(token)
  }
  if (operands.length === 0) return []
  if (operands.some(operand => /["']/u.test(operand))) return [] // quoted paths are ambiguous after whitespace splitting
  // Pattern-taking commands read a FILE only when a second operand names one;
  // a single operand is the pattern itself and the command reads stdin.
  if (PATH_LAST_COMMANDS.has(program) && operands.length < 2) return []

  const paths = PATH_LAST_COMMANDS.has(program) ? [operands[operands.length - 1] as string] : operands
  return [...new Set(paths)]
}
