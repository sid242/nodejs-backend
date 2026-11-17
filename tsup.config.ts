import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/server.ts',
    'src/worker.ts',
    'src/db/migrate.ts',
    'src/db/migrate-all.ts',
    'src/db/seed.ts',
  ],
  format: ['esm'],
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  dts: false,
  shims: true,
});
