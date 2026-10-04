/**
 * engine.test.ts — 麦克斯韦妖内核的科学自检
 * ---------------------------------------------------------------------------
 * 每一条断言都对应一个可查证的物理结论，而不是「跑起来没报错」：
 *   1. 理想气体熵（二维 Sackur–Tetrode）的解析性质
 *   2. maxwell 妖真的造出温差；none 对照真的造不出；reverse 真的反向
 *   3. 表观悖论：无限记忆时气体熵真的下降（netEntropy < 0）
 *   4. Landauer 救场：有限记忆必须擦除，netEntropy 回到 0 以上
 *   5. 硬圆盘动力学：能量守恒、粒子数守恒、留在箱内
 *   6. 记账：测量 / 擦除 / 开门 / 过门次数自洽
 *   7. 可复现：同 seed 逐位一致，且全程不碰 Math.random
 *
 * 运行：npx vitest run maxwell-demon/src/lib/engine.test.ts
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BOX,
  DEMON_PRESETS,
  PARAM_RANGES,
  RAYLEIGH_MEDIAN_FACTOR,
  createDemon,
  defaultParams,
  idealGasEntropy,
  measureDemon,
  stepDemon,
  type DemonMetrics,
  type DemonParams,
  type DemonState
} from './engine'

/* ------------------------------------------------------------------ *
 * 测试脚手架
 * ------------------------------------------------------------------ */

/** 外部注入的确定性随机源（mulberry32）：同 seed 逐位一致，绝不用 Math.random。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BASE = defaultParams()
const BOX = DEFAULT_BOX
const SEED = 12345
/** 主实验时长：实测 4000 步就能把 maxwell 的冷热比推到 2.6 以上。 */
const STEPS = 4000
const DT = 1

interface RunResult {
  state: DemonState
  metrics: DemonMetrics
}

/** 从零造一个状态、跑 steps 步，返回终点状态与度量。 */
function run(params: DemonParams, steps = STEPS, seed = SEED, dt = DT): RunResult {
  const rng = mulberry32(seed)
  const state = createDemon(params, BOX, rng)
  let metrics = measureDemon(state, params, BOX)
  for (let i = 0; i < steps; i++) metrics = stepDemon(state, params, BOX, dt, rng)
  return { state, metrics }
}

const policy = (patch: Partial<DemonParams>): DemonParams => ({ ...BASE, ...patch })

/** Σv²：总动能的两倍（m = 1），弹性碰撞下必须守恒。 */
function sumV2(state: DemonState): number {
  let total = 0
  for (const p of state.particles) total += p.vx * p.vx + p.vy * p.vy
  return total
}

function snapshot(state: DemonState): string {
  return JSON.stringify(state)
}

/* ================================================================== *
 * 1 · 理想气体熵
 * ================================================================== */

describe('1 · 二维理想气体熵（Sackur–Tetrode，k = m = h = 1）', () => {
  it('S = N[ln(2πAT/N) + 2] 对给定参数给出解析值', () => {
    const n = 10
    const area = 100
    const t = 1
    const expected = n * (Math.log((2 * Math.PI * area * t) / n) + 2)
    expect(idealGasEntropy(n, area, t)).toBeCloseTo(expected, 12)
  })

  it('温度升高，熵单调增大（∂S/∂T = N/T > 0）', () => {
    expect(idealGasEntropy(10, 100, 2)).toBeGreaterThan(idealGasEntropy(10, 100, 1))
    expect(idealGasEntropy(50, 80000, 1.4)).toBeGreaterThan(idealGasEntropy(50, 80000, 0.7))
  })

  it('面积变大，熵单调增大（∂S/∂A = N/A > 0）', () => {
    expect(idealGasEntropy(10, 200, 1)).toBeGreaterThan(idealGasEntropy(10, 100, 1))
    expect(idealGasEntropy(50, 80000, 1)).toBeGreaterThan(idealGasEntropy(50, 40000, 1))
  })

  it('N = 0 或 T = 0 时特判为 0（而不是 −∞ 或 NaN）', () => {
    expect(idealGasEntropy(0, 100, 1)).toBe(0)
    expect(idealGasEntropy(10, 100, 0)).toBe(0)
    expect(idealGasEntropy(0, 0, 0)).toBe(0)
  })

  it('左右两半的熵之和在均匀态恰好等于整箱的熵（没有虚假的混合熵）', () => {
    const n = 220
    const t = 1
    const area = BOX.width * BOX.height
    const halves = idealGasEntropy(n / 2, area / 2, t) + idealGasEntropy(n / 2, area / 2, t)
    expect(halves).toBeCloseTo(idealGasEntropy(n, area, t), 10)
  })
})

