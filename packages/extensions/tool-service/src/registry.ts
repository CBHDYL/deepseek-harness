/**
 * Managed long-running service registry for the `service_manage` tool: spawns
 * detached processes with private log files, tracks their pid/port/health,
 * and guarantees cleanup — every started service is killed when its owning
 * session disposes or the plugin unloads, so an agent can never orphan a
 * process (the postmortem-0003 failure mode).
 * @module @deepseek-ai/dsh-tool-service/registry
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, openSync, readFileSync, closeSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** One managed service. */
export interface ManagedService {
  /** Stable id chosen by the caller. */
  id: string
  /** The shell command being run. */
  command: string
  /** Process id of the detached child. */
  pid: number
  /** Absolute path of the private log file. */
  logPath: string
  /** Optional port the service is expected to listen on. */
  port?: number
  /** Optional http(s) healthcheck URL. */
  healthUrl?: string
  /** Epoch ms when the service started. */
  startedAt: number
  /** Session id that owns the process (killed on its disposal). */
  ownerSessionId?: string
}

/** Private log root: a 0700 directory under the OS temp dir. */
function logRoot(): string {
  const root = join(tmpdir(), 'dsh-services')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  return root
}

/**
 * Whether a process with this pid is alive (no signal sent).
 * @param pid - the process id to probe.
 * @returns true when the process exists.
 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a TCP port is currently bound on loopback.
 * @param port - the port to probe.
 * @param host - the bind address to probe.
 * @returns true when something is listening on the port.
 */
export async function isPortInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolveResult) => {
    const server = createServer()
    server.once('error', () => resolveResult(true))
    server.listen(port, host, () => {
      server.close(() => resolveResult(false))
    })
  })
}

/**
 * Fetch a healthcheck URL with a short timeout; false on any failure.
 * @param url - the healthcheck URL.
 * @param timeoutMs - the request timeout.
 * @returns whether the endpoint answered with an ok status.
 */
export async function healthOk(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Terminate a process, escalating to SIGKILL when it does not exit promptly.
 * @param pid - the process id to terminate.
 * @param graceMs - how long to wait for SIGTERM before SIGKILL.
 */
export async function killProcess(pid: number, graceMs = 1500): Promise<void> {
  if (!isAlive(pid)) return
  try { process.kill(pid, 'SIGTERM') } catch { return }
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline && isAlive(pid)) {
    await new Promise(resolveResult => setTimeout(resolveResult, 100))
  }
  if (isAlive(pid)) {
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  }
}

/**
 * The last `lines` lines of a log file, or a message when it is unreadable.
 * @param logPath - the absolute log file path.
 * @param lines - how many trailing lines to return.
 * @returns the log tail.
 */
export function tailLog(logPath: string, lines: number): string {
  try {
    const text = readFileSync(logPath, 'utf8')
    const parts = text.split('\n')
    return parts.slice(-lines).join('\n')
  } catch (error: unknown) {
    return `cannot read log ${logPath}: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Registry state of one service for the model-facing result. */
export interface ServiceStatus {
  id: string
  running: boolean
  pid: number
  command: string
  logPath: string
  port?: number
  portOpen?: boolean
  health?: boolean
  startedAt: number
}

/**
 * The process registry: start/stop/status/logs/list plus guaranteed cleanup.
 * One instance per plugin `apply()`; disposal kills every managed process.
 */
export class ServiceRegistry {
  private services = new Map<string, ManagedService>()
  private readonly root = logRoot()

  /**
   * All managed services.
   * @returns the complete service list.
   */
  list(): ManagedService[] {
    return [...this.services.values()]
  }

  /**
   * The managed service record for an id, or undefined.
   * @param id - the managed service id.
   * @returns the service record when managed.
   */
  get(id: string): ManagedService | undefined {
    return this.services.get(id)
  }

  /**
   * Tail a service's log.
   * @param id - the managed service id.
   * @param lines - how many trailing lines to return.
   * @returns the log tail, or a readable error message.
   */
  logs(id: string, lines: number): string {
    const service = this.services.get(id)
    if (service === undefined) throw new Error(`service "${id}" is not managed`)
    return tailLog(service.logPath, lines)
  }

  /**
   * Start a detached service. Rejects a duplicate id, a port already in use,
   * and a command that fails to spawn. The service is killed on plugin
   * disposal and on its owning session's disposal.
   * @param input - the service identity, command, and optional port/health/workdir/owner.
   * @returns the started service record.
   */
  async start(input: {
    id: string
    command: string
    workdir?: string
    port?: number
    healthUrl?: string
    ownerSessionId?: string
  }): Promise<ManagedService> {
    if (this.services.has(input.id)) {
      throw new Error(`service "${input.id}" is already managed; stop it first`)
    }
    if (input.port !== undefined && await isPortInUse(input.port)) {
      throw new Error(`port ${input.port} is already in use`)
    }
    const logPath = join(this.root, `${input.id}.log`)
    const logFd = openSync(logPath, 'a', 0o600)
    let pid: number
    try {
      const child = spawn(input.command, {
        shell: true,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        cwd: input.workdir === undefined ? process.cwd() : resolve(input.workdir),
      })
      pid = child.pid ?? 0
      if (pid === 0) throw new Error(`failed to spawn ${JSON.stringify(input.command)}`)
      child.unref()
    } catch (error: unknown) {
      closeSync(logFd)
      throw error
    }
    const service: ManagedService = {
      id: input.id,
      command: input.command,
      pid,
      logPath,
      startedAt: Date.now(),
      ...input.port !== undefined ? { port: input.port } : {},
      ...input.healthUrl !== undefined ? { healthUrl: input.healthUrl } : {},
      ...input.ownerSessionId !== undefined ? { ownerSessionId: input.ownerSessionId } : {},
    }
    this.services.set(input.id, service)
    return service
  }

  /**
   * Stop and forget a service; idempotent for unknown ids.
   * @param id - the managed service id.
   */
  async stop(id: string): Promise<void> {
    const service = this.services.get(id)
    if (service === undefined) return
    await killProcess(service.pid)
    this.services.delete(id)
  }

  /**
   * Current status facts for a service, or a not-managed error.
   * @param id - the managed service id.
   * @returns liveness, port, and health facts for the service.
   */
  async status(id: string): Promise<ServiceStatus> {
    const service = this.services.get(id)
    if (service === undefined) throw new Error(`service "${id}" is not managed`)
    const running = isAlive(service.pid)
    return {
      id: service.id,
      running,
      pid: service.pid,
      command: service.command,
      logPath: service.logPath,
      startedAt: service.startedAt,
      ...service.port !== undefined ? { port: service.port, portOpen: await isPortInUse(service.port) } : {},
      ...service.healthUrl !== undefined ? { health: await healthOk(service.healthUrl) } : {},
    }
  }

  /**
   * Kill every managed process; called on plugin disposal and per-session cleanup.
   * @param filter - optional predicate limiting which services are killed.
   */
  async killAll(filter?: (service: ManagedService) => boolean): Promise<void> {
    const targets = [...this.services.values()].filter(filter ?? (() => true))
    await Promise.all(targets.map(service => killProcess(service.pid)))
    for (const service of targets) this.services.delete(service.id)
  }
}

/**
 * Total bytes currently written to a service log (0 when absent).
 * @param logPath - the absolute log file path.
 * @returns the log size in bytes.
 */
export function logSize(logPath: string): number {
  try {
    return statSync(logPath).size
  } catch {
    return 0
  }
}
