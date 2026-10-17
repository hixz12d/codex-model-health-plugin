<script setup lang="ts">
import { computed } from 'vue'
import { BaseButton, BaseCard, BaseTable, BaseTag } from '@codex-proxy/ui'
import type { BaseTableColumn } from '@codex-proxy/ui'
import type { BatchRow, DetectionParams } from './useBatchDetection'
import { batchStatusText } from './useBatchDetection'
import { methodText } from './presentation'
import { batchMetrics } from './batchPresentation'

const props = defineProps<{
  rows: BatchRow[]
  running: boolean
  remaining: number
  completed: number
  issues: number
  error: string
  params: DetectionParams | null
  busy: boolean
}>()
defineEmits<{ pause: []; resume: []; finish: []; view: [row: BatchRow] }>()
const isMeow = computed(() => props.params?.method !== 'modeltrace')
const displayRows = computed(() => props.rows.map(row => ({ ...row, ...batchMetrics(row.run) })))
const columns = computed<BaseTableColumn[]>(() => [
  { key: 'name', label: '账号', kind: 'identity', size: 'xl' },
  { key: 'status', label: '进度', kind: 'custom', size: 'lg' },
  ...(isMeow.value ? [{ key: 'targetScore', label: '目标模型匹配度', kind: 'custom' as const, size: 'lg' as const }] : []),
  { key: 'candidate', label: isMeow.value ? '当前最高候选' : '检测结论', kind: 'custom', size: 'xl' },
  { key: 'candidateScore', label: isMeow.value ? '候选匹配度' : '最高候选相对概率', kind: 'custom', size: 'lg' },
  { key: 'actions', label: '操作', kind: 'actions' },
])
function rowTone(row: BatchRow) {
  return row.status === 'running' ? 'primary' : row.status === 'failed' || row.status === 'uncertain' ? 'warning' : undefined
}
</script>

<template>
  <BaseCard v-if="props.rows.length">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>本批检测结果</h2>
          <p class="subtitle">{{ methodText(params?.method) }} · {{ params?.request_model }}<template v-if="isMeow"> · 对照模型：{{ params?.claimed_model }}</template></p>
        </div>
        <div class="flex flex-wrap gap-2">
          <BaseButton v-if="running" size="sm" @click="$emit('pause')">当前题完成后暂停批次</BaseButton>
          <template v-else-if="remaining">
            <BaseButton size="sm" variant="primary" :disabled="busy" @click="$emit('resume')">继续批次</BaseButton>
            <BaseButton size="sm" :disabled="busy" @click="$emit('finish')">结束批次</BaseButton>
          </template>
        </div>
      </div>
    </template>
    <template #body>
      <p role="status" class="text-cp-sm mt-0">共 {{ rows.length }} 个账号 · 完成 {{ completed }} · 异常 {{ issues }} · 待完成 {{ remaining }}</p>
      <p v-if="error" role="alert" class="sample-error">{{ error }}</p>
      <p v-if="!running && remaining" class="muted text-cp-sm">批次已暂停，点击“继续批次”才会发送下一题。“结束批次”跳过剩余账号，已有样本仍可从历史单独续测。</p>
      <BaseTable class="hidden xl:block" :columns="columns" :rows="displayRows">
        <template #status="{ row }">
          <BaseTag :type="rowTone(row)">{{ batchStatusText[row.status as BatchRow['status']] }}</BaseTag>
          <div v-if="row.run" class="muted text-cp-xs mt-1 tabular-nums">{{ row.run.report.valid_samples }} / {{ row.run.plan.jobs.length }} 有效样本</div>
          <p v-if="row.error || row.note" class="sample-answer muted mt-1 mb-0">{{ row.error || row.note }}</p>
        </template>
        <template #targetScore="{ row }"><strong class="tabular-nums">{{ row.targetScore }}</strong><span v-if="row.provisional" class="muted text-cp-xs block mt-1">暂定</span></template>
        <template #candidate="{ row }"><span class="sample-answer">{{ row.candidate }}</span><span v-if="row.provisional" class="muted text-cp-xs block mt-1">暂定</span></template>
        <template #candidateScore="{ row }"><strong class="tabular-nums">{{ row.candidateScore }}</strong><span v-if="row.provisional" class="muted text-cp-xs block mt-1">暂定</span></template>
        <template #actions="{ row }"><BaseButton size="sm" :disabled="!row.run || busy" :aria-label="`查看 ${row.name} 的本批报告`" @click="$emit('view', row)">详情</BaseButton></template>
      </BaseTable>
      <ul class="m-0 list-none p-0 xl:hidden" aria-label="本批账号结果">
        <li v-for="row in displayRows" :key="row.id" class="border-b border-cp-border py-4 last:border-b-0">
          <div class="flex flex-wrap items-center justify-between gap-2"><strong class="break-all text-cp-sm">{{ row.name }}</strong><BaseTag :type="rowTone(row)">{{ batchStatusText[row.status] }}</BaseTag></div>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-cp-sm my-3">
            <template v-if="isMeow"><dt class="muted">目标模型匹配度</dt><dd class="m-0 text-right font-emphasis tabular-nums">{{ row.targetScore }}<span v-if="row.provisional" class="muted text-cp-xs block font-normal">暂定</span></dd></template>
            <dt class="muted">{{ isMeow ? '当前最高候选' : '检测结论' }}</dt><dd class="m-0 text-right break-all">{{ row.candidate }}<span v-if="row.provisional" class="muted text-cp-xs block">暂定</span></dd>
            <dt class="muted">{{ isMeow ? '候选匹配度' : '候选相对概率' }}</dt><dd class="m-0 text-right font-emphasis tabular-nums">{{ row.candidateScore }}<span v-if="row.provisional" class="muted text-cp-xs block font-normal">暂定</span></dd>
          </dl>
          <p v-if="row.error || row.note" class="sample-error">{{ row.error || row.note }}</p>
          <div class="flex flex-wrap items-center justify-between gap-2"><span class="muted text-cp-xs tabular-nums">有效样本 {{ row.run?.report.valid_samples ?? 0 }} / {{ row.run?.plan.jobs.length ?? '—' }}</span><BaseButton size="sm" :disabled="!row.run || busy" :aria-label="`查看 ${row.name} 的本批报告`" @click="$emit('view', row)">详情</BaseButton></div>
        </li>
      </ul>
      <p class="muted text-cp-xs mb-0"><template v-if="isMeow">百分比是候选库内的行为匹配度，暂定值会随有效样本更新。</template><template v-else>完成三轮有效样本后显示结论，百分比只表示候选库内的相对概率。</template>不是模型身份认证；本批汇总在离开或刷新页面后不保留。</p>
    </template>
  </BaseCard>
</template>
