/**
 * BoidSections.tsx — Boids 实验的分析区块
 *
 * 四个区块回答四个问题：
 *   00 观察窗   —— 秩序长什么样
 *   01 规则分解 —— 某一只鸟此刻被哪条规则推动得最厉害
 *   02 秩序从哪来 —— 极化度与紧致度随时间的演化（含消融对比）
 *   03 临界点   —— 噪声加大到什么时候秩序崩塌（Vicsek 相变）
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  computeMetrics,
  createFlock,
  defaultParams,
  stepFlock,
  sweepNoise,
  type BoidParams
} from '../lib/engine'
import { Lines } from '../../../shared/components/Lines'
import { Readout } from '../../../shared/components/ui'
import { createRng } from '../../../shared/lib/rng'

/* ------------------------------------------------------------------ *
 * 01 规则分解
 * ------------------------------------------------------------------ */

const RULE_META = [
  { key: 'separation', name: '分离', color: '#e8553a', desc: '躲开过近的邻居' },
  { key: 'alignment', name: '对齐', color: '#6fb3e0', desc: '转向邻居的平均方向' },
  { key: 'cohesion', name: '聚合', color: '#57dcaa', desc: '转向邻居的平均位置' }
] as const

export function RuleSplit(props: {
  breakdown: { separation: [number, number]; alignment: [number, number]; cohesion: [number, number] } | null
  selected: boolean
}) {
  const b = props.breakdown
  const mags = useMemo(() => {
    if (!b) return { separation: 0, alignment: 0, cohesion: 0 }
    return {
      separation: Math.hypot(b.separation[0], b.separation[1]),
      alignment: Math.hypot(b.alignment[0], b.alignment[1]),
      cohesion: Math.hypot(b.cohesion[0], b.cohesion[1])
    }
  }, [b])

  const max = Math.max(mags.separation, mags.alignment, mags.cohesion, 1e-6)
  const leader = RULE_META.reduce((a, r) => (mags[r.key] > mags[a.key] ? r : a), RULE_META[0])

  return (
    <div className="rulesplit">
      <div className="rulesplit__diagram">
        <RuleDiagram breakdown={b} />
      </div>

      <div className="rulesplit__list">
        {RULE_META.map((r) => (
          <div className="rule-row" key={r.key}>
            <span className="rule-row__name">
              <i className="rule-row__swatch" style={{ background: r.color }} />
              {r.name}
            </span>
            <span className="rule-row__track">
              <i
                className="rule-row__fill"
                style={{ '--w': `${(mags[r.key] / max) * 100}%`, background: r.color } as React.CSSProperties}
              />
            </span>
            <span className="rule-row__val">{mags[r.key].toFixed(2)}</span>
          </div>
        ))}

        <p className="rulesplit__hint">
          {!props.selected || !b ? (
            <>在左边画布上点任意一只鸟，这里会显示它此刻被三条规则各自推了多少 —— 箭头长度是这条规则实际贡献的转向力，已经乘上你设的权重。</>
          ) : (
            <>
              这只鸟此刻最受<b style={{ color: leader.color }}>{leader.name}</b>支配（{leader.desc}）。
              三条规则的权重是你调的，但实际受力还取决于它碰巧被多少邻居看见、离得多近 ——
              这就是为什么同一个权重下，群体里每只鸟的行为并不一样。
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function RuleDiagram(props: {
  breakdown: { separation: [number, number]; alignment: [number, number]; cohesion: [number, number] } | null
}) {
  const W = 300
  const H = 300
  const cx = W / 2
  const cy = H / 2
  const b = props.breakdown

  let maxLen = 1e-6
  if (b) {
    for (const v of [b.separation, b.alignment, b.cohesion]) maxLen = Math.max(maxLen, Math.hypot(v[0], v[1]))
  }
  const scale = 92 / maxLen

  const arrows = b
    ? [
        { v: b.separation, color: '#e8553a' },
        { v: b.alignment, color: '#6fb3e0' },
        { v: b.cohesion, color: '#57dcaa' }
      ]
    : []

  const total = b
    ? ([b.separation[0] + b.alignment[0] + b.cohesion[0], b.separation[1] + b.alignment[1] + b.cohesion[1]] as [
        number,
        number
      ])
    : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="选中个体的三条转向力分解">
      {/* 刻度圈 */}
      {[0.33, 0.66, 1].map((f) => (
        <circle
          key={f}
          cx={cx}
          cy={cy}
          r={92 * f}
          fill="none"
          stroke="rgba(236,229,216,.07)"
          strokeDasharray="2 5"
        />
      ))}
      <line x1={cx - 105} y1={cy} x2={cx + 105} y2={cy} stroke="rgba(236,229,216,.07)" />
      <line x1={cx} y1={cy - 105} x2={cx} y2={cy + 105} stroke="rgba(236,229,216,.07)" />

      {arrows.map((a, i) => {
        const len = Math.hypot(a.v[0], a.v[1])
        if (len < 1e-9) return null
        const ex = cx + a.v[0] * scale
        const ey = cy + a.v[1] * scale
        return (
          <g key={i}>
            <line x1={cx} y1={cy} x2={ex} y2={ey} stroke={a.color} strokeWidth={2.4} strokeLinecap="round" />
            <circle cx={ex} cy={ey} r={3.4} fill={a.color} />
          </g>
        )
      })}

      {total && Math.hypot(total[0], total[1]) > 1e-9 && (
        <line
          x1={cx}
          y1={cy}
          x2={cx + total[0] * scale}
          y2={cy + total[1] * scale}
          stroke="rgba(236,229,216,.55)"
          strokeWidth={1.4}
          strokeDasharray="4 3"
        />
      )}

      {/* 选中的这只鸟 */}
      <polygon points={`${cx + 8},${cy} ${cx - 5},${cy + 4.6} ${cx - 2.4},${cy} ${cx - 5},${cy - 4.6}`} fill="#ece5d8" />

      {!b && (
        <text x={cx} y={cy + 62} textAnchor="middle" className="lines__tick">
          未选中个体
        </text>
      )}
      {b && (
        <text x={cx} y={H - 12} textAnchor="middle" className="lines__tick">
          虚线 = 三者合成后的实际转向（= 三个箭头之和）
        </text>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * 02 秩序演化 + 03 相变
 * ------------------------------------------------------------------ */

export interface HistoryPoint {
  t: number
  polarization: number
  radiusOfGyration: number
  meanNeighborDistance: number
}

export function OrderChart(props: { history: HistoryPoint[]; ablation: AblationResult | null }) {
  // 极化度是 0..1 的比值，群体半径是几百像素的绝对量。塞进同一根 y 轴，
  // 极化度会被压成贴着底边的一条直线 —— 什么也看不出来。分开画。
  const xs = props.history.map((h) => String(Math.round(h.t)))

  return (
    <>
      <div className="chart-pair">
        <div className="chart-wrap">
          <div className="chart-wrap__title">极化度 · 大家朝同一个方向的整齐程度</div>
          <Lines
            series={[
              { id: 'pol', label: '极化度', color: '#6fb3e0', values: props.history.map((h) => h.polarization) }
            ]}
            xLabels={xs}
            yMin={0}
            yMax={1}
            height={240}
            yFormat={(v) => v.toFixed(1)}
            ariaLabel="极化度随时间的演化"
          />
        </div>
        <div className="chart-wrap">
          <div className="chart-wrap__title">群体半径 · 聚得有多紧（像素）</div>
          <Lines
            series={[
              { id: 'rog', label: '群体半径', color: '#57dcaa', values: props.history.map((h) => h.radiusOfGyration) }
            ]}
            xLabels={xs}
            yFromZero
            height={240}
            yFormat={(v) => v.toFixed(0)}
            ariaLabel="群体半径随时间的演化"
          />
        </div>
      </div>

      {props.ablation && (
        <div style={{ marginTop: 22 }}>
          <h3 className="eco-side__title" style={{ border: 0, padding: 0, marginBottom: 12 }}>
            消融对比：三条规则各自负责什么
          </h3>
          <AblationTable data={props.ablation} />
        </div>
      )}
    </>
  )
}

export interface AblationResult {
  rows: { id: string; name: string; detail: string; polarization: number; radius: number; nnd: number }[]
  reference: { polarization: number; radius: number; nnd: number }
}

export function AblationTable(props: { data: AblationResult }) {
  return (
    <div className="ablation">
      <div className="ablation__row ablation__row--head">
        <div>配置</div>
        <div style={{ textAlign: 'right' }}>极化度</div>
        <div style={{ textAlign: 'right' }}>群体半径</div>
        <div style={{ textAlign: 'right' }}>最近邻距离</div>
      </div>
      {props.data.rows.map((r) => (
        <div className="ablation__row" key={r.id} title={r.detail}>
          <div className="ablation__name">{r.name}</div>
          <div className="ablation__cell">{r.polarization.toFixed(3)}</div>
          <div className="ablation__cell">{r.radius.toFixed(0)}</div>
          <div className="ablation__cell">{r.nnd.toFixed(1)}</div>
        </div>
      ))}
      <div className="ablation__row is-active">
        <div className="ablation__name">三条全开（当前）</div>
        <div className="ablation__cell">{props.data.reference.polarization.toFixed(3)}</div>
        <div className="ablation__cell">{props.data.reference.radius.toFixed(0)}</div>
        <div className="ablation__cell">{props.data.reference.nnd.toFixed(1)}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 后台计算任务：分片执行，避免卡住界面
 * ------------------------------------------------------------------ */

// 分析用的画布刻意比界面小（界面是 900×520，这里 420×300）。
// 原因是密度：平均邻居数 = count × πR² / 面积。界面上 260 只鸟在 900×520 里
// 平均只有约 3.7 个邻居，这个密度下有序相是**亚稳**的 —— 换个种子，
// 低噪声端的极化度会在 0.2~1.0 之间乱跳，相变曲线直接测不出来。
// 把画布缩到 420×300、放 120 只鸟，平均邻居数约 6.3，曲线立刻变成干净的 S 形。
// 这是模型本身的性质，不是画得不好看 —— 所以界面文案里专门写了这件事。
const ANALYSIS_W = 420
const ANALYSIS_H = 300
const SWEEP_LEVELS = 10
const SWEEP_STEPS = 700
const SWEEP_COUNT = 120
// 实测标定：这是四个混沌系统，单次运行的涨落足以颠倒结论
//（1000 步 × 2 seed 时「只有聚合」的半径能落在 30~90 之间）。
// 1600 步 × 3 seed 平均后，四行的大小关系在 6 个种子下都稳定。
const ABLATION_STEPS = 1600
const ABLATION_SEEDS = 3
const ABLATION_COUNT = 120
// 实时曲线（界面画布）用的是整套仿真里的那一份，这里不再重复定义尺寸

/** 让出一帧，好让进度条能刷新 */
const yieldFrame = () => new Promise((r) => setTimeout(r, 0))

export function usePhaseSweep(params: BoidParams) {
  const [data, setData] = useState<{ noise: number; polarization: number }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const runningRef = useRef(false)
  const paramsRef = useRef(params)
  paramsRef.current = params

  const run = async () => {
    if (runningRef.current) return
    runningRef.current = true
    setBusy(true)
    setData(null)

    // 必须用引擎自带的扫描协议：它对每一档用同一条随机流、同样的步数。
    // 自己逐档换 seed 会引入巨大方差，把相变曲线打成锯齿。
    await yieldFrame() // 先让「扫描中…」画出来，再进这段同步计算
    const p: BoidParams = {
      ...paramsRef.current,
      count: SWEEP_COUNT,
      predatorCount: 0,
      noise: 0
    }
    const curve = sweepNoise(p, {
      levels: SWEEP_LEVELS,
      steps: SWEEP_STEPS,
      seed: 2024,
      width: ANALYSIS_W,
      height: ANALYSIS_H
    })

    setData(curve)
    setBusy(false)
    runningRef.current = false
  }

  return { data, run, busy }
}

export function useAblation(params: BoidParams) {
  const [data, setData] = useState<AblationResult | null>(null)
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const runningRef = useRef(false)

  const run = async () => {
    if (runningRef.current) return
    runningRef.current = true
    setBusy(true)
    setProgress(0)
    await yieldFrame()

    const base: BoidParams = {
      ...defaultParams(),
      ...params,
      count: ABLATION_COUNT,
      predatorCount: 0,
      noise: Math.min(params.noise, 0.05)
    }

    const configs: { id: string; name: string; detail: string; patch: Partial<BoidParams> }[] = [
      {
        id: 'sep',
        name: '只有分离',
        detail: '鸟会互相躲开，但不会朝任何方向对齐 —— 结果是一盘散沙',
        patch: { separation: 1.6, alignment: 0, cohesion: 0 }
      },
      {
        id: 'ali',
        name: '只有对齐',
        detail: '方向会统一，但没有聚合，群体也不会收缩',
        patch: { separation: 0, alignment: 1.2, cohesion: 0 }
      },
      {
        id: 'coh',
        name: '只有聚合',
        detail: '都往邻居中间挤：团是紧了，但没有共同方向 —— 聚拢不等于有序',
        patch: { separation: 0, alignment: 0, cohesion: 1.2 }
      },
      {
        id: 'all',
        name: '三条全开',
        detail: '你正在调的那组权重，跑同样的步数作为基准',
        patch: {}
      }
    ]

    const rows: AblationResult['rows'] = []
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i]
      const p = { ...base, ...cfg.patch }

      // 多个种子取平均：单次运行的方差大到足以颠倒结论
      let pol = 0
      let rog = 0
      let nnd = 0
      for (let s = 0; s < ABLATION_SEEDS; s++) {
        const rng = createRng(`ablation-${cfg.id}-${s}`)
        const state = createFlock(p, ANALYSIS_W, ANALYSIS_H, rng)
        let m = computeMetrics(state, p)
        for (let k = 0; k < ABLATION_STEPS; k++) m = stepFlock(state, p, 1, ANALYSIS_W, ANALYSIS_H, rng)
        pol += m.polarization / ABLATION_SEEDS
        rog += m.radiusOfGyration / ABLATION_SEEDS
        nnd += m.meanNeighborDistance / ABLATION_SEEDS
      }

      rows.push({
        id: cfg.id,
        name: cfg.name,
        detail: cfg.detail,
        polarization: pol,
        radius: rog,
        nnd
      })
      setProgress((i + 1) / configs.length)
      await yieldFrame()
    }

    // 基准取自上面那条「三条全开」：必须和其余三条跑同样的步数。
    // 直接拿实时画面上的读数当基准是不公平的 —— 那时它可能还没收敛。
    const full = rows.pop()!
    setData({
      rows,
      reference: { polarization: full.polarization, radius: full.radius, nnd: full.nnd }
    })
    setProgress(1)
    setBusy(false)
    runningRef.current = false
  }

  return { data, run, busy, progress }
}

/* ------------------------------------------------------------------ *
 * 相变曲线
 * ------------------------------------------------------------------ */

export function PhaseChart(props: { data: { noise: number; polarization: number }[] }) {
  const d = props.data

  // 临界点取「极化度跌破 0.5」的位置，做线性插值
  let critical: number | null = null
  for (let i = 1; i < d.length; i++) {
    if (d[i - 1].polarization >= 0.5 && d[i].polarization < 0.5) {
      const f = (d[i - 1].polarization - 0.5) / (d[i - 1].polarization - d[i].polarization || 1)
      critical = d[i - 1].noise + f * (d[i].noise - d[i - 1].noise)
      break
    }
  }

  return (
    <div className="chart-wrap">
      <Lines
        series={[
          {
            id: 'pol',
            label: '极化度',
            color: '#6fb3e0',
            values: d.map((x) => x.polarization)
          }
        ]}
        xLabels={d.map((x) => x.noise.toFixed(2))}
        yFromZero
        yMax={1}
        yMin={0}
        height={330}
        yFormat={(v) => v.toFixed(2)}
        ariaLabel="极化度随噪声强度的变化"
        bands={[
          { from: 0, to: critical != null ? critical / d[d.length - 1].noise : 0.4, color: 'rgba(87,220,170,.06)', label: '有序' },
          {
            from: critical != null ? critical / d[d.length - 1].noise : 0.4,
            to: 1,
            color: 'rgba(232,85,58,.06)',
            label: '无序'
          }
        ]}
        markers={
          critical != null
            ? [{ at: critical / d[d.length - 1].noise, label: `临界噪声 ≈ ${critical.toFixed(2)}` }]
            : []
        }
      />
    </div>
  )
}

export function PhaseReadout(props: { data: { noise: number; polarization: number }[] }) {
  const d = props.data
  const first = d[0]?.polarization ?? 0
  const last = d[d.length - 1]?.polarization ?? 0
  let critical: number | null = null
  for (let i = 1; i < d.length; i++) {
    if (d[i - 1].polarization >= 0.5 && d[i].polarization < 0.5) {
      const f = (d[i - 1].polarization - 0.5) / (d[i - 1].polarization - d[i].polarization || 1)
      critical = d[i - 1].noise + f * (d[i].noise - d[i - 1].noise)
      break
    }
  }

  return (
    <Readout
      items={[
        { label: '噪声 0 时', value: first.toFixed(3), tone: 'good', hint: '完全没有随机扰动时，群体几乎完全同向' },
        { label: '噪声 1 时', value: last.toFixed(3), tone: 'bad', hint: '噪声拉满，方向完全随机' },
        {
          label: '临界噪声',
          value: critical != null ? critical.toFixed(2) : '—',
          tone: 'accent',
          hint: '极化度跌破 0.5 的位置，用线性插值估计'
        }
      ]}
    />
  )
}

/** 让界面在挂载后自动跑一次相变扫描 */
export function useAutoRun(fn: () => void, deps: unknown[], delay = 600) {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    const t = setTimeout(fn, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
