<script setup lang="ts">
import { BaseButton } from '@codex-proxy/ui'
import type { BatchRow } from './useBatchDetection'
defineProps<{ row: BatchRow; busy: boolean }>()
defineEmits<{ pause: [id: string]; resume: [id: string]; view: [row: BatchRow] }>()
</script>

<template>
  <div class="flex flex-wrap justify-end gap-2">
    <BaseButton v-if="row.status === 'running' || row.status === 'waiting'" size="sm" :disabled="busy" :aria-label="`暂停 ${row.name}`" @click="$emit('pause', row.id)">暂停</BaseButton>
    <BaseButton v-else-if="row.status === 'pausing'" size="sm" disabled>正在暂停</BaseButton>
    <BaseButton v-else-if="row.status === 'paused'" size="sm" :disabled="busy" :aria-label="`继续 ${row.name}`" @click="$emit('resume', row.id)">继续</BaseButton>
    <BaseButton size="sm" :disabled="!row.run || busy" :aria-label="`查看 ${row.name} 的本批报告`" @click="$emit('view', row)">详情</BaseButton>
  </div>
</template>
