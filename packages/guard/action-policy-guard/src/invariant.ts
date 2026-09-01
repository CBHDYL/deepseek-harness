/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-action-policy-guard`.
 * @module @deepseek-ai/dsh-action-policy-guard/invariant
 */

const PACKAGE_NAME = '@deepseek-ai/dsh-action-policy-guard'

/** Cordis companion plugin name. */
export const name = 'action-policy-guard-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the interceptor is covered by its own suite. */
export const install = (): void => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: { invariants: { register(name: string, install: () => void): unknown } }): Promise<unknown> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
