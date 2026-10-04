/**
 * lab.tsx — 实验室外壳：主题容器、顶部导航、报头、章节、面板、版记
 *
 * 三个实验共用这一套骨架，各自只换一个 --accent 主色。
 * 换实验时整页底色会有一层极淡的色偏过渡，读起来像「换了个房间」而不是换了个网站。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

export type LabTheme = 'axelrod' | 'boids' | 'maxwell'

export interface ExperimentMeta {
  id: LabTheme
  /**
   * 相对**站点根**的路径，不带前导 ./ 或 ../。
   *
   * 这里必须存根相对路径，不能存 './boids/' 这种页面相对路径 ——
   * 从 /axelrod/ 页面点 './boids/' 会解析成 /axelrod/boids/，直接 404。
   * 由 LabNav 的 base 参数拼出每个页面各自正确的相对地址。
   */
  path: string
  name: string
  tagline: string
}

/** 实验室里的全部实验。导航、首页卡片都从这里读，避免两处写死。 */
export const EXPERIMENTS: ExperimentMeta[] = [
  { id: 'axelrod', path: 'axelrod/', name: '阿克塞尔罗德实验', tagline: '重复囚徒困境锦标赛' },
  { id: 'boids', path: 'boids/', name: 'Boids 鸟群模型', tagline: '三条局部规则涌现出群体秩序' },
  { id: 'maxwell', path: 'maxwell-demon/', name: '麦克斯韦妖', tagline: '信息能不能换熵' }
]

/**
 * 站点根相对路径 → 当前页面可用的相对地址。
 * 首页在根下，用 './'；实验页都在下一级，用 '../'。
 */
export function labHref(base: string, rootRelative: string): string {
  return base + rootRelative
}

/* ------------------------------------------------------------------ *
 * 折叠状态：存 localStorage，刷新后保持
 * ------------------------------------------------------------------ */

const FOLD_PREFIX = 'lab:fold:'
const foldBus = new EventTarget()

/** 一键折叠 / 展开所有面板（各面板自己订阅这个事件） */
export function foldAll(folded: boolean) {
  foldBus.dispatchEvent(new CustomEvent<boolean>('fold-all', { detail: folded }))
}

