import type { Run } from './api'

export interface BatchMetrics {
  targetScore: string
  candidate: string
  candidateScore: string
  provisional: boolean
  note: string
}

function validProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}
function percent(value: unknown) {
  return validProbability(value) ? `${(value * 100).toFixed(1)}%` : '—'
}
function candidateName(name: string) {
  return name === 'other_known_external' ? '其他 / 未建模行为' : name
}

// 只整理已有评分，不改算法；无有效样本时隐藏先验值，避免误认成检测结果
export function batchMetrics(run: Run | null): BatchMetrics {
  const empty: BatchMetrics = { targetScore: '—', candidate: '—', candidateScore: '—', provisional: false, note: '' }
  if (!run) return empty
  const report = run.report
  if (report.method === 'modeltrace') {
    // 三轮完整有效样本和最终归因都到位后，批量汇总才公布候选
    if (run.status !== 'completed' || report.valid_samples < 3 || report.verdict !== 'attributed' || !report.analysis) {
      return { ...empty, candidate: run.status === 'paused' || run.status === 'stopped' || run.status === 'completed' ? '样本不足或结果未确认' : '等待完整结果' }
    }
    const candidates = report.analysis.results.filter(item => validProbability(item.probability))
    const maximum = Math.max(...candidates.map(item => item.probability))
    const winners = candidates.filter(item => item.probability === maximum)
    return {
      ...empty,
      candidate: winners.length ? `更接近 ${winners.map(item => item.display_name).join(' / ')}${winners.length > 1 ? '（并列）' : ''}` : '结果未确认',
      candidateScore: percent(maximum),
    }
  }
  if (report.valid_samples <= 0) return empty
  const candidates = Object.entries(report.matches).filter(([, value]) => validProbability(value))
  const maximum = Math.max(...candidates.map(([, value]) => value))
  const winners = candidates.filter(([, value]) => value === maximum)
  return {
    targetScore: percent(report.matches[run.plan.claimed_model]),
    candidate: winners.length ? `${winners.map(([name]) => candidateName(name)).join(' / ')}${winners.length > 1 ? '（并列）' : ''}` : '—',
    candidateScore: percent(maximum),
    provisional: run.status !== 'completed',
    note: run.status === 'completed' && report.verdict === 'insufficient' ? '证据不足，匹配度仅供参考' : '',
  }
}
