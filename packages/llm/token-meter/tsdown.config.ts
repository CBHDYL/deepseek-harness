import { defineConfig } from 'tsdown'

/**
 * Build the package root and the estimate companion as independent bundles.
 *
 * The root workspace config emits only the index/invariant/startup entry names,
 * so a package that declares a further subpath export has to emit it here. The
 * VFS packer enumerates every declared non-wildcard export and requires it to
 * resolve, so an unbuilt subpath fails the packed Web preview rather than the
 * import that would use it.
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/estimate.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
