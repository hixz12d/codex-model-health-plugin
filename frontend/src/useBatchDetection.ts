import { computed, onScopeDispose, ref } from 'vue'
import { api } from './api'
import type { Bootstrap, Method, Run } from './api'

export const MAX_BATCH_ACCOUNTS = 16
export interface DetectionParams {
  method: Method
  key_id: string
  request_model: string
  claimed_model: string
  tier: string
}
export interface BatchRow {
  id: string
  name: string
  status: 'waiting' | 'running' | 'completed' | 'failed' | 'uncertain' | 'skipped'
  run: Run | null
  error: string
}
export const batchStatusText: Record<BatchRow['status'], string> = {
  waiting: '等待检测', running: '正在检测', completed: '已完成',
  failed: '异常待处理', uncertain: '结果待确认', skipped: '已跳过',
}

// 只编排现有单账号接口，不绕过宿主计量、账号绑定或检测预算
export function useBatchDetection(options: { onRun: (run: Run) => void; reload: () => Promise<void> }) {
  const rows = ref<BatchRow[]>([])
  const running = ref(false)
  const error = ref('')
  const params = ref<DetectionParams | null>(null)
  const remaining = computed(() => rows.value.filter(row => row.status === 'waiting' || row.status === 'running').length)
  const completed = computed(() => rows.value.filter(row => row.status === 'completed').length)
  const issues = computed(() => rows.value.filter(row => row.status === 'failed' || row.status === 'uncertain').length)
  let proceed = false
  let disposed = false

  function pause() { proceed = false }
  function visible() { return !disposed && document.visibilityState === 'visible' }
  function accept(row: BatchRow, value: Run) {
    row.run = value
    if (!disposed) options.onRun(value)
  }
  function settle(row: BatchRow) {
    if (row.run?.status === 'completed') row.status = 'completed'
    else if (row.run?.status === 'paused' || row.run?.status === 'stopped') {
      row.status = 'failed'
      row.error = [...row.run.attempts].reverse().find(attempt => attempt.status === 'error')?.error || '任务已暂停或结束，请查看报告后单独处理'
    }
    else row.status = 'waiting'
  }

  async function resume() {
    if (running.value || !remaining.value || !params.value || !visible()) return
    running.value = true
    proceed = true
    error.value = ''
    try {
      for (const row of rows.value) {
        if (!proceed || !visible()) break
        if (row.status !== 'waiting') continue
        row.status = 'running'
        try {
          if (!row.run) {
            accept(row, (await api<{ run: Run }>('runs/start', { ...params.value, account_id: row.id })).run)
          } else {
            // 手动续队列先读状态；未知副作用不重新创建、不自动重发
            const current = await api<{ run: Run; busy: boolean }>('runs/get', { id: row.run.id })
            accept(row, current.run)
            if (current.busy || current.run.status === 'running') throw new Error('当前请求尚未确认结束，请在历史中刷新并检查该账号')
          }
          while (proceed && visible() && row.run?.status === 'ready') {
            accept(row, (await api<{ run: Run }>('runs/step', { id: row.run.id })).run)
          }
          settle(row)
        } catch (cause) {
          row.status = 'uncertain'
          row.error = cause instanceof Error ? cause.message : String(cause)
          error.value = '队列已暂停：本次操作结果未确认，不会自动重试。请先查看当前账号或检测历史，再继续剩余账号。'
          // HTTP/桥接失败可能发生在服务端已写入或已计费之后
          proceed = false
        }
      }
    } finally {
      if (!disposed) {
        try { await options.reload() }
        catch { error.value ||= '检测历史刷新失败；本批结果仍在下方，可稍后重新读取历史' }
      }
      running.value = false
      proceed = false
    }
  }

  function start(accounts: Bootstrap['accounts'], settings: DetectionParams) {
    if (running.value || remaining.value || !visible()) return
    const unique = [...new Map(accounts.map(account => [account.id, account])).values()]
    if (!unique.length || unique.length > MAX_BATCH_ACCOUNTS) return
    // 冻结本批参数，修改新建表单不能改变排队账号的检测条件
    params.value = { ...settings }
    rows.value = unique.map(account => ({ id: account.id, name: account.name, status: 'waiting', run: null, error: '' }))
    void resume()
  }

  function finish() {
    if (running.value) return
    for (const row of rows.value) {
      if (row.status === 'waiting') row.status = 'skipped'
    }
    // 已创建的未完成任务仍由原历史接口续测，不丢弃其已计量样本
    error.value = ''
  }
  function syncRun(value: Run) {
    const row = rows.value.find(row => row.run?.id === value.id)
    if (!row || running.value) return
    row.run = value
    if (value.status === 'completed') {
      row.status = 'completed'
      row.error = ''
    }
  }
  function visibility() { if (!visible()) pause() }
  document.addEventListener('visibilitychange', visibility)
  onScopeDispose(() => { disposed = true; pause(); document.removeEventListener('visibilitychange', visibility) })

  return { rows, running, remaining, completed, issues, error, params, start, pause, resume, finish, syncRun }
}
