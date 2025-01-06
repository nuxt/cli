import type { Template } from '.'
import { applySuffix } from '.'
import { resolve } from 'pathe'

const component: Template = ({ name, args, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, `components/${name}${applySuffix(
    args,
    ['client', 'server'],
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
