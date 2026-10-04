/**
 * engine.ts — 阿克塞尔罗德重复囚徒困境实验内核
 * ---------------------------------------------------------------------------
 * 纯计算模块，不依赖 React 或任何浏览器 API，可以在 Node 里直接跑测试。
 *
 * 记号沿用 Axelrod (1980) "Effective Choice in the Prisoner's Dilemma"：
 *   T = Temptation  诱惑（我背叛、对方合作）
 *   R = Reward      奖赏（双方合作）
 *   P = Punishment  惩罚（双方背叛）
 *   S = Sucker      受骗（我合作、对方背叛）
 * 囚徒困境要求：T > R > P > S 且 2R > T + S
 */

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

export type Move = 'C' | 'D'

export interface PayoffMatrix {
  T: number
  R: number
  P: number
  S: number
}

/** 策略在一场对局里能看到的东西。state 是它的私有便笺（每场一份）。 */
export interface History {
  my: Move[]
  opp: Move[]
  myScores: number[]
  oppScores: number[]
  state: Record<string, unknown>
}

export interface MoveContext {
  round: number
  rng: () => number
  matrix: PayoffMatrix
  lastMyScore: number | null
  lastOppScore: number | null
}

export interface Strategy {
  id: string
  name: string
  nameEn: string
  short: string
  origin: string
  philosophy: string
  move(h: History, ctx: MoveContext): Move
}

export interface MatrixCheck {
  key: string
  ok: boolean
  text: string
}

export interface MatrixValidation {
  checks: MatrixCheck[]
  valid: boolean
}

export interface RoundTrace {
  round: number
  a: Move
  b: Move
  pa: number
  pb: number
  cumA: number
  cumB: number
}

export interface MatchResult {
  length: number
  trace: RoundTrace[]
  totalA: number
  totalB: number
  avgA: number
  avgB: number
  coopRateA: number
  coopRateB: number
  mutualCoopRate: number
  capped: boolean
}

export interface MatchOptions {
  rounds?: number
  matrix?: PayoffMatrix
  /** 误操作概率（颤抖的手），对双方各自独立生效 */
  noise?: number
  /** 几何延续概率 w ∈ (0,1)：每轮以 w 继续，期望轮数 1/(1-w) */
  discount?: number | null
  maxRounds?: number | null
  seedBase?: string | number
  tag?: string
}

export interface TournamentOptions {
  rounds?: number
  repetitions?: number
  noise?: number
  discount?: number | null
  maxRounds?: number | null
  seedBase?: string | number
  includeSelf?: boolean
  matrix?: PayoffMatrix
}

export interface RankingRow {
  index: number
  id: string
  name: string
  score: number
  rank: number
}

export interface PairDetail {
  i: number
  j: number
  scoreI: number
  scoreJ: number
  coopI: number
  coopJ: number
  avgLength: number
  reps: number
}

export interface TournamentResult {
  n: number
  ids: string[]
  names: string[]
  /** matrix[i][j] = i 面对 j 的每场平均总分（可与文献值直接对照） */
  matrix: number[][]
  /** 每轮平均收益，供生态演化使用 */
  perRoundMatrix: number[][]
  coopMatrix: number[][]
  /** 含对角线的完整矩阵（对角线来自自博弈） */
  fullMatrix: number[][]
  selfScore: number[]
  selfPerRound: number[]
  avgLengths: number[][]
  totals: number[]
  ranking: RankingRow[]
  details: Record<string, PairDetail>
  /** convergence[i][r] = 第 r 轮结束时 i 的累计总分（跨对手平均） */
  convergence: (number | null)[][]
  rounds: number
  reps: number
}

export interface RoundRobinResult {
  K: number
  rounds: number
  ids: string[]
  /** move[i][j][t] = 第 t 轮 i 对 j 的实际出手；对角线 move[i][i] 为 null */
  move: (Move[] | null)[][]
  roundScore: number[][]
  cum: number[][]
  /** coopFrac[t][i] = i 在第 t 轮对多少比例的对手选择了合作 */
  coopFrac: number[][]
  totals: number[]
  oppCount: number
}

export interface TraitProfile {
  /** 从不先背叛：整场里没在对方背叛之前先出手 */
  nice: number
  firstCoop: number
  retaliate: number
  forgive: number
  reconcile: number
  clarity: number
  samples: number
  undefinedStates: string[]
}