/* ================================================================== *
 * 2 · 默认参数、预设与滑块范围
 * ================================================================== */

describe('2 · 默认参数、预设与滑块范围', () => {
  it('默认参数就是题面那一组，且能看出明显温差', () => {
    const p = defaultParams()
    expect(p.particleCount).toBe(220)
    expect(p.temperature).toBe(1)
    expect(p.radius).toBe(3)
    expect(p.gateHeight).toBe(26)
    expect(p.memoryCapacity).toBe(24)
    expect(p.policy).toBe('maxwell')
    expect(p.measurementCost).toBe(0)
  })

  it('默认阈值取在初始速率分布的中位数附近（瑞利中位数 σ√(2ln2) ≈ 1.177）', () => {
    const p = defaultParams()
    const median = Math.sqrt(p.temperature) * RAYLEIGH_MEDIAN_FACTOR
    expect(p.speedThreshold).toBeGreaterThan(median * 0.9)
    expect(p.speedThreshold).toBeLessThan(median * 1.1)
  })

  it('至少 5 个预设，覆盖理想妖 / 有限记忆 / 懒妖 / 反向妖 / 无妖对照', () => {
    expect(DEMON_PRESETS.length).toBeGreaterThanOrEqual(5)
    const ids = DEMON_PRESETS.map((x) => x.id)
    expect(ids).toContain('ideal')
    expect(ids).toContain('finite')
    expect(ids).toContain('lazy')
    expect(ids).toContain('reverse')
    expect(ids).toContain('none')
    const ideal = DEMON_PRESETS.find((x) => x.id === 'ideal')
    expect(ideal?.params.memoryCapacity).toBe(Number.POSITIVE_INFINITY)
    const none = DEMON_PRESETS.find((x) => x.id === 'none')
    expect(none?.params.policy).toBe('none')
    for (const preset of DEMON_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.detail.length).toBeGreaterThan(0)
    }
  })

  it('PARAM_RANGES 覆盖全部数值参数，且区间与步长合法', () => {
    const numericKeys: (keyof DemonParams)[] = [
      'particleCount',
      'temperature',
      'radius',
      'gateHeight',
      'speedThreshold',
      'memoryCapacity',
      'measurementCost'
    ]
    for (const key of numericKeys) {
      const range = PARAM_RANGES[key as string]
      expect(range, `缺少 ${key} 的滑块范围`).toBeDefined()
      expect(range.min).toBeLessThan(range.max)
      expect(range.step).toBeGreaterThan(0)
      const value = BASE[key] as number
      expect(range.min).toBeLessThanOrEqual(value)
      expect(range.max).toBeGreaterThanOrEqual(value)
    }
  })
})

/* ================================================================== *
 * 3 · 温差：maxwell 造得出，none 造不出，reverse 反向
 * ================================================================== */

