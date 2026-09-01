/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-output-repetition-guard`.
 * @module @deepseek-ai/dsh-output-repetition-guard/invariant
 */

const PACKAGE_NAME = '@deepseek-ai/dsh-output-repetition-guard'

/** Cordis companion plugin name. */
export const name = 'output-repetition-guard-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the detector is a pure class covered by its own suite,
 * and the listener exposes only the package-owned `output-repetition/detected`
 * emit (not an invariant-worthy state).
 */
export const install = (): void => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: { invariants: { register(name: string, install: () => void): unknown } }): Promise<unknown> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