export interface TraitAxis {
  key: keyof Pick<TraitProfile, 'nice' | 'retaliate' | 'forgive' | 'reconcile' | 'clarity'>
  label: string
  hint: string
}

export interface EcologyOptions {
  generations?: number
  mutation?: number
  dt?: number
}

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

export const DEFAULT_MATRIX: PayoffMatrix = { T: 5, R: 3, P: 1, S: 0 }

export interface MatrixPreset {
  id: string
  name: string
  matrix: PayoffMatrix
  note: string
}

export const MATRIX_PRESETS: MatrixPreset[] = [
  {
    id: 'axelrod',
    name: 'Axelrod 1980',
    matrix: { T: 5, R: 3, P: 1, S: 0 },
    note: '原始锦标赛所用收益，文献标准配置'
  },
  {
    id: 'nowak',
    name: 'Nowak & Sigmund 1993',
    matrix: { T: 5, R: 3, P: 1, S: 0 },
    note: '研究宽容型一报还一报时的经典配置'
  },
  {
    id: 'classic',
    name: '教科书负受骗',
    matrix: { T: 4, R: 3, P: 1, S: -1 },
    note: '受骗得负分，合作风险更高'
  },
  {
    id: 'mild',
    name: '温和诱惑',
    matrix: { T: 4, R: 3, P: 1, S: 0 },
    note: '背叛的诱惑很小，合作更易自发出现'
  },
  {
    id: 'harsh',
    name: '强烈诱惑',
    matrix: { T: 10, R: 3, P: 1, S: 0 },
    note: '背叛收益极高，考验策略的稳健性'
  },
  {
    id: 'zerosum',
    name: '零和边缘',
    matrix: { T: 5, R: 2, P: 1, S: 0 },
    note: '2R = T + S，恰好落在困境边界上'
  }
]

/**
 * 展示用的五个轴。前四个名字沿用阿克塞尔罗德总结的性质
 * （友善 / 报复 / 宽容 / 清晰→可预测），第五个「破局」是本实验补充的：
 * 它衡量「双方都背叛之后，谁愿意先递橄榄枝」，正是噪音环境下能否
 * 从互相背叛里爬出来的关键，也是一报还一报与坚定而公平的分水岭。
 */
export const TRAIT_AXES: TraitAxis[] = [
  { key: 'nice', label: '友善', hint: '从不先背叛：整场里没在对方背叛之前先出手' },
  { key: 'retaliate', label: '报复', hint: '对方上一轮背叛时，我也出手背叛的频率' },
  { key: 'forgive', label: '宽容', hint: '对方重新示好时，我愿意恢复合作的频率' },
  { key: 'reconcile', label: '破局', hint: '双方都背叛之后，我主动先示好的频率' },
  { key: 'clarity', label: '可预测', hint: '行为有多好懂：最优「只记一轮」预测器的命中率' }
]

/* ------------------------------------------------------------------ *
 * 随机数：可复现（同一 seed 必得同一结果）
 * ------------------------------------------------------------------ */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedOf(seed: string | number): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0
  return xmur3(String(seed))() >>> 0
}

export function createRng(seed: string | number): () => number {
  return mulberry32(seedOf(seed))
}

/** 由若干片段拼出一个稳定的整数种子 */
export function deriveSeed(base: string | number, a: string, b: string, rep: number): number {
  return seedOf(`${base}|${a}|${b}|${rep}`)
}

/* ------------------------------------------------------------------ *
 * 收益矩阵
 * ------------------------------------------------------------------ */

/** 校验囚徒困境约束，返回逐条结论 */
export function validateMatrix(m: PayoffMatrix): MatrixValidation {
  const checks: MatrixCheck[] = [
    { key: 'T>R', ok: m.T > m.R, text: 'T > R：背叛诱惑高于双方合作' },
    { key: 'R>P', ok: m.R > m.P, text: 'R > P：互相合作优于互相背叛' },
    { key: 'P>S', ok: m.P > m.S, text: 'P > S：互相背叛优于被对方出卖' },
    { key: '2R>T+S', ok: 2 * m.R > m.T + m.S, text: '2R > T + S：轮流背叛不如稳定合作' }
  ]
  return { checks, valid: checks.every((c) => c.ok) }
}