describe('3 · 谁真的造出了温差', () => {
  it('maxwell：跑够步数后 tempRight > tempLeft，冷热比显著大于 1.15', () => {
    const { metrics } = run(policy({ policy: 'maxwell', memoryCapacity: Number.POSITIVE_INFINITY }))
    expect(metrics.tempRight).toBeGreaterThan(metrics.tempLeft)
    expect(metrics.hotColdRatio).toBeGreaterThan(1.15)
  })

  it('none：门焊死，两侧被隔板彻底隔开，温度与比值逐位不变（无系统性温差）', () => {
    const p = policy({ policy: 'none', memoryCapacity: Number.POSITIVE_INFINITY })
    const rng = mulberry32(SEED)
    const state = createDemon(p, BOX, rng)
    const before = measureDemon(state, p, BOX)
    for (let i = 0; i < STEPS; i++) stepDemon(state, p, BOX, DT, rng)
    const after = measureDemon(state, p, BOX)
    // 隔板是固体、门从不开：每一侧的总动能被精确守恒，比值不该动分毫
    expect(after.tempLeft).toBeCloseTo(before.tempLeft, 12)
    expect(after.tempRight).toBeCloseTo(before.tempRight, 12)
    expect(after.hotColdRatio).toBeCloseTo(before.hotColdRatio, 12)
    // 且这个「初始抽样涨落」本身就要接近 1
    expect(after.hotColdRatio).toBeLessThan(1.2)
  })

  it('none：多种子平均后冷热比贴近 1（残余只是 110 颗粒子的抽样涨落）', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const ratios = seeds.map(
      (seed) => run(policy({ policy: 'none', memoryCapacity: Number.POSITIVE_INFINITY }), STEPS, seed).metrics.hotColdRatio
    )
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length
    expect(mean).toBeLessThan(1.15)
    expect(Math.max(...ratios)).toBeLessThan(1.3)
  })

  it('reverse：把快慢判断反过来，于是 tempLeft > tempRight', () => {
    const { metrics } = run(policy({ policy: 'reverse', memoryCapacity: Number.POSITIVE_INFINITY }))
    expect(metrics.tempLeft).toBeGreaterThan(metrics.tempRight)
    expect(metrics.hotColdRatio).toBeGreaterThan(1.15)
  })

  it('能量守恒：温差是重新分配能量，不是凭空产生 —— nL·TL + nR·TR 保持初始值', () => {
    const p = policy({ policy: 'maxwell', memoryCapacity: Number.POSITIVE_INFINITY })
    const rng = mulberry32(SEED)
    const state = createDemon(p, BOX, rng)
    const e0 = sumV2(state)
    let m = measureDemon(state, p, BOX)
    for (let i = 0; i < STEPS; i++) m = stepDemon(state, p, BOX, DT, rng)
    // T = <v²>/2 ⇒ 2(nL·TL + nR·TR) = Σv²
    const totalFromTemps = 2 * (m.nLeft * m.tempLeft + m.nRight * m.tempRight)
    expect(totalFromTemps).toBeCloseTo(e0, 8)
    expect(sumV2(state)).toBeCloseTo(e0, 8)
  })
})

/* ================================================================== *
 * 4 · 熵的账本：悖论与 Landauer 救场
 * ================================================================== */

