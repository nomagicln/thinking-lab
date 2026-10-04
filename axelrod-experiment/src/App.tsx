/**
 * App.tsx — 状态与编排
 *
 * 所有派生数据都用 useMemo 从参数算出来；参数一变，React 重新渲染。
 * 计算本身是纯函数（lib/engine.ts），因此结果完全可复现。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_MATRIX,
  TRAIT_AXES,
  ecology,
  measureTraits,
  playRoundRobin,
  runTournament,
  type TraitProfile
} from './lib/engine'
import {
  BY_ID,
  LITERATURE_1980,
  ROSTER_PRESETS,
  STRATEGIES,
  TRAIT_PROBE_IDS,
  byIds,
  type RosterPreset
} from './lib/strategies'
import { colorOf, registerColorOrder, scoreCeiling } from './lib/format'
import { ControlRail, type Params } from './components/Rail'
import { Section, TooltipHost, hideTip } from './components/common'
import { Convergence, EcologyStream, Heatmap, type LineSeries, type StreamSeries } from './components/charts'
import { Playback } from './components/Playback'
import { Dossier, Literature, Ranking, Verdict } from './components/Sections'

registerColorOrder(STRATEGIES.map((s) => s.id))

const CLASSIC = ROSTER_PRESETS[0]

const INITIAL: Params = {
  matrix: DEFAULT_MATRIX,
  matrixPresetId: 'axelrod',
  rounds: 200,
  repetitions: 5,
  noise: 0,
  mode: 'fixed',
  discount: 0.9,
  seedBase: 'axelrod-1980',
  selectedIds: CLASSIC.ids ?? STRATEGIES.map((s) => s.id),
  rosterPresetId: CLASSIC.id
}

export default function App() {
  const [params, setParams] = useState<Params>(INITIAL)
  const [participants, setParticipants] = useState<string[] | null>(null)
  const [focusTop3, setFocusTop3] = useState(true)
  const [generations, setGenerations] = useState(150)
  const [mutation, setMutation] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  const patch = useCallback((p: Partial<Params>) => setParams((prev) => ({ ...prev, ...p })), [])

  /* ---------------- 参赛阵容 ---------------- */

  const strategies = useMemo(() => byIds(params.selectedIds), [params.selectedIds])

  const applyPreset = useCallback((preset: RosterPreset) => {
    setParams((prev) => ({
      ...prev,
      selectedIds: preset.ids ?? STRATEGIES.map((s) => s.id),
      rosterPresetId: preset.id,
      noise: preset.params?.noise ?? 0,
      repetitions: preset.params?.repetitions ?? prev.repetitions
    }))
  }, [])

  const toggleStrategy = useCallback((id: string) => {
    setParams((prev) => {
      const has = prev.selectedIds.includes(id)
      return {
        ...prev,
        selectedIds: has ? prev.selectedIds.filter((x) => x !== id) : [...prev.selectedIds, id],
        rosterPresetId: null
      }
    })
  }, [])

  /* ---------------- 锦标赛 ---------------- */

  // 计时放在 memo 内部返回，避免在渲染期间调用 setState
  const { result, computeMs } = useMemo(() => {
    if (strategies.length < 2) return { result: null, computeMs: 0 }
    const t0 = performance.now()
    const r = runTournament(strategies, {
      rounds: params.rounds,
      repetitions: params.repetitions,
      noise: params.noise,
      discount: params.mode === 'geometric' ? params.discount : null,
      maxRounds: params.mode === 'geometric' ? 3000 : null,
      matrix: params.matrix,
      seedBase: params.seedBase,
      includeSelf: false // 1980 年的规则：每位选手不与自己对局
    })
    return { result: r, computeMs: performance.now() - t0 }
  }, [strategies, params])

  /** 一场对局的有效轮数：固定模式就是设定值，几何延续模式取实际平均长度 */
  const effectiveRounds = useMemo(() => {
    if (params.mode !== 'geometric') return params.rounds
    if (!result) return 1 / (1 - params.discount)
    const lens = result.avgLengths
    let sum = 0
    let cnt = 0
    for (let i = 0; i < lens.length; i++) {
      for (let j = 0; j < lens[i].length; j++) {
        if (i !== j) {
          sum += lens[i][j]
          cnt++
        }
      }
    }
    return cnt ? sum / cnt : 1 / (1 - params.discount)
  }, [params.mode, params.rounds, params.discount, result])

  const ceiling = scoreCeiling(params.matrix, effectiveRounds)

  /* ---------------- 行为特质（只跟收益矩阵有关） ---------------- */

  const profiles = useMemo(() => {
    const probes = TRAIT_PROBE_IDS.map((id) => BY_ID[id]).filter(Boolean)
    const map: Record<string, TraitProfile> = {}
    for (const st of STRATEGIES) {
      map[st.id] = measureTraits(st, probes, {
        matrix: params.matrix,
        rounds: 200,
        reps: 3,
        seedBase: 'trait-probe'
      })
    }
    return map
    // params.matrix 的四个数变了才需要重算
  }, [params.matrix.T, params.matrix.R, params.matrix.P, params.matrix.S]) // eslint-disable-line react-hooks/exhaustive-deps

  const profileOf = useCallback((id: string) => profiles[id], [profiles])

  /** 指标完全重合的策略（无噪音下 ctft 与 tft 就是如此，这是正确的） */
  const twins = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const st of STRATEGIES) {
      const p = profiles[st.id]
      const key = TRAIT_AXES.map((ax) => Math.round(p[ax.key] * 10)).join('-')
      ;(groups[key] ||= []).push(st.id)
    }
    const out: Record<string, string[]> = {}
    for (const ids of Object.values(groups)) {
      if (ids.length < 2) continue
      for (const id of ids) out[id] = ids.filter((o) => o !== id)
    }
    return out
  }, [profiles])

  /* ---------------- 生态演化 ---------------- */

  const ecoHistory = useMemo(() => {
    if (!result) return null
    return ecology(result.fullMatrix, { generations, mutation })
  }, [result, generations, mutation])

  /* ---------------- 回放参与者 ---------------- */

  useEffect(() => {
    if (!result) return
    setParticipants((prev) => {
      const valid = (prev ?? []).filter((id) => params.selectedIds.includes(id))
      if (valid.length >= 2) return valid
      return result.ranking.slice(0, Math.min(4, params.selectedIds.length)).map((r) => r.id)
    })
  }, [result, params.selectedIds])

  const activeParticipants = useMemo(() => {
    const list = (participants ?? []).filter((id) => params.selectedIds.includes(id))
    return list
  }, [participants, params.selectedIds])

  const order = useMemo(
    () => STRATEGIES.map((s) => s.id),
    []
  )

  const toggleParticipant = useCallback(
    (id: string) => {
      setParticipants((prev) => {
        const list = (prev ?? []).filter((x) => params.selectedIds.includes(x))
        const at = list.indexOf(id)
        if (at >= 0) {
          if (list.length <= 2) return list // 至少留两位，否则没得比
          list.splice(at, 1)
        } else {
          list.push(id)
        }
        return list.sort((a, b) => order.indexOf(a) - order.indexOf(b))
      })
    },
    [params.selectedIds, order]
  )

  const setAllParticipants = useCallback(
    (ids: string[]) => setParticipants(ids.sort((a, b) => order.indexOf(a) - order.indexOf(b))),
    [order]
  )

  /* ---------------- 回放数据 ---------------- */

  const rrStrategies = useMemo(() => byIds(activeParticipants), [activeParticipants])

  const playbackData = useMemo(() => {
    if (rrStrategies.length < 2) return null
    const rounds =
      params.mode === 'geometric' ? Math.max(2, Math.round(effectiveRounds)) : params.rounds
    return playRoundRobin(rrStrategies, {
      rounds,
      matrix: params.matrix,
      noise: params.noise,
      seedBase: params.seedBase
    })
  }, [rrStrategies, params.rounds, params.mode, params.discount, params.noise, params.matrix, params.seedBase, effectiveRounds])

  /** 泳道按「本次回放的最终得分」排序，读起来才是一条排行榜 */
  const playbackOrder = useMemo(() => {
    if (!playbackData) return []
    return playbackData.totals
      .map((_, i) => i)
      .sort((a, b) => playbackData.totals[b] - playbackData.totals[a])
  }, [playbackData])

  // 数据一变就跳到最后一轮
  useEffect(() => {
    if (playbackData) setCursor(playbackData.rounds)
  }, [playbackData])

  // 渲染用的游标始终夹在当前数据范围内：切换模式会让对局长度骤变
  // （几何延续模式只有约 10 轮），中间那一帧不能拿旧游标去索引新数据。
  const safeCursor = playbackData ? Math.max(0, Math.min(cursor, playbackData.rounds)) : 0

  const startPlay = useCallback(() => {
    if (!playbackData) return
    // 已经播到底了就从头再来，否则点「播放」什么也不会发生
    if (safeCursor >= playbackData.rounds) setCursor(0)
    setPlaying(true)
  }, [playbackData, safeCursor])

  /* ---------------- 播放 ---------------- */

  useEffect(() => {
    if (!playing || !playbackData) return
    const step = Math.max(1, Math.round(playbackData.rounds / 90))
    timerRef.current = window.setInterval(() => {
      setCursor((c) => {
        if (c >= playbackData.rounds) {
          setPlaying(false)
          return c
        }
        return c + step
      })
    }, 42)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [playing, playbackData])

  /* ---------------- 交互 ---------------- */

  const focusDossier = useCallback((id: string) => {
    document.getElementById('sec-dossier')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setFlashId(id)
    window.setTimeout(() => setFlashId(null), 2600)
  }, [])

  const ids = result?.ids ?? []

  const convergenceSeries: LineSeries[] = useMemo(() => {
    if (!result) return []
    return strategies.map((st, i) => ({
      id: st.id,
      label: st.short,
      color: colorOf(st.id),
      values: result.convergence[i]
    }))
  }, [result, strategies])

  const top3 = result ? result.ranking.slice(0, 3).map((r) => r.id) : []

  const streamSeries: StreamSeries[] = useMemo(() => {
    if (!result || !ecoHistory) return []
    const final = ecoHistory[ecoHistory.length - 1]
    return strategies
      .map((st, i) => ({ id: st.id, label: st.short, color: colorOf(st.id), index: i }))
      .sort((a, b) => final[b.index] - final[a.index])
  }, [result, ecoHistory, strategies])

  const ecoFinal = useMemo(() => {
    if (!ecoHistory || !result) return []
    const final = ecoHistory[ecoHistory.length - 1]
    const rankIdx = strategies.map((_, i) => i).sort((a, b) => final[b] - final[a])
    return rankIdx.map((i) => ({
      id: strategies[i].id,
      name: strategies[i].name,
      color: colorOf(strategies[i].id),
      share: final[i]
    }))
  }, [ecoHistory, result, strategies])

  const litEntry = result ? LITERATURE_1980.find((l) => l.mapped === result.ranking[0].id) : undefined
  const preset = ROSTER_PRESETS.find((r) => r.id === params.rosterPresetId)

  return (
    <>
      <div className="grain" aria-hidden="true" />
      <div className="grid-bg" aria-hidden="true" />
      <TooltipHost />

      <header className="masthead">
        <div className="masthead__rule">
          <span>实验记录 · 1980</span>
          <span className="masthead__rule-dot" />
          <span>Journal of Conflict Resolution 24(3)</span>
          <span className="masthead__rule-dot" />
          <span>React + TypeScript</span>
        </div>
        <h1 className="masthead__title">
          <span className="masthead__title-cn">重复囚徒困境</span>
          <span className="masthead__title-en">Iterated Prisoner&apos;s Dilemma</span>
        </h1>
        <p className="masthead__lede">
          罗伯特·阿克塞尔罗德向全世界征集策略，让它们两两相遇两百个回合。
          没有中央权威，没有道德说教，只有得分表。
          结果，那个最简单、最不精明的策略赢了 —— 而且赢了很多年。
          下面这些参数都是活的，你可以随时把它拆开重来。
        </p>
        <nav className="toc" aria-label="章节导航">
          {[
            ['sec-verdict', '结论'],
            ['sec-ranking', '排名'],
            ['sec-matrix', '对阵矩阵'],
            ['sec-convergence', '收敛'],
            ['sec-ecology', '生态演化'],
            ['sec-playback', '多人回放'],
            ['sec-literature', '文献对照'],
            ['sec-dossier', '策略档案']
          ].map(([id, label]) => (
            <a href={`#${id}`} key={id}>
              {label}
            </a>
          ))}
        </nav>
      </header>

      <main className="shell">
        <ControlRail
          p={params}
          preset={preset}
          computeMs={computeMs}
          onPatch={patch}
          onPreset={applyPreset}
          onToggleStrategy={toggleStrategy}
          onAll={() =>
            patch({ selectedIds: STRATEGIES.map((s) => s.id), rosterPresetId: 'all' })
          }
          onNone={() => patch({ selectedIds: [], rosterPresetId: null })}
          onReseed={() => patch({ seedBase: `seed-${Math.random().toString(36).slice(2, 8)}` })}
        />

        <div className="stage">
          {!result ? (
            <Section id="sec-verdict" title="无法开赛" variant="verdict">
              <p className="verdict__takeaway" style={{ border: 0, padding: 0, margin: 0 }}>
                至少需要两位选手。目前选了 <b>{params.selectedIds.length}</b> 位 ——
                一个人没法构成锦标赛。
              </p>
            </Section>
          ) : (
            <>
              {/* 结论 */}
              <Section id="sec-verdict" title="" variant="verdict">
                <Verdict
                  result={result}
                  strategies={strategies}
                  profileOf={profileOf}
                  ceiling={ceiling}
                  effectiveRounds={effectiveRounds}
                  matrix={params.matrix}
                  litScore={litEntry?.score}
                />
                <div className="run-stats" id="run-stats">
                  {[
                    ['选手', `${strategies.length} 位`],
                    ['对局组合', `${(strategies.length * (strategies.length - 1)) / 2} 组 × ${params.repetitions} 次`],
                    [
                      '每场轮数',
                      params.mode === 'geometric'
                        ? `≈${(1 / (1 - params.discount)).toFixed(1)} 轮`
                        : `${params.rounds} 轮`
                    ],
                    ['误操作率', `${Math.round(params.noise * 100)}%`],
                    ['计算耗时', `${computeMs.toFixed(0)} ms`]
                  ].map(([k, v]) => (
                    <span key={k}>
                      {k} <b>{v}</b>
                    </span>
                  ))}
                </div>
              </Section>

              {/* 排名 */}
              <Section
                id="sec-ranking"
                num="01"
                title="最终排名"
                note={
                  <>
                    每位选手与其余每位各打若干场。柱子长度是「平均每场总分」占理论天花板（每轮全合作
                    R 分 × 轮数）的比例，竖线是全池平均分。名字右侧五个小点的明暗分别是
                    「友善 / 报复 / 宽容 / 破局 / 可预测」的强度（鼠标悬停看准确数值），
                    详细定义见 <a href="#sec-dossier">策略档案</a>。
                  </>
                }
              >
                <Ranking
                  result={result}
                  strategies={strategies}
                  ceiling={ceiling}
                  profileOf={profileOf}
                  selectedIds={activeParticipants}
                  onToggle={toggleParticipant}
                  onTraits={focusDossier}
                />
              </Section>

              {/* 对阵矩阵 */}
              <Section
                id="sec-matrix"
                num="02"
                title="谁在谁身上得分"
                note={
                  <>
                    整个锦标赛的原始证据。点击任意格子，下方回放区会播放这一对选手的逐轮交手。
                    对角线是自博弈，按 1980 年的规则不计入排名，用虚线留空。
                  </>
                }
              >
                <div className="heatmap-wrap">
                  <Heatmap
                    ids={ids}
                    labels={ids.map((id) => BY_ID[id].short)}
                    matrix={result.matrix}
                    highlightId={activeParticipants[0]}
                    onCell={(r, k) => {
                      setAllParticipants([ids[r], ids[k]])
                      document
                        .getElementById('sec-playback')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                  />
                </div>
              </Section>

              {/* 收敛 */}
              <Section
                id="sec-convergence"
                num="03"
                title="分数是怎么攒起来的"
                note={
                  <>
                    横轴是轮次，纵轴是到该轮为止的累计总分（对所有对局取平均）。曲线的斜率就是
                    「每轮赚钱的速度」：一报还一报的线陡而稳；永远背叛一开始冲得猛，然后迅速躺平
                    —— 因为肯跟它合作的人越来越少。
                  </>
                }
              >
                <div className="chart-wrap">
                  <Convergence
                    series={convergenceSeries}
                    xLabels={result.convergence[0].map((_, i) => String(i + 1))}
                    yLabel="累计总分"
                    yFromZero
                    height={360}
                    highlightId={focusTop3 ? null : activeParticipants[0]}
                    labelIds={focusTop3 ? top3 : null}
                  />
                </div>
                <div className="chart-controls">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={focusTop3}
                      onChange={(e) => setFocusTop3(e.target.checked)}
                    />
                    <span>只突出前三名</span>
                  </label>
                </div>
              </Section>

              {/* 生态演化 */}
              <Section
                id="sec-ecology"
                num="04"
                title="生态演化"
                note={
                  <>
                    阿克塞尔罗德的第二个实验：把得分表变成繁殖率。
                    种群按适应度自我复制 —— 表现好的策略留下更多后代，表现差的份额萎缩。
                    注意这不是「谁更能打」，而是「谁在人群里更活得下去」。
                  </>
                }
              >
                <div className="eco-layout">
                  <div className="chart-wrap chart-wrap--eco">
                    {ecoHistory && (
                      <EcologyStream
                        history={ecoHistory}
                        series={streamSeries}
                        highlightId={activeParticipants[0]}
                        height={380}
                      />
                    )}
                  </div>
                  <div className="eco-side">
                    <h3 className="eco-side__title">终局种群份额</h3>
                    <div className="eco-final">
                      {ecoFinal.map((row) => (
                        <div
                          className={'eco-final__row' + (row.share < 0.001 ? ' is-dead' : '')}
                          key={row.id}
                        >
                          <span className="eco-final__swatch" style={{ background: row.color }} />
                          <span className="eco-final__name">{row.name}</span>
                          <span className="eco-final__val">
                            {row.share < 0.0001 ? '灭绝' : `${(row.share * 100).toFixed(1)}%`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="chart-controls">
                  <label className="field__label field__label--sub" htmlFor="in-gens">
                    迭代代数 <b>{generations}</b>
                  </label>
                  <input
                    id="in-gens"
                    type="range"
                    min={10}
                    max={400}
                    step={10}
                    value={generations}
                    onChange={(e) => setGenerations(Number(e.target.value))}
                  />
                  <label className="field__label field__label--sub" htmlFor="in-mutation">
                    变异率 <b>{Math.round(mutation * 100)}%</b>
                  </label>
                  <input
                    id="in-mutation"
                    type="range"
                    min={0}
                    max={20}
                    step={1}
                    value={Math.round(mutation * 100)}
                    onChange={(e) => setMutation(Number(e.target.value) / 100)}
                  />
                </div>
              </Section>

              {/* 多人回放 */}
              <Section
                id="sec-playback"
                num="05"
                title="多人同步回放"
                note={
                  <>
                    把整场循环赛摊开来看。选几位参与者，让所有对手在<b>同一轮里同时出手</b>，
                    然后一轮一轮推下去：每条泳道一格一轮，下方矩阵则显示「这一轮谁对谁做了什么」。
                  </>
                }
              >
                <div className="pb-bar">
                  <div className="pb-bar__pick">
                    <div className="pb-bar__label">
                      参与者 <b id="out-pb-count">{activeParticipants.length}</b> 位
                      <span className="pb-bar__quick">
                        <button
                          type="button"
                          id="pb-top"
                          className="btn btn--link"
                          onClick={() =>
                            setAllParticipants(
                              result.ranking.slice(0, 4).map((r) => r.id)
                            )
                          }
                        >
                          前四名
                        </button>
                        <button
                          type="button"
                          id="pb-least"
                          className="btn btn--link"
                          onClick={() =>
                            setAllParticipants(
                              result.ranking
                                .slice(Math.max(0, result.ranking.length - 4))
                                .map((r) => r.id)
                            )
                          }
                        >
                          后四名
                        </button>
                        <button
                          type="button"
                          id="pb-all"
                          className="btn btn--link"
                          onClick={() => setAllParticipants(params.selectedIds.slice())}
                        >
                          全部
                        </button>
                      </span>
                    </div>
                    <div className="chips chips--tight" id="pb-participants">
                      {ids.map((id) => {
                        const on = activeParticipants.includes(id)
                        return (
                          <button
                            key={id}
                            type="button"
                            className={'chip chip--sm' + (on ? ' is-on' : '')}
                            title={BY_ID[id].name + ' · ' + BY_ID[id].philosophy}
                            onClick={() => toggleParticipant(id)}
                          >
                            {BY_ID[id].short}
                          </button>
                        )
                      })}
                    </div>
                    <p className="pb-bar__hint" id="pb-hint">
                      {playbackData
                        ? `同步回放 ${playbackData.K} 位参与者，两两交手：每人每轮最多与 ${playbackData.oppCount} 位对手过招，共 ${playbackData.rounds} 轮。泳道每一格是一轮，颜色越绿表示该轮对越多对手选择了合作。`
                        : '至少需要两位参与者。'}
                    </p>
                  </div>
                  <div className="pb-bar__btns">
                    <button
                      type="button"
                      id="btn-play"
                      className="btn btn--small"
                      onClick={() => (playing ? setPlaying(false) : startPlay())}
                    >
                      {playing ? '暂停' : '播放'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() => {
                        setPlaying(false)
                        setCursor(Math.max(0, safeCursor - 1))
                      }}
                    >
                      上一轮
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() => {
                        setPlaying(false)
                        setCursor(Math.min(playbackData?.rounds ?? 0, safeCursor + 1))
                      }}
                    >
                      下一轮
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() => {
                        setPlaying(false)
                        setCursor(playbackData?.rounds ?? 0)
                      }}
                    >
                      到底
                    </button>
                  </div>
                </div>

                <input
                  type="range"
                  className="scrub"
                  aria-label="回放进度"
                  min={0}
                  max={playbackData?.rounds ?? 1}
                  step={1}
                  value={safeCursor}
                  onChange={(e) => {
                    setPlaying(false)
                    setCursor(Number(e.target.value))
                  }}
                  onMouseUp={hideTip}
                />

                <div className="playback-host">
                  {playbackData && (
                    <Playback
                      data={playbackData}
                      strategies={rrStrategies}
                      order={playbackOrder}
                      cursor={safeCursor}
                      onCursor={setCursor}
                    />
                  )}
                </div>
              </Section>

              {/* 文献对照 */}
              <Section
                id="sec-literature"
                num="06"
                title="与 1980 年的原始结果对照"
                note={
                  <>
                    当年 14 份投稿 + 1 个随机基准的平均得分。原始程序大多从未公开完整源码，
                    所以本实验用行为上等价的策略去逼近，而不是逐字节重刻。
                  </>
                }
              >
                <Literature result={result} ids={ids} />
              </Section>
            </>
          )}

          {/* 策略档案：即使没跑起来也能看 */}
          <Section
            id="sec-dossier"
            num="07"
            title="策略档案"
            note={
              <>
                下面每张卡片的五条横杠都<b>不是照抄文献标签，而是把这个策略放进各种处境里量出来的</b>：
                让它分别对上「永远合作、永远背叛、一报还一报、随机、乔斯、交替者」，
                再统计它在四种局面下的出手倾向。前四条名字沿用阿克塞尔罗得总结的性质，
                第五条「破局」是本实验补充的 —— 它正是噪音环境下能否从互相背叛里爬出来的关键。
                悬停任意横杠可以看到它的定义。
              </>
            }
          >
            <Dossier
              profileOf={profileOf}
              twins={twins}
              inPlayIds={ids}
              activeId={flashId}
            />
          </Section>

          <footer className="colophon">
            <div className="colophon__rule" />
            <p>
              <b>来源</b>　Axelrod, R. (1980) <i>Effective Choice in the Prisoner&apos;s Dilemma</i>,{' '}
              <i>Journal of Conflict Resolution</i> 24(1): 3–25；Axelrod, R. (1984){' '}
              <i>The Evolution of Cooperation</i>, Basic Books.
            </p>
            <p className="colophon__dim">
              收益矩阵符号：T 诱惑 · R 奖赏 · P 惩罚 · S 受骗。囚徒困境要求 T &gt; R &gt; P &gt; S 且
              2R &gt; T + S。
            </p>
          </footer>
        </div>
      </main>
    </>
  )
}
