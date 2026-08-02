import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Pure maths: no DOM, no WebGL, no component mounting. That is the point of this package.
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
})