describe('4 · 熵的账本：表观悖论与 Landauer 救场', () => {
  it('表观悖论：maxwell + 无限记忆时 deltaSGas 显著为负（气体熵真的下降了）', () => {
    const { metrics, state } = run(policy({ policy: 'maxwell', memoryCapacity: Number.POSITIVE_INFINITY }))
    expect(metrics.deltaSGas).toBeLessThan(-5)
    // 理想妖从不擦除：擦除熵恒为 0，于是总熵也显著为负 —— 这正是悖论
    expect(state.bitsErased).toBe(0)
    expect(metrics.deltaSErase).toBe(0)
    expect(metrics.netEntropy).toBeLessThan(0)
    expect(metrics.netEntropy).toBeCloseTo(metrics.deltaSGas, 12)
  })

  it('Landauer 救场：有限记忆必须擦除，deltaSErase > 0 且总熵回到 0 以上', () => {
    const { metrics, state } = run(policy({ policy: 'maxwell', memoryCapacity: 24 }))
    expect(state.bitsErased).toBeGreaterThan(0)
    expect(metrics.deltaSErase).toBeGreaterThan(0)
    expect(metrics.deltaSErase).toBeCloseTo(state.bitsErased * Math.LN2, 10)
    // 整个实验的结论：气体少掉的熵，被擦除记忆的熵全部补回来还多
    expect(metrics.netEntropy).toBeGreaterThanOrEqual(0)
    expect(metrics.netEntropy).toBeCloseTo(metrics.deltaSGas + metrics.deltaSErase, 10)
  })

  it('擦除的账目不改变动力学：有限记忆与无限记忆跑出同一个气体状态', () => {
    const ideal = run(policy({ policy: 'maxwell', memoryCapacity: Number.POSITIVE_INFINITY }))
    const finite = run(policy({ policy: 'maxwell', memoryCapacity: 24 }))
    expect(finite.metrics.tempLeft).toBe(ideal.metrics.tempLeft)
    expect(finite.metrics.tempRight).toBe(ideal.metrics.tempRight)
    expect(finite.metrics.deltaSGas).toBe(ideal.metrics.deltaSGas)
    expect(finite.state.bitsRecorded).toBe(ideal.state.bitsRecorded)
  })

  it('measurementCost：每次测量额外耗散 bitsRecorded × cost × ln2，账目再往正的方向走', () => {
    const cost = 1
    const { metrics, state } = run(
      policy({ policy: 'maxwell', memoryCapacity: Number.POSITIVE_INFINITY, measurementCost: cost })
    )
    expect(metrics.deltaSMeasure).toBeCloseTo(state.bitsRecorded * cost * Math.LN2, 10)
    expect(metrics.deltaSMeasure).toBeGreaterThan(0)
    expect(metrics.netEntropy).toBeCloseTo(metrics.deltaSGas + metrics.deltaSMeasure, 10)
    // 即使妖永不擦除记忆，光靠测量耗散也足以把账推回正值
    expect(metrics.netEntropy).toBeGreaterThan(0)
  })

  it('初始时刻 deltaSGas 恰好为 0（参考点就是真实初始态，不是理论值）', () => {
    const p = policy({ policy: 'maxwell', memoryCapacity: 24 })
    const rng = mulberry32(SEED)
    const state = createDemon(p, BOX, rng)
    const metrics = measureDemon(state, p, BOX)
    expect(metrics.deltaSGas).toBeCloseTo(0, 12)
    expect(metrics.deltaSErase).toBe(0)
    expect(metrics.deltaSMeasure).toBe(0)
    expect(metrics.netEntropy).toBeCloseTo(0, 12)
  })

  it('熵减来自梯度而不是数值噪声：sGas 随冷热分化单调下降', () => {
    const p = policy({ policy: 'maxwell', memoryCapacity: Number.POSITIVE_INFINITY })
    const rng = mulberry32(SEED)
    const state = createDemon(p, BOX, rng)
    const s0 = measureDemon(state, p, BOX).sGas
    for (let i = 0; i < 1000; i++) stepDemon(state, p, BOX, DT, rng)
    const s1 = measureDemon(state, p, BOX).sGas
    for (let i = 0; i < 3000; i++) stepDemon(state, p, BOX, DT, rng)
    const s2 = measureDemon(state, p, BOX).sGas
    expect(s1).toBeLessThan(s0)
    expect(s2).toBeLessThan(s1)
  })
})

/* ================================================================== *
 * 5 · 硬圆盘动力学
 * ================================================================== */