/** 单轮收益：[出手方得分, 对手得分] */
export function payoff(a: Move, b: Move, m: PayoffMatrix): [number, number] {
  if (a === 'C' && b === 'C') return [m.R, m.R]
  if (a === 'C' && b === 'D') return [m.S, m.T]
  if (a === 'D' && b === 'C') return [m.T, m.S]
  return [m.P, m.P]
}

function flip(move: Move): Move {
  return move === 'C' ? 'D' : 'C'
}

export function blankHistory(): History {
  // state 是策略的私有便笺（每场对局、每位选手各一份），
  // 让有记忆深度的策略不必依赖全局变量。
  return { my: [], opp: [], myScores: [], oppScores: [], state: {} }
}

/* ------------------------------------------------------------------ *
 * 单场对局
 * ------------------------------------------------------------------ */

export function playMatch(sa: Strategy, sb: Strategy, opts: MatchOptions = {}): MatchResult {
  const m = opts.matrix ?? DEFAULT_MATRIX
  const noise = opts.noise ?? 0
  const w = opts.discount
  const geometric = typeof w === 'number' && w > 0 && w < 1
  const rounds = Math.max(1, Math.round(opts.rounds ?? 200))
  const maxRounds = geometric
    ? Math.min(opts.maxRounds ?? 4000, Math.max(rounds * 6, 400))
    : rounds
  const tag = opts.tag ?? 'match'
  const seedBase = opts.seedBase ?? 'match'

  const rngA = createRng(deriveSeed(seedBase, tag, 'A', 0))
  const rngB = createRng(deriveSeed(seedBase, tag, 'B', 1))
  const noiseA = createRng(deriveSeed(seedBase, tag, 'nA', 2))
  const noiseB = createRng(deriveSeed(seedBase, tag, 'nB', 3))
  const rngLen = createRng(deriveSeed(seedBase, tag, 'len', 4))

  const hA = blankHistory()
  const hB = blankHistory()
  const trace: RoundTrace[] = []
  let cumA = 0
  let cumB = 0
  let coopA = 0
  let coopB = 0
  let mutualCoop = 0

  for (let r = 0; r < maxRounds; r++) {
    const ctxA: MoveContext = {
      round: r,
      rng: rngA,
      matrix: m,
      lastMyScore: r > 0 ? hA.myScores[r - 1] : null,
      lastOppScore: r > 0 ? hA.oppScores[r - 1] : null
    }
    const ctxB: MoveContext = {
      round: r,
      rng: rngB,
      matrix: m,
      lastMyScore: r > 0 ? hB.myScores[r - 1] : null,
      lastOppScore: r > 0 ? hB.oppScores[r - 1] : null
    }

    // 1) 双方同时决策（只能看到上一轮为止的历史）
    let a: Move = sa.move(hA, ctxA) === 'D' ? 'D' : 'C'
    let b: Move = sb.move(hB, ctxB) === 'D' ? 'D' : 'C'

    // 2) 颤抖的手
    if (noise > 0) {
      if (noiseA() < noise) a = flip(a)
      if (noiseB() < noise) b = flip(b)
    }

    // 3) 结算
    const pay = payoff(a, b, m)
    cumA += pay[0]
    cumB += pay[1]
    if (a === 'C') coopA++
    if (b === 'C') coopB++
    if (a === 'C' && b === 'C') mutualCoop++

    // 4) 归档历史（策略看到的是「实际发生」的动作，含误操作）
    hA.my.push(a)
    hA.opp.push(b)
    hA.myScores.push(pay[0])
    hA.oppScores.push(pay[1])
    hB.my.push(b)
    hB.opp.push(a)
    hB.myScores.push(pay[1])
    hB.oppScores.push(pay[0])

    trace.push({ round: r, a, b, pa: pay[0], pb: pay[1], cumA, cumB })

    // 5) 未来阴影：本轮打完后掷骰子决定是否继续
    if (geometric && rngLen() >= (w as number)) break
  }

  const len = trace.length
  return {
    length: len,
    trace,
    totalA: cumA,
    totalB: cumB,
    avgA: cumA / len,
    avgB: cumB / len,
    coopRateA: coopA / len,
    coopRateB: coopB / len,
    mutualCoopRate: mutualCoop / len,
    capped: geometric && len >= maxRounds
  }
}

