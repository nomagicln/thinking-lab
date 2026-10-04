/**
 * ui.tsx — 共享交互原语：悬停浮标、滑块、芯片、分段开关、指标条
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'

/* ------------------------------------------------------------------ *
 * 悬停浮标
 * ------------------------------------------------------------------ */

type TipListener = (html: string | null, ev?: { clientX: number; clientY: number }) => void
let tipListener: TipListener | null = null

export function showTip(html: string, ev: { clientX: number; clientY: number }) {
  tipListener?.(html, ev)
}
export function hideTip() {
  tipListener?.(null)
}

export function TooltipHost() {
  const [state, setState] = useState<{ html: string; x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    tipListener = (html, ev) => {
      if (!html || !ev) {
        setState(null)
        return
      }
      setState({ html, x: ev.clientX, y: ev.clientY })
    }
    return () => {
      tipListener = null
    }
  }, [])

  // 量到尺寸后做一次贴边翻转，避免跑出窗口
  useEffect(() => {
    const el = ref.current
    if (!el || !state) return
    const pad = 14
    const w = el.offsetWidth
    const h = el.offsetHeight
    let x = state.x + pad
    let y = state.y + pad
    if (x + w > window.innerWidth - 8) x = state.x - w - pad
    if (y + h > window.innerHeight - 8) y = state.y - h - pad
    el.style.transform = `translate(${Math.max(4, x)}px,${Math.max(4, y)}px)`
  }, [state])

  return (
    <div
      ref={ref}
      className={'viz-tip' + (state ? ' is-on' : '')}
      dangerouslySetInnerHTML={{ __html: state?.html ?? '' }}
    />
  )
}

/* ------------------------------------------------------------------ *
 * 控件
 * ------------------------------------------------------------------ */

export function Slider(props: {
  id?: string
  label: string
  value: number
  min: number
  max: number
  step?: number
  display: string
  hint?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={props.id}>
        {props.label} <b>{props.display}</b>
      </label>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.hint && <p className="field__hint">{props.hint}</p>}
    </div>
  )
}

export function Switch(props: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  )
}

export function Chips<T extends { id: string; name: string; detail?: string }>(props: {
  items: T[]
  activeId: string | null
  onPick: (item: T) => void
  tight?: boolean
  hostId?: string
}) {
  return (
    <div id={props.hostId} className={'chips' + (props.tight ? ' chips--tight' : '')}>
      {props.items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={'chip' + (props.activeId === it.id ? ' is-on' : '')}
          title={it.detail}
          onClick={() => props.onPick(it)}
        >
          {it.name}
        </button>
      ))}
    </div>
  )
}

export function Seg<T extends string>(props: {
  options: [T, string][]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {props.options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          className={props.value === v ? 'is-on' : ''}
          onClick={() => props.onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 指标条
 * ------------------------------------------------------------------ */

export interface MeterAxis {
  key: string
  label: string
  hint: string
}

function band(v: number): string {
  return v >= 0.8 ? 'is-high' : v >= 0.45 ? 'is-mid' : 'is-low'
}

/** 一组指标横杠：宽度即数值，颜色分三档 */
export function MeterList(props: {
  axes: MeterAxis[]
  values: Record<string, number>
  compact?: boolean
  format?: (v: number) => string
}) {
  const fmt = props.format ?? ((v: number) => Math.round(v * 100) + '%')
  return (
    <div className={'traitbars' + (props.compact ? ' traitbars--compact' : '')}>
      {props.axes.map((ax) => {
        const v = props.values[ax.key] ?? 0
        return (
          <div className="traitbar" title={ax.hint} key={ax.key}>
            <div className="traitbar__label">{ax.label}</div>
            <div className="traitbar__track">
              <div
                className={`traitbar__fill ${band(v)}`}
                style={{ '--w': `${Math.max(0, Math.min(1, v)) * 100}%` } as CSSProperties}
              />
            </div>
            <div className="traitbar__val">{fmt(v)}</div>
          </div>
        )
      })}
    </div>
  )
}

/** 迷你点阵：透明度即强度，尺寸小，准确数值放 tooltip */
export function MiniMeter(props: {
  axes: MeterAxis[]
  values: Record<string, number>
  label: string
  title?: string
  onClick?: () => void
}) {
  return (
    <span
      className="trait-mini"
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      aria-label={props.label}
      title={props.title}
      onClick={
        props.onClick
          ? (e) => {
              e.stopPropagation()
              props.onClick?.()
            }
          : undefined
      }
      onKeyDown={
        props.onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                props.onClick?.()
              }
            }
          : undefined
      }
    >
      {props.axes.map((ax) => (
        <i
          key={ax.key}
          className="trait-mini__dot"
          style={{ opacity: 0.16 + 0.84 * (props.values[ax.key] ?? 0) }}
        />
      ))}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * 数字读数块
 * ------------------------------------------------------------------ */

export function Readout(props: {
  items: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'accent' }[]
}) {
  return (
    <div className="readouts">
      {props.items.map((it) => (
        <div className="readout" key={it.label} title={it.hint}>
          <div className="readout__label">{it.label}</div>
          <div className={'readout__value' + (it.tone ? ' is-' + it.tone : '')}>{it.value}</div>
        </div>
      ))}
    </div>
  )
}