describe('5 · 硬圆盘动力学', () => {
  it('无测量耗散时 Σv² 在四种策略下都守恒到浮点精度', () => {
    for (const pol of ['maxwell', 'lazy', 'reverse', 'none'] as const) {
      const p = policy({ policy: pol, memoryCapacity: Number.POSITIVE_INFINITY, measurementCost: 0 })
      const rng = mulberry32(777)
      const state = createDemon(p, BOX, rng)
      const e0 = sumV2(state)
      for (let i = 0; i < 2000; i++) stepDemon(state, p, BOX, DT, rng)
      expect(Math.abs(sumV2(state) - e0) / e0, `${pol} 策略能量不守恒`).toBeLessThan(1e-9)
    }
  })

  it('两体弹性对撞：动能与动量守恒，且碰撞后互相分离', () => {
    const p = policy({ policy: 'none', memoryCapacity: Number.POSITIVE_INFINITY })
    const state: DemonState = {
      particles: [
        { x: 100, y: 100, vx: 2, vy: 0.5, r: 3 },
        { x: 105.5, y: 100, vx: -1, vy: -0.5, r: 3 }
      ],
      time: 0,
      bitsRecorded: 0,
      bitsErased: 0,
      memoryUsed: 0,
      crossingsLR: 0,
      crossingsRL: 0,
      gateOpens: 0
    }
    const [a, b] = state.particles
    const e0 = a.vx * a.vx + a.vy * a.vy + b.vx * b.vx + b.vy * b.vy
    const px0 = a.vx + b.vx
    const py0 = a.vy + b.vy
    stepDemon(state, p, BOX, DT, mulberry32(1))
    const e1 = a.vx * a.vx + a.vy * a.vy + b.vx * b.vx + b.vy * b.vy
    expect(e1).toBeCloseTo(e0, 12)
    expect(a.vx + b.vx).toBeCloseTo(px0, 12)
    expect(a.vy + b.vy).toBeCloseTo(py0, 12)
    // 法向相对速度变为分离方向
    expect((b.vx - a.vx) * (b.x - a.x) + (b.vy - a.vy) * (b.y - a.y)).toBeGreaterThan(0)
    // 重叠被消除（位置修正），且不改变动能
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(a.r + b.r - 1e-9)
  })

  it('粒子数守恒，且任何时刻都留在箱内（半径边距以内）', () => {
    const p = policy({ policy: 'maxwell', memoryCapacity: 24 })
    const rng = mulberry32(SEED)
    const state = createDemon(p, BOX, rng)
    expect(state.particles.length).toBe(p.particleCount)
    for (let i = 0; i < STEPS; i++) stepDemon(state, p, BOX, DT, rng)
    expect(state.particles.length).toBe(p.particleCount)
    for (const q of state.particles) {
      expect(Number.isFinite(q.x)).toBe(true)
      expect(q.x).toBeGreaterThanOrEqual(q.r - 1e-6)
      expect(q.x).toBeLessThanOrEqual(BOX.width - q.r + 1e-6)
      expect(q.y).toBeGreaterThanOrEqual(q.r - 1e-6)
      expect(q.y).toBeLessThanOrEqual(BOX.height - q.r + 1e-6)
    }
  })

  it('初始速度的抽样温度等于参数温度，且两侧粒子数约为一半', () => {
    const p = policy({ policy: 'none' })
    const rng = mulberry32(SEED)
    const state = createDemon(p, BOX, rng)
    const m = measureDemon(state, p, BOX)
    expect(m.nLeft + m.nRight).toBe(p.particleCount)
    // 有限样本涨落：220 颗粒子下约 7%，给 25% 的宽松容差
    expect(Math.abs(m.tempLeft - p.temperature) / p.temperature).toBeLessThan(0.25)
    expect(Math.abs(m.tempRight - p.temperature) / p.temperature).toBeLessThan(0.25)
  })
})

/* ================================================================== *
 * 6 · 门与记忆的记账
 * ================================================================== */

