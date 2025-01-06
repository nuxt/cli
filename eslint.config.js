// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: {
    tooling: true,
    stylistic: true,
  },
  dirs: {
    src: [
      './playground',
    ],
  },
}).append({
  rules: {
    'vue/singleline-html-element-content-newline': 'off',
    // TODO: remove usage of `any` throughout codebase
    '@typescript-eslint/no-explicit-any': 'off',
  },
}, {
  files: ['src/**'],
  rules: {
    'no-console': 'error',
  },
})
