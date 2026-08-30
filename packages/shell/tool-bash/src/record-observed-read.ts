/**
 * Emit filesystem observations for bash commands that provably READ files, so
 * the fs-observation-policy read-before-edit gate treats a `cat file` the same
 * as a `read` tool call. Best-effort by design: a missing filesystem, an
 * unresolvable path, or a stat failure never fails the bash call.
 * @module @deepseek-ai/dsh-tool-bash/observed-read
 */

import { resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { FileSystem, FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import { pureReadTargets } from './observed-read.ts'

/**
 * Record each provable pure read of `command` against the composed filesystem
 * (when one is mounted) under `exec.agent`'s observation ownership. The
 * observation carries the version the filesystem reports NOW — the same
 * freshness basis the `read` tool uses, so a later write/edit CAS compares
 * against a just-observed version.
 * @param ctx - the tool context; the filesystem service is read opportunistically.
 * @param command - the executed bash command.
 * @param workdir - the directory the command ran in (for relative paths).
 * @param exitCode - the command's exit code; only a clean exit proves the read happened.
 * @param exec - the tool execution carrying the calling agent.
 */
export async function recordBashReadObservations(
  ctx: Context,
  command: string,
  workdir: string | undefined,
  exitCode: number | null,
  exec: ToolExecution,
): Promise<void> {
  if (exitCode !== 0 || exec.agent === undefined) return
  const fs = ctx.get('fs') as FileSystem | undefined
  if (fs === undefined) return
  for (const raw of pureReadTargets(command)) {
    try {
      const path = workdir !== undefined && !raw.startsWith('/') ? resolvePath(workdir, raw) : raw
      const target: FsTarget = await fs.resolve(path)
      const info = await fs.stat(target)
      if (info !== undefined) {
        const version = info.version as FsVersion
        ctx.emit('fs/observed', target, { kind: 'present', version }, exec)
      }
    } catch {
      // Best-effort observation: an unresolvable or racing path must not fail the command.
    }
  }
}
