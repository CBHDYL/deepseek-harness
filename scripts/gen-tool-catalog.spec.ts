/**
 * P6-10/P6-11 effects-catalog source-of-truth pins: the catalog reports the
 * SHIPPED tool definition's runtime `effects` (harvested from the live tool
 * registry), never MCP/self-declared claims, and a boot that registers
 * nothing fails loud instead of fabricating an empty section.
 */

import { describe, expect, it } from 'vitest'
import { collectToolCatalog, assertToolsHarvested } from './gen-tool-catalog.ts'
import type { ToolPackage } from './gen-tool-catalog.ts'

describe('gen-tool-catalog effects harvest', () => {
  it('every catalog effects value comes from the shipped definition: only read-only or undeclared, never a self-claim', async () => {
    const catalog = await collectToolCatalog()
    const values = new Set<string>()
    for (const entry of catalog) {
      for (const [name, effects] of Object.entries(entry.effects)) {
        values.add(effects)
        // The only trusted vocabulary: the shipped ToolDefinition.effects
        // union. A third value would mean an untrusted self-declared channel
        // leaked into the catalog.
        expect(['read-only', 'undeclared']).toContain(effects)
        // MCP runtime registrations are never harvested: no wire tool name
        // appears under a catalog schema.
        expect(name.startsWith('mcp__')).toBe(false)
      }
    }
    expect(values).toEqual(new Set(['read-only', 'undeclared']))
  })

  it('the shipped read-only declarations surface: all five session-query tools report read-only', async () => {
    const catalog = await collectToolCatalog()
    const query = catalog.find(entry => entry.pkg === '@deepseek-ai/dsh-tool-session-query')
    expect(query).toBeDefined()
    const names = ['session_search', 'session_event_search', 'session_trace', 'session_event_trace', 'session_event_read']
    for (const name of names) {
      expect(query!.effects[name]).toBe('read-only')
    }
  })

  it('a boot that registers no tool fails loud instead of harvesting nothing', () => {
    const broken: ToolPackage = {
      pkg: '@deepseek-ai/dsh-tool-broken-boot',
      dir: 'tool-broken-boot',
      source: 'packages/none/src/index.ts',
      requires: [],
      writes: [],
      async mount() {},
    }
    expect(() => { assertToolsHarvested(broken, 0) }).toThrow(/booted without registering a single tool/)
    expect(() => { assertToolsHarvested(broken, 1) }).not.toThrow()
  })
})
