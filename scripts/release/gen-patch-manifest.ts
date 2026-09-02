/**
 * Generate the patch manifest: a machine-readable inventory of the committed
 * source delta between an explicit upstream baseline and an explicit candidate,
 * with each change attributed to a known semantic work item.
 *
 * The manifest is evidence, not authority: it changes nothing at runtime,
 * takes part in no grant or sandbox decision, repairs nothing, and its
 * existence never proves a candidate legitimate. It also describes source
 * delta only — it never announces DRIFT; drift is the R2 gate's question.
 *
 * Ownership is an explicit, auditable commit table (`SEMANTIC_OWNERSHIP`):
 * a commit belongs to the work item listed beside it, nothing is inferred
 * from commit messages, and any commit missing from the table is reported as
 * OTHER/UNMAPPED rather than silently skipped.
 * @module scripts/release/gen-patch-manifest
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { capture, isEntry } from './process.ts'

/** Semantic work items a commit may belong to. */
export const WORK_ITEMS = [
  'PR-1', 'PR-2', 'PR-3', 'PR-4', 'PR-5', 'PR-6',
  'R1-R2', 'R3', 'R4',
  'ALIGN', 'SANITATION', 'DOC-HYGIENE', 'ANCHOR', 'P1-FIX',
  'STOPGAP', 'MIGRATION',
] as const

/** A semantic work item id. */
export type WorkItem = (typeof WORK_ITEMS)[number] | 'OTHER'

/**
 * The explicit commit ownership table. Only these hashes map to work items;
 * everything else is OTHER. Entries are short hashes because `git rev-list`
 * is asked for the same length below.
 */
export const SEMANTIC_OWNERSHIP: Readonly<Record<string, WorkItem>> = {
  '14e8acfc0': 'PR-1',
  '37b6c8c6b': 'PR-2',
  'bcaab0c2d': 'PR-2',
  'e86ee106f': 'PR-2',
  'e18040ffb': 'PR-3',
  '4399114cb': 'PR-4',
  '03ccf9aa3': 'PR-5',
  '132ee8733': 'PR-6',
  'b8b7d7d3b': 'PR-6',
  'cb7361f4b': 'ALIGN',
  'c2f62f965': 'SANITATION',
  'b92d266c2': 'SANITATION',
  'ef979cb2b': 'DOC-HYGIENE',
  '0ee00831c': 'DOC-HYGIENE',
  '2f23dd74b': 'DOC-HYGIENE',
  '56281b8d5': 'DOC-HYGIENE',
  '090aaae28': 'R1-R2',
  '7dfbc8954': 'R1-R2',
  '38fafbbbe': 'R1-R2',
  '70dca4e50': 'R1-R2',
  'be397b85c': 'R1-R2',
  '48e0ba95d': 'ANCHOR',
  '1c3dfde10': 'R3',
  '106629dae': 'R4',
  '3735467b4': 'P1-FIX',
  '3e02e7bb0': 'STOPGAP',
  'b6cd4a3c1': 'MIGRATION',
  'aed8cef92': 'MIGRATION',
}

/** One commit in the delta. */
export interface ManifestCommit {
  /** Full object name. */
  readonly sha: string
  /** One-line subject. */
  readonly subject: string
  /** Semantic owner from the explicit table, `OTHER` when unmapped. */
  readonly owner: WorkItem
}

/** One changed file in the delta. */
export interface ManifestFile {
  /** Path as `git diff` reports it. */
  readonly path: string
  /** Change kind: A / M / D / R100 … */
  readonly status: string
  /** Top-level area the path belongs to. */
  readonly area: string
  /** Number of commits touching the file in the delta. */
  readonly commits: number
  /** Whether every touching commit is unmapped. */
  readonly unmapped: boolean
}

