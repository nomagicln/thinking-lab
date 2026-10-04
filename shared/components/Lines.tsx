/**
 * Lines.tsx — 通用折线图（三个实验共用）
 *
 * 支持可选的背景色带与竖向标记：Boids 用它标出相变区间，
 * 麦克斯韦妖用它标出「净熵过零」的时刻。
 */

export interface LineSeries {
  id: string
  label: string
  color: string
  values: (number | null)[]
  dashed?: boolean
}

export interface Band {
  from: number // 归一化位置 0..1（沿 x 轴）
  to: number
  color: string
  label?: string
}

export interface Marker {
  at: number // 归一化位置 0..1
  label: string
  color?: string
}

/** 末端标签防重叠：按 y 排序后强制最小间距，再整体压回可视范围。堆叠面积图也用得上。 */
export function layoutLabels(items: { y: number }[], minGap: number, top: number, bottom: number) {
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

export function Lines(props: {
  series: LineSeries[]
  xLabels?: string[]
  yLabel?: string
  yFromZero?: boolean
  height?: number
  highlightId?: string | null
  /** 只给这些系列画末端标签；不传则全部画 */
  labelIds?: string[] | null
  yFormat?: (v: number) => string
  ariaLabel?: string
  bands?: Band[]
  markers?: Marker[]
  /** 固定 y 轴上限（例如概率类指标固定到 1） */
  yMax?: number
  yMin?: number
}) {
  const series = props.series.filter((s) => s.values.length)
  if (!series.length) return null

  const W = 960
  const H = props.height ?? 320
  const pad = { t: 22, r: 104, b: 40, l: 58 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b

  const all: number[] = []
  for (const s of series) for (const v of s.values) if (v != null && Number.isFinite(v)) all.push(v)

  let lo = props.yMin ?? Math.min(...all)
  let hi = props.yMax ?? Math.max(...all)
  if (props.yFromZero && props.yMin == null) lo = 0
  const padY = (hi - lo) * 0.12 || 1
  if (!props.yFromZero && props.yMin == null) lo -= padY
  if (props.yMax == null) hi += padY
  if (hi === lo) hi = lo + 1

  const len = Math.max(...series.map((s) => s.values.length))
  const x = (i: number) => pad.l + (len <= 1 ? 0 : (i / (len - 1)) * iw)
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih
  const fmt = props.yFormat ?? ((v: number) => String(Math.round(v)))

  const ticks = 5
  const endLabels: { x: number; y: number; label: string; color: string; hl: boolean }[] = []

  series.forEach((s) => {
    if (props.labelIds && !props.labelIds.includes(s.id)) return
    let lastIdx = -1
    for (let q = s.values.length - 1; q >= 0; q--) {
      const v = s.values[q]
      if (v != null && Number.isFinite(v)) {
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
      aria-label={props.ariaLabel ?? '折线图'}
    >
      {/* 背景色带 */}
      {(props.bands ?? []).map((b, i) => (
        <g key={`band${i}`}>
          <rect
            x={pad.l + b.from * iw}
            y={pad.t}
            width={Math.max(1, (b.to - b.from) * iw)}
            height={ih}
            fill={b.color}
          />
          {b.label && (
            <text
              x={pad.l + ((b.from + b.to) / 2) * iw}
              y={pad.t + 13}
              textAnchor="middle"
              className="lines__bandlabel"
            >
              {b.label}
            </text>
          )}
        </g>
      ))}

      {/* 横向网格与 y 轴刻度 */}
      {Array.from({ length: ticks + 1 }, (_, t) => {
        const vv = lo + ((hi - lo) * t) / ticks
        const yy = y(vv)
        return (
          <g key={`g${t}`}>
            <line x1={pad.l} x2={pad.l + iw} y1={yy} y2={yy} className="lines__grid" />
            <text x={pad.l - 10} y={yy + 4} textAnchor="end" className="lines__tick">
              {fmt(vv)}
            </text>
          </g>
        )
      })}

      {/* x 轴刻度 */}
      {Array.from({ length: Math.min(8, len) }, (_, xt) => {
        const count = Math.min(8, len)
        const idx = Math.round((xt / Math.max(1, count - 1)) * (len - 1))
        return (
          <text key={`x${xt}`} x={x(idx)} y={pad.t + ih + 22} textAnchor="middle" className="lines__tick">
            {props.xLabels?.[idx] ?? String(idx + 1)}
          </text>
        )
      })}

      {/* 竖向标记 */}
      {(props.markers ?? []).map((m, i) => (
        <g key={`mk${i}`}>
          <line
            x1={pad.l + m.at * iw}
            x2={pad.l + m.at * iw}
            y1={pad.t}
            y2={pad.t + ih}
            stroke={m.color ?? 'var(--accent)'}
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.7}
          />
          <text
            x={pad.l + m.at * iw + 5}
            y={pad.t + 12}
            className="lines__marker"
            fill={m.color ?? 'var(--accent)'}
          >
            {m.label}
          </text>
        </g>
      ))}

      {/* 曲线 */}
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
            strokeWidth={props.highlightId === s.id ? 2.6 : 1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.dashed ? '5 4' : undefined}
            pathLength={s.dashed ? undefined : 1}
            opacity={dim ? 0.3 : 1}
            className={s.dashed ? undefined : 'lines__path'}
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