describe('6 · 门与记忆的记账', () => {
  it('maxwell：两个方向的过门都发生过，gateOpens = crossingsLR + crossingsRL', () => {
    const { state, metrics } = run(policy({ policy: 'maxwell' }))
    expect(state.crossingsLR).toBeGreaterThan(0)
    expect(state.crossingsRL).toBeGreaterThan(0)
    expect(state.gateOpens).toBe(state.crossingsLR + state.crossingsRL)
    // 门确实放行了粒子：开门次数远小于测量次数（大部分判断是关门）
    expect(state.gateOpens).toBeLessThan(state.bitsRecorded)
    expect(metrics.nLeft + metrics.nRight).toBe(BASE.particleCount)
  })

  it('none：门从不开、从无粒子过门，但妖仍在每次尝试上做判断（记录比特）', () => {
    const { state } = run(policy({ policy: 'none', memoryCapacity: Number.POSITIVE_INFINITY }))
    expect(state.gateOpens).toBe(0)
    expect(state.crossingsLR).toBe(0)
    expect(state.crossingsRL).toBe(0)
    expect(state.bitsRecorded).toBeGreaterThan(0)
    expect(state.memoryUsed).toBe(state.bitsRecorded)
  })

  it('lazy：±30% 迟滞带让开门次数严格少于 maxwell（判据是它的子集）', () => {
    const maxwell = run(policy({ policy: 'maxwell' }), STEPS)
    const lazy = run(policy({ policy: 'lazy' }), STEPS)
    expect(lazy.state.bitsRecorded).toBeGreaterThan(0)
    expect(lazy.state.gateOpens).toBeLessThan(maxwell.state.gateOpens)
    // 开门更少 ⇒ 温差建立更慢
    expect(lazy.metrics.hotColdRatio).toBeLessThan(maxwell.metrics.hotColdRatio)
  })

  it('记忆容量小 ⇒ 必须频繁擦除：容量 8 已擦掉几百比特，容量 1024 一次都不用擦', () => {
    // 记账恒等式：bitsErased + memoryUsed = bitsRecorded
    const small = run(policy({ policy: 'maxwell', memoryCapacity: 8 }), STEPS)
    const big = run(policy({ policy: 'maxwell', memoryCapacity: 1024 }), STEPS)
    expect(small.state.bitsErased + small.state.memoryUsed).toBe(small.state.bitsRecorded)
    expect(big.state.bitsErased + big.state.memoryUsed).toBe(big.state.bitsRecorded)
    // 小容量：写满就清空，几乎每个比特都被擦过
    expect(small.state.bitsErased).toBeGreaterThan(100)
    expect(small.state.memoryUsed).toBeLessThan(8)
    // 大容量：同样步数下记忆根本没写满
    expect(big.state.bitsErased).toBe(0)
    expect(big.state.memoryUsed).toBe(big.state.bitsRecorded)
    expect(small.state.bitsErased).toBeGreaterThan(big.state.bitsErased + 100)
  })

  it('时间跑得更久，小容量擦除的比特数继续明显领先大容量', () => {
    const small = run(policy({ policy: 'maxwell', memoryCapacity: 8 }), 20000)
    const big = run(policy({ policy: 'maxwell', memoryCapacity: 1024 }), 20000)
    expect(small.state.bitsErased).toBeGreaterThan(big.state.bitsErased)
    expect(small.metrics.deltaSErase).toBeGreaterThan(big.metrics.deltaSErase)
    // 两者气体状态完全一致：擦除只是记账，不反作用于动力学
    expect(small.metrics.deltaSGas).toBe(big.metrics.deltaSGas)
  })

  it('有限记忆下 memoryUsed 始终小于容量；无限记忆下 memoryUsed = bitsRecorded', () => {
    const finite = run(policy({ policy: 'maxwell', memoryCapacity: 24 }), STEPS)
    expect(finite.state.memoryUsed).toBeLessThan(24)
    expect(finite.state.memoryUsed).toBeGreaterThanOrEqual(0)
    const infinite = run(policy({ policy: 'maxwell', memoryCapacity: Number.POSITIVE_INFINITY }), 500)
    expect(infinite.state.bitsErased).toBe(0)
    expect(infinite.state.memoryUsed).toBe(infinite.state.bitsRecorded)
  })

  it('步数越多，测量与过门次数单调累积，time 精确等于 steps × dt', () => {
    const p = policy({ policy: 'maxwell' })
    const rng = mulberry32(SEED)
    const state = createDemon(p, BOX, rng)
    let lastBits = 0
    let lastCross = 0
    for (let i = 0; i < 1000; i++) {
      const m = stepDemon(state, p, BOX, 0.5, rng)
      expect(state.bitsRecorded).toBeGreaterThanOrEqual(lastBits)
      expect(state.crossingsLR + state.crossingsRL).toBeGreaterThanOrEqual(lastCross)
      lastBits = state.bitsRecorded
      lastCross = state.crossingsLR + state.crossingsRL
      expect(m.nLeft + m.nRight).toBe(p.particleCount)
    }
    expect(state.time).toBeCloseTo(500, 9)
  })
})