/** The generated manifest. */
export interface PatchManifest {
  /** Explicitly requested baseline revision, resolved to a commit. */
  readonly baseline: string
  /** Explicitly requested candidate revision, resolved to a commit. */
  readonly candidate: string
  /** The merge base of the two. */
  readonly mergeBase: string
  /** Commits on the candidate side since the merge base, oldest first. */
  readonly commits: readonly ManifestCommit[]
  /** Changed files since the merge base, alphabetically ordered. */
  readonly files: readonly ManifestFile[]
  /** Commit count per owner, in work-item order. */
  readonly ownership: Readonly<Record<WorkItem, number>>
  /** Files that no mapped commit touches. */
  readonly unmappedFileCount: number
}

const SHORT_LEN = 9

function git(root: string, args: string[]): string {
  return capture('git', ['-C', root, ...args])
}

/** The top-level area a changed path belongs to. */
function areaOf(path: string): string {
  const parts = path.split('/')
  if (parts[0] === 'packages' && parts[1] !== undefined && parts[2] !== undefined) return `packages/${parts[1]}/${parts[2]}`
  if (parts[0] === 'apps' && parts[1] !== undefined) return `apps/${parts[1]}`
  if (parts[0] === 'scripts' && parts[1] !== undefined) return `scripts/${parts[1].split('.')[0] ?? ''}`
  if (parts[0] === 'docs' && parts[1] !== undefined) return `docs/${parts[1]}`
  if (parts[0] === '.agents' && parts[1] !== undefined && parts[2] !== undefined) return `.agents/${parts[1]}/${parts[2]}`
  return parts[0] ?? '(root)'
}

/**
 * Rebuild the delta between two explicitly named revisions.
 * @param root - repository root.
 * @param baseline - explicit baseline revision; never inferred.
 * @param candidate - explicit candidate revision; never inferred.
 * @param ownership - the commit ownership table to attribute against,
 * defaulting to {@link SEMANTIC_OWNERSHIP}. Injected for tests so they never
 * mutate the shipped table.
 * @returns The manifest. Both revisions must resolve, and the merge base is
 * computed rather than assumed.
 */
