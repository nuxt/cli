import type { Template } from '.'
import { resolve } from 'pathe'

const page: Template = ({ name, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.dir.pages, `${name}.vue`),
  contents: `
<script setup lang="ts"></script>

<template>
  <div>
    Page: ${name}
  </div>
</template>

<style scoped></style>
`,
})

export { page }
