/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-escalation-hider`.
 * @module @deepseek-ai/dsh-escalation-hider/invariant
 */

const PACKAGE_NAME = '@deepseek-ai/dsh-escalation-hider'

/** Cordis companion plugin name. */
export const name = 'escalation-hider-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the schema transform is a pure function covered by its
 * own suite, and the assembly listener exposes no package-owned event or
 * snapshot an independent companion could observe.
 */
export const install = (): void => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: { invariants: { register(name: string, install: () => void): unknown } }): Promise<unknown> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