export function buildPatchManifest(
  root: string,
  baseline: string,
  candidate: string,
  ownershipTable: Readonly<Record<string, WorkItem>> = SEMANTIC_OWNERSHIP,
): PatchManifest {
  // Fail loud on an unresolvable revision; git's error names the offender.
  const baselineSha = git(root, ['rev-parse', '--verify', `${baseline}^{commit}`]).trim()
  const candidateSha = git(root, ['rev-parse', '--verify', `${candidate}^{commit}`]).trim()
  const mergeBase = git(root, ['merge-base', baselineSha, candidateSha]).trim()

  const commits: ManifestCommit[] = git(root, ['log', '--reverse', '--format=%H %s', `${mergeBase}..${candidateSha}`])
    .split('\n').filter(line => line !== '')
    .map((line) => {
      const space = line.indexOf(' ')
      const sha = space === -1 ? line : line.slice(0, space)
      const subject = space === -1 ? '' : line.slice(space + 1)
      return { sha, subject, owner: ownershipTable[sha.slice(0, SHORT_LEN)] ?? 'OTHER' }
    })

  // One pass over the range builds the file → touching-commits map, so the
  // unmapped-file accounting never needs a git spawn per file.
  const touching = new Map<string, Set<string>>()
  {
    let current: string | undefined
    for (const line of git(root, ['log', '--full-history', '--diff-merges=first-parent', '--name-only', '--format=%H', `${mergeBase}..${candidateSha}`]).split('\n')) {
      if (line === '') continue
      if (/^[0-9a-f]{40}$/.test(line)) { current = line; continue }
      if (current === undefined) continue
      const set = touching.get(line) ?? new Set<string>()
      set.add(current)
      touching.set(line, set)
    }
  }
  const mappedCommits = new Set(commits.filter(commit => commit.owner !== 'OTHER').map(commit => commit.sha))

  const files: ManifestFile[] = git(root, ['diff', '--name-status', mergeBase, candidateSha])
    .split('\n').filter(line => line !== '')
    .map((line) => {
      const [status, ...rest] = line.split('\t')
      // A rename record carries `old\tnew`; the new path is what exists in the
      // candidate and what the touching map is keyed by.
      const isRename = status !== undefined && status.startsWith('R')
      const path = isRename && rest.length > 1 ? (rest[rest.length - 1] ?? '') : rest.join('\t')
      const commitsForFile = touching.get(path) ?? new Set<string>()
      return {
        path,
        status: status ?? 'M',
        area: areaOf(path),
        commits: commitsForFile.size,
        unmapped: commitsForFile.size === 0 || [...commitsForFile].every(sha => !mappedCommits.has(sha)),
      }
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const ownershipCounts = Object.fromEntries([...WORK_ITEMS, 'OTHER' as const].map(item => [item, 0])) as Record<WorkItem, number>
  for (const commit of commits) ownershipCounts[commit.owner] += 1

  return {
    baseline: baselineSha,
    candidate: candidateSha,
    mergeBase,
    commits,
    files,
    ownership: ownershipCounts,
    unmappedFileCount: files.filter(file => file.unmapped).length,
  }
}

/** Render the manifest as Markdown for human audit. */
export function renderMarkdown(manifest: PatchManifest): string {
  const lines: string[] = [
    '# Patch Manifest',
    '',
    '> Evidence, not authority: this inventory changes nothing at runtime and never proves a candidate legitimate.',
    '',
    `- baseline: \`${manifest.baseline}\``,
    `- candidate: \`${manifest.candidate}\``,
    `- merge base: \`${manifest.mergeBase}\``,
    '',
    '## Semantic ownership',
    '',
    '| work item | commits |',
    '|---|---|',
    ...([...WORK_ITEMS, 'OTHER' as const]).filter(item => manifest.ownership[item] > 0).map(item => `| ${item} | ${String(manifest.ownership[item])} |`),
    '',
    `Files with no mapped owning commit: **${String(manifest.unmappedFileCount)}**`,
    '',
    '## Commits (oldest first)',
    '',
    ...manifest.commits.map(commit => `- \`${commit.sha.slice(0, SHORT_LEN)}\` [${commit.owner}] ${commit.subject}`),
    '',
    '## Changed files',
    '',
    '| status | commits | unmapped | area | path |',
    '|---|---|---|---|---|',
    ...manifest.files.map(file => `| ${file.status} | ${String(file.commits)} | ${file.unmapped ? 'yes' : ''} | ${file.area} | ${file.path} |`),
    '',
  ]
  return lines.join('\n')
}

function main(): void {
  const { values } = parseArgs({
    options: {
      baseline: { type: 'string' },
      candidate: { type: 'string' },
      out: { type: 'string' },
    },
    allowPositionals: false,
  })
  if (values.baseline === undefined || values.candidate === undefined) {
    throw new Error('usage: gen-patch-manifest.ts --baseline <rev> --candidate <rev> [--out <dir>]')
  }
  const root = process.cwd()
  const manifest = buildPatchManifest(root, values.baseline, values.candidate)
  const outDir = resolve(root, values.out ?? 'dist/patch-manifest')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(`${outDir}/patch-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(`${outDir}/patch-manifest.md`, `${renderMarkdown(manifest)}\n`)
  console.log(`gen-patch-manifest: baseline ${manifest.baseline.slice(0, SHORT_LEN)} candidate ${manifest.candidate.slice(0, SHORT_LEN)} merge-base ${manifest.mergeBase.slice(0, SHORT_LEN)}`)
  console.log(`gen-patch-manifest: ${String(manifest.commits.length)} commit(s), ${String(manifest.files.length)} file(s), ${String(manifest.unmappedFileCount)} unmapped file(s) in ${outDir}`)
}

if (isEntry(import.meta.url)) main()
