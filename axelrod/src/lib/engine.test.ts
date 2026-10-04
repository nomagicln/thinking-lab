/**
 * engine.test.ts — 科学正确性自检
 *
 * 每一条断言都对应一个可查证的博弈论结论，而不是「跑起来没报错」。
 * 运行：npm test
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MATRIX,
  TRAIT_AXES,
  createRng,
  deriveSeed,
  ecology,
  measureTraits,
  payoff,
  playMatch,
  playRoundRobin,
  runTournament,
  validateMatrix,
  type PayoffMatrix,
  type TraitProfile
} from './engine'
import { BY_ID, ROSTER_PRESETS, STRATEGIES, byIds } from './strategies'

const M = DEFAULT_MATRIX
const DEFAULT_ROSTER = ROSTER_PRESETS[0]

const idx = (roster: { id: string }[], id: string) => roster.findIndex((s) => s.id === id)

const PROBES = ['allc', 'alld', 'tft', 'random', 'joss', 'alternator'].map((id) => BY_ID[id])
const traitsOf = (id: string): TraitProfile =>
  measureTraits(BY_ID[id], PROBES, { matrix: M, rounds: 200, reps: 3, seedBase: 'trait-probe' })

/* ================================================================== */

describe('1 · 收益矩阵与单轮结算', () => {
  it('Axelrod 默认矩阵满足囚徒困境四条件', () => {
    expect(validateMatrix(M).valid).toBe(true)
  })

  it('双方合作 = (3,3)', () => expect(payoff('C', 'C', M)).toEqual([3, 3]))
  it('我背叛对方合作 = (5,0)', () => expect(payoff('D', 'C', M)).toEqual([5, 0]))
  it('双方背叛 = (1,1)', () => expect(payoff('D', 'D', M)).toEqual([1, 1]))
  it('我被出卖 = (0,5)', () => expect(payoff('C', 'D', M)).toEqual([0, 5]))

  it('整体理性：2R > T + S', () => expect(2 * M.R).toBeGreaterThan(M.T + M.S))
  it('个体理性：T + S > 2P', () => expect(M.T + M.S).toBeGreaterThan(2 * M.P))

  it('非法矩阵（T < R）被拒绝', () => {
    expect(validateMatrix({ T: 2, R: 3, P: 1, S: 0 }).valid).toBe(false)
  })
  it('非法矩阵（2R < T+S）被拒绝', () => {
    expect(validateMatrix({ T: 9, R: 3, P: 1, S: 0 }).valid).toBe(false)
  })
})

