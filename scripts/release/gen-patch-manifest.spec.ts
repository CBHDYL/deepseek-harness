import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPatchManifest, renderMarkdown, SEMANTIC_OWNERSHIP, type WorkItem } from './gen-patch-manifest.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A scratch git repository with a known commit shape. */
function repo(commits: readonly { readonly subject: string; readonly file: string }[]): { root: string; shas: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-patch-manifest-'))
  roots.push(root)
  const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'spec@local'])
  git(['config', 'user.name', 'spec'])
  const shas: string[] = []
  for (const commit of commits) {
    writeFileSync(join(root, commit.file), `${commit.subject}\n`)
    git(['add', commit.file])
    git(['commit', '-q', '-m', commit.subject])
    shas.push(git(['rev-parse', 'HEAD']).trim())
  }
  return { root, shas }
}

describe('patch manifest', () => {
  it('produces deterministic output for the same revisions', () => {
    const { root, shas } = repo([
      { subject: 'base', file: 'a.txt' },
      { subject: 'change one', file: 'b.txt' },
      { subject: 'change two', file: 'c.txt' },
    ])
    const first = buildPatchManifest(root, shas[0]!, shas[2]!)
    const second = buildPatchManifest(root, shas[0]!, shas[2]!)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('records the explicit baseline, candidate, and computed merge base', () => {
    const { root, shas } = repo([
      { subject: 'base', file: 'a.txt' },
      { subject: 'change', file: 'b.txt' },
    ])
    const manifest = buildPatchManifest(root, shas[0]!, shas[1]!)
    expect(manifest.baseline).toBe(shas[0])
    expect(manifest.candidate).toBe(shas[1])
    expect(manifest.mergeBase).toBe(shas[0])
    expect(manifest.commits).toHaveLength(1)
    expect(manifest.files.map(file => file.path)).toEqual(['b.txt'])
  })

  it('attributes a known commit through the explicit table and reports the unknown one as OTHER', () => {
    const { root, shas } = repo([
      { subject: 'base', file: 'a.txt' },
      { subject: 'mapped change', file: 'b.txt' },
      { subject: 'unmapped change', file: 'c.txt' },
    ])
    // Inject the mapping keyed the way the shipped table is keyed, without
    // mutating the shipped table.
    const table: Readonly<Record<string, WorkItem>> = { ...SEMANTIC_OWNERSHIP, [shas[1]!.slice(0, 9)]: 'PR-1' }
    const manifest = buildPatchManifest(root, shas[0]!, shas[2]!, table)
    expect(manifest.commits[0]!.owner).toBe('PR-1')
    expect(manifest.commits[1]!.owner).toBe('OTHER')
    expect(manifest.ownership['PR-1']).toBe(1)
    expect(manifest.ownership['OTHER']).toBe(1)
    expect(manifest.files.find(file => file.path === 'b.txt')?.unmapped).toBe(false)
    expect(manifest.files.find(file => file.path === 'c.txt')?.unmapped).toBe(true)
  })

  it('attributes a renamed file to the commit that renamed it', () => {
    const { root, shas } = repo([{ subject: 'base', file: 'a.txt' }])
    execFileSync('git', ['-C', root, 'mv', 'a.txt', 'renamed.txt'])
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'rename a to renamed'])
    const renamedSha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const table: Readonly<Record<string, WorkItem>> = { ...SEMANTIC_OWNERSHIP, [renamedSha.slice(0, 9)]: 'PR-1' }
    const manifest = buildPatchManifest(root, shas[0]!, 'HEAD', table)
    const renamed = manifest.files.find(file => file.path === 'renamed.txt')
    expect(renamed?.status).toMatch(/^R/)
    expect(renamed?.unmapped).toBe(false)
    expect(renamed?.commits).toBeGreaterThan(0)
  })

  it('fails loud on an invalid revision', () => {
    const { root, shas } = repo([{ subject: 'base', file: 'a.txt' }])
    expect(() => buildPatchManifest(root, shas[0]!, 'not-a-revision')).toThrow()
  })

  it('reports an empty delta when candidate equals baseline', () => {
    const { root, shas } = repo([{ subject: 'base', file: 'a.txt' }])
    const manifest = buildPatchManifest(root, shas[0]!, shas[0]!)
    expect(manifest.commits).toHaveLength(0)
    expect(manifest.files).toHaveLength(0)
    expect(manifest.unmappedFileCount).toBe(0)
  })

  it('renders markdown naming baseline, candidate, and every commit', () => {
    const { root, shas } = repo([
      { subject: 'base', file: 'a.txt' },
      { subject: 'change', file: 'b.txt' },
    ])
    const markdown = renderMarkdown(buildPatchManifest(root, shas[0]!, shas[1]!))
    expect(markdown).toContain(shas[0])
    expect(markdown).toContain(shas[1])
    expect(markdown).toContain('change')
    expect(markdown).toContain('b.txt')
  })
})
