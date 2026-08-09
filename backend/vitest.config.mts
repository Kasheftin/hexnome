import 'dotenv/config'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    /* The service specs talk to the real database; two suites sharing one would fight over rows. */
    fileParallelism: false,
    /*
     * `src/rules` is a symlink to packages/rules/src, whose own suite runs in its own project — so
     * without this the rules specs would run twice, once here with no vitest config of their own.
     */
    include: ['src/**/*.spec.ts'],
    exclude: ['src/rules/**'],
  },
})
