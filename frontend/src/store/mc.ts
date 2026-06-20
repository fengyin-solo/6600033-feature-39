import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface MCScenario {
  id: string
  name: string
  description: string
  params: Record<string, number>
  category: string
}

export interface MCResult {
  scenario: string
  iterations: number
  estimate: number
  trueValue?: number
  error?: number
  samples: number[]
  convergence: number[]
}

export interface HypTestResult {
  testType: string
  statistic: number
  pValue: number
  significant: boolean
  alpha: number
  df?: number
}

export type RecordType = 'simulation' | 'test'

export interface HistorySummary {
  id: number
  record_type: RecordType
  title: string
  summary: string
  created_at: string
}

export interface HistoryRecord extends HistorySummary {
  params: Record<string, any>
  result: Record<string, any>
}

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

function normalRandom(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

function runMC(scenario: MCScenario, n: number): MCResult {
  const samples: number[] = []
  const convergence: number[] = []

  if (scenario.id === 'pi') {
    let inside = 0
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1
      if (x * x + y * y <= 1) inside++
      samples.push(x * x + y * y <= 1 ? 1 : 0)
      convergence.push((inside / (i + 1)) * 4)
    }
    const estimate = (inside / n) * 4
    return { scenario: 'pi', iterations: n, estimate, trueValue: Math.PI, error: Math.abs(estimate - Math.PI), samples, convergence }
  }
  if (scenario.id === 'brownian') {
    let pos = 0
    const dt = scenario.params.dt || 0.01
    for (let i = 0; i < n; i++) { pos += normalRandom() * Math.sqrt(dt); samples.push(pos) }
    convergence.push(...samples.slice(0, 200))
    return { scenario: 'brownian', iterations: n, estimate: pos, samples, convergence }
  }
  if (scenario.id === 'option') {
    const { S0 = 100, K = 105, r = 0.05, sigma = 0.2, T = 1 } = scenario.params
    let payoffSum = 0
    for (let i = 0; i < n; i++) {
      const ST = S0 * Math.exp((r - 0.5 * sigma * sigma) * T + sigma * Math.sqrt(T) * normalRandom())
      const p = Math.max(ST - K, 0); payoffSum += p; samples.push(p)
      if ((i + 1) % 50 === 0) convergence.push((payoffSum / (i + 1)) * Math.exp(-r * T))
    }
    return { scenario: 'option', iterations: n, estimate: (payoffSum / n) * Math.exp(-r * T), samples, convergence }
  }
  if (scenario.id === 'random_walk') {
    let pos = 0
    for (let i = 0; i < n; i++) { pos += Math.random() > 0.5 ? 1 : -1; samples.push(pos) }
    convergence.push(...samples.slice(0, 200))
    return { scenario: 'random_walk', iterations: n, estimate: pos, samples, convergence }
  }
  if (scenario.id === 'diffusion') {
    const { D = 1, dt = 0.01 } = scenario.params
    let x = 0, y = 0
    for (let i = 0; i < n; i++) {
      x += normalRandom() * Math.sqrt(2 * D * dt); y += normalRandom() * Math.sqrt(2 * D * dt)
      samples.push(Math.sqrt(x * x + y * y))
    }
    convergence.push(...samples.slice(0, 200))
    return { scenario: 'diffusion', iterations: n, estimate: Math.sqrt(x * x + y * y), samples, convergence }
  }
  // gambler
  const { p = 0.45, bankroll = 50, goal = 100 } = scenario.params
  let ruinCount = 0
  for (let i = 0; i < n; i++) {
    let money = bankroll
    let steps = 0
    while (money > 0 && money < goal && steps < 10000) { money += Math.random() < p ? 1 : -1; steps++ }
    if (money <= 0) ruinCount++
    samples.push(money <= 0 ? 0 : 1)
    convergence.push(ruinCount / (i + 1))
  }
  return { scenario: 'gambler', iterations: n, estimate: ruinCount / n, samples, convergence }
}

