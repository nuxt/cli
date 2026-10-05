<script setup lang="ts">
definePageMeta({ middleware: 'traced' })

const { data } = await useFetch('/api/pid')
</script>

<template>
  <div>served by {{ data?.pid }}</div>
</template>
