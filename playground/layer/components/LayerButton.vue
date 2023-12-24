<template>
  <button>{{ props.label || 'Link Button' }}</button>
</template>

<script setup lang="ts">
import type { ButtonAction } from '#my-module/types'

const props = defineProps<{ label: string | undefined } & ButtonAction>();
</script>