export const SCENARIOS: MCScenario[] = [
  { id: 'pi', name: '圆周率π估算', description: '随机投点估算π值，观察收敛过程', params: {}, category: '基础' },
  { id: 'brownian', name: '布朗运动模拟', description: '粒子热运动随机路径模拟', params: { dt: 0.01 }, category: '物理' },
  { id: 'option', name: '欧式期权定价', description: 'Black-Scholes期权价格蒙特卡洛估算', params: { S0: 100, K: 105, r: 0.05, sigma: 0.2, T: 1 }, category: '金融' },
  { id: 'random_walk', name: '随机游走', description: '一维离散随机游走轨迹模拟', params: {}, category: '基础' },
  { id: 'diffusion', name: '粒子扩散', description: '二维粒子随机扩散位移分析', params: { D: 1, dt: 0.01 }, category: '物理' },
  { id: 'gambler', name: '赌徒破产', description: '不利赌局下资金耗尽概率估算', params: { p: 0.45, bankroll: 50, goal: 100 }, category: '概率' }
]

function parseGroup(input: string): number[] {
  return input.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
}

export const useMCStore = defineStore('mc', () => {
  const currentScenario = ref<MCScenario>(SCENARIOS[0])
  const iterations = ref(1000)
  const result = ref<MCResult | null>(null)
  const testResult = ref<HypTestResult | null>(null)
  const isRunning = ref(false)

  const group1 = ref('5.1,4.8,5.3,4.9,5.2,5.0,4.7,5.1,5.4,4.8')
  const group2 = ref('4.6,4.2,4.9,4.3,4.5,4.7,4.4,4.8,4.1,4.6')

  const history = ref<HistorySummary[]>([])
  const activeRecordId = ref<number | null>(null)
  const isHistoryLoading = ref(false)

  function runSimulation() {
    isRunning.value = true
    setTimeout(() => {
      result.value = runMC(currentScenario.value, iterations.value)
      isRunning.value = false
      void saveSimulation(result.value)
    }, 10)
  }

  function runTest() {
    const g1 = parseGroup(group1.value)
    const g2 = parseGroup(group2.value)
    if (g1.length <= 1 || g2.length <= 1) return
    const n1 = g1.length, n2 = g2.length
    const m1 = g1.reduce((a, b) => a + b, 0) / n1
    const m2 = g2.reduce((a, b) => a + b, 0) / n2
    const v1 = g1.reduce((s, x) => s + (x - m1) ** 2, 0) / (n1 - 1)
    const v2 = g2.reduce((s, x) => s + (x - m2) ** 2, 0) / (n2 - 1)
    const se = Math.sqrt(v1 / n1 + v2 / n2)
    const t = (m1 - m2) / se
    const df = Math.round((v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1)))
    const pValue = 2 * (1 - Math.min(0.9999, Math.abs(t) / (Math.abs(t) + Math.sqrt(df))))
    testResult.value = { testType: 'Welch T检验', statistic: Math.round(t * 1000) / 1000, pValue: Math.round(pValue * 10000) / 10000, significant: pValue < 0.05, alpha: 0.05, df }
    void saveTest(testResult.value, g1, g2)
  }

  async function saveSimulation(r: MCResult) {
    const summary = `${currentScenario.value.name} · n=${r.iterations} · 估算=${r.estimate.toFixed(4)}${r.trueValue !== undefined ? ` · 真实=${r.trueValue.toFixed(4)}` : ''}${r.error !== undefined ? ` · 误差=${r.error.toFixed(4)}` : ''}`
    const payload = {
      record_type: 'simulation' as RecordType,
      title: currentScenario.value.name,
      summary,
      params: { scenarioId: currentScenario.value.id, scenarioName: currentScenario.value.name, iterations: r.iterations },
      result: {
        ...r,
        samples: r.samples.slice(0, 1000),
        convergence: r.convergence.slice(0, 200),
      },
    }
    try {
      const saved = await apiRequest<HistoryRecord>('/api/history', { method: 'POST', body: JSON.stringify(payload) })
      history.value = [saved, ...history.value]
      activeRecordId.value = saved.id
    } catch (e) {
      console.error('保存模拟结果失败', e)
    }
  }

  async function saveTest(tr: HypTestResult, g1: number[], g2: number[]) {
    const summary = `T检验 · t=${tr.statistic} · p=${tr.pValue} · ${tr.significant ? '显著(p<0.05)' : '不显著'}`
    const payload = {
      record_type: 'test' as RecordType,
      title: '独立样本T检验',
      summary,
      params: { alpha: tr.alpha, group1: g1, group2: g2 },
      result: tr,
    }
    try {
      const saved = await apiRequest<HistoryRecord>('/api/history', { method: 'POST', body: JSON.stringify(payload) })
      history.value = [saved, ...history.value]
      activeRecordId.value = saved.id
    } catch (e) {
      console.error('保存检验结果失败', e)
    }
  }

  async function loadHistory() {
    isHistoryLoading.value = true
    try {
      history.value = await apiRequest<HistorySummary[]>('/api/history')
    } catch (e) {
      console.error('加载历史失败', e)
    } finally {
      isHistoryLoading.value = false
    }
  }

  async function loadRecord(id: number) {
    try {
      const rec = await apiRequest<HistoryRecord>(`/api/history/${id}`)
      activeRecordId.value = id
      if (rec.record_type === 'simulation') {
        const sid = rec.params.scenarioId as string | undefined
        currentScenario.value = SCENARIOS.find(s => s.id === sid) || SCENARIOS[0]
        iterations.value = (rec.params.iterations as number) ?? (rec.result.iterations as number) ?? iterations.value
        result.value = rec.result as unknown as MCResult
      } else {
        group1.value = Array.isArray(rec.params.group1) ? (rec.params.group1 as number[]).join(',') : group1.value
        group2.value = Array.isArray(rec.params.group2) ? (rec.params.group2 as number[]).join(',') : group2.value
        testResult.value = rec.result as unknown as HypTestResult
      }
    } catch (e) {
      console.error('加载记录失败', e)
    }
  }

  async function deleteRecord(id: number) {
    try {
      await apiRequest<{ ok: boolean }>(`/api/history/${id}`, { method: 'DELETE' })
      history.value = history.value.filter(h => h.id !== id)
      if (activeRecordId.value === id) activeRecordId.value = null
    } catch (e) {
      console.error('删除记录失败', e)
    }
  }

  async function init() {
    await loadHistory()
    const latestSim = history.value.find(h => h.record_type === 'simulation')
    const latestTest = history.value.find(h => h.record_type === 'test')
    if (latestSim) await loadRecord(latestSim.id)
    if (latestTest) await loadRecord(latestTest.id)
    if (!result.value) runSimulation()
  }

  function setScenario(s: MCScenario) { currentScenario.value = s; result.value = null }

  const convergenceData = computed(() => {
    if (!result.value) return [] as [number, number][]
    return result.value.convergence.slice(0, 200).map((v, i): [number, number] => [i, Math.round(v * 100000) / 100000])
  })

  const histogramData = computed(() => {
    if (!result.value) return { xAxis: [] as number[], data: [] as number[] }
    const s = result.value.samples.slice(0, 1000)
    const mn = Math.min(...s), mx = Math.max(...s)
    const bins = 20, bs = (mx - mn) / bins || 1
    const counts = new Array(bins).fill(0)
    s.forEach(v => { counts[Math.min(bins - 1, Math.floor((v - mn) / bs))]++ })
    return { xAxis: Array.from({ length: bins }, (_, i) => Math.round((mn + i * bs) * 100) / 100), data: counts }
  })

  return {
    currentScenario, iterations, result, testResult, isRunning,
    group1, group2, history, activeRecordId, isHistoryLoading,
    convergenceData, histogramData,
    runSimulation, runTest, setScenario,
    init, loadHistory, loadRecord, deleteRecord,
  }
})
