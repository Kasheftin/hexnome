import vue from 'eslint-plugin-vue'
import ts from 'typescript-eslint'

export default ts.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },

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
   * `packages/rules` is the rules module: pure TypeScript over plain data. It must
   * stay free of `vue` and `three` so that it can be unit-tested without a DOM
   * and reused verbatim by the backend.
   *
   * Structure now carries half the weight — the package depends on neither library and
   * its tsconfig omits the DOM lib — but the rule stays, because a dependency is far
   * easier to add than to notice.
   */
  {
    files: ['packages/rules/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'vue',
            message: '@hexnome/rules must stay framework-free. Keep Vue in scene/, ui/ or stores/.',
          },
          {
            name: 'three',
            message: '@hexnome/rules must stay renderer-free. Use the plain Axial/Point2 types instead of three classes.',
          },
        ],
        patterns: [
          {
            group: ['three/*', 'vue/*', '@tresjs/*', '@/*'],
            message: '@hexnome/rules may not depend on the app. Dependencies point inward only.',
          },
        ],
      }],
    },
  },
)
