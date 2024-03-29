import type { Template } from '.'

const page: Template = ({ name }) => ({
  path: `pages/${name}.vue`,
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