/* ================================================================== *
 * 7 · 可复现与数值稳定
 * ================================================================== */

describe('7 · 可复现与数值稳定', () => {
  it('同 seed 逐位一致（粒子坐标、速度与全部计数器）', () => {
    const p = policy({ policy: 'maxwell', memoryCapacity: 24 })
    const a = run(p, 3000, 2024)
    const b = run(p, 3000, 2024)
    expect(snapshot(a.state)).toBe(snapshot(b.state))
    expect(a.metrics).toEqual(b.metrics)
  })

  it('不同 seed 给出不同轨迹（随机性真的来自传入的 rng）', () => {
    const p = policy({ policy: 'maxwell', memoryCapacity: 24 })
    const a = run(p, 3000, 2024)
    const b = run(p, 3000, 2025)
    expect(snapshot(a.state)).not.toBe(snapshot(b.state))
  })

  it('不产生 NaN / Infinity，且 measureDemon 不修改 state', () => {
    const p = policy({ policy: 'maxwell', memoryCapacity: 24 })
    const { state, metrics } = run(p, 2000)
    const keys: (keyof DemonMetrics)[] = [
      'tempLeft',
      'tempRight',
      'nLeft',
      'nRight',
      'sGas',
      'deltaSGas',
      'deltaSErase',
      'deltaSMeasure',
      'netEntropy',
      'hotColdRatio'
    ]
    for (const key of keys) expect(Number.isFinite(metrics[key]), `${key} 不是有限数`).toBe(true)
    expect(Number.isFinite(state.time)).toBe(true)
    for (const q of state.particles) {
      expect(Number.isFinite(q.x)).toBe(true)
      expect(Number.isFinite(q.y)).toBe(true)
      expect(Number.isFinite(q.vx)).toBe(true)
      expect(Number.isFinite(q.vy)).toBe(true)
    }
    const before = snapshot(state)
    const again = measureDemon(state, p, BOX)
    expect(again).toEqual(metrics)
    expect(snapshot(state)).toBe(before)
  })

  it('手工拼出来的 state（没有 sGasInitial）也能算出有限的度量', () => {
    const p = policy({ policy: 'none' })
    const state: DemonState = {
      particles: [
        { x: 50, y: 50, vx: 1, vy: 0, r: 3 },
        { x: 300, y: 50, vx: -1, vy: 0, r: 3 }
      ],
      time: 0,
      bitsRecorded: 0,
      bitsErased: 0,
      memoryUsed: 0,
      crossingsLR: 0,
      crossingsRL: 0,
      gateOpens: 0
    }
    const m = measureDemon(state, p, BOX)
    expect(Number.isFinite(m.sGas)).toBe(true)
    expect(Number.isFinite(m.deltaSGas)).toBe(true)
    expect(m.nLeft).toBe(1)
    expect(m.nRight).toBe(1)
    expect(m.tempLeft).toBeCloseTo(0.5, 12)
    expect(m.tempRight).toBeCloseTo(0.5, 12)
    expect(m.hotColdRatio).toBeCloseTo(1, 12)
  })

  it('空箱子不炸：0 颗粒子时度量全部有限且熵为 0', () => {
    const p = policy({ particleCount: 0 })
    const rng = mulberry32(SEED)
    const state = createDemon(p, BOX, rng)
    let m = measureDemon(state, p, BOX)
    for (let i = 0; i < 10; i++) m = stepDemon(state, p, BOX, DT, rng)
    expect(state.particles.length).toBe(0)
    expect(m.nLeft).toBe(0)
    expect(m.nRight).toBe(0)
    expect(m.sGas).toBe(0)
    expect(Number.isFinite(m.hotColdRatio)).toBe(true)
    expect(Number.isFinite(m.netEntropy)).toBe(true)
  })
})
