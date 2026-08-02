import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  resolve: {
    /*
     * Vitest reads the package's TypeScript source, while the compiled server requires its `dist`.
     * That is deliberate: tests stay instant and need no build, and `pnpm build` proves the other
     * path still works. Both come from the same files.
     */
    alias: {
      '@hexnome/rules': new URL('../packages/rules/src', import.meta.url).pathname,
    },
  },
})
