import type { Template } from '.'
import { resolve } from 'pathe'
import { applySuffix } from '.'
import { modes } from './modifiers'

const component: Template = ({ name, args, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, `components/${name}${applySuffix(
    args,
    modes,
    'mode',
  )}.vue`),
  contents: `
<script setup lang="ts"></script>

<template>
  <div>
    Component: ${name}
  </div>
</template>

<style scoped></style>
`,
})

export { component }