/* ------------------------------------------------------------------ *
 * 同步循环赛（多人逐轮回放）
 * ------------------------------------------------------------------ */

/**
 * 和 playMatch 的唯一区别是「时间对齐」：所有对手在同一轮里同时出手，
 * 因此可以逐轮推进整个小组，看每个人在每一轮对全体对手做了什么。
 */
export function playRoundRobin(
  strategies: Strategy[],
  opts: { rounds?: number; noise?: number; matrix?: PayoffMatrix; seedBase?: string | number } = {}
): RoundRobinResult {
  const m = opts.matrix ?? DEFAULT_MATRIX
  const K = strategies.length
  const T = Math.max(1, Math.round(opts.rounds ?? 200))
  const noise = opts.noise ?? 0
  const seedBase = opts.seedBase ?? 'roundrobin'

  // 每一对选手各自保留历史与随机流。
  // 种子派生刻意与 runTournament 逐字对齐：这样「只选两个人」时，
  // 回放出来的就是锦标赛里那一对的第一次交手，数字完全对得上。
  interface Pair {
    i: number
    j: number
    hA: History
    hB: History
    rngA: () => number
    rngB: () => number
    nA: () => number
    nB: () => number
  }

  const pairs: Pair[] = []
  for (let i = 0; i < K; i++) {
    for (let j = i + 1; j < K; j++) {
      const seed = deriveSeed(seedBase, strategies[i].id, strategies[j].id, 0)
      pairs.push({
        i,
        j,
        hA: blankHistory(),
        hB: blankHistory(),
        rngA: createRng(deriveSeed(seed, 'pair', 'A', 0)),
        rngB: createRng(deriveSeed(seed, 'pair', 'B', 1)),
        nA: createRng(deriveSeed(seed, 'pair', 'nA', 2)),
        nB: createRng(deriveSeed(seed, 'pair', 'nB', 3))
      })
    }
  }

  const move: (Move[] | null)[][] = []
  for (let a = 0; a < K; a++) {
    const row: (Move[] | null)[] = []
    for (let b = 0; b < K; b++) {
      row.push(a === b ? null : Array.from({ length: T }, () => 'C' as Move))
    }
    move.push(row)
  }

  const roundScore: number[][] = new Array(T)
  const cum: number[][] = new Array(T)
  const coopFrac: number[][] = new Array(T)
  const running = new Array<number>(K).fill(0)
  const oppCount = K - 1

  for (let t = 0; t < T; t++) {
    const rs = new Array<number>(K).fill(0)
    const cc = new Array<number>(K).fill(0)

    for (const pr of pairs) {
      const ctxA: MoveContext = {
        round: t,
        rng: pr.rngA,
        matrix: m,
        lastMyScore: t > 0 ? pr.hA.myScores[t - 1] : null,
        lastOppScore: t > 0 ? pr.hA.oppScores[t - 1] : null
      }
      const ctxB: MoveContext = {
        round: t,
        rng: pr.rngB,
        matrix: m,
        lastMyScore: t > 0 ? pr.hB.myScores[t - 1] : null,
        lastOppScore: t > 0 ? pr.hB.oppScores[t - 1] : null
      }

      let mvA: Move = strategies[pr.i].move(pr.hA, ctxA) === 'D' ? 'D' : 'C'
      let mvB: Move = strategies[pr.j].move(pr.hB, ctxB) === 'D' ? 'D' : 'C'

      if (noise > 0) {
        if (pr.nA() < noise) mvA = flip(mvA)
        if (pr.nB() < noise) mvB = flip(mvB)
      }

      const pay = payoff(mvA, mvB, m)

      const rowIJ = move[pr.i][pr.j]
      const rowJI = move[pr.j][pr.i]
      if (rowIJ && rowJI) {
        rowIJ[t] = mvA
        rowJI[t] = mvB
      }

      rs[pr.i] += pay[0]
      rs[pr.j] += pay[1]
      if (mvA === 'C') cc[pr.i]++
      if (mvB === 'C') cc[pr.j]++

      pr.hA.my.push(mvA)
      pr.hA.opp.push(mvB)
      pr.hA.myScores.push(pay[0])
      pr.hA.oppScores.push(pay[1])
      pr.hB.my.push(mvB)
      pr.hB.opp.push(mvA)
      pr.hB.myScores.push(pay[1])
      pr.hB.oppScores.push(pay[0])
    }

    const cumRow = new Array<number>(K)
    const fracRow = new Array<number>(K)
    for (let k = 0; k < K; k++) {
      running[k] += rs[k]
      cumRow[k] = running[k]
      fracRow[k] = oppCount > 0 ? cc[k] / oppCount : 0
    }
    roundScore[t] = rs
    cum[t] = cumRow
    coopFrac[t] = fracRow
  }

  return {
    K,
    rounds: T,
    ids: strategies.map((s) => s.id),
    move,
    roundScore,
    cum,
    coopFrac,
    totals: running.slice(),
    oppCount
  }
}

