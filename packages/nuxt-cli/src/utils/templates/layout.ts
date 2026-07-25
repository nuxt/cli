import type { Template } from '.'
import { resolve } from 'pathe'

const layout: Template = ({ name, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.dir.layouts, `${name}.vue`),
  contents: `
<script setup lang="ts"></script>

<template>
  <div>
    Layout: ${name}
    <slot />
  </div>
</template>

<style scoped></style>
`,
})

export { layout }
