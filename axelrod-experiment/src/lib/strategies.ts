/**
 * strategies.ts — 经典策略库
 * ---------------------------------------------------------------------------
 * 每个策略实现 engine.ts 里的 Strategy 接口。move 拿到的 history 只包含
 * 「实际发生过」的动作（含颤抖的手造成的误操作），因此策略必须在不确定性
 * 下工作。需要记事的策略把状态写进 history.state。
 *
 * 注意：这里刻意不声明「特质」。特质由 engine.measureTraits 从实际对局中
 * 量出来 —— 因为阿克塞尔罗德那四条性质是布尔值，按字面定义一报还一报和
 * 坚定而公平都是四项全满，靠手写标签根本分不开。
 */

import type { History, Move, Strategy } from './engine'

const C: Move = 'C'
const D: Move = 'D'

function flip(mv: Move): Move {
  return mv === 'C' ? 'D' : 'C'
}

function countC(arr: Move[]): number {
  let n = 0
  for (let i = 0; i < arr.length; i++) if (arr[i] === 'C') n++
  return n
}

/** 策略私有状态的读写小工具（state 是 Record<string, unknown>） */
function memo(h: History): Record<string, number | string> {
  return h.state as Record<string, number | string>
}

export const STRATEGIES: Strategy[] = [
  {
    id: 'tft',
    name: '一报还一报',
    nameEn: 'Tit for Tat',
    short: 'TFT',
    origin: 'Anatol Rapoport，Axelrod 1980 年首届锦标赛冠军',
    philosophy: '首轮合作，此后原样奉还对方上一轮的动作。善良、可报复、能宽容、够清晰。',
    move(h, ctx) {
      return ctx.round === 0 ? C : h.opp[ctx.round - 1]
    }
  },
  {
    id: 'stft',
    name: '猜疑的一报还一报',
    nameEn: 'Suspicious Tit for Tat',
    short: 'STFT',
    origin: 'TFT 的变体，常见于后续实验',
    philosophy: '先下手试探一下，再照抄对方。志在避免被白占便宜，代价是常常亲手点燃报复循环。',
    move(h, ctx) {
      return ctx.round === 0 ? D : h.opp[ctx.round - 1]
    }
  },
  {
    id: 'tf2t',
    name: '两报还一报',
    nameEn: 'Tit for Two Tats',
    short: 'TF2T',
    origin: 'Axelrod 第二届锦标赛的常见思路',
    philosophy: '对方连背叛两次才还手。极度宽容，几乎不主动冲突，但会被一直背叛的人长期榨取。',
    move(h, ctx) {
      const r = ctx.round
      if (r < 2) return C
      return h.opp[r - 1] === D && h.opp[r - 2] === D ? D : C
    }
  },
  {
    id: 'allc',
    name: '永远合作',
    nameEn: 'Always Cooperate',
    short: 'ALLC',
    origin: '基准策略',
    philosophy: '无条件伸出友善之手。在没有背叛者的世界里最好，一旦遇到掠夺者就是提款机。',
    move() {
      return C
    }
  },
  {
    id: 'alld',
    name: '永远背叛',
    nameEn: 'Always Defect',
    short: 'ALLD',
    origin: '基准策略，也是「理性自利」的教科书答案',
    philosophy: '单次博弈的唯一理性解。放进重复博弈里，它会赢下每一场局部战斗，却输掉整个战争。',
    move() {
      return D
    }
  },
  {
    id: 'random',
    name: '随机',
    nameEn: 'Random',
    short: 'RAND',
    origin: 'Axelrod 加入的对照基准',
    philosophy: '五成合作五成背叛，毫无规律。既不友善也不报复，只是把不确定性泼进池子里。',
    move(_h, ctx) {
      return ctx.rng() < 0.5 ? C : D
    }
  },
  {
    id: 'grim',
    name: '冷酷触发',
    nameEn: 'Grim Trigger',
    short: 'GRIM',
    origin: 'Robert Axelrod 记作 FRIEDMAN，源自 Friedman 1971',
    philosophy: '合作到底，直到对方背叛一次——然后永远背叛。绝对可报复，绝不宽容。',
    move(h) {
      return h.opp.indexOf(D) === -1 ? C : D
    }
  },
  {
    id: 'joss',
    name: '乔斯',
    nameEn: 'Joss',
    short: 'JOSS',
    origin: 'Axelrod 1980 年首届锦标赛参赛策略',
    philosophy: '一报还一报，但有一成概率偷偷捅一刀。占小便宜的算计，最终被所有对手拉黑。',
    move(h, ctx) {
      const r = ctx.round
      if (r === 0) return C
      if (h.opp[r - 1] === D) return D
      return ctx.rng() < 0.1 ? D : C
    }
  },
  {
    id: 'pavlov',
    name: '巴甫洛夫',
    nameEn: 'Pavlov (Win-Stay, Lose-Shift)',
    short: 'PAV',
    origin: 'Nowak & Sigmund 1993',
    philosophy: '上一轮拿到好收益就照旧，拿到差收益就换招。以结果学习，在噪音环境里反而最稳。',
    move(h, ctx) {
      const r = ctx.round
      if (r === 0) return C
      // 收益落在 {R, T} 视为「赢」，保持上一手；否则「输」，改换门庭
      return (ctx.lastMyScore ?? 0) >= ctx.matrix.R ? h.my[r - 1] : flip(h.my[r - 1])
    }
  },
  {
    id: 'gtft',
    name: '宽容的一报还一报',
    nameEn: 'Generous Tit for Tat',
    short: 'GTFT',
    origin: 'Nowak & Sigmund 1993；Axelrod 第二届锦标赛的胜者家族',
    philosophy: '照抄对方，但有三分之一概率原谅一次背叛。给报复循环留一扇逃生门。',
    move(h, ctx) {
      const r = ctx.round
      if (r === 0) return C
      if (h.opp[r - 1] === D) return ctx.rng() < 1 / 3 ? C : D
      return C
    }
  },
  {
    id: 'fbf',
    name: '坚定而公平',
    nameEn: 'Firm but Fair',
    short: 'FBF',
    origin: 'Frean 1994',
    philosophy: '以牙还牙，但双双越界之后有一线生机（三分之一概率和解），防止僵死在互相背叛里。',
    move(h, ctx) {
      const r = ctx.round
      if (r === 0) return C
      const mine = h.my[r - 1]
      const theirs = h.opp[r - 1]
      if (mine === C && theirs === C) return C // 双方合作 → 继续
      if (mine === C && theirs === D) return D // 被出卖 → 还手
      if (mine === D && theirs === C) return C // 对方示好 → 收手
      return ctx.rng() < 1 / 3 ? C : D // 双双背叛 → 三分之一概率伸出橄榄枝
    }
  },
  {
    id: 'ctft',
    name: '悔过的一报还一报',
    nameEn: 'Contrite Tit for Tat',
    short: 'CTFT',
    origin: 'Sugden 1986，用于对抗误操作的 TFT 改良',
    philosophy: '照抄对方，但如果上一轮的背叛其实是自己手滑，就主动认错合作一次，避免把误操作滚成血仇。',
    move(h, ctx) {
      const r = ctx.round
      const s = memo(h)
      if (r === 0) {
        s.intent = C
        return C
      }
      // 我本打算合作却实际出手背叛 → 是我的错，无条件合作以赎罪
      if (s.intent === C && h.my[r - 1] === D) {
        s.intent = C
        return C
      }
      const reply = h.opp[r - 1]
      s.intent = reply
      return reply
    }
  },
  {
    id: 'prober',
    name: '试探者',
    nameEn: 'Prober (Tester)',
    short: 'PROB',
    origin: 'Axelrod《合作的进化》中的 Tester 家族',
    philosophy: '开局合作两轮再捅一刀，然后看对方敢不敢还手。对方软就吃干抹净，对方硬就立刻改口。',
    move(h, ctx) {
      const r = ctx.round
      const s = memo(h)
      if (r === 0 || r === 1) return C
      if (r === 2) return D // 试探
      if (r === 3) return C // 出手之后必须先示好一轮，否则对方的还手根本来不及发生
      if (r === 4) {
        // 第 2 轮我背叛，对方只能在第 3 轮还手 —— 现在才看得到
        s.mode = h.opp[3] === D ? 'tft' : 'exploit'
        return s.mode === 'exploit' ? D : C
      }
      if (s.mode === 'exploit') return D // 对方不会还手，就一直占便宜
      return h.opp[r - 1]
    }
  },
  {
    id: 'rprober',
    name: '悔过的试探者',
    nameEn: 'Remorseful Prober',
    short: 'RP',
    origin: 'Axelrod 第二届锦标赛参赛策略',
    philosophy: '会试探，也会在被惩罚时真心道歉。占便宜只占两轮，见好就收，不至于把关系做死。',
    move(h, ctx) {
      const r = ctx.round
      const s = memo(h)
      if (r === 0 || r === 1) return C
      if (r === 2) return D // 试探
      if (r === 3) return C // 等待对方反应
      if (r === 4) {
        if (h.opp[3] === D) {
          s.mode = 'tft'
          return C // 对方还手了，认错
        }
        s.mode = 'exploit'
        s.left = 2
        return D
      }
      if (s.mode === 'exploit' && (s.left as number) > 0) {
        s.left = (s.left as number) - 1
        return D
      }
      if (s.mode === 'exploit') {
        // 占完便宜想收手，但若对方记账，就直接退到 TFT 长期相处
        s.mode = 'tft'
      }
      return h.opp[r - 1]
    }
  },
  {
    id: 'majority',
    name: '多数派',
    nameEn: 'Majority',
    short: 'MAJ',
    origin: 'Axelrod 1980 年首届锦标赛参赛策略',
    philosophy: '对方历史上合作超过一半就合作，否则背叛。只看长期统计，不纠缠单轮得失。',
    move(h, ctx) {
      const r = ctx.round
      if (r === 0) return C
      // 严格过半才合作：对方恰好一半合作一半背叛时按背叛处理，
      // 否则会被「每隔一轮背叛」的固定节奏套利。
      return countC(h.opp) * 2 > r ? C : D
    }
  },
  {
    id: 'adaptive',
    name: '适应者',
    nameEn: 'Adaptive',
    short: 'ADPT',
    origin: '本实验补充的启发式策略',
    philosophy: '滚动估计对方近十轮的合作率：够友善就合作，够恶劣就背叛，说不准就跟着上一轮走。',
    move(h, ctx) {
      const r = ctx.round
      if (r === 0) return C
      const win = h.opp.slice(Math.max(0, r - 10), r)
      const rate = countC(win) / win.length
      if (rate >= 0.7) return C
      if (rate <= 0.25) return D
      return h.opp[r - 1]
    }
  },
  {
    id: 'alternator',
    name: '交替者',
    nameEn: 'Alternator',
    short: 'ALT',
    origin: '本实验补充的周期性对照策略',
    philosophy: '合作、背叛、合作、背叛……固定节奏，对人完全不敏感。它能吃尽软柿子，却会被任何会还手的人按住。',
    move(_h, ctx) {
      return ctx.round % 2 === 0 ? C : D
    }
  }
]

