import type { Template } from '.'

const layout: Template = ({ name }) => ({
  path: `layouts/${name}.vue`,
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
