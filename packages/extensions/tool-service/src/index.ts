/**
 * Model-facing `service_manage` tool: start, stop, status, logs, and list for
 * long-running managed processes, with guaranteed cleanup — every process the
 * tool starts is killed when its owning session disposes or the plugin
 * unloads, so the agent cannot orphan a server (the postmortem-0003 failure
 * mode this tool exists to prevent).
 * @module @deepseek-ai/dsh-tool-service
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertNever } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session'
import { ServiceRegistry } from './registry.ts'

export const name = 'tool-service'
export const inject = ['tools', 'systemPrompt']

/** Plugin config; currently no tunables, kept for forward compatibility. */
export interface Config {
  /** Maximum log lines returned by a `logs` call (default 200). */
  maxLogLines?: number
}

/** Runtime schema for the plugin config. */
export const Config: z<Config> = z.object({
  maxLogLines: z.number().min(1).default(200),
})

/** The closed action vocabulary. */
export type ServiceAction = 'start' | 'stop' | 'status' | 'logs' | 'list'

/**
 * Install the `service_manage` tool and its guidance.
 * @param ctx - plugin context; registrations are effects scoped to it, and registry cleanup runs on disposal.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const maxLogLines = config.maxLogLines ?? 200
  const registry = new ServiceRegistry()

  // Guaranteed cleanup: plugin disposal kills every managed process, and a
  // session's disposal kills the services its agent started.
  ctx.effect(() => () => { void registry.killAll() }, 'tool-service registry teardown')
  ctx.on('session/disposed', (session) => {
    void registry.killAll(service => service.ownerSessionId === session.id)
  })

  ctx.systemPrompt.section({
    name: 'tool:service_manage',
    order: 106,
    text: 'Use service_manage for long-running processes the current session must keep alive (dev servers, watchers). It runs the command directly (outside the file sandbox) and kills the whole process group when the session ends; never fall back to bare nohup/background shell for services.',
  })

  ctx.tools.register(defineTool({
    name: 'service_manage',
    description: 'Manage a long-running service process owned by this session: start a detached process with optional port and healthcheck, stop it, check its status, read its log, or list managed services. The command runs directly (outside the file sandbox); the whole process group is killed when this session ends or the plugin unloads — use this instead of orphaned background shell processes.',
    parameters: {
      action: {
        type: 'string' as const,
        required: true,
        enum: ['start', 'stop', 'status', 'logs', 'list'] as const,
        description: 'What to do: start a new service, stop one, check status, read the log tail, or list managed services.',
      },
      id: {
        type: 'string' as const,
        description: 'Stable service id (required for start/stop/status/logs; omitted for list).',
      },
      command: {
        type: 'string' as const,
        description: 'The shell command to run (required for start).',
      },
      workdir: {
        type: 'string' as const,
        description: 'Working directory for the started process; defaults to the session workspace.',
      },
      port: {
        type: 'number' as const,
        description: 'Optional port the service is expected to bind; the tool refuses to start when it is already in use and reports its state in status.',
      },
      health_url: {
        type: 'string' as const,
        description: 'Optional http(s) URL polled for status health checks.',
      },
      lines: {
        type: 'number' as const,
        description: `Log lines to return (logs action only; capped at ${maxLogLines}).`,
      },
    },
    output: {
      schema: {
        oneOf: [
          { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, message: { type: 'string', required: true } } },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              services: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    running: { type: 'boolean', required: true },
                    pid: { type: 'integer', required: true },
                    port: { type: 'integer' },
                    portOpen: { type: 'boolean' },
                    health: { type: 'boolean' },
                  },
                },
              },
            },
          },
        ],
      },
      render: (args, value) => [{ type: 'text', text: renderServiceResult(args.action, value) }],
    },
    effects: 'side-effectful',
    async execute(args: ServiceToolArgs, exec) {
      if (args.action === 'start' && exec.agent === undefined) {
        throw new Error('service_manage: starting a service requires an agent session to own its lifecycle')
      }
      switch (args.action) {
        case 'start': {
          if (args.id === undefined || args.command === undefined) {
            throw new Error('service_manage: start requires id and command')
          }
          if (exec.agent === undefined) {
            throw new Error('service_manage: starting a service requires an agent session to own its lifecycle')
          }
          const service = await registry.start({
            id: args.id,
            command: args.command,
            // Default to the session workspace (the immutable session cwd) so an
            // omitted or relative workdir stays in the project rather than the
            // harness launch directory.
            workdir: args.workdir === undefined ? String(exec.agent.session.header.cwd ?? process.cwd()) : args.workdir,
            ...args.port !== undefined ? { port: args.port } : {},
            ...args.health_url !== undefined ? { healthUrl: args.health_url } : {},
            ownerSessionId: exec.agent.session.id,
          })
          return { ok: true, message: `service "${service.id}" started (pid ${service.pid}); logs at ${service.logPath}` }
        }
        case 'stop': {
          if (args.id === undefined) throw new Error('service_manage: stop requires id')
          await registry.stop(args.id)
          return { ok: true, message: `service "${args.id}" stopped` }
        }
        case 'status': {
          if (args.id === undefined) throw new Error('service_manage: status requires id')
          return { ok: true, services: [projectStatus(await registry.status(args.id))] }
        }
        case 'logs': {
          if (args.id === undefined) throw new Error('service_manage: logs requires id')
          return { ok: true, message: registry.logs(args.id, Math.min(args.lines ?? 100, maxLogLines)) }
        }
        case 'list': {
          return { ok: true, services: (await Promise.all(registry.list().map(s => registry.status(s.id)))).map(projectStatus) }
        }
        default: {
          return assertNever(args.action, 'ServiceAction')
        }
      }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `service_manage ${args.action}${args.id !== undefined ? ` ${args.id}` : ''}`,
        kind: 'execute',
        rawInput: JSON.stringify(args),
        content: [],
      }
    },
    presentResult(args, result: ToolResult): GenericCallView | undefined {
      const text = result.content.find(block => block.type === 'text')?.text ?? ''
      return { card: 'generic', title: `service_manage ${args.action}`, kind: 'execute', rawInput: JSON.stringify(args), content: [{ type: 'text', text }] }
    },
  }))
}

/** Validated tool arguments. */
export interface ServiceToolArgs {
  action: ServiceAction
  id?: string
  command?: string
  workdir?: string
  port?: number
  health_url?: string
  lines?: number
}