export interface RosterPreset {
  id: string
  name: string
  detail: string
  ids: string[] | null
  params?: { noise?: number; repetitions?: number }
}

export const ROSTER_PRESETS: RosterPreset[] = [
  {
    id: 'classic1980',
    name: '经典复现 · 1980',
    detail: '11 位行为上对应首届锦标赛的策略。默认阵容，一报还一报以约 498 分夺冠（文献值 504.5）',
    ids: ['tft', 'stft', 'tf2t', 'allc', 'alld', 'random', 'grim', 'joss', 'majority', 'prober', 'rprober'],
    params: { noise: 0 }
  },
  {
    id: 'noise',
    name: '噪音考验',
    detail: '把误操作调到 10%。一报还一报的「回声效应」会让它自己把自己拖进互相背叛',
    ids: ['tft', 'ctft', 'gtft', 'pavlov', 'fbf', 'tf2t', 'allc', 'alld', 'joss', 'random'],
    params: { noise: 0.1, repetitions: 20 }
  },
  {
    id: 'forgiveness',
    name: '宽容与报复',
    detail: '把「报复强度」当成唯一变量：从两报还一报到冷酷触发，看宽容到什么程度最优',
    ids: ['tf2t', 'gtft', 'ctft', 'fbf', 'tft', 'majority', 'grim', 'allc', 'alld'],
    params: { noise: 0 }
  },
  {
    id: 'predator',
    name: '掠夺者与守卫',
    detail: '纯合作者、投机试探者与报复者同场。试探者能在一只羊身上榨出 994 分，遇到一报还一报却只有 599',
    ids: ['allc', 'alld', 'joss', 'prober', 'rprober', 'random', 'tft', 'grim', 'pavlov'],
    params: { noise: 0 }
  },
  {
    id: 'ecology',
    name: '生态演化',
    detail: 'Axelrod 的「生存博弈」：只看单轮收益矩阵，让种群按适应度自我复制，看谁能活到最后',
    ids: ['tft', 'alld', 'allc', 'grim', 'joss', 'random', 'pavlov'],
    params: { noise: 0 }
  },
  {
    id: 'all',
    name: '全员对决',
    detail: '全部 17 种策略同场竞技。池子越大，名列前茅的差距越被抹平',
    ids: null,
    params: { noise: 0 }
  }
]