function useFolded(key: string, defaultFolded = false) {
  const [folded, setFolded] = useState(() => {
    if (typeof localStorage === 'undefined') return defaultFolded
    try {
      const v = localStorage.getItem(FOLD_PREFIX + key)
      return v === null ? defaultFolded : v === '1'
    } catch {
      return defaultFolded
    }
  })

  const write = (next: boolean) => {
    try {
      localStorage.setItem(FOLD_PREFIX + key, next ? '1' : '0')
    } catch {
      /* 隐私模式下写不进去，忽略即可 */
    }
  }

  useEffect(() => {
    const onAll = (e: Event) => {
      const next = (e as CustomEvent<boolean>).detail
      setFolded(next)
      write(next)
    }
    foldBus.addEventListener('fold-all', onAll)
    return () => foldBus.removeEventListener('fold-all', onAll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const toggle = () =>
    setFolded((c) => {
      const next = !c
      write(next)
      return next
    })

  return [folded, toggle] as const
}

export function Lab(props: { theme: LabTheme; children: ReactNode }) {
  return (
    <div className={`lab lab--${props.theme}`}>
      <div className="grain" aria-hidden="true" />
      <div className="grid-bg" aria-hidden="true" />
      {props.children}
    </div>
  )
}

/**
 * 顶部细导航：回实验室 + 兄弟实验直达。
 * 当前实验用主色高亮，其余保持低对比，形成一个「楼层指示牌」。
 * 传 current={null} 表示自己就是实验室首页，此时不显示返回链接、也不高亮任何一项。
 *
 * base 必填（'./' 或 '../'）：漏传就会静默生成 404 链接，宁可让类型检查报错。
 */
export function LabNav(props: { current?: LabTheme | null; base: string }) {
  const current = props.current ?? null
  return (
    <nav className="labnav" aria-label="实验导航">
      {current ? (
        <a className="labnav__home" href={labHref(props.base, './')}>
          <span className="labnav__arrow">←</span> thinking-lab
        </a>
      ) : (
        <span className="labnav__home labnav__home--static">thinking-lab</span>
      )}
      <div className="labnav__list">
        {EXPERIMENTS.map((e) => (
          <a
            key={e.id}
            href={labHref(props.base, e.path)}
            className={'labnav__item' + (e.id === current ? ' is-current' : '')}
            aria-current={e.id === current ? 'page' : undefined}
          >
            {e.name}
          </a>
        ))}
      </div>
    </nav>
  )
}

/* ------------------------------------------------------------------ *
 * 报头
 * ------------------------------------------------------------------ */

export function Masthead(props: {
  meta: string[]
  titleCn: string
  titleEn: string
  lede: ReactNode
  toc?: [string, string][]
}) {
  return (
    <header className="masthead">
      <div className="masthead__rule">
        {props.meta.map((m, i) => (
          <span key={m} style={{ display: 'contents' }}>
            {i > 0 && <span className="masthead__rule-dot" />}
            <span>{m}</span>
          </span>
        ))}
      </div>

      <h1 className="masthead__title">
        <span className="masthead__title-cn">{props.titleCn}</span>
        <span className="masthead__title-en">{props.titleEn}</span>
      </h1>

      <p className="masthead__lede">{props.lede}</p>

      {props.toc && props.toc.length > 0 && (
        <nav className="toc" aria-label="章节导航">
          {props.toc.map(([id, label]) => (
            <a href={`#${id}`} key={id}>
              {label}
            </a>
          ))}
        </nav>
      )}
    </header>
  )
}

/* ------------------------------------------------------------------ *
 * 章节
 * ------------------------------------------------------------------ */

export function Section(props: {
  id: string
  num?: string
  title: string
  note?: ReactNode
  children: ReactNode
  variant?: 'verdict'
  /** 默认允许折叠；观察窗之类的首屏区块传 false 关掉 */
  collapsible?: boolean
}) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(props.variant === 'verdict')
  const canFold = props.collapsible !== false && props.variant !== 'verdict'
  const [folded, toggle] = useFolded('sec:' + props.id)

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
    visible ? 'is-visible' : '',
    canFold && folded ? 'is-folded' : ''
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
        {canFold && (
          <button
            type="button"
            className="foldbtn sec__fold"
            onClick={toggle}
            aria-expanded={!folded}
            aria-controls={props.id + '-body'}
            title={folded ? '展开本章' : '折叠本章'}
          >
            <span className="foldbtn__label">{folded ? '展开' : '折叠'}</span>
            <span className="foldbtn__chev" aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="sec__body" id={props.id + '-body'} hidden={canFold && folded}>
        {props.children}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * 侧栏面板（可折叠）
 * ------------------------------------------------------------------ */

export function Panel(props: {
  /** 折叠状态存 localStorage 用的键，全局唯一即可 */
  id: string
  title: string
  sub?: string
  children: ReactNode
  /** 默认是否折叠 */
  defaultFolded?: boolean
  className?: string
}) {
  const [folded, toggle] = useFolded('panel:' + props.id, props.defaultFolded)
  const bodyId = 'panel-body-' + props.id

  return (
    <section className={'panel' + (folded ? ' is-folded' : '') + (props.className ? ' ' + props.className : '')}>
      <button
        type="button"
        className="panel__head"
        onClick={toggle}
        aria-expanded={!folded}
        aria-controls={bodyId}
      >
        <h2 className="panel__title">
          {props.title}
          {props.sub && <em>{props.sub}</em>}
        </h2>
        <span className="foldbtn__chev" aria-hidden="true" />
      </button>
      <div className="panel__body" id={bodyId} hidden={folded}>
        {props.children}
      </div>
    </section>
  )
}

/** 侧栏顶部：一键折叠 / 展开全部面板 */
export function RailTools() {
  return (
    <div className="railtools">
      <span className="railtools__label">参数</span>
      <span className="railtools__spacer" />
      <button type="button" className="railtools__btn" onClick={() => foldAll(true)}>
        全部折叠
      </button>
      <button type="button" className="railtools__btn" onClick={() => foldAll(false)}>
        全部展开
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 版记
 * ------------------------------------------------------------------ */

export function Colophon(props: { source: ReactNode; footnotes?: ReactNode[] }) {
  return (
    <footer className="colophon">
      <div className="colophon__rule" />
      <p>
        <b>来源</b>
        {props.source}
      </p>
      {(props.footnotes ?? []).map((f, i) => (
        <p className="colophon__dim" key={i}>
          {f}
        </p>
      ))}
    </footer>
  )
}
