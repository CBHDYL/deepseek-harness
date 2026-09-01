/**
 * The sandbox POLICY home (`ctx.sandboxPolicy`): the single owner of the
 * deployment's sandbox fallbacks plus per-session resolution: the file-effect
 * {@link SandboxMode}, the `workspace-write` root, and the override kit (the
 * `sandbox/mode` event, its fold, and its write path, from `./session-mode.ts`).
 * Before each agent request, the owner also contributes the resolved policy to
 * the cache-safe runtime-context snapshot. The agent loop logs that snapshot as
 * model history, so replay reconstructs the same mode and root the enforcing
 * consumers resolve without rewriting the stable system prompt.
 *
 * Enforcing filesystem, one-shot bash, and terminal backends read the SAME
 * resolved policy here. The context describes that policy without inventorying
 * capabilities, while each backend retains its own enforcement dialect and each
 * tool owns its operation-specific denial and escalation guidance. The service
 * reads session state once at each operation boundary; executors and providers
 * remain session-free.
 *
 * @module @deepseek-ai/dsh-sandbox-policy
 */

import { resolve as resolvePath } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { canonicalPath, type SandboxExecutionPolicy, type SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { effectiveSandboxMode } from './session-mode.ts'

export { SANDBOX_MODES, effectiveSandboxMode, setSandboxMode } from './session-mode.ts'

declare const sandboxAuthorityBrand: unique symbol

/** An authority minted by the sandbox-policy owner; caller code cannot construct one. */
export type ResolvedSandboxAuthority = SandboxExecutionPolicy & { readonly [sandboxAuthorityBrand]: true }

/**
 * Enforce provenance at an enforcing backend's consumption point: a minted
 * authority passes through; a caller-constructed object is reported and
 * yields undefined so the backend applies its owner default (never the forged
 * object's declared fields). Shared by the fs/shell enforcing backends so the
 * check lives exactly where the authority is consumed.
 * @param policy - the caller-supplied policy, if any.
 * @param owner - the policy service whose minted set decides provenance.
 * @param consumer - the backend name for the warning message.
 * @param warn - the backend's logger-warning sink.
 * @returns the policy when minted, undefined for a forged object.
 */
export function trustedAuthority(
  policy: SandboxExecutionPolicy | undefined,
  owner: SandboxPolicyService,
  consumer: string,
  warn: (message: string) => void,
): SandboxExecutionPolicy | undefined {
  if (policy !== undefined && !owner.isMinted(policy)) {
    warn(`${consumer}: ignoring a caller-supplied sandbox policy that was not minted by ctx.sandboxPolicy`)
    return undefined
  }
  return policy
}

/** Strictly-wider order over the closed mode vocabulary, for ceiling comparison. */
const SANDBOX_MODE_ORDER: Record<SandboxMode, number> = {
  'read-only': 0,
  'workspace-write': 1,
  'danger-full-access': 2,
}

/** Freeze a plain authority so callers cannot widen a minted value in place. */
function deepFreeze<T extends object>(value: T): T {
  return Object.freeze(value)
}

/** Resolve filesystem identity before lexical normalization can erase symlink-sensitive components. */
function resolveWorkspaceRoot(path: string): string {
  return resolvePath(canonicalPath(path))
}

/** Render the policy without claiming which capabilities are mounted. */
function renderPolicyContext(policy: SandboxExecutionPolicy): string {
  switch (policy.mode) {
    case 'read-only':
      return 'Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.'
    case 'workspace-write':
      return `Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(policy.workspaceRoot)}. Some platform temporary areas may also be writable.`
    case 'danger-full-access':
      return 'Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.'
    /* v8 ignore next 4 -- SandboxMode is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
    default: {
      const mode: never = policy.mode
      throw new Error(`unreachable sandbox mode: ${String(mode)}`)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandboxPolicy: SandboxPolicyService
  }
}

/**
 * Plugin config: the deployment's sandbox default. All optional — `Config`
 * supplies the defaults (`mode: 'read-only'` is the fail-safe default; a
 * deployment that wants a workspace-writable agent opts in explicitly). The
 * runner choice is NOT here (it is the `ctx.sandbox` provider's config), nor
 * is any per-family knob: this is the one shared policy home.
 */
export interface Config {
  /** File-sandbox mode a session starts from (default: `read-only`). */
  mode?: SandboxMode
  /**
   * Hard deployment ceiling (default: `danger-full-access`, preserving the
   * historical semantics where an approved escalation may reach the widest
   * mode). No session override or approved escalation resolves above it.
   */
  maxMode?: SandboxMode
  /**
   * Fallback root for agentless calls and sessions without a cwd (default:
   * `process.cwd()`). Normal agent calls use their session cwd instead.
   */
  workspaceRoot?: string
}

/** Inputs that select the sandbox policy for one capability call. */
export interface SandboxPolicyRequest {
  /** Calling session; its immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
}

/**
 * The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment
 * default mode, fallback workspace root, and current request-time policy
 * section. Tool layers call {@link resolve} for each execution so a session's
 * mode log and immutable cwd travel together to every enforcing capability.
 */
export class SandboxPolicyService extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    mode: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('read-only'),
    maxMode: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('danger-full-access'),
    // No schema default: process.cwd() is resolved in the constructor so the
    // stored root is always absolute regardless of how it was supplied.
    workspaceRoot: z.string(),
  })

  /** The deployment default mode — the fallback beneath a session override. */
  readonly defaultMode: SandboxMode
  /** The hard ceiling no resolution exceeds — the security cap for session overrides and escalations. */
  readonly maxMode: SandboxMode
  /** The absolute `workspace-write` fallback root for calls without a session cwd. */
  readonly workspaceRoot: string
  /** Authorities this owner minted — the provenance the enforcing backends check. */
  private readonly minted = new WeakSet<object>()
  constructor(ctx: Context, config: Config) {
    super(ctx, 'sandboxPolicy')
    // schemastery (static Config) already filled `mode`; the cast records that
    // runtime fact. `workspaceRoot` has NO schema default, so its fallback to
    // the process cwd is real branching, resolved absolute either way.
    this.defaultMode = config.mode as SandboxMode
    this.maxMode = config.maxMode as SandboxMode
    if (SANDBOX_MODE_ORDER[this.defaultMode] > SANDBOX_MODE_ORDER[this.maxMode]) {
      throw new Error(`sandbox-policy: deployment default mode ${this.defaultMode} exceeds the configured maxMode ceiling ${this.maxMode}`)
    }
    this.workspaceRoot = resolveWorkspaceRoot(config.workspaceRoot ?? process.cwd())

    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'sandbox:policy',
        order: 110,
        text: (context) => {
          const session = context.agent?.session
          return session === undefined
            ? ''
            : renderPolicyContext(this.resolve({ session }))
        },
      })
    })
  }

  /**
   * Resolve the complete policy for one capability call. An approved explicit
   * mode outranks the session's last `sandbox/mode` event, which outranks the
   * deployment default. A session cwd is its workspace-write boundary; the
   * configured root is the fallback for agentless calls and sessions without a
   * cwd.
   * @param request - optional session and approved mode override.
   * @returns the fully resolved per-call mode and absolute workspace root.
   */
  resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy {
    const { session } = request
    const requested = request.mode ?? (session === undefined ? undefined : this.overrideOf(session)) ?? this.defaultMode
    const mode = SANDBOX_MODE_ORDER[requested] > SANDBOX_MODE_ORDER[this.maxMode] ? this.maxMode : requested
    const authority = deepFreeze({
      mode,
      workspaceRoot: resolveWorkspaceRoot(session?.header.cwd ?? this.workspaceRoot),
      ...session === undefined ? {} : { sessionId: session.id },
    })
    this.minted.add(authority)
    return authority
  }

  /**
   * Whether this owner minted the authority. Enforcing backends accept only
   * minted authorities; a caller-constructed object is ignored and the owner's
   * default applies. TypeScript cannot forge the brand, and this runtime check
   * stops structurally forged objects from partially-trusted in-process code.
   * It is not a malicious-code boundary: a plugin that can patch the service
   * or reach an unrestricted capability is out of scope.
   * @param authority - the policy object a capability call carries.
   * @returns true only for an authority this service returned from `resolve`.
   */
  isMinted(authority: SandboxExecutionPolicy): boolean {
    return this.minted.has(authority)
  }

  /**
   * Read the session override without applying the deployment default.
   * @param session - session whose log supplies the override.
   * @returns the last logged mode, or `undefined` without one.
   */
  overrideOf(session: Session): SandboxMode | undefined {
    return effectiveSandboxMode(session.events)
  }
}

export default SandboxPolicyService