/** 测量特质时使用的「提问对手」：总合作、总背叛、以牙还牙、随机、偷袭者、固定节奏 */
export const TRAIT_PROBE_IDS = ['allc', 'alld', 'tft', 'random', 'joss', 'alternator'] as const

export const BY_ID: Record<string, Strategy> = Object.fromEntries(STRATEGIES.map((s) => [s.id, s]))

export function byIds(ids: string[] | null): Strategy[] {
  if (!ids) return STRATEGIES.slice()
  return ids.map((id) => BY_ID[id]).filter(Boolean)
}

export interface LiteratureEntry {
  rank: number
  name: string
  author: string
  score: number
  mapped: string | null
}

/** Axelrod (1980) 首届锦标赛公布的平均得分 */
export const LITERATURE_1980: LiteratureEntry[] = [
  { rank: 1, name: 'Tit for Tat', author: 'Rapoport', score: 504.5, mapped: 'tft' },
  { rank: 2, name: 'Tideman & Chieruzzi', author: 'Tideman, Chieruzzi', score: 500.4, mapped: null },
  { rank: 3, name: 'Nydegger', author: 'Nydegger', score: 485.4, mapped: null },
  { rank: 4, name: 'Grofman', author: 'Grofman', score: 481.9, mapped: null },
  { rank: 5, name: 'Shubik', author: 'Shubik', score: 480.4, mapped: null },
  { rank: 6, name: 'Stein & Rapoport', author: 'Stein, Rapoport', score: 477.6, mapped: null },
  { rank: 7, name: 'Friedman', author: 'Friedman', score: 474.6, mapped: 'grim' },
  { rank: 8, name: 'Davis', author: 'Davis', score: 471.5, mapped: null },
  { rank: 9, name: 'Graaskamp', author: 'Graaskamp', score: 471.3, mapped: null },
  { rank: 10, name: 'Downing', author: 'Downing', score: 464.2, mapped: null },
  { rank: 11, name: 'Feld', author: 'Feld', score: 454.2, mapped: null },
  { rank: 12, name: 'Joss', author: 'Joss', score: 436.9, mapped: 'joss' },
  { rank: 13, name: 'Tullock', author: 'Tullock', score: 416.5, mapped: null },
  { rank: 14, name: 'Nameless', author: '匿名', score: 401.1, mapped: null },
  { rank: 15, name: 'Random', author: '匿名', score: 400.3, mapped: 'random' }
]
