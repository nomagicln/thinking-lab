/**
 * DemonSections.tsx — 麦克斯韦妖的账本与曲线
 *
 * 这个实验的说服力全在账本上：光看气体熵在下降，的确像是违反了第二定律；
 * 把「擦除记忆要付 kT ln2」这一项记上去，总数就再也不为负。
 */

import { useRef, useState } from 'react'
import {
  createDemon,
  defaultParams,
  stepDemon,
  type Box,
  type DemonMetrics,
  type DemonParams
} from '../lib/engine'
import { Lines } from '../../../shared/components/Lines'
import { createRng } from '../../../shared/lib/rng'

const LN2 = Math.LN2

/* ------------------------------------------------------------------ *
 * 熵账本
 * ------------------------------------------------------------------ */

export function Ledger(props: { m: DemonMetrics | null; bitsErased: number; bitsRecorded: number }) {
  const m = props.m
  const rows = [
    {
      label: '气体熵的变化',
      sub: 'ΔS气体 —— 妖把快慢分子分开，气体确实变「有序」了',
      value: m ? m.deltaSGas : 0,
      negativeIsGood: true
    },
    {
      label: '擦除记忆的代价',
      sub: `ΔS擦除 = 擦除 ${props.bitsErased} 比特 × kT ln2（Landauer 下限）`,
      value: m ? m.deltaSErase : 0,
      negativeIsGood: false
    },
    {
      label: '测量的耗散',
      sub: `ΔS测量 = 测量 ${props.bitsRecorded} 次 × 你设的测量代价`,
      value: m ? m.deltaSMeasure : 0,
      negativeIsGood: false
    }
  ]

  return (
    <div className="ledger">
      {rows.map((r) => (
        <div className="ledger__row" key={r.label}>
          <div className="ledger__label">
            <b>{r.label}</b>
            <em>{r.sub}</em>
          </div>
          <div
            className={
              'ledger__value ' + (r.value < -1e-9 ? 'is-neg' : r.value > 1e-9 ? 'is-pos' : '')
            }
          >
            {r.value >= 0 ? '+' : ''}
            {r.value.toFixed(3)}
          </div>
        </div>
      ))}
      <div className="ledger__row ledger__row--total">
        <div className="ledger__label">
          <b>净熵变</b>
          <em>ΔS气体 + ΔS擦除 + ΔS测量 —— 第二定律要求它 ≥ 0</em>
        </div>
        <div
          className={'ledger__value ' + (m && m.netEntropy < 0 ? 'is-neg' : 'is-pos')}
          id="net-entropy"
        >
          {m ? (m.netEntropy >= 0 ? '+' : '') + m.netEntropy.toFixed(3) : '—'}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 熵天平：两边各一根条，长度按绝对值归一
 * ------------------------------------------------------------------ */

export function Balance(props: { m: DemonMetrics | null }) {
  const m = props.m
  const gasDrop = Math.max(0, -(m?.deltaSGas ?? 0))
  const erasure = Math.max(0, (m?.deltaSErase ?? 0) + (m?.deltaSMeasure ?? 0))
  const max = Math.max(gasDrop, erasure, 1e-6)
  const net = m?.netEntropy ?? 0

  return (
    <>
      <div className="balance">
        <div className="balance__side">
          <div className="balance__head">气体少掉的熵</div>
          <div className="balance__bar">
            <i style={{ width: `${(gasDrop / max) * 100}%`, background: 'var(--jade)' }} />
          </div>
          <div className="balance__num" style={{ color: 'var(--jade)' }}>
            −{gasDrop.toFixed(2)}
          </div>
        </div>
        <div className="balance__side">
          <div className="balance__head">妖付掉的熵</div>
          <div className="balance__bar">
            <i style={{ width: `${(erasure / max) * 100}%`, background: 'var(--vermilion)' }} />
          </div>
          <div className="balance__num" style={{ color: 'var(--vermilion)' }}>
            +{erasure.toFixed(2)}
          </div>
        </div>
      </div>

      <p className="balance__verdict" id="balance-verdict">
        {!m ? (
          <>等待数据…</>
        ) : net >= 0 ? (
          <>
            妖付掉的熵覆盖了气体少掉的熵，净熵 <b>+{net.toFixed(2)}</b> ——{' '}
            <b>第二定律没有被打败</b>。妖不是免费的：它换来的每一分秩序，都要用擦除记忆的耗散去买。
          </>
        ) : (
          <>
            当前净熵是 <b>{net.toFixed(2)}</b>，看起来是负的 ——{' '}
            <b>这正是「妖」的悖论所在</b>。但请注意上面的「擦除记忆的代价」还是 0：
            把记忆容量调小（或者把测量代价调大），这笔账就会补上。
          </>
        )}
      </p>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * 温差演化
 * ------------------------------------------------------------------ */

export interface TempPoint {
  t: number
  left: number
  right: number
}

export function TempChart(props: { history: TempPoint[] }) {
  const h = props.history
  if (h.length < 2) return null
  return (
    <div className="chart-wrap">
      <Lines
        series={[
          { id: 'hot', label: '热侧', color: '#e8553a', values: h.map((x) => x.right) },
          { id: 'cold', label: '冷侧', color: '#6fb3e0', values: h.map((x) => x.left) }
        ]}
        xLabels={h.map((x) => String(x.t))}
        yFromZero
        height={300}
        yFormat={(v) => v.toFixed(1)}
        ariaLabel="两侧温度随时间的分化"
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 记忆容量扫描：这个实验的结论性图表
 * ------------------------------------------------------------------ */

export interface CapacityPoint {
  capacity: number
  label: string
  deltaSGas: number
  deltaSErase: number
  net: number
}

export function CapacityChart(props: { data: CapacityPoint[] }) {
  const d = props.data
  const labels = d.map((x) => x.label)
  return (
    <div className="chart-wrap">
      <Lines
        series={[
          { id: 'gas', label: 'ΔS气体', color: '#57dcaa', values: d.map((x) => x.deltaSGas) },
          { id: 'erase', label: 'ΔS擦除', color: '#e8553a', values: d.map((x) => x.deltaSErase) },
          { id: 'net', label: '净熵变', color: '#a894e8', values: d.map((x) => x.net) }
        ]}
        xLabels={labels}
        height={340}
        yFormat={(v) => v.toFixed(0)}
        ariaLabel="净熵变随妖的记忆容量的变化"
      />
    </div>
  )
}

export function CapacityTable(props: { data: CapacityPoint[] }) {
  return (
    <div className="ablation">
      <div className="ablation__row ablation__row--head">
        <div>妖的记忆容量</div>
        <div style={{ textAlign: 'right' }}>ΔS气体</div>
        <div style={{ textAlign: 'right' }}>ΔS擦除</div>
        <div style={{ textAlign: 'right' }}>净熵变</div>
      </div>
      {props.data.map((r) => (
        <div className={'ablation__row' + (r.capacity === Infinity ? ' is-active' : '')} key={r.label}>
          <div className="ablation__name">{r.label}</div>
          <div className="ablation__cell">{r.deltaSGas.toFixed(1)}</div>
          <div className="ablation__cell">{r.deltaSErase.toFixed(1)}</div>
          <div className="ablation__cell" style={{ color: r.net < 0 ? 'var(--vermilion)' : 'var(--jade)' }}>
            {r.net >= 0 ? '+' : ''}
            {r.net.toFixed(1)}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 后台任务：记忆容量扫描
 * ------------------------------------------------------------------ */

const CAPACITIES: (number | typeof Infinity)[] = [2, 4, 8, 16, 32, 64, 256, Infinity]
// 实测标定：步数太少时，有限容量的擦除账还没累积起来，净熵会一直是负的，
// 就看不到「擦除把秩序买回去」这一幕。16000 步刚好让所有有限容量翻正、
// 只有无限记忆留在负数 —— 这正是这个实验要说的那句话。
const SWEEP_STEPS = 16000
const SWEEP_PARTICLES = 160
const BOX: Box = { width: 400, height: 260 }

const yieldFrame = () => new Promise((r) => setTimeout(r, 0))

export function useCapacitySweep(params: DemonParams) {
  const [data, setData] = useState<CapacityPoint[] | null>(null)
  const [progress, setProgress] = useState(0)
  const busyRef = useRef(false)
  const paramsRef = useRef(params)
  paramsRef.current = params

  const run = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setData(null)
    setProgress(0)

    const p0: DemonParams = {
      ...defaultParams(),
      ...paramsRef.current,
      particleCount: SWEEP_PARTICLES,
      policy: 'maxwell',
      measurementCost: 0
    }

    const out: CapacityPoint[] = []
    for (let i = 0; i < CAPACITIES.length; i++) {
      const cap = CAPACITIES[i]
      const p = { ...p0, memoryCapacity: cap }
      const rng = createRng(`capacity-${i}`)
      const state = createDemon(p, BOX, rng)
      let m = stepDemon(state, p, BOX, 1, rng)
      for (let s = 0; s < SWEEP_STEPS; s++) m = stepDemon(state, p, BOX, 1, rng)
      out.push({
        capacity: cap,
        label: cap === Infinity ? '无限' : `${cap} 位`,
        deltaSGas: m.deltaSGas,
        deltaSErase: m.deltaSErase,
        net: m.netEntropy
      })
      setProgress((i + 1) / CAPACITIES.length)
      await yieldFrame()
    }

    setData(out)
    busyRef.current = false
  }

  return { data, progress, run, busy: progress > 0 && progress < 1 }
}

export { LN2 }
