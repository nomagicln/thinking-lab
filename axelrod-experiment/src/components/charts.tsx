/**
 * charts.tsx — 三块纯 SVG 图表：对阵矩阵、收敛曲线、生态演化
 * 全部是受控组件：数据从 props 进来，渲染由 React 接管。
 */

import { heatRamp, onColorText, fmt, pctWhole } from '../lib/format'
import { hideTip, showTip } from './common'

/* ------------------------------------------------------------------ *
 * 1. 对阵得分热力图
 * ------------------------------------------------------------------ */

export function Heatmap(props: {
  ids: string[]
  labels: string[]
  /** matrix[i][j] = i 对 j 的每场平均总分 */
  matrix: number[][]
  highlightId?: string
  onCell: (i: number, j: number) => void
}) {
  const { ids, labels, matrix } = props
  const n = ids.length
  const cell = n > 14 ? 38 : n > 11 ? 44 : 50
  const labelW = 96
  const headH = 30
  const width = labelW + n * cell + 16
  const height = headH + n * cell + 58

  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const v = matrix[i][j]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  const span = hi - lo || 1
  const tone = (v: number) => heatRamp((v - lo) / span)

  const legendY = headH + n * cell + 18

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      className="heatmap"
      role="img"
      aria-label="策略两两对阵的得分矩阵"
    >
      <defs>
        <linearGradient id="heat-legend" x1="0" x2="1" y1="0" y2="0">
          {[0, 0.32, 0.62, 1].map((t) => (
            <stop key={t} offset={t} stopColor={heatRamp(t)} />
          ))}
        </linearGradient>
      </defs>

      {ids.map((id, c) => (
        <text
          key={`ch-${id}`}
          x={labelW + c * cell + cell / 2}
          y={headH - 10}
          textAnchor="middle"
          className={'heatmap__head' + (props.highlightId === id ? ' is-hl' : '')}
        >
          {labels[c]}
        </text>
      ))}

      {ids.map((rowId, r) => {
        const ry = headH + r * cell
        return (
          <g key={`row-${rowId}`}>
            <text
              x={labelW - 10}
              y={ry + cell / 2 + 4}
              textAnchor="end"
              className={'heatmap__head' + (props.highlightId === rowId ? ' is-hl' : '')}
            >
              {labels[r]}
            </text>
            {ids.map((colId, k) => {
              const cx = labelW + k * cell
              const isSelf = r === k
              const val = matrix[r][k]
              const bg = isSelf ? null : tone(val)
              const tip = isSelf
                ? `<b>${labels[r]}</b> 对 自己<br><span class="t-dim">自博弈不计入锦标赛排名</span>`
                : `<b>${labels[r]}</b> 对 <b>${labels[k]}</b><br>` +
                  `得分 <span class="t-mono">${fmt(matrix[r][k])}</span> · ` +
                  `对手得分 <span class="t-mono">${fmt(matrix[k][r])}</span><br>` +
                  `<span class="t-dim">点击在后面回放这一对</span>`
              return (
                <g
                  key={`c-${rowId}-${colId}`}
                  className="heatmap__cell"
                  style={{ animationDelay: `${(r * n + k) * 4}ms` }}
                  onMouseEnter={(e) => showTip(tip, e)}
                  onMouseMove={(e) => showTip(tip, e)}
                  onMouseLeave={hideTip}
                  onClick={() => !isSelf && props.onCell(r, k)}
                >
                  <rect
                    x={cx + 1.5}
                    y={ry + 1.5}
                    width={cell - 3}
                    height={cell - 3}
                    rx={2}
                    fill={isSelf ? 'rgba(236,229,216,0.045)' : (bg as string)}
                    stroke={isSelf ? 'rgba(236,229,216,0.12)' : 'rgba(0,0,0,0.25)'}
                    strokeWidth={1}
                    strokeDasharray={isSelf ? '2 3' : undefined}
                  />
                  {isSelf ? (
                    <text x={cx + cell / 2} y={ry + cell / 2 + 4} textAnchor="middle" className="heatmap__self">
                      —
                    </text>
                  ) : (
                    <text
                      x={cx + cell / 2}
                      y={ry + cell / 2 + 4}
                      textAnchor="middle"
                      className="heatmap__val"
                      fill={onColorText(bg as string)}
                    >
                      {Math.round(val)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )
      })}

      <rect x={labelW} y={legendY} width={120} height={8} rx={4} fill="url(#heat-legend)" />
      <text x={labelW} y={legendY + 22} className="heatmap__legend">
        {Math.round(lo)} 分
      </text>
      <text x={labelW + 120} y={legendY + 22} textAnchor="end" className="heatmap__legend">
        {Math.round(hi)} 分
      </text>
      <text x={labelW + 150} y={legendY + 8} className="heatmap__legend">
        行 = 出手方，列 = 对手；格中数字为该策略在这对组合里的每场平均总分
      </text>
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * 2. 折线图
 * ------------------------------------------------------------------ */

export interface LineSeries {
  id: string
  label: string
  color: string
  values: (number | null)[]
}

/** 末端标签防重叠：按 y 排序后强制最小间距，再整体压回可视范围 */
function layoutLabels(items: { y: number }[], minGap: number, top: number, bottom: number) {
  if (!items.length) return items
  items.sort((a, b) => a.y - b.y)
  for (let i = 1; i < items.length; i++) {
    if (items[i].y - items[i - 1].y < minGap) items[i].y = items[i - 1].y + minGap
  }
  const overflow = items[items.length - 1].y - bottom
  if (overflow > 0) for (const it of items) it.y -= overflow
  if (items[0].y < top) {
    const push = top - items[0].y
    for (const it of items) it.y += push
  }
  return items
}

export function Convergence(props: {
  series: LineSeries[]
  xLabels: string[]
  yLabel?: string
  yFromZero?: boolean
  height?: number
  highlightId?: string | null
  labelIds?: string[] | null
}) {
  const series = props.series.filter((s) => s.values.length)
  if (!series.length) return null

  const W = 960
  const H = props.height ?? 360
  const pad = { t: 22, r: 108, b: 40, l: 58 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b

  const all: number[] = []
  for (const s of series) for (const v of s.values) if (v != null && Number.isFinite(v)) all.push(v)
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  if (props.yFromZero) lo = 0
  const padY = (hi - lo) * 0.12 || 1
  if (!props.yFromZero) lo -= padY
  hi += padY

  const len = Math.max(...series.map((s) => s.values.length))
  const x = (i: number) => pad.l + (len <= 1 ? 0 : (i / (len - 1)) * iw)
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih

  const ticks = 5
  const endLabels: { x: number; y: number; label: string; color: string; hl: boolean }[] = []

  series.forEach((s) => {
    if (props.labelIds && !props.labelIds.includes(s.id)) return
    let lastIdx = -1
    for (let q = s.values.length - 1; q >= 0; q--) {
      if (s.values[q] != null && Number.isFinite(s.values[q] as number)) {
        lastIdx = q
        break
      }
    }
    if (lastIdx >= 0) {
      endLabels.push({
        x: x(lastIdx) + 8,
        y: y(s.values[lastIdx] as number),
        label: s.label,
        color: s.color,
        hl: props.highlightId === s.id
      })
    }
  })
  layoutLabels(endLabels, 12, pad.t + 6, pad.t + ih)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="lines"
      role="img"
      aria-label="各策略累计总分随轮次的变化"
    >
      {Array.from({ length: ticks + 1 }, (_, t) => {
        const vv = lo + ((hi - lo) * t) / ticks
        const yy = y(vv)
        return (
          <g key={`g${t}`}>
            <line x1={pad.l} x2={pad.l + iw} y1={yy} y2={yy} className="lines__grid" />
            <text x={pad.l - 10} y={yy + 4} textAnchor="end" className="lines__tick">
              {Math.round(vv)}
            </text>
          </g>
        )
      })}

      {Array.from({ length: Math.min(8, len) }, (_, xt) => {
        const count = Math.min(8, len)
        const idx = Math.round((xt / Math.max(1, count - 1)) * (len - 1))
        return (
          <text
            key={`x${xt}`}
            x={x(idx)}
            y={pad.t + ih + 22}
            textAnchor="middle"
            className="lines__tick"
          >
            {props.xLabels[idx] ?? String(idx + 1)}
          </text>
        )
      })}

      {series.map((s, si) => {
        let d = ''
        let started = false
        s.values.forEach((v, i) => {
          if (v == null || !Number.isFinite(v)) {
            started = false
            return
          }
          d += `${started ? ' L' : ' M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`
          started = true
        })
        const dim = props.highlightId && props.highlightId !== s.id
        return (
          <path
            key={s.id}
            d={d}
            fill="none"
            stroke={s.color}
            strokeWidth={props.highlightId === s.id ? 2.6 : 1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            opacity={dim ? 0.3 : 1}
            className="lines__path"
            style={{ animationDelay: `${si * 40}ms` }}
          />
        )
      })}

      {endLabels.map((l) => (
        <text
          key={l.label}
          x={l.x}
          y={l.y + 4}
          className={'lines__end' + (l.hl ? ' is-hl' : '')}
          fill={l.color}
        >
          {l.label}
        </text>
      ))}

      {props.yLabel && (
        <text
          x={0}
          y={0}
          className="lines__axis"
          transform={`translate(14,${pad.t + ih / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {props.yLabel}
        </text>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * 3. 生态演化堆叠面积图
 * ------------------------------------------------------------------ */

export interface StreamSeries {
  id: string
  label: string
  color: string
  index: number
}

export function EcologyStream(props: {
  history: number[][]
  series: StreamSeries[]
  highlightId?: string
  height?: number
}) {
  const { history, series } = props
  if (!history.length) return null

  const W = 960
  const H = props.height ?? 380
  const pad = { t: 24, r: 128, b: 42, l: 58 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const gens = history.length - 1

  const x = (g: number) => pad.l + (gens <= 0 ? 0 : (g / gens) * iw)
  const y = (s: number) => pad.t + ih - s * ih

  let lower = new Array<number>(history.length).fill(0)
  const bands: { d: string; color: string; id: string; delay: number }[] = []
  const labels: { y: number; text: string; color: string; hl: boolean }[] = []

  series.forEach((s, si) => {
    const upper = history.map((row, gi) => row[s.index] + lower[gi])
    let d = ''
    history.forEach((_row, gi) => {
      d += `${gi === 0 ? 'M' : 'L'}${x(gi).toFixed(1)} ${y(lower[gi]).toFixed(1)}`
    })
    for (let gi = history.length - 1; gi >= 0; gi--) {
      d += `L${x(gi).toFixed(1)} ${y(upper[gi]).toFixed(1)}`
    }
    d += 'Z'
    bands.push({ d, color: s.color, id: s.id, delay: si * 45 })

    const last = history[history.length - 1][s.index]
    if (last > 0.012) {
      labels.push({
        y: y(lower[history.length - 1] + last / 2),
        text: `${s.label} ${(last * 100).toFixed(1)}%`,
        color: s.color,
        hl: props.highlightId === s.id
      })
    }
    lower = upper
  })

  layoutLabels(labels, 12, pad.t + 6, pad.t + ih)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="stream"
      role="img"
      aria-label="种群份额随时间演化"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={pad.l + iw} y1={y(f)} y2={y(f)} className="lines__grid" />
          <text x={pad.l - 10} y={y(f) + 4} textAnchor="end" className="lines__tick">
            {Math.round(f * 100)}%
          </text>
        </g>
      ))}

      {Array.from({ length: Math.min(10, gens) + 1 }, (_, t) => {
        const steps = Math.min(10, gens)
        const g = Math.round((t / steps) * gens)
        return (
          <text
            key={`gx${t}`}
            x={x(g)}
            y={pad.t + ih + 22}
            textAnchor="middle"
            className="lines__tick"
          >
            第 {g} 代
          </text>
        )
      })}

      {bands.map((b) => (
        <path
          key={b.id}
          d={b.d}
          fill={b.color}
          opacity={!props.highlightId || props.highlightId === b.id ? 0.86 : 0.22}
          className="stream__band"
          style={{ animationDelay: `${b.delay}ms` }}
        />
      ))}

      {labels.map((l) => (
        <text
          key={l.text}
          x={pad.l + iw + 10}
          y={l.y + 4}
          className={'lines__end' + (l.hl ? ' is-hl' : '')}
          fill={l.color}
        >
          {l.text}
        </text>
      ))}
    </svg>
  )
}

export { pctWhole }
