import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli/index.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  target: 'node18',
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  shims: true,
  external: ['better-sqlite3'],
});