/* ------------------------------------------------------------------ *
 * 循环赛（Axelrod 第一届锦标赛的复刻）
 * ------------------------------------------------------------------ */

function zeros(rows: number, cols: number): number[][] {
  const out: number[][] = new Array(rows)
  for (let i = 0; i < rows; i++) out[i] = new Array<number>(cols).fill(0)
  return out
}

function accumulateConvergence(
  conv: Float64Array,
  count: Int32Array,
  trace: RoundTrace[],
  side: 'A' | 'B',
  rounds: number
): void {
  for (let r = 0; r < trace.length && r < rounds; r++) {
    const t = trace[r]
    // 存的是「到第 r 轮为止的累计总分」，不是每轮均分 ——
    // 这样曲线本身就是总分，斜率就是每轮赚钱的速度。
    conv[r] += side === 'A' ? t.cumA : t.cumB
    count[r] += 1
  }
}

export function runTournament(strategies: Strategy[], opts: TournamentOptions = {}): TournamentResult {
  const m = opts.matrix ?? DEFAULT_MATRIX
  const n = strategies.length
  const reps = Math.max(1, opts.repetitions ?? 1)
  const includeSelf = opts.includeSelf ?? false
  const rounds = Math.max(1, Math.round(opts.rounds ?? 200))
  const seedBase = opts.seedBase ?? 'axelrod'
  const noise = opts.noise ?? 0

  // 平均分矩阵：score[i][j] = i 面对 j 的每场平均「总分」
  // 用总分而非每轮均分，是为了能直接和 Axelrod (1980) 公布的 504.5 等数字对照。
  const score = zeros(n, n)
  const perRound = zeros(n, n)
  const coop = zeros(n, n)
  const lengths = zeros(n, n)
  const details: Record<string, PairDetail> = {}

  const convSum: Float64Array[] = []
  const convN: Int32Array[] = []
  for (let i = 0; i < n; i++) {
    convSum.push(new Float64Array(rounds))
    convN.push(new Int32Array(rounds))
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let sumI = 0
      let sumJ = 0
      let coopI = 0
      let coopJ = 0
      let lenSum = 0

      for (let rep = 0; rep < reps; rep++) {
        const seed = deriveSeed(seedBase, strategies[i].id, strategies[j].id, rep)
        const res = playMatch(strategies[i], strategies[j], {
          rounds,
          matrix: m,
          noise,
          discount: opts.discount,
          maxRounds: opts.maxRounds,
          seedBase: seed,
          tag: 'pair'
        })
        sumI += res.totalA
        sumJ += res.totalB
        coopI += res.coopRateA
        coopJ += res.coopRateB
        lenSum += res.length

        accumulateConvergence(convSum[i], convN[i], res.trace, 'A', rounds)
        accumulateConvergence(convSum[j], convN[j], res.trace, 'B', rounds)
      }

      score[i][j] = sumI / reps
      score[j][i] = sumJ / reps
      const lenAvg = lenSum / reps
      perRound[i][j] = score[i][j] / lenAvg
      perRound[j][i] = score[j][i] / lenAvg
      coop[i][j] = coopI / reps
      coop[j][i] = coopJ / reps
      lengths[i][j] = lengths[j][i] = lenAvg
      details[`${i}-${j}`] = {
        i,
        j,
        scoreI: score[i][j],
        scoreJ: score[j][i],
        coopI: coop[i][j],
        coopJ: coop[j][i],
        avgLength: lenAvg,
        reps
      }
    }
  }

  // 自博弈：不计入排名（Axelrod 首届锦标赛不含自我对局），
  // 但生态演化需要对角线，所以照常计算。
  const selfScore = new Array<number>(n)
  const selfPerRound = new Array<number>(n)
  for (let s = 0; s < n; s++) {
    let acc = 0
    let accLen = 0
    for (let rep = 0; rep < reps; rep++) {
      const seedS = deriveSeed(seedBase, strategies[s].id, strategies[s].id, rep)
      const rs = playMatch(strategies[s], strategies[s], {
        rounds,
        matrix: m,
        noise,
        discount: opts.discount,
        maxRounds: opts.maxRounds,
        seedBase: seedS,
        tag: 'self'
      })
      acc += rs.totalA
      accLen += rs.length
      accumulateConvergence(convSum[s], convN[s], rs.trace, 'A', rounds)
    }
    selfScore[s] = acc / reps
    selfPerRound[s] = selfScore[s] / (accLen / reps)
  }

  // 汇总：每位选手的平均得分（对全部对手取平均）
  const totals = new Array<number>(n)
  for (let a = 0; a < n; a++) {
    let t = 0
    let denom = 0
    for (let b = 0; b < n; b++) {
      if (a === b) {
        if (includeSelf) {
          t += selfScore[a]
          denom++
        }
        continue
      }
      t += score[a][b]
      denom++
    }
    totals[a] = denom > 0 ? t / denom : 0
  }

  const ranking: RankingRow[] = strategies
    .map((st, idx) => ({ index: idx, id: st.id, name: st.name, score: totals[idx], rank: 0 }))
    .sort((x, y) => y.score - x.score)
  ranking.forEach((row, k) => {
    row.rank = k + 1
  })

  const convergence: (number | null)[][] = convSum.map((arr, idx) => {
    const out: (number | null)[] = new Array(rounds)
    for (let r = 0; r < rounds; r++) out[r] = convN[idx][r] > 0 ? arr[r] / convN[idx][r] : null
    return out
  })

  // 生态演化用的完整矩阵（含对角线）。用「每轮平均收益」而非总分：
  // 复制者动力学对正数缩放不变，而几何延续模式下各场长度不一，必须归一。
  const full = zeros(n, n)
  for (let p = 0; p < n; p++) {
    for (let q = 0; q < n; q++) {
      full[p][q] = p === q ? selfPerRound[p] : perRound[p][q]
    }
  }

  return {
    n,
    ids: strategies.map((s) => s.id),
    names: strategies.map((s) => s.name),
    matrix: score,
    perRoundMatrix: perRound,
    coopMatrix: coop,
    fullMatrix: full,
    selfScore,
    selfPerRound,
    avgLengths: lengths,
    totals,
    ranking,
    details,
    convergence,
    rounds,
    reps
  }
}

