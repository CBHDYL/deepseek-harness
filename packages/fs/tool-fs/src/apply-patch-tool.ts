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

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffCallView, DiffResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { computeHunkDiffs, diffsFromMeta } from './diff.ts'
import { remediateFsError } from './error.ts'
import { sessionResolveOptions } from './session-cwd.ts'
import type { FsSandboxController } from './sandbox.ts'
import { parseUnifiedPatch, applyHunks } from './apply-patch.ts'

/** Validated `apply_patch` arguments after defaulting. */
interface ApplyPatchInput {
  patch: string
  filePath: string
}

/**
 * The `apply_patch` tool's validated arguments: the raw unified diff plus the
 * two escalation fields, advertised only under a confining `ctx.fs` (absent
 * from the schema otherwise, so the validator rejects them before `execute`).
 */
interface ApplyPatchToolArgs {
  patch: string
  file_path?: string
  sandbox_permissions?: string
  justification?: string
}

/** Strip an `a/`/`b/` prefix from a diff header path when present. */
function stripDiffPrefix(path: string): string {
  return path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path
}

/**
 * Register the `apply_patch` tool and its system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param sandbox - the shared sandbox-escalation API (advertisement, mode stamping, denial mapping).
 */
export function applyPatchTool(ctx: Context, sandbox: FsSandboxController): void {
  ctx.systemPrompt.section({
    name: 'tool:apply_patch',
    order: 103,
    text: 'Use the apply_patch tool for changes too large or too scattered for a literal edit: it applies a single-file unified diff whose context lines are verified, so a wrong target fails loudly instead of corrupting. Read the file first (the fs-observation-policy requires it), then send the diff.',
  })

  ctx.tools.register(defineTool({
    name: 'apply_patch',
    description: 'Apply a single-file unified diff to an existing file. The diff must start with `--- a/<path>` and `+++ b/<path>` headers followed by `@@ -l,c +l,c @@` hunks (space = context, `-` = removed, `+` = added). Every context and removed line is verified against the file; the first mismatch fails the call with the hunk and line number. Multi-file diffs are rejected.',
    parameters: {
      patch: { type: 'string', required: true, description: 'The unified diff to apply, with `--- a/<path>` and `+++ b/<path>` headers.' },
      file_path: { type: 'string', description: 'Optional explicit target path; defaults to the `+++ b/` header path.' },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          hunksApplied: { type: 'integer', required: true },
          before: { type: 'string', required: true },
          after: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `The file ${value.path} has been updated by applying ${value.hunksApplied} hunk${value.hunksApplied === 1 ? '' : 's'}.`,
      }],
      presentationMeta: (args, value) => ({
        diffs: computeHunkDiffs(args.file_path ?? value.path, value.before, value.after)
          .map(({ path, oldText, newText }) => ({ path, oldText, newText })),
      }),
    },
    async execute(args: ApplyPatchToolArgs, exec) {
      const parsed = parseUnifiedPatch(args.patch)
      if (!parsed.ok) throw new Error(parsed.error)
      const input: ApplyPatchInput = {
        patch: args.patch,
        filePath: args.file_path ?? stripDiffPrefix(parsed.patch.newPath ?? parsed.patch.oldPath ?? ''),
      }
      if (input.filePath.length === 0) {
        throw new Error('apply_patch: cannot determine the target file; pass file_path or include ---/+++ headers')
      }
      // Resolve the per-call sandbox policy BEFORE anything executes, like edit.
      const sandboxPolicy = await sandbox.resolvePolicy('apply_patch', args, exec)
      const target = await ctx.fs.resolve(input.filePath, sessionResolveOptions(exec, input.filePath, sandboxPolicy?.workspaceRoot))
      let outcome
      try {
        // Single-slot decision: the observation policy returns the observed
        // version or throws FS_NOT_OBSERVED (read the file first).
        const intent = await ctx.waterfall('fs/edit-intent', target, exec, () => undefined)
        const before = await ctx.fs.readText(target)
        const applied = applyHunks(before, parsed.patch.hunks)
        if (!applied.ok) {
          const { mismatch } = applied
          throw new Error(
            `apply_patch: hunk starting at line ${mismatch.oldStart} does not match — line ${mismatch.line} expected ${JSON.stringify(mismatch.expected)} but found ${JSON.stringify(mismatch.actual)}`,
          )
        }
        outcome = await ctx.fs.editText(
          target,
          { oldString: before, newString: applied.content, replaceAll: true },
          intent,
          exec.signal,
          sandboxPolicy,
        )
        if (outcome.after !== applied.content) {
          throw new Error('apply_patch: filesystem did not apply the full replacement; refusing to report success')
        }
      } catch (error: unknown) {
        throw remediateFsError(sandbox.mapError(error, sandboxPolicy))
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      return {
        path: target.displayPath,
        hunksApplied: parsed.patch.hunks.length,
        before: outcome.before,
        after: outcome.after,
      }
    },
    presentCall(args): DiffCallView {
      return {
        card: 'diff',
        title: `Apply patch ${args.file_path ?? '(auto)'}`,
        diffs: [],
        ...args.file_path !== undefined ? { locations: [{ path: args.file_path }] } : {},
      }
    },
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const diffs = diffsFromMeta(result.meta)
      if (diffs === undefined) return undefined
      return { card: 'diff', title: `Apply patch ${args.file_path ?? ''}`, diffs }
    },
  }))
}
