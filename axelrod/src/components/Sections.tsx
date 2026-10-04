/**
 * Sections.tsx — 结论、排名、生态侧栏、文献对照、策略档案
 */

import type { PayoffMatrix, TraitProfile, TournamentResult, Strategy } from '../lib/engine'
import { BY_ID, LITERATURE_1980, STRATEGIES, type LiteratureEntry } from '../lib/strategies'
import { colorOf, fmt, mean, pctWhole } from '../lib/format'
import { TraitBars, TraitMini } from './TraitDisplay'

/* ------------------------------------------------------------------ *
 * 结论横幅
 * ------------------------------------------------------------------ */

export function Verdict(props: {
  result: TournamentResult
  strategies: Strategy[]
  profileOf: (id: string) => TraitProfile | undefined
  ceiling: number
  effectiveRounds: number
  matrix: PayoffMatrix
  litScore?: number
}) {
  const { result: R, strategies } = props
  const champion = R.ranking[0]
  const st = strategies[champion.index]
  const prof = props.profileOf(champion.id)

  return (
    <div className="verdict">
      <div className="verdict__kicker">本次锦标赛冠军</div>

      <div className="verdict__main">
        <div>
          <div className="verdict__name">{champion.name}</div>
          <small>
            {st.nameEn} · {st.origin}
          </small>
        </div>
        <div>
          <div className="verdict__score">
            {champion.score.toFixed(1)}
            <span>分</span>
          </div>
          <div className="verdict__delta">
            {props.litScore != null
              ? `文献值 ${props.litScore.toFixed(1)} 分　偏差 ${
                  champion.score - props.litScore >= 0 ? '+' : ''
                }${(champion.score - props.litScore).toFixed(1)}（${(
                  (Math.abs(champion.score - props.litScore) / props.litScore) *
                  100
                ).toFixed(1)}%）`
              : `得分上限 = 每轮全合作 ${props.matrix.R} 分 × ${props.effectiveRounds.toFixed(0)} 轮 = ${props.ceiling.toFixed(0)} 分`}
          </div>
        </div>
      </div>

      <div className="verdict__profile">
        <div className="verdict__profile-head">行为特质（从实际对局中测量）</div>
        <TraitBars profile={prof} compact />
      </div>

      <p className="verdict__takeaway">
        <Takeaway championId={champion.id} championName={champion.name} profile={prof} n={R.n} />
      </p>
    </div>
  )
}

function Takeaway(props: {
  championId: string
  championName: string
  profile?: TraitProfile
  n: number
}) {
  const p = props.profile
  if (!p) return <>共 <b>{props.n}</b> 位选手参赛。</>

  const nice = p.nice >= 0.9
  const ret = p.retaliate >= 0.7
  const forgiving = p.forgive >= 0.7

  if (nice && ret && forgiving) {
    return (
      <>
        冠军同时具备<b>友善、可报复、宽容</b>。它从不主动挑事，被打了一定还手，
        但只要对方回头就立刻翻篇 —— 这三条让它既不被吃掉，也不用把每一场都打成消耗战。
      </>
    )
  }
  if (!nice) {
    return (
      <>
        这次夺冠的是一位<b>会主动背叛</b>的选手。注意看看参赛名单 ——
        池子里愿意一直合作的软柿子越多，投机者就越容易爬到榜首。
        把「永远合作」和「两报还一报」请出去再跑一次，排名会立刻翻个面。
      </>
    )
  }
  if (!ret) {
    return (
      <>
        冠军<b>从不还手</b>。这在一个人人友善的池子里成立，但极其脆弱：
        只要加进一个永远背叛的对手，它的分数就会立刻塌掉。
        这正是阿克塞尔罗德说「友善还不够」的原因。
      </>
    )
  }
  return (
    <>
      冠军<b>绝不宽容</b> —— 一次背叛就永久报复。在没有误操作的世界里它很有效，
      但把「误操作率」调高一档再跑，它会崩得比谁都惨，因为一次手滑就足以锁死一段关系。
    </>
  )
}