/* ------------------------------------------------------------------ *
 * 生态演化（Axelrod 的「生存博弈」/ 复制者动力学）
 * ------------------------------------------------------------------ */

/**
 * A[i][j] = i 面对 j 的单次平均收益。
 * x_i(t+1) = x_i(t) · f_i / f̄ ，f_i = Σ_j x_j · A[i][j]
 *
 * 若收益矩阵含负值，整体平移常数（不改变复制者动力学的结果）。
 */
export function ecology(A: number[][], opts: EcologyOptions = {}): number[][] {
  const n = A.length
  const generations = Math.max(1, Math.round(opts.generations ?? 60))
  const mutation = opts.mutation ?? 0
  const dt = opts.dt ?? 1

  let minVal = Infinity
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) if (A[i][j] < minVal) minVal = A[i][j]
  }
  const shift = minVal < 0 ? -minVal + 1 : 0

  let x = new Array<number>(n).fill(1 / n)
  const history: number[][] = [x.slice()]

  for (let g = 0; g < generations; g++) {
    const fit = new Array<number>(n)
    let mean = 0
    for (let a = 0; a < n; a++) {
      let f = 0
      for (let b = 0; b < n; b++) f += (A[a][b] + shift) * x[b]
      fit[a] = f
      mean += f * x[a]
    }

    let next = new Array<number>(n)
    for (let k = 0; k < n; k++) {
      const grown = mean > 0 ? x[k] * (fit[k] / mean) : x[k]
      next[k] = x[k] + dt * (grown - x[k])
      if (next[k] < 0) next[k] = 0
    }

    if (mutation > 0) {
      next = next.map((v) => v * (1 - mutation) + mutation / n)
    }

    const sum = next.reduce((a, b) => a + b, 0)
    if (sum <= 0) {
      next = new Array<number>(n).fill(1 / n)
    } else {
      for (let z = 0; z < n; z++) next[z] /= sum
    }

    x = next
    history.push(x.slice())
  }

  return history
}

