import type { Template } from '.'
import { applySuffix } from '.'

const component: Template = ({ name, args }) => ({
  path: `components/${name}${applySuffix(
    args,
    ['client', 'server'],
    'mode',
  )}.vue`,
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
