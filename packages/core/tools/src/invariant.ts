/** Package-owned tool-pipeline invariants. @module @deepseek-ai/dsh-tools/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ToolExecution, ToolExecutionResult } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tools'

/** Cordis companion plugin name. */
export const name = 'tools-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

type ToolStage = 'pre' | 'execute' | 'post'

/** Validate the immutable final execution/result snapshot. */
function validateResult(
  exec: Readonly<ToolExecution>,
  result: Readonly<ToolExecutionResult>,
  fail: InvariantFailure,
): void {
  if (!Object.isFrozen(exec)) fail('tools/result execution must be frozen before publication')
  if (!Object.isFrozen(result) || !Object.isFrozen(result.content)) {
    fail('tools/result outcome and content must be frozen before publication')
  }
  if (exec.name.length === 0 || String(exec.callId).length === 0) {
    fail('tools/result execution must carry non-empty name and callId')
  }
}

/** Install monotonic pipeline, final-snapshot, and code-dispatch enclosure checks. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const stages = new WeakMap<object, ToolStage>()
  const openTurns = new WeakMap<Session, number | null>()
  const dispatchRoots = new WeakMap<Session, Map<string, string>>()
  // A6: every allowed-once decision carrying an operation id resolves through
  // exactly one terminal disposition on the same id (tool/result or the
  // Code Mode settle event); duplicate operation ids across one session log
  // fail (restart/HMR collision guard). Seeded from the loaded log so only
  // NEW appends are checked — legacy duplicate rows stay readable.
  const pendingAllowed = new WeakMap<Session, Set<string>>()
  const seenOperationIds = new WeakMap<Session, Set<string>>()
  // An operation identity is CLAIMED by its attempt's opening event —
  // `tool/call` for native calls, `tool/code-dispatch-start` for Code Mode
  // sub-dispatches — and then repeated only on that attempt's continuation
  // events (approval pair, result, settle). Uniqueness therefore applies to
  // opening events, and the seed scans the same opening set so a restart or
  // ToolRuntime replacement can never re-mint a logged id.
  const openingOperationIdOf = (event: SessionEvent): string | undefined =>
    event.type === 'tool/call' ? event.data.operationId
      : event.type === 'tool/code-dispatch-start' ? event.data.operationId
        : undefined
  const validateOperationId = (session: Session, operationId: string | undefined): void => {
    if (operationId === undefined) return
    const seen = seenOperationIds.get(session) ?? seedOperationIds(session).seen
    if (seen.has(operationId)) fail(`duplicate durable operationId ${JSON.stringify(operationId)} within one session log`)
    seen.add(operationId)
  }
  const seedOperationIds = (session: Session): { pending: Set<string>; seen: Set<string> } => {
    const pending = new Set<string>()
    const seen = new Set<string>()
    for (const event of session.snapshotEvents()) {
      const openingId = openingOperationIdOf(event)
      if (openingId !== undefined) seen.add(openingId)
      if (event.type === 'approval/decided' && event.data.outcome === 'allowed-once'
        && event.data.operationId !== undefined) {
        pending.add(event.data.operationId)
      }
      if (event.type === 'tool/result' && event.data.operationId !== undefined) pending.delete(event.data.operationId)
      if (event.type === 'tool/code-dispatch' && event.data.operationId !== undefined) pending.delete(event.data.operationId)
    }
    pendingAllowed.set(session, pending)
    seenOperationIds.set(session, seen)
    return { pending, seen }
  }
  const operationTraceFor = (session: Session): { pending: Set<string>; seen: Set<string> } => {
    const pending = pendingAllowed.get(session)
    if (pending !== undefined) return { pending, seen: seenOperationIds.get(session) as Set<string> }
    return seedOperationIds(session)
  }
  const validateDispatch = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return
    const root = String(event.data.rootCallId)
    const parent = String(event.data.parentCallId)
    const child = String(event.data.subCallId)
    if (root.length === 0 || parent.length === 0 || child.length === 0) {
      fail(`${event.type} must carry non-empty rootCallId, parentCallId, and subCallId`)
      return
    }
    const roots = dispatchRoots.get(session)
    const known = roots?.get(child)
    if (known !== undefined && known !== root) fail(`${event.type} changed rootCallId for subCallId ${child}`)
    if (parent !== root && roots?.get(parent) !== root) {
      fail(`${event.type} parentCallId ${parent} does not belong to rootCallId ${root}`)
    }
  }
  const commitDispatch = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return
    const roots = dispatchRoots.get(session) as Map<string, string>
    roots.set(String(event.data.subCallId), String(event.data.rootCallId))
  }
  const seed = (session: Session): number | null => {
    let openTurn: number | null = null
    dispatchRoots.set(session, new Map())
    for (const event of session.snapshotEvents()) {
      validateDispatch(session, event)
      commitDispatch(session, event)
      if (event.type === 'turn/start') openTurn = event.data.turn
      else if (event.type === 'turn/end') openTurn = null
      else if ((event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch')
        && openTurn === null) {
        fail(`${event.type} appended outside any open turn`)
      }
    }
    openTurns.set(session, openTurn)
    return openTurn
  }
  const openTurnFor = (session: Session): number | null => openTurns.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) {
    seed(session)
    seedOperationIds(session)
  }
  ctx.on('session/created', (session) => { seed(session); seedOperationIds(session) }, { global: true })
  ctx.on('session/event', (session, event) => {
    validateDispatch(session, event)
    commitDispatch(session, event)
    if (event.type === 'turn/start') openTurns.set(session, event.data.turn)
    else if (event.type === 'turn/end') openTurns.set(session, null)
  }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'session/event') {
      const [session, event] = args as [Session, SessionEvent]
      validateDispatch(session, event)
      if ((event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch')
        && openTurnFor(session) === null) {
        fail(`${event.type} appended outside any open turn`)
      }
      // Pre-commit, authoritative gate: an A6 violation (duplicate opening
      // identity, or an allowed-once attempt reaching turn end without its
      // terminal disposition) rejects the append BEFORE the event enters the
      // durable log.
      validateOperationId(session, openingOperationIdOf(event))
      if (event.type === 'approval/decided' && event.data.outcome === 'allowed-once'
        && event.data.operationId !== undefined) {
        operationTraceFor(session).pending.add(event.data.operationId)
      }
      if ((event.type === 'tool/result' || event.type === 'tool/code-dispatch')
        && event.data.operationId !== undefined) {
        operationTraceFor(session).pending.delete(event.data.operationId)
      }
      if (event.type === 'turn/end') {
        const { pending } = operationTraceFor(session)
        if (pending.size > 0) {
          fail(`allowed-once attempt without a terminal disposition: ${[...pending].map(id => JSON.stringify(id)).join(', ')}`)
        }
      }
      return
    }
    if (eventName === 'tools/pre-execute') {
      const exec = args[0] as ToolExecution
      if (stages.has(exec)) fail('tools/pre-execute repeated for one execution')
      stages.set(exec, 'pre')
      return
    }
    if (eventName === 'tools/execute') {
      const exec = args[0] as ToolExecution
      if (stages.get(exec) !== 'pre') fail('tools/execute must follow tools/pre-execute')
      stages.set(exec, 'execute')
      return
    }
    if (eventName === 'tools/post-execute') {
      const exec = args[0] as ToolExecution
      const previous = stages.get(exec)
      if (previous !== 'pre' && previous !== 'execute') {
        fail('tools/post-execute must follow tools/pre-execute or tools/execute')
      }
      stages.set(exec, 'post')
      return
    }
    if (eventName !== 'tools/result') return
    const [exec, result] = args as [Readonly<ToolExecution>, Readonly<ToolExecutionResult>]
    validateResult(exec, result, fail)
    stages.delete(exec)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the tools invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
