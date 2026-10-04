/**
 * lab.tsx — 实验室外壳：主题容器、顶部导航、报头、章节、版记
 *
 * 三个实验共用这一套骨架，各自只换一个 --accent 主色。
 * 换实验时整页底色会有一层极淡的色偏过渡，读起来像「换了个房间」而不是换了个网站。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

export type LabTheme = 'axelrod' | 'boids' | 'maxwell'

export interface ExperimentMeta {
  id: LabTheme
  path: string
  name: string
  tagline: string
}

/** 实验室里的全部实验。导航、首页卡片都从这里读，避免两处写死。 */
export const EXPERIMENTS: ExperimentMeta[] = [
  {
    id: 'axelrod',
    path: './axelrod/',
    name: '阿克塞尔罗德实验',
    tagline: '重复囚徒困境锦标赛'
  },
  {
    id: 'boids',
    path: './boids/',
    name: 'Boids 鸟群模型',
    tagline: '三条局部规则涌现出群体秩序'
  },
  {
    id: 'maxwell',
    path: './maxwell-demon/',
    name: '麦克斯韦妖',
    tagline: '信息能不能换熵'
  }
]

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
 */
export function LabNav(props: { current?: LabTheme | null }) {
  const current = props.current ?? null
  return (
    <nav className="labnav" aria-label="实验导航">
      {current ? (
        <a className="labnav__home" href="../">
          <span className="labnav__arrow">←</span> thinking-lab
        </a>
      ) : (
        <span className="labnav__home labnav__home--static">thinking-lab</span>
      )}
      <div className="labnav__list">
        {EXPERIMENTS.map((e) => (
          <a
            key={e.id}
            href={e.path}
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
