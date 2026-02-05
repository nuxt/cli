// @ts-check
import antfu from '@antfu/eslint-config'
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: {
    tooling: true,
    standalone: false,
    stylistic: true,
  },
  dirs: {
    src: [
      './playground',
    ],
  },
}, await antfu({
  // nuxt/eslint already provides it
  regexp: false,
})).append(
  {
    ignores: ['packages/nuxi/src/data/**'],
  },
  {
    rules: {
      'vue/singleline-html-element-content-newline': 'off',
      // TODO: remove usage of `any` throughout codebase
      '@typescript-eslint/no-explicit-any': 'off',
      'style/indent-binary-ops': 'off',
      'pnpm/json-valid-catalog': 'off',
      'pnpm/json-enforce-catalog': 'off',
      'pnpm/yaml-enforce-settings': 'off',
    },
  },
  {
    files: ['playground/**'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.yml'],
    rules: {
      '@stylistic/spaced-comment': 'off',
    },
  },
)
