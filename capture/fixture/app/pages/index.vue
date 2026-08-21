<script setup lang="ts">
const { data } = await useFetch('/api/hello')
</script>

<template>
  <main>
    <h1>{{ data?.message }}</h1>
  </main>
</template>