describe('2 · 可复现性与随机数', () => {
  const m1 = playMatch(BY_ID.joss, BY_ID.tft, { rounds: 200, matrix: M, seedBase: 'fixed' })
  const m2 = playMatch(BY_ID.joss, BY_ID.tft, { rounds: 200, matrix: M, seedBase: 'fixed' })
  const m3 = playMatch(BY_ID.joss, BY_ID.tft, { rounds: 200, matrix: M, seedBase: 'other' })

  it('同一 seed 结果逐位一致', () => {
    expect(m1.totalA).toBe(m2.totalA)
    expect(m1.totalB).toBe(m2.totalB)
  })

  it('不同 seed 结果不同', () => expect(m1.totalA).not.toBe(m3.totalA))

  it('随机数大致均匀', () => {
    const rng = createRng('uniformity')
    let hits = 0
    const N = 100000
    for (let i = 0; i < N; i++) if (rng() < 0.5) hits++
    expect(Math.abs(hits / N - 0.5)).toBeLessThan(0.01)
  })

  it('随机数落在 [0,1)', () => {
    const rng = createRng('range')
    for (let i = 0; i < 10000; i++) {
      const x = rng()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('3 · 无噪音时的解析可验证对局', () => {
  it('TFT 对 TFT 全程合作，各得 600 分', () => {
    const r = playMatch(BY_ID.tft, BY_ID.tft, { rounds: 200, matrix: M, seedBase: 'self' })
    expect(r.totalA).toBe(600)
    expect(r.coopRateA).toBe(1)
  })

  it('TFT 对 ALLD = 199 分（0 + 199×1）', () => {
    const r = playMatch(BY_ID.tft, BY_ID.alld, { rounds: 200, matrix: M, seedBase: 'k' })
    // 首轮合作被出卖得 S=0，之后 199 轮互相背叛各得 P=1
    expect(r.totalA).toBe(199)
    expect(r.totalB).toBe(204)
    expect(r.totalB).toBeGreaterThan(r.totalA)
  })

  it('ALLC 对 ALLD = 0 分（被榨干）', () => {
    const r = playMatch(BY_ID.allc, BY_ID.alld, { rounds: 200, matrix: M, seedBase: 'k' })
    expect(r.totalA).toBe(0)
    expect(r.totalB).toBe(1000)
  })

  it('冷酷触发对 ALLD：首轮后永久互相背叛 = 199 分', () => {
    const r = playMatch(BY_ID.grim, BY_ID.alld, { rounds: 200, matrix: M, seedBase: 'k' })
    expect(r.totalA).toBe(199)
  })

  it('冷酷触发能锁死交替者', () => {
    const r = playMatch(BY_ID.alternator, BY_ID.grim, { rounds: 200, matrix: M, seedBase: 'k' })
    expect(r.totalA).toBe(107)
  })

  it('但交替者能从永远合作身上榨出 800 分', () => {
    const r = playMatch(BY_ID.alternator, BY_ID.allc, { rounds: 200, matrix: M, seedBase: 'k' })
    expect(r.totalA).toBe(800)
  })
})

describe('3.5 · 多人同步回放内核', () => {
  const RR = playRoundRobin([BY_ID.tft, BY_ID.joss], { rounds: 200, matrix: M, seedBase: 'rr' })
  const PM = playMatch(BY_ID.tft, BY_ID.joss, {
    rounds: 200,
    matrix: M,
    seedBase: deriveSeed('rr', 'tft', 'joss', 0),
    tag: 'pair'
  })

  it('K=2 时与 playMatch 逐位一致（种子派生已对齐）', () => {
    expect(RR.totals[0]).toBe(PM.totalA)
    expect(RR.totals[1]).toBe(PM.totalB)
  })

  it('K=2 时每一轮的出手也完全一致', () => {
    for (let t = 0; t < 200; t++) {
      expect(RR.move[0][1]?.[t]).toBe(PM.trace[t].a)
      expect(RR.move[1][0]?.[t]).toBe(PM.trace[t].b)
    }
  })

  const R4 = playRoundRobin([BY_ID.tft, BY_ID.alld, BY_ID.allc, BY_ID.grim], {
    rounds: 50,
    matrix: M,
    seedBase: 'rr4'
  })

  it('K 位参与者时每人每轮与 K−1 位对手过招', () => expect(R4.oppCount).toBe(3))

  it('coopFrac 与 move 互相吻合', () => {
    for (let t = 0; t < R4.rounds; t++) {
      for (let i = 0; i < 4; i++) {
        let c = 0
        for (let j = 0; j < 4; j++) if (i !== j && R4.move[i][j]?.[t] === 'C') c++
        expect(R4.coopFrac[t][i]).toBeCloseTo(c / 3, 12)
      }
    }
  })

  it('累计分单调不减，且等于每轮收益之和', () => {
    for (let i = 0; i < 4; i++) {
      let acc = 0
      for (let t = 0; t < R4.rounds; t++) {
        acc += R4.roundScore[t][i]
        expect(R4.cum[t][i]).toBe(acc)
        if (t > 0) expect(R4.cum[t][i]).toBeGreaterThanOrEqual(R4.cum[t - 1][i])
      }
      expect(R4.totals[i]).toBe(acc)
    }
  })

  it('双人回放得分 = 锦标赛矩阵中对应的那一格', () => {
    const roster = byIds(DEFAULT_ROSTER.ids)
    const T = runTournament(roster, {
      rounds: 200,
      repetitions: 1,
      noise: 0,
      matrix: M,
      seedBase: 'align'
    })
    const rr = playRoundRobin([BY_ID.tft, BY_ID.grim], { rounds: 200, matrix: M, seedBase: 'align' })
    expect(rr.totals[0]).toBe(T.matrix[idx(roster, 'tft')][idx(roster, 'grim')])
  })
})

/* ================================================================== */

const roster = byIds(DEFAULT_ROSTER.ids)
const T = runTournament(roster, {
  rounds: 200,
  repetitions: 5,
  noise: 0,
  matrix: M,
  seedBase: 'axelrod-1980'
})
const tftTotal = T.totals[idx(roster, 'tft')]

describe('4 · 复现 Axelrod 1980 首届锦标赛', () => {
  it('一报还一报夺冠', () => {
    expect(T.ranking[0].id).toBe('tft')
  })

  it('TFT 得分与文献值 504.5 相差在 5% 以内', () => {
    expect(Math.abs(tftTotal - 504.5) / 504.5).toBeLessThan(0.05)
  })

  it('永远背叛排名垫底三名之内', () => {
    const rank = T.ranking.findIndex((r) => r.id === 'alld')
    expect(rank).toBeGreaterThanOrEqual(roster.length - 3)
  })

  it('TFT 得分高于 ALLD', () => {
    expect(tftTotal).toBeGreaterThan(T.totals[idx(roster, 'alld')])
  })

  it('冠军与最后一名的差距不超过 40%', () => {
    const gap = T.ranking[0].score - T.ranking[roster.length - 1].score
    expect(gap / T.ranking[0].score).toBeLessThan(0.4)
  })

  it('友善策略的平均分高于非友善策略（阿克塞尔罗德的核心发现）', () => {
    const nice: number[] = []
    const nasty: number[] = []
    roster.forEach((s, i) => {
      ;(traitsOf(s.id).nice >= 0.9 ? nice : nasty).push(T.totals[i])
    })
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    expect(avg(nice)).toBeGreaterThan(avg(nasty))
  })

  it('排名前 3 中有不少于 2 个友善策略', () => {
    const count = T.ranking.slice(0, 3).filter((r) => traitsOf(r.id).nice >= 0.9).length
    expect(count).toBeGreaterThanOrEqual(2)
  })

  it('冷酷触发（= 文献 Friedman）明显高于永远背叛', () => {
    expect(T.totals[idx(roster, 'grim')]).toBeGreaterThan(T.totals[idx(roster, 'alld')] + 50)
  })

  it('试探者能在一只羊身上榨出 994 分，对 TFT 却只有 599 分', () => {
    const farm = playMatch(BY_ID.prober, BY_ID.allc, { rounds: 200, matrix: M, seedBase: 'k' })
    const deter = playMatch(BY_ID.prober, BY_ID.tft, { rounds: 200, matrix: M, seedBase: 'k' })
    expect(farm.totalA).toBe(994)
    expect(deter.totalA).toBe(599)
    // 这正是「友善必须配上可报复」的机制
    expect(farm.totalA - deter.totalA).toBeGreaterThan(350)
  })
})

/* ================================================================== */

describe('4.5 · 行为特质测量（不是照抄文献标签）', () => {
  it('TFT 友善 / 报复 / 宽容 均为满分', () => {
    const t = traitsOf('tft')
    expect(t.nice).toBe(1)
    expect(t.retaliate).toBe(1)
    expect(t.forgive).toBe(1)
  })

  it('TFT 破局为 0：它从不先打破互相背叛的死循环', () => {
    expect(traitsOf('tft').reconcile).toBe(0)
  })

  it('TFT 可预测为满分：出手完全由对方上一轮决定', () => {
    expect(traitsOf('tft').clarity).toBe(1)
  })

  // 这正是用户报的问题：一报还一报与坚定而公平不能长得一样
  it('坚定而公平与一报还一报在「破局」上明显不同', () => {
    const fbf = traitsOf('fbf').reconcile
    expect(fbf).toBeGreaterThan(0.25)
    expect(fbf).toBeLessThan(0.42)
  })

  it('两者的「报复」强度也不同（FBF 双背叛时只有 1/3 还手）', () => {
    expect(traitsOf('fbf').retaliate).toBeLessThan(traitsOf('tft').retaliate - 0.05)
  })

  it('永远合作：报复 0%，破局按「从不记仇」补为 100%', () => {
    const t = traitsOf('allc')
    expect(t.retaliate).toBe(0)
    expect(t.reconcile).toBe(1)
  })

  it('永远合作从未进入「我背叛过」的局面，缺失状态被记录', () => {
    expect(traitsOf('allc').undefinedStates).toContain('DC')
  })

  it('永远背叛：友善 0%，宽容 0%', () => {
    const t = traitsOf('alld')
    expect(t.nice).toBe(0)
    expect(t.forgive).toBe(0)
  })

  it('冷酷触发：超强报复(100%)、零宽容(0%)、零破局(0%)', () => {
    const t = traitsOf('grim')
    expect(t.retaliate).toBe(1)
    expect(t.forgive).toBe(0)
    expect(t.reconcile).toBe(0)
  })

  it('巴甫洛夫：破局 100%（输则变招，主动跳出双背叛）', () => {
    expect(traitsOf('pavlov').reconcile).toBe(1)
  })

  it('宽容型 TFT：破局约 1/3', () => {
    expect(traitsOf('gtft').reconcile).toBeCloseTo(1 / 3, 1)
  })

  it('随机：四个指标都落在 0.5 附近', () => {
    const t = traitsOf('random')
    for (const k of ['retaliate', 'forgive', 'reconcile', 'clarity'] as const) {
      expect(Math.abs(t[k] - 0.5)).toBeLessThan(0.12)
    }
  })

  it('TF2T 的报复显著低于 TFT（连背叛两次才还手）', () => {
    const v = traitsOf('tf2t').retaliate
    expect(v).toBeGreaterThan(0.4)
    expect(v).toBeLessThan(0.75)
  })

  // 「不同策略却写着一样的特质」那个 bug 的回归测试
  it('17 位策略至少产出 14 种互不相同的特质组合', () => {
    const sigs = new Set(
      STRATEGIES.map((st) => {
        const p = traitsOf(st.id)
        return TRAIT_AXES.map((ax) => Math.round(p[ax.key] * 10)).join('-')
      })
    )
    expect(sigs.size).toBeGreaterThanOrEqual(14)
  })

  it('唯一的重复必须是「无噪音下行为确实等价」的那一对', () => {
    const groups: Record<string, string[]> = {}
    for (const st of STRATEGIES) {
      const p = traitsOf(st.id)
      const key = TRAIT_AXES.map((ax) => Math.round(p[ax.key] * 10)).join('-')
      ;(groups[key] ||= []).push(st.id)
    }
    const dups = Object.values(groups).filter((g) => g.length > 1)
    expect(dups).toHaveLength(1)
    expect(dups[0].slice().sort().join(',')).toBe('ctft,tft')
  })
})

/* ================================================================== */

describe('5 · 噪音环境：TFT 的「回声效应」', () => {
  const noiseSelf = (id: string) =>
    playMatch(BY_ID[id], BY_ID[id], { rounds: 200, matrix: M, seedBase: 'noisy', noise: 0.1 }).totalA

  const tft = noiseSelf('tft')

  it('TFT 自博弈在 10% 噪音下大幅崩坏（干净时 600）', () => {
    expect(tft).toBeLessThan(520)
    expect(tft).toBeGreaterThan(400)
  })

  it('悔过型 TFT 明显优于原始 TFT', () => expect(noiseSelf('ctft')).toBeGreaterThan(tft + 25))
  it('巴甫洛夫在噪音下稳健', () => expect(noiseSelf('pavlov')).toBeGreaterThan(tft + 25))
  it('宽容型 TFT 在噪音下最占优', () => expect(noiseSelf('gtft')).toBeGreaterThan(tft + 50))
  it('冷酷触发在噪音下近乎灾难', () => expect(noiseSelf('grim')).toBeLessThan(350))

  const noisyRoster = byIds(ROSTER_PRESETS[1].ids)
  const TN = runTournament(noisyRoster, {
    rounds: 200,
    repetitions: 20,
    noise: 0.1,
    matrix: M,
    seedBase: 'noise-tournament'
  })

  it('噪音环境下 TFT 不再夺冠', () => expect(TN.ranking[0].id).not.toBe('tft'))

  it('噪音把顶端差距抹平（前两名相差 < 2%）', () => {
    const gap = (TN.ranking[0].score - TN.ranking[1].score) / TN.ranking[0].score
    expect(gap).toBeLessThan(0.02)
  })

  it('TFT 在噪音锦标赛中的得分明显低于无噪音时', () => {
    expect(TN.totals[idx(noisyRoster, 'tft')]).toBeLessThan(tftTotal)
  })
})

/* ================================================================== */

describe('6 · 生态演化（复制者动力学）', () => {
  const ecoRoster = byIds(ROSTER_PRESETS[4].ids)
  const TE = runTournament(ecoRoster, {
    rounds: 200,
    repetitions: 3,
    noise: 0,
    matrix: M,
    seedBase: 'eco',
    includeSelf: true
  })
  const hist = ecology(TE.fullMatrix, { generations: 150 })
  const final = hist[hist.length - 1]
  const share = (id: string) => final[idx(ecoRoster, id)]

  it('种群份额之和恒为 1', () => {
    expect(final.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
  })

  it('份额始终非负', () => {
    expect(hist.every((row) => row.every((v) => v >= 0))).toBe(true)
  })

  it('友善且可报复的策略占据多数', () => {
    expect(share('tft') + share('grim') + share('pavlov')).toBeGreaterThan(0.5)
  })

  it('ALLD 在生态中被淘汰', () => expect(share('alld')).toBeLessThan(0.005))
  it('JOSS 与 RANDOM 同样被淘汰', () => {
    expect(share('joss')).toBeLessThan(0.005)
    expect(share('random')).toBeLessThan(0.005)
  })

  it('ALLD 份额单调衰退', () => {
    const series = hist.map((row) => row[idx(ecoRoster, 'alld')])
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeLessThanOrEqual(series[i - 1] + 1e-12)
    }
  })

  it('TFT/ALLD 双种群：TFT 最终占满整个种群', () => {
    const duo = byIds(['tft', 'alld'])
    const TD = runTournament(duo, {
      rounds: 200,
      repetitions: 3,
      noise: 0,
      matrix: M,
      seedBase: 'duo',
      includeSelf: true
    })
    const duoFinal = ecology(TD.fullMatrix, { generations: 200 }).at(-1)!
    expect(duoFinal[0]).toBeGreaterThan(0.999)
  })
})

/* ================================================================== */

describe('7 · 未来阴影（几何延续概率 w）', () => {
  const geo9 = playMatch(BY_ID.tft, BY_ID.tft, {
    rounds: 200,
    matrix: M,
    seedBase: 'geo',
    tag: 'w',
    discount: 0.9
  })
  const geo3 = playMatch(BY_ID.tft, BY_ID.tft, {
    rounds: 200,
    matrix: M,
    seedBase: 'geo',
    tag: 'w',
    discount: 0.3
  })

  it('w=0.9 时期望轮数落在 1/(1-w)=10 附近', () => {
    expect(geo9.length).toBeGreaterThan(3)
    expect(geo9.length).toBeLessThan(40)
  })

  it('w 越小对局越短', () => expect(geo3.length).toBeLessThan(geo9.length))
})

/* ================================================================== */

describe('8 · 参数调整的敏感性', () => {
  it('把诱惑 T 从 5 提到 10 后，纯背叛者名次上升', () => {
    const harsh = runTournament(roster, {
      rounds: 200,
      repetitions: 3,
      noise: 0,
      matrix: { T: 10, R: 3, P: 1, S: 0 } as PayoffMatrix,
      seedBase: 'harsh'
    })
    const before = T.ranking.findIndex((r) => r.id === 'alld')
    const after = harsh.ranking.findIndex((r) => r.id === 'alld')
    expect(after).toBeLessThan(before)
  })

  it('轮数压到 5 轮后，长期声誉机制失效', () => {
    const short = runTournament(roster, {
      rounds: 5,
      repetitions: 5,
      noise: 0,
      matrix: M,
      seedBase: 'short'
    })
    expect(short.ranking[0].id === 'tft' && short.totals[idx(roster, 'tft')] >= tftTotal).toBe(false)
  })

  it('换一个 seed 冠军依然是 TFT（结论稳健）', () => {
    const clone = runTournament(roster, {
      rounds: 200,
      repetitions: 3,
      noise: 0,
      matrix: M,
      seedBase: 'copy'
    })
    expect(clone.ranking[0].id).toBe('tft')
  })
})
