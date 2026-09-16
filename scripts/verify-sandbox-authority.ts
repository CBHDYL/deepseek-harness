/**
 * Reject a new confinement consumer that nobody has judged.
 *
 * `ctx.sandbox.confine` applies whatever policy it receives, and
 * `SandboxExecutionPolicy` is structural, so a consumer that forwards a
 * caller-supplied policy decides the enforcement mode. A consumer is safe only
 * when its policy comes from `ctx.sandboxPolicy` — either resolved locally or
 * gated on `isMinted`. Neither is visible in the call itself, so this gate
 * requires every such consumer to be listed with the source of its policy.
 *
 * A resolved call in the same file is not sufficient evidence: the PTC runtime
 * once read `request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()`, which
 * satisfies any "resolves an owner policy" check while accepting a forged one.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')

/** A confinement call on the sandbox provider, which applies the policy it receives. */
const confineCall = /\bsandbox\.confine\(/u

/**
 * Every source file that may call the confinement provider, with the origin of
 * the policy it passes. Add an entry only after reading how that policy is
 * obtained; remove it when the file stops calling the provider.
 */
export const SANDBOX_CONFINE_CALLERS: Readonly<Record<string, string>> = {
  'packages/api/terminal-controller/src/index.ts': 'resolves ctx.sandboxPolicy for the agent session',
  'packages/ptc-runtime/ptc-runtime-node/src/index.ts': 'passes request.sandboxPolicy through trustedAuthority, which requires isMinted',
  'packages/shell/bash-sandbox/src/index.ts': 'passes spec.sandboxPolicy through trustedAuthority, which requires isMinted',
  'packages/shell/pwsh-sandbox/src/index.ts': 'passes spec.sandboxPolicy through trustedAuthority, which requires isMinted',
  'packages/ssh/ssh/src/helper.ts': 'mints ctx.sandboxPolicy for the mode and path parsed from the wire',
  'packages/terminal/terminal-bash/src/index.ts': 'resolves ctx.sandboxPolicy for the terminal owner session',
}

/** One confinement consumer whose presence the manifest does not account for. */
export interface SandboxAuthorityViolation {
  /** Repository-relative tracked path. */
  file: string
  /** Whether the file calls the provider without a manifest entry, or is a stale entry. */
  kind: 'unlisted-caller' | 'stale-entry'
}

/**
 * Compare the confinement consumers present in the source plane against the manifest.
 * @param sources - repository-relative path to file text, covering the source plane.
 * @param listed - manifest of admitted consumers.
 * @returns every unlisted caller and every listed path that no longer calls.
 */
export function findSandboxAuthorityViolations(
  sources: ReadonlyMap<string, string>,
  listed: Readonly<Record<string, string>> = SANDBOX_CONFINE_CALLERS,
): SandboxAuthorityViolation[] {
  const violations: SandboxAuthorityViolation[] = []
  for (const [file, source] of sources) {
    if (confineCall.test(source) && listed[file] === undefined) violations.push({ file, kind: 'unlisted-caller' })
  }
  for (const file of Object.keys(listed)) {
    const source = sources.get(file)
    if (source === undefined || !confineCall.test(source)) violations.push({ file, kind: 'stale-entry' })
  }
  return violations
}

/**
 * Read every tracked source-plane file.
 * @param repoRoot - Repository root.
 * @returns repository-relative path to file text.
 */
export function sourcePlaneFiles(repoRoot: string): Map<string, string> {
  const tracked = execFileSync('git', ['ls-files', '-z', 'packages'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(file => /^packages\/[^/]+\/[^/]+\/src\/.*\.ts$/u.test(file))
  const sources = new Map<string, string>()
  for (const file of tracked) sources.set(file, readFileSync(resolve(repoRoot, file), 'utf8'))
  return sources
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  const sources = sourcePlaneFiles(root)
  const callers = [...sources].filter(([, source]) => confineCall.test(source)).length
  if (callers === 0) throw new Error('verify-sandbox-authority: no confinement consumer found; the scan is broken')
  const violations = findSandboxAuthorityViolations(sources)
  if (violations.length === 0) {
    console.log(`verify-sandbox-authority: ${Object.keys(SANDBOX_CONFINE_CALLERS).length} confinement consumer(s) accounted for.`)
  } else {
    console.error('verify-sandbox-authority: a confinement consumer must state where its policy comes from:')
    for (const violation of violations) {
      console.error(violation.kind === 'unlisted-caller'
        ? `  ${violation.file}: calls the confinement provider without a SANDBOX_CONFINE_CALLERS entry`
        : `  ${violation.file}: listed, but no longer calls the confinement provider`)
    }
    process.exitCode = 1
  }
}
