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
      './packages/nuxi/playground',
    ],
  },
}, await antfu()).append({
  rules: {
    'vue/singleline-html-element-content-newline': 'off',
    // TODO: remove usage of `any` throughout codebase
    '@typescript-eslint/no-explicit-any': 'off',
    'style/indent-binary-ops': 'off',
  },
}, {
  files: ['packages/nuxt-cli/playground/**'],
  rules: {
    'no-console': 'off',
  },
}, {
  files: ['**/*.yml'],
  rules: {
    '@stylistic/spaced-comment': 'off',
  },
})
