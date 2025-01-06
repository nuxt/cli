import { resolve } from 'pathe'
import type { Template } from '.'

const app: Template = ({ args, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, 'app.vue'),
  contents: args['pages']
    ? `
<script setup lang="ts"></script>

<template>
  <div>
    <NuxtLayout>
      <NuxtPage/>
    </NuxtLayout>
  </div>
</template>

<style scoped></style>
`
    : `
<script setup lang="ts"></script>

<template>
  <div>
    <h1>Hello World!</h1>
  </div>
</template>

<style scoped></style>
`,
})

export { app }
