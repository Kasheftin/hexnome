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
    },
  },
  test: {
    // The rules module is pure maths — no DOM, no WebGL, no component mounting.
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
})