/* ------------------------------------------------------------------ *
 * 排名
 * ------------------------------------------------------------------ */

export function Ranking(props: {
  result: TournamentResult
  strategies: Strategy[]
  ceiling: number
  profileOf: (id: string) => TraitProfile | undefined
  selectedIds: string[]
  onToggle: (id: string) => void
  onTraits: (id: string) => void
}) {
  const { result: R, strategies } = props
  const avg = mean(R.totals)
  const scale = 100 / Math.max(props.ceiling, ...R.totals)

  return (
    <>
      <div className="rank-legend">
        <span className="trait-mini">
          {[1, 1, 1, 0.16, 1].map((o, i) => (
            <i key={i} className="trait-mini__dot" style={{ opacity: o }} />
          ))}
        </span>
        小点从左到右 = <b>友善</b>（从不先背叛）· <b>报复</b>（被背叛会还手）·{' '}
        <b>宽容</b>（对方示好就收手）· <b>破局</b>（双双背叛后主动示好）·{' '}
        <b>可预测</b>（行为好懂）
        <span className="rank-legend__sep" />
        明暗 = 强度，悬停看准确数值
      </div>

      <div className="ranking">
        {R.ranking.map((row, i) => {
          const st = strategies[row.index]
          const isSel = props.selectedIds.includes(row.id)
          return (
            <div
              key={row.id}
              className={
                'rank-row' +
                (row.rank === 1 ? ' is-winner' : '') +
                (isSel ? ' is-selected' : '')
              }
              style={{ '--d': `${i * 34}ms`, '--w': `${(row.score * scale).toFixed(2)}%` } as React.CSSProperties}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              aria-label={`${row.name} 排名第 ${row.rank}，${fmt(row.score)} 分`}
              onClick={() => props.onToggle(row.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  props.onToggle(row.id)
                }
              }}
            >
              <div className="rank-row__rank">{String(row.rank).padStart(2, '0')}</div>
              <div className="rank-row__body">
                <div className="rank-row__head">
                  <div className="rank-row__name">
                    {row.name}
                    <span className="rank-row__en">{st.nameEn}</span>
                  </div>
                  <TraitMini
                    profile={props.profileOf(row.id)}
                    label={row.name}
                    onClick={() => props.onTraits(row.id)}
                  />
                  <div className="rank-row__val">{fmt(row.score)}</div>
                </div>
                <div className="rank-row__track">
                  <div className="rank-row__bar" style={{ background: colorOf(row.id) }} />
                  <div
                    className="rank-row__mean"
                    style={{ left: `${(avg * scale).toFixed(2)}%` }}
                    title={`全池平均 ${fmt(avg)}`}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <InsightCards
        result={R}
        strategies={strategies}
        profileOf={props.profileOf}
        ceiling={props.ceiling}
      />
    </>
  )
}

function InsightCards(props: {
  result: TournamentResult
  strategies: Strategy[]
  profileOf: (id: string) => TraitProfile | undefined
  ceiling: number
}) {
  const { result: R, strategies } = props
  const avg = mean(R.totals)
  const champ = R.ranking[0]
  const last = R.ranking[R.ranking.length - 1]

  const niceScores: number[] = []
  const nastyScores: number[] = []
  strategies.forEach((s, i) => {
    const p = props.profileOf(s.id)
    ;((p?.nice ?? 0) >= 0.9 ? niceScores : nastyScores).push(R.totals[i])
  })

  let best = { score: -Infinity, j: -1 }
  let worst = { score: Infinity, j: -1 }
  for (let j = 0; j < R.n; j++) {
    if (j === champ.index) continue
    const sc = R.matrix[champ.index][j]
    if (sc > best.score) best = { score: sc, j }
    if (sc < worst.score) worst = { score: sc, j }
  }

  const cards: { title: string; body: React.ReactNode }[] = [
    {
      title: '阿克塞尔罗德的核心发现',
      body: (
        <>
          把 <b>{niceScores.length}</b> 位「友善」（从不先背叛）的选手平均一下是{' '}
          <span className="num">{fmt(mean(niceScores), 1)}</span> 分，<b>{nastyScores.length}</b>{' '}
          位会主动背叛的选手平均 <span className="num">{fmt(mean(nastyScores), 1)}</span> 分。
          {mean(niceScores) > mean(nastyScores)
            ? '友善在这一池里是划算的 —— 但注意，友善只是入场券，冠军还额外具备可报复这一条。'
            : '这一次不友善反而更赚，说明池子里的软柿子太多，或者背叛的诱惑太大。试着把 T 调低一点。'}
        </>
      )
    }
  ]

  if (best.j >= 0 && worst.j >= 0) {
    cards.push({
      title: '冠军也有被吊打的时候',
      body: (
        <>
          「{champ.name}」对 <b>{R.names[best.j]}</b> 拿到最高的{' '}
          <span className="num">{best.score.toFixed(0)}</span> 分，对 <b>{R.names[worst.j]}</b> 只有{' '}
          <span className="num">{worst.score.toFixed(0)}</span> 分。冠军不是每一场都赢 ——
          它是「总账」的赢家，而不是「每一局」的赢家。单场最优解（永远背叛）恰恰是总分最差的策略之一。
        </>
      )
    })
  }

  cards.push({
    title: '天花板在哪里',
    body: (
      <>
        如果两个人从头到尾都合作，一场的理论上限是{' '}
        <span className="num">{props.ceiling.toFixed(0)}</span> 分。冠军拿到{' '}
        <span className="num">{champ.score.toFixed(0)}</span> 分，相当于上限的{' '}
        <span className="num">{((champ.score / props.ceiling) * 100).toFixed(1)}%</span>。而最后一名「
        {last.name}」只有 <span className="num">{last.score.toFixed(0)}</span> 分。对比一下全池平均{' '}
        <span className="num">{avg.toFixed(0)}</span> 分，就知道差距其实不算大 ——
        这正是重复博弈的微妙之处：<b>赢家不是碾压，而是少输一点。</b>
      </>
    )
  })

  return (
    <div className="insight">
      {cards.map((c) => (
        <div className="insight-card" key={c.title}>
          <h4>{c.title}</h4>
          <p>{c.body}</p>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 文献对照
 * ------------------------------------------------------------------ */

export function Literature(props: {
  result: TournamentResult
  ids: string[]
}) {
  const { result: R, ids } = props
  const champ = R.ranking[0]
  const tftRank = R.ranking.find((x) => x.id === 'tft')
  const litTop = LITERATURE_1980[0]

  const mapLabel = (row: LiteratureEntry) => {
    if (!row.mapped) return { text: '无对应', cls: 'is-none' }
    if (!ids.includes(row.mapped)) return { text: '未参赛', cls: 'is-none' }
    const r = R.ranking.find((x) => x.id === row.mapped)
    return { text: `模拟第 ${r?.rank} 名`, cls: 'is-none' }
  }

  return (
    <div className="lit-layout">
      <div className="lit">
        <div className="lit__row lit__row--head">
          <div>#</div>
          <div>策略</div>
          <div>投稿者</div>
          <div style={{ textAlign: 'right' }}>平均分</div>
          <div style={{ textAlign: 'right' }}>本实验对应</div>
        </div>
        {LITERATURE_1980.map((row) => {
          const m = mapLabel(row)
          return (
            <div className={'lit__row' + (row.mapped ? ' is-mapped' : '')} key={row.rank}>
              <div className="lit__rank">{String(row.rank).padStart(2, '0')}</div>
              <div className="lit__name">{row.name}</div>
              <div className="lit__author">{row.author}</div>
              <div className="lit__score">{row.score.toFixed(1)}</div>
              <div className={'lit__map ' + m.cls} style={m.text.startsWith('模拟') ? { color: 'var(--jade)' } : undefined}>
                {m.text}
              </div>
            </div>
          )
        })}
      </div>

      <aside className="lit-side">
        <h3>关于「复现」的诚实说明</h3>
        <p>
          1980 年那 14 份投稿里，只有少数几份（例如 Rapoport 的一报还一报、Joss 的乔斯）
          行为被完整描述过，其余多数从未公开源码。因此这里做的是<b>行为近似</b>，
          不是逐字节重刻。
        </p>
        <p>
          能对上的是<b>结构与量级</b>：一报还一报夺冠，分数落在 500 分附近，
          而背叛者在榜尾。
        </p>
        <div className="lit-compare">
          <div className="lit-compare__row">
            <span className="lit-compare__k">文献冠军</span>
            <span className="lit-compare__v">
              {litTop.name} · {litTop.score.toFixed(1)}
            </span>
          </div>
          <div className="lit-compare__row">
            <span className="lit-compare__k">本次冠军</span>
            <span className="lit-compare__v">
              {champ.name} · {champ.score.toFixed(1)}
            </span>
          </div>
          <div className="lit-compare__row">
            <span className="lit-compare__k">一报还一报名次</span>
            <span className="lit-compare__v">
              文献第 1 名 → 模拟第 {tftRank?.rank ?? '—'} 名
            </span>
          </div>
        </div>
        <p style={{ marginTop: 14, color: 'var(--paper-4)', fontSize: 12 }}>
          排名顺序会随阵容变化 —— 这本身就是阿克塞尔罗德想说的话：
          「哪种策略最好」不是一个策略的属性，而是一个<b>种群</b>的属性。
        </p>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 策略档案
 * ------------------------------------------------------------------ */

export function Dossier(props: {
  profileOf: (id: string) => TraitProfile | undefined
  twins: Record<string, string[]>
  inPlayIds: string[]
  activeId: string | null
}) {
  const inPlay = new Set(props.inPlayIds)

  // 当前参赛的排前面
  const entries = STRATEGIES.slice().sort((a, b) => {
    const da = inPlay.has(a.id) ? 0 : 1
    const db = inPlay.has(b.id) ? 0 : 1
    return da - db
  })

  return (
    <>
      <div className="dossier-meta">
        <span>
          共 <b>{STRATEGIES.length}</b> 位策略
        </span>
        <span>
          其中 <b>{props.inPlayIds.length}</b> 位参加本次锦标赛
        </span>
        <span className="dossier-meta__legend">
          <i className="traitbar__fill is-low" /> 弱
          <i className="traitbar__fill is-mid" /> 中
          <i className="traitbar__fill is-high" /> 强
        </span>
      </div>

      <div className="dossier">
        {entries.map((st, i) => {
          const p = props.profileOf(st.id)
          const twinIds = props.twins[st.id]
          let note: string | null = null
          if (!inPlay.has(st.id)) {
            note = '本次未参赛（在左侧「参赛阵容」里勾选即可加入）。'
          } else if (twinIds?.length) {
            const others = twinIds.map((o) => BY_ID[o]?.name ?? o).join('、')
            note =
              `无噪音下，它的行为指标与「${others}」完全重合 —— ` +
              '差别只在出现误操作时才显形。把误操作率调高再跑一次就能看到。'
          }

          return (
            <article
              className={'dossier-card' + (props.activeId === st.id ? ' is-flash' : '')}
              id={`dossier-${st.id}`}
              key={st.id}
              style={{ animationDelay: `${Math.min(i * 40, 500)}ms` }}
            >
              <div className="dossier-card__head">
                <h3 className="dossier-card__title">
                  {st.name}
                  <span className="dossier-card__en">{st.nameEn}</span>
                </h3>
                <span className="dossier-card__short">{st.short}</span>
              </div>
              <div className="dossier-card__origin">{st.origin}</div>
              <p className="dossier-card__phil">{st.philosophy}</p>
              <TraitBars profile={p} />
              <div className="dossier-card__foot">
                <div>首轮合作 {pctWhole(p?.firstCoop ?? 0)}</div>
                <div>样本 {(p?.samples ?? 0).toLocaleString('en-US')} 次出手</div>
              </div>
              {note && <div className="dossier-card__note">{note}</div>}
            </article>
          )
        })}
      </div>
    </>
  )
}
