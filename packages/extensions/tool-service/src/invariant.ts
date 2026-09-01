/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-service`.
 * @module @deepseek-ai/dsh-tool-service/invariant
 */

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-service'

/** Cordis companion plugin name. */
export const name = 'tool-service-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the registry's kill-on-disposal guarantee is a
 * process-lifecycle contract exercised by the package's own subprocess tests,
 * not an event-stream relation another companion could observe.
 */
export const install = (): void => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: { invariants: { register(name: string, install: () => void): unknown } }): Promise<unknown> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
