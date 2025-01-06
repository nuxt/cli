import { resolve } from 'pathe'
import type { Template } from '.'

const error: Template = ({ nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, 'error.vue'),
  contents: `
<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps({
  error: Object as () => NuxtError
})
</script>

<template>
  <div>
    <h1>{{ error.statusCode }}</h1>
    <NuxtLink to="/">Go back home</NuxtLink>
  </div>
</template>

<style scoped></style>
`,
})

export { error }
