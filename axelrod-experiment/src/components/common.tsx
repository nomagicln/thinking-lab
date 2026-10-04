/**
 * common.tsx — 跨章节复用的展示原语
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TRAIT_AXES, type TraitProfile } from '../lib/engine'
import { pctWhole } from '../lib/format'

/* ------------------------------------------------------------------ *
 * 章节容器：滚动到视口时淡入
 * ------------------------------------------------------------------ */

export function Section(props: {
  id: string
  num?: string
  title: string
  note?: ReactNode
  children: ReactNode
  variant?: 'verdict'
}) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(props.variant === 'verdict')

  useEffect(() => {
    if (props.variant === 'verdict') return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.04 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [props.variant])

  const cls = [
    'sec',
    props.variant === 'verdict' ? 'sec--verdict' : '',
    visible ? 'is-visible' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={cls} id={props.id} ref={ref}>
      <header className="sec__head">
        <h2 className="sec__title">
          {props.num && <span className="sec__num">{props.num}</span>}
          {props.title}
        </h2>
        {props.note && <p className="sec__note">{props.note}</p>}
      </header>
      {props.children}
    </section>
  )
}

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

  // 浮标量到尺寸后做一次「贴边翻转」，避免跑出窗口
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
 * 行为特质
 * ------------------------------------------------------------------ */

export function profileText(profile: TraitProfile | undefined): string {
  if (!profile) return ''
  return TRAIT_AXES.map((ax) => `${ax.label} ${pctWhole(profile[ax.key])}`).join(' · ')
}

function band(v: number): string {
  return v >= 0.8 ? 'is-high' : v >= 0.45 ? 'is-mid' : 'is-low'
}

/** 五条横杠的完整特质条 */
export function TraitBars(props: { profile?: TraitProfile; compact?: boolean }) {
  const p = props.profile
  return (
    <div className={'traitbars' + (props.compact ? ' traitbars--compact' : '')}>
      {TRAIT_AXES.map((ax) => {
        const v = p ? p[ax.key] : 0
        return (
          <div className="traitbar" title={ax.hint} key={ax.key}>
            <div className="traitbar__label">{ax.label}</div>
            <div className="traitbar__track">
              <div
                className={`traitbar__fill ${band(v)}`}
                style={{ '--w': `${(v * 100).toFixed(1)}%` } as React.CSSProperties}
              />
            </div>
            <div className="traitbar__val">{pctWhole(v)}</div>
          </div>
        )
      })}
    </div>
  )
}

/** 排名行右侧的五个小点，明暗即强度 */
export function TraitMini(props: {
  profile?: TraitProfile
  label: string
  onClick?: () => void
}) {
  const p = props.profile
  return (
    <span
      className="trait-mini"
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      aria-label={`${props.label} 的行为特质${props.onClick ? '，点击查看档案' : ''}`}
      title={profileText(p) + (props.onClick ? '　（点击查看完整档案）' : '')}
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
      {TRAIT_AXES.map((ax) => (
        <i
          key={ax.key}
          className="trait-mini__dot"
          style={{ opacity: 0.16 + 0.84 * (p ? p[ax.key] : 0) }}
        />
      ))}
    </span>
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