/** Project a full status onto the output-schema fields. */
function projectStatus(status: {
  id: string
  running: boolean
  pid: number
  port?: number
  portOpen?: boolean
  health?: boolean
}): { id: string; running: boolean; pid: number; port?: number; portOpen?: boolean; health?: boolean } {
  return {
    id: status.id,
    running: status.running,
    pid: status.pid,
    ...status.port !== undefined ? { port: status.port } : {},
    ...status.portOpen !== undefined ? { portOpen: status.portOpen } : {},
    ...status.health !== undefined ? { health: status.health } : {},
  }
}

/** Render the canonical result value into the model-facing text. */
interface ServiceRow {
  id: string
  running: boolean
  pid: number
  port?: number
  portOpen?: boolean
  health?: boolean
}

function renderServiceResult(action: ServiceAction, value: { ok: boolean; message?: string; services?: ServiceRow[] }): string {
  if (action === 'list' || action === 'status') {
    const rows = value.services ?? []
    if (rows.length === 0) return 'no managed services'
    return rows.map((s) => {
      const facts = [
        s.running ? 'running' : 'stopped',
        s.port !== undefined ? `port:${s.port}${s.portOpen === true ? '(in use)' : '(free)'}` : undefined,
        s.health === undefined ? undefined : `health:${s.health ? 'ok' : 'down'}`,
      ].filter(Boolean)
      return `- ${s.id} (pid ${s.pid}, ${facts.join(', ')})`
    }).join('\n')
  }
  return value.message ?? 'ok'
}
