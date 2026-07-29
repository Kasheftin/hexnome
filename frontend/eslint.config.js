import vue from 'eslint-plugin-vue'
import ts from 'typescript-eslint'

export default ts.config(
  { ignores: ['dist/**', 'node_modules/**'] },

  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],

  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: ts.parser },
    },
  },

  {
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },

  /**
   * The one hard architectural rule (docs/tech-spec.md).
   *
   * `src/game/**` is the rules module: pure TypeScript over plain data. It must
   * stay free of `vue` and `three` so that it can be unit-tested without a DOM
   * and reused verbatim by the Nest.js backend to validate moves server-side.
   *
   * This rule exists because the boundary erodes silently otherwise — one
   * convenient `Vector3` import and the module is no longer portable.
   */
  {
    files: ['src/game/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'vue',
            message: 'src/game/** must stay framework-free. Keep Vue in scene/, ui/ or stores/.',
          },
          {
            name: 'three',
            message: 'src/game/** must stay renderer-free. Use the plain Axial/Point2 types instead of three classes.',
          },
        ],
        patterns: [
          {
            group: ['three/*', 'vue/*', '@tresjs/*', '@/scene/*', '@/ui/*', '@/stores/*'],
            message: 'src/game/** may not depend on rendering, UI or store layers. Dependencies point inward only.',
          },
        ],
      }],
    },
  },
)
