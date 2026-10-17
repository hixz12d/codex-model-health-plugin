import { computed, onScopeDispose, ref } from 'vue'
import { api } from './api'
import type { Bootstrap, Method, Run } from './api'

export const MAX_BATCH_ACCOUNTS = 16
export const MAX_CONCURRENCY = 4
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
  status: 'waiting' | 'running' | 'pausing' | 'paused' | 'completed' | 'failed' | 'uncertain' | 'skipped'
  run: Run | null
  error: string
}
export const batchStatusText: Record<BatchRow['status'], string> = {
  waiting: '排队中', running: '正在检测', pausing: '本题结束后暂停', paused: '已暂停', completed: '已完成',
  failed: '异常待处理', uncertain: '结果待确认', skipped: '已跳过',
}

// 按账号并行，每个账号内严格逐题；继续操作不重新创建已有任务。
export function useBatchDetection(options: { onRun: (run: Run) => void; reload: () => Promise<void> }) {
  const rows = ref<BatchRow[]>([])
  const active = ref(0)
  const concurrency = ref(3)
  const running = computed(() => active.value > 0)
  const error = ref('')
  const params = ref<DetectionParams | null>(null)
  const remaining = computed(() => rows.value.filter(row => ['waiting', 'running', 'pausing', 'paused'].includes(row.status)).length)
  const paused = computed(() => rows.value.filter(row => row.status === 'paused').length)
  const canPause = computed(() => rows.value.some(row => row.status === 'waiting' || row.status === 'running'))
  const completed = computed(() => rows.value.filter(row => row.status === 'completed').length)
  const issues = computed(() => rows.value.filter(row => row.status === 'failed' || row.status === 'uncertain').length)
  let disposed = false

  function visible() { return !disposed && document.visibilityState === 'visible' }
  function pauseAccount(id: string) {
    const row = rows.value.find(row => row.id === id)
    if (!row) return
    if (row.status === 'waiting') row.status = 'paused'
    else if (row.status === 'running') row.status = 'pausing'
  }
  function pause() { rows.value.forEach(row => pauseAccount(row.id)) }
  function accept(row: BatchRow, value: Run) {
    row.run = value
    if (!disposed) options.onRun(value)
  }
  function settle(row: BatchRow) {
    if (row.run?.status === 'completed') row.status = 'completed'
    else if (row.run?.status === 'paused' || row.run?.status === 'stopped') {
      row.status = 'failed'
      row.error = [...row.run.attempts].reverse().find(attempt => attempt.status === 'error')?.error || '任务已暂停或结束，请查看报告后单独处理'
    } else row.status = 'paused'
  }

  async function execute(row: BatchRow) {
    try {
      if (!row.run) {
        accept(row, (await api<{ run: Run }>('runs/start', { ...params.value, account_id: row.id })).run)
      } else {
        // 只读核对，不自动恢复服务端的错误或未知结果。
        const current = await api<{ run: Run; busy: boolean }>('runs/get', { id: row.run.id })
        accept(row, current.run)
        if (current.busy || current.run.status === 'running') throw new Error('该账号请求尚未确认结束，请在历史中刷新并检查')
      }
      while (row.status === 'running' && visible() && row.run?.status === 'ready') {
        accept(row, (await api<{ run: Run }>('runs/step', { id: row.run.id })).run)
      }
      settle(row)
    } catch (cause) {
      row.status = 'uncertain'
      row.error = cause instanceof Error ? cause.message : String(cause)
      error.value = '操作结果未确认：已暂停其余账号，不会自动重发。请核对异常账号的详情或历史；可手动继续其他账号。'
      // 管理请求失败可能发生在已计费之后；等待其余在途请求收尾，不强制取消。
      pause()
    } finally {
      active.value--
      schedule()
      if (!disposed && !running.value) {
        try { await options.reload() }
        catch { error.value ||= '检测历史刷新失败；本批结果仍保留，可稍后重新读取历史' }
      }
    }
  }

  function schedule() {
    if (!visible()) { pause(); return }
    while (active.value < concurrency.value) {
      const row = rows.value.find(row => row.status === 'waiting')
      if (!row) break
      row.status = 'running'
      active.value++
      void execute(row)
    }
  }
  function resumeAccount(id: string) {
    if (!visible()) return
    const row = rows.value.find(row => row.id === id)
    if (!row || row.status !== 'paused') return
    row.status = 'waiting'
    schedule()
  }
  function resume() {
    if (!params.value || !visible()) return
    rows.value.forEach(row => { if (row.status === 'paused') row.status = 'waiting' })
    schedule()
  }
  function start(accounts: Bootstrap['accounts'], settings: DetectionParams, parallel = 3) {
    if (running.value || remaining.value || !visible()) return
    const unique = [...new Map(accounts.map(account => [account.id, account])).values()]
    if (!unique.length || unique.length > MAX_BATCH_ACCOUNTS) return
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > MAX_CONCURRENCY) return
    concurrency.value = parallel
    params.value = { ...settings }
    error.value = ''
    rows.value = unique.map(account => ({ id: account.id, name: account.name, status: 'waiting', run: null, error: '' }))
    schedule()
  }
  function finish() {
    if (running.value) return
    for (const row of rows.value) {
      if (row.status === 'waiting' || row.status === 'paused') row.status = 'skipped'
    }
    error.value = ''
  }
  function syncRun(value: Run) {
    const row = rows.value.find(row => row.run?.id === value.id)
    if (!row || row.status === 'running' || row.status === 'pausing') return
    row.run = value
    if (value.status === 'completed') {
      row.status = 'completed'
      row.error = ''
    }
  }
  function visibility() { if (!visible()) pause() }
  document.addEventListener('visibilitychange', visibility)
  onScopeDispose(() => { disposed = true; pause(); document.removeEventListener('visibilitychange', visibility) })

  return { rows, running, active, concurrency, paused, canPause, remaining, completed, issues, error, params, start, pause, resume, pauseAccount, resumeAccount, finish, syncRun }
}
