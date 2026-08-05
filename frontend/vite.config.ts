import { fileURLToPath, URL } from 'node:url'
import templateCompilerOptions from '@tresjs/core/template-compiler-options'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    // TresJS resolves <TresMesh>, <TresBoxGeometry>, … at runtime from the three.js
    // namespace, so Vue must treat them as custom elements rather than components.
    //
    // Use TresJS's own options, not a hand-rolled `tag.startsWith('Tres')` check:
    // theirs also whitelists `<primitive>` and the `tres-` kebab form. Getting this
    // wrong fails silently — Vue cannot resolve <primitive>, so the element renders
    // nothing at all and only a console warning says why.
    vue(templateCompilerOptions),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
       * Resolved by path rather than left to the workspace link, so Vite treats the rules package as
       * ordinary source: it is compiled and hot-reloaded like the rest of the app, with no build step
       * between editing a rule and seeing it.
       */
      '@hexnome/rules': fileURLToPath(new URL('../packages/rules/src', import.meta.url)),
    },
  },
  server: {
    /*
     * The API, proxied rather than reached across origins.
     *
     * Keeping the browser on one origin means the app's fetches are same-origin in development
     * exactly as they are in production, so there is no CORS to configure, no credentials mode to
     * get wrong, and no `VITE_API_BASE` to set before the thing will run at all.
     */
    proxy: {
      '/games': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      // The head-moved socket. `ws` makes Vite forward the upgrade rather than the request.
      '/watch': { target: 'ws://localhost:3000', ws: true },
    },
  },
  test: {
    /*
     * App-layer specs. The rules package runs its own suite — see packages/rules/vitest.config.ts.
     *
     * `jsdom` only for the handful that touch storage; the scene specs are pure maths and do not care
     * either way.
     */
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
  },
})
