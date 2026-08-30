/**
 * Subprocess tests for the managed-service registry and the service_manage
 * tool: real spawn/kill/log/port/health behavior, the session-ownership
 * cleanup guarantee, and the agent-less denial. Processes are real and short;
 * every test joins its children via killAll in teardown.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:net'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolService from '@deepseek-ai/dsh-tool-service'
import { ServiceRegistry, isAlive } from '@deepseek-ai/dsh-tool-service/registry'

const registries: ServiceRegistry[] = []
function freshRegistry(): ServiceRegistry {
  const registry = new ServiceRegistry()
  registries.push(registry)
  return registry
}

afterEach(async () => {
  await Promise.all(registries.splice(0).map(registry => registry.killAll()))
})

/** A long-running no-op node process. */
const SLEEP_COMMAND = 'node -e "setInterval(() => {}, 1000)"'

describe('ServiceRegistry', () => {
  it('starts a detached process, reports it alive, and stops it', async () => {
    const registry = freshRegistry()
    const service = await registry.start({ id: 'srv', command: SLEEP_COMMAND })
    expect(isAlive(service.pid)).toBe(true)
    const status = await registry.status('srv')
    expect(status.running).toBe(true)
    await registry.stop('srv')
    expect(isAlive(service.pid)).toBe(false)
    await expect(registry.status('srv')).rejects.toThrow(/not managed/)
  })

  it('captures the process log', async () => {
    const registry = freshRegistry()
    const command = 'node -e "console.log(\'hello-service\'); setInterval(() => {}, 1000)"'
    await registry.start({ id: 'logs', command })
    await new Promise(resolveResult => setTimeout(resolveResult, 600))
    expect(registry.logs('logs', 5)).toContain('hello-service')
    await registry.stop('logs')
  })

  it('refuses a duplicate id and a port already in use', async () => {
    const registry = freshRegistry()
    await registry.start({ id: 'dup', command: SLEEP_COMMAND })
    await expect(registry.start({ id: 'dup', command: SLEEP_COMMAND })).rejects.toThrow(/already managed/)

    const server = createServer()
    await new Promise<void>(resolveResult => server.listen(0, '127.0.0.1', resolveResult))
    const port = (server.address() as { port: number }).port
    await expect(registry.start({ id: 'portbusy', command: SLEEP_COMMAND, port })).rejects.toThrow(/already in use/)
    await new Promise<void>(resolveResult => server.close(() => resolveResult()))
  })

  it('reports the port state in status and checks a health URL', async () => {
    const registry = freshRegistry()
    // Find a free port, then let the SERVICE bind it (no test-side holder).
    const probe = createServer()
    await new Promise<void>(resolveResult => probe.listen(0, '127.0.0.1', resolveResult))
    const port = (probe.address() as { port: number }).port
    await new Promise<void>(resolveResult => probe.close(() => resolveResult()))
    const command = `node -e "require('node:http').createServer((q, s) => { s.end('ok') }).listen(${port}, '127.0.0.1')"`
    await registry.start({ id: 'web', command, port, healthUrl: `http://127.0.0.1:${port}/` })
    await new Promise(resolveResult => setTimeout(resolveResult, 900))
    const status = await registry.status('web')
    expect(status.portOpen).toBe(true)
    expect(status.health).toBe(true)
    await registry.stop('web')
  })

  it('killAll terminates every managed process', async () => {
    const registry = freshRegistry()
    const a = await registry.start({ id: 'a', command: SLEEP_COMMAND })
    const b = await registry.start({ id: 'b', command: SLEEP_COMMAND })
    await registry.killAll()
    expect(isAlive(a.pid)).toBe(false)
    expect(isAlive(b.pid)).toBe(false)
  })
})

describe('service_manage tool', () => {
  async function harness() {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(ToolService, {})
    return ctx
  }

  const call = (ctx: Context, args: object, agent?: object) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: 'call-svc' as never,
    name: 'service_manage',
    arguments: args,
    ...agent !== undefined ? { agent: agent as never } : {},
  })

  const text = (result: { content: Array<{ type: string; text?: string }> }) =>
    result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')

  function agent(ctx: Context, sessionId: string) {
    const id = SessionId(sessionId)
    const fiber = ctx.plugin(() => {})
    return {
      id,
      ctx: fiber.ctx,
      session: { id, header: { version: 0, id, createdAt: 0 } },
    } as never
  }

  it('start/status/logs/stop round-trips through the tool', async () => {
    const ctx = await harness()
    const started = await call(ctx, {
      action: 'start',
      id: 'svc',
      command: 'node -e "console.log(\'tool-service\'); setInterval(() => {}, 1000)"',
    }, agent(ctx, 'sess-svc'))
    expect(started.isError).toBe(false)
    expect(text(started)).toContain('started')

    await new Promise(resolveResult => setTimeout(resolveResult, 500))
    const status = await call(ctx, { action: 'status', id: 'svc' }, agent(ctx, 'sess-svc'))
    expect(text(status)).toContain('running')

    const logs = await call(ctx, { action: 'logs', id: 'svc', lines: 5 }, agent(ctx, 'sess-svc'))
    expect(text(logs)).toContain('tool-service')

    const stopped = await call(ctx, { action: 'stop', id: 'svc' }, agent(ctx, 'sess-svc'))
    expect(text(stopped)).toContain('stopped')
  })

  it('denies starting a service without an agent', async () => {
    const ctx = await harness()
    const result = await call(ctx, { action: 'start', id: 'x', command: 'true' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires an agent')
  })

  it('kills a session-owned service when the session disposes', async () => {
    const ctx = await harness()
    const owner = agent(ctx, 'sess-cleanup')
    const started = await call(ctx, { action: 'start', id: 'owned', command: SLEEP_COMMAND }, owner)
    expect(started.isError).toBe(false)

    const listBefore = await call(ctx, { action: 'list' }, owner)
    expect(text(listBefore)).toContain('owned')

    // Session disposal announces via the session/disposed event; emitting it
    // with the owning session must kill the owned service.
    await new Promise(resolveResult => setTimeout(resolveResult, 200))
    ctx.emit('session/disposed', (owner as { session: object }).session as never)
    await new Promise(resolveResult => setTimeout(resolveResult, 500))

    const listAfter = await call(ctx, { action: 'list' }, owner)
    expect(text(listAfter)).toBe('no managed services')
  })
})