/* ------------------------------------------------------------------ *
 * 行为特质测量
 * ------------------------------------------------------------------ */

/**
 * 把一个策略放到各种处境里，量出它的行为倾向 —— 而不是照抄文献给它的标签。
 *
 * 这样做的理由：阿克塞尔罗德那四条性质是布尔值，按字面定义
 * 一报还一报和「坚定而公平」都是四项全满，画出来一模一样。
 * 换成连续测量后，两者的差别才显形（破局倾向 0% vs 28%）。
 *
 * probes 是「提问用的对手」，要覆盖各种处境：总合作、总背叛、以牙还牙、
 * 随机、偷袭者、固定节奏。
 */
export function measureTraits(
  strategy: Strategy,
  probes: Strategy[],
  opts: { matrix?: PayoffMatrix; rounds?: number; reps?: number; seedBase?: string | number } = {}
): TraitProfile {
  const m = opts.matrix ?? DEFAULT_MATRIX
  const rounds = Math.max(10, Math.round(opts.rounds ?? 200))
  const reps = Math.max(1, opts.reps ?? 2)
  const seedBase = opts.seedBase ?? 'traits'

  let firstN = 0
  let firstC = 0
  let matchN = 0
  let dirtyN = 0
  const cond: Record<string, { C: number; D: number }> = {
    CC: { C: 0, D: 0 },
    CD: { C: 0, D: 0 },
    DC: { C: 0, D: 0 },
    DD: { C: 0, D: 0 }
  }

  probes.forEach((probe, pi) => {
    for (let r = 0; r < reps; r++) {
      const res = playMatch(strategy, probe, {
        rounds,
        matrix: m,
        seedBase: deriveSeed(seedBase, strategy.id, probe.id, pi * 97 + r),
        tag: 'trait'
      })

      let oppHasDefected = false
      let dirty = false

      res.trace.forEach((t, idx) => {
        // 「先背叛」= 在对方还没背叛过之前自己先动手
        if (t.a === 'D' && !oppHasDefected) dirty = true

        if (idx === 0) {
          firstN++
          if (t.a === 'C') firstC++
        } else {
          // 条件分布以「上一轮 (我, 对方)」为条件
          const prev = res.trace[idx - 1]
          cond[prev.a + prev.b][t.a]++
        }

        if (t.b === 'D') oppHasDefected = true
      })

      matchN++
      if (dirty) dirtyN++
    }
  })

  const retN = cond.CD.C + cond.CD.D + cond.DD.C + cond.DD.D
  const forN = cond.DC.C + cond.DC.D
  const recN = cond.DD.C + cond.DD.D
  const keys = ['CC', 'CD', 'DC', 'DD']

  let total = 0
  let clarity = 0
  keys.forEach((k) => {
    total += cond[k].C + cond[k].D
  })
  if (total > 0) {
    keys.forEach((k) => {
      const n = cond[k].C + cond[k].D
      if (!n) return
      clarity += (n / total) * (Math.max(cond[k].C, cond[k].D) / n)
    })
  }

  // 有些状态可能整场都没出现过（永远合作者从来不会「自己背叛过」）。
  // 这时指标在字面上无从测量，硬填 0 会误导 ——
  // 「从没背叛过的人」不该被评为「一点都不宽容」。
  // 所以缺失状态按「合作」补：从未记仇，就等于随时愿意合作。
  return {
    nice: matchN ? 1 - dirtyN / matchN : 0,
    firstCoop: firstN ? firstC / firstN : 0,
    retaliate: retN ? (cond.CD.D + cond.DD.D) / retN : 0,
    forgive: forN ? cond.DC.C / forN : 1,
    reconcile: recN ? cond.DD.C / recN : 1,
    clarity,
    samples: total,
    undefinedStates: keys.filter((k) => cond[k].C + cond[k].D === 0)
  }
}
