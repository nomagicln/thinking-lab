/**
 * engine.test.ts — Boids 计算内核的科学自检
 * ===========================================================================
 * 每条断言都对应一个可查证的模型性质（哪条规则负责什么、边界怎么处理、
 * 噪声下到底有没有相变），而不是「跑起来没报错」。
 *
 * 规模说明：为了跑得快，测试用的群体比界面小（60~260 只鸟、几百步）。
 * 步数与画布尺寸都不是随手写的——
 *   · 步数少于 ~300 时群体还没收敛，同一组权重换个种子就能从 0.4 跳到 0.95；
 *   · 相变对**密度**敏感：260 只鸟 / perception 46 的默认参数下，平均邻居数
 *     在 560×380 画布上约 8，在 900×520 上只有约 3.7。后者属于低密度区，
 *     有序相是亚稳的（常常形成绕质心打转的磨盘），低噪声端会随初值波动。
 *     所以相变相关的断言一律用稠密画布，并额外检查「跨种子稳健性」。
 */

import { describe, expect, it } from 'vitest'
import {
  BOID_PRESETS,
  PARAM_RANGES,
  computeMetrics,
  createFlock,
  defaultParams,
  ruleBreakdown,
  stepFlock,
  sweepNoise,
  type BoidParams,
  type FlockState
} from './engine'

/** 低密度大画布：用于可复现性、边界这类与密度无关的检查 */
const BIG = { w: 900, h: 520 }
/** 稠密画布：260 只鸟时平均邻居数 ≈ 8，相变在这里才是稳健的 */
const DENSE = { w: 560, h: 380 }
/** 高密度小盒：三条规则的定性差异在这里最清楚 */
const TINY = { w: 160, h: 160 }

/** 简易可复现随机源（内核不关心它从哪来，只要求是 () => number） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface RunResult {
  state: FlockState
  params: BoidParams
  before: ReturnType<typeof computeMetrics>
  after: ReturnType<typeof computeMetrics>
}

/** 建群 → 跑 steps 步 → 返回前后两组观测量 */
function run(
  patch: Partial<BoidParams>,
  steps: number,
  opts: { seed?: number; w?: number; h?: number; count?: number } = {}
): RunResult {
  const params: BoidParams = { ...defaultParams(), count: opts.count ?? 260, predatorCount: 0, ...patch }
  const w = opts.w ?? BIG.w
  const h = opts.h ?? BIG.h
  const rng = mulberry32(opts.seed ?? 7)
  const state = createFlock(params, w, h, rng)
  const before = computeMetrics(state, params)
  let after = before
  for (let i = 0; i < steps; i++) after = stepFlock(state, params, 1, w, h, rng)
  return { state, params, before, after }
}

/** 只保留某一条规则 */
const ONLY = {
  separation: { separation: 1.8, alignment: 0, cohesion: 0 },
  alignment: { separation: 0, alignment: 2.4, cohesion: 0 },
  cohesion: { separation: 0, alignment: 0, cohesion: 1 }
} satisfies Record<string, Partial<BoidParams>>

const NUMERIC_KEYS = [
  'count',
  'perception',
  'fov',
  'separationRadius',
  'separation',
  'alignment',
  'cohesion',
  'maxSpeed',
  'minSpeed',
  'maxForce',
  'noise',
  'predatorCount',
  'predatorFear',
  'predatorSpeed'
] as const

/* ================================================================== *
 * 1 · 可复现性
 * ================================================================== */

describe('1 · 可复现性', () => {
  it('同 seed 逐只鸟完全一致（位置与速度都逐位相同）', () => {
    const a = run({}, 150, { seed: 12345, count: 120, ...BIG })
    const b = run({}, 150, { seed: 12345, count: 120, ...BIG })
    expect(a.state.boids.length).toBe(b.state.boids.length)
    for (let i = 0; i < a.state.boids.length; i++) {
      expect(a.state.boids[i].x).toBe(b.state.boids[i].x)
      expect(a.state.boids[i].y).toBe(b.state.boids[i].y)
      expect(a.state.boids[i].vx).toBe(b.state.boids[i].vx)
      expect(a.state.boids[i].vy).toBe(b.state.boids[i].vy)
    }
    expect(a.state.time).toBe(b.state.time)
  })

  it('不同 seed 结果不同', () => {
    const a = run({}, 150, { seed: 1, count: 120, ...BIG })
    const b = run({}, 150, { seed: 2, count: 120, ...BIG })
    const differs = a.state.boids.some((x, i) => Math.abs(x.x - b.state.boids[i].x) > 1e-9)
    expect(differs).toBe(true)
  })

  it('sweepNoise 同 seed 逐点一致', () => {
    const p = { ...defaultParams(), count: 120, predatorCount: 0 }
    const o = { levels: 5, steps: 80, seed: 99, width: DENSE.w, height: DENSE.h }
    expect(sweepNoise(p, o).map((c) => c.polarization)).toEqual(sweepNoise(p, o).map((c) => c.polarization))
  })
})

/* ================================================================== *
 * 2 · 三条规则各自负责什么
 * ================================================================== */

describe('2 · 三条规则各自的职责', () => {
  it('只有对齐时，群体建立共同航向（polarization > 0.9）', () => {
    // 对齐是唯一能产生全局方向的规则；稠密小盒里 400 步就足以收敛。
    const { after } = run(ONLY.alignment, 400, { seed: 7, count: 60, w: 400, h: 300 })
    expect(after.polarization).toBeGreaterThan(0.9)
  })

  it('只有分离时，最近邻平均距离显著大于只有聚合时', () => {
    const sep = run(ONLY.separation, 250, { seed: 5, count: 60, ...TINY }).after
    const coh = run(ONLY.cohesion, 250, { seed: 5, count: 60, ...TINY }).after
    // 分离把鸟推开铺满盒子，聚合把鸟塌成一团
    expect(sep.meanNeighborDistance).toBeGreaterThan(coh.meanNeighborDistance * 1.7)
    expect(sep.meanNeighborDistance).toBeGreaterThan(coh.meanNeighborDistance + 3)
  })

  it('只有聚合时，radiusOfGyration 比初始值显著缩小', () => {
    const { before, after } = run(ONLY.cohesion, 250, { seed: 5, count: 60, ...TINY })
    expect(after.radiusOfGyration).toBeLessThan(before.radiusOfGyration * 0.7)
  })

  it('只有分离时群体铺得比只有聚合时开（回转半径更大）', () => {
    const sep = run(ONLY.separation, 250, { seed: 5, count: 60, ...TINY }).after
    const coh = run(ONLY.cohesion, 250, { seed: 5, count: 60, ...TINY }).after
    expect(sep.radiusOfGyration).toBeGreaterThan(coh.radiusOfGyration)
  })

  it('ruleBreakdown 的 total 恰好等于三条几何向量按权重相加', () => {
    const { state, params } = run({}, 60, { seed: 3, count: 80, ...BIG })
    for (const i of [0, 7, 40]) {
      const b = ruleBreakdown(state, params, i)
      const wx = params.separation * b.separation[0] + params.alignment * b.alignment[0] + params.cohesion * b.cohesion[0]
      const wy = params.separation * b.separation[1] + params.alignment * b.alignment[1] + params.cohesion * b.cohesion[1]
      expect(Math.abs(b.total[0] - wx)).toBeLessThan(1e-9)
      expect(Math.abs(b.total[1] - wy)).toBeLessThan(1e-9)
    }
  })

  it('三个规则向量是未加权的：改权重只改 total，不改分量', () => {
    const { state, params } = run({}, 60, { seed: 3, count: 80, ...BIG })
    const b1 = ruleBreakdown(state, params, 5)
    const heavy: BoidParams = { ...params, separation: 0, alignment: 0, cohesion: 9 }
    const b2 = ruleBreakdown(state, heavy, 5)
    // 几何量与权重无关
    expect(b2.separation).toEqual(b1.separation)
    expect(b2.alignment).toEqual(b1.alignment)
    expect(b2.cohesion).toEqual(b1.cohesion)
    // total 只剩被保留的那一项
    expect(b2.total[0]).toBeCloseTo(9 * b1.cohesion[0], 9)
    expect(b2.total[1]).toBeCloseTo(9 * b1.cohesion[1], 9)
  })

  it('ruleBreakdown 越界索引返回零向量而不是抛异常', () => {
    const { state, params } = run({}, 10, { seed: 3, count: 30, ...BIG })
    for (const i of [-1, 999, Number.NaN]) {
      expect(ruleBreakdown(state, params, i).total).toEqual([0, 0])
    }
  })

  it('视野角 fov 真的把身后的邻居挡在外面', () => {
    // 两只鸟同向飞行，b1 恰好在 b0 正后方 40 < perception
    const params: BoidParams = { ...defaultParams(), count: 2, predatorCount: 0, fov: Math.PI / 2, noise: 0 }
    const state: FlockState = {
      boids: [
        { x: 100, y: 100, vx: 2, vy: 0 },
        { x: 60, y: 100, vx: 2, vy: 0 }
      ],
      predators: [],
      time: 0
    }
    const narrow = ruleBreakdown(state, params, 0)
    expect(narrow.alignment).toEqual([0, 0])
    expect(narrow.cohesion).toEqual([0, 0])
    // 全向视野下同一个邻居就会产生聚合转向
    const wide = ruleBreakdown(state, { ...params, fov: 2 * Math.PI }, 0)
    expect(Math.abs(wide.cohesion[0])).toBeGreaterThan(0)
  })

  it('wrap 模式下的聚合是环形距离：接缝两侧的两团会合并', () => {
    // 若用欧氏距离，接缝两侧的鸟会「看不见」对方，两团永远不会合并
    const make = (boundary: 'wrap' | 'bounce') => {
      const params: BoidParams = {
        ...defaultParams(),
        count: 60,
        perception: 200,
        separation: 0,
        alignment: 0,
        cohesion: 1,
        noise: 0,
        boundary
      }
      const rng = mulberry32(3)
      const state = createFlock(params, 400, 400, rng)
      for (let i = 0; i < 60; i++) {
        state.boids[i].x = i % 2 === 0 ? 5 : 395
        state.boids[i].y = 200
        state.boids[i].vx = 0
        state.boids[i].vy = 1.2
      }
      let m = computeMetrics(state, params)
      for (let s = 0; s < 250; s++) m = stepFlock(state, params, 1, 400, 400, rng)
      return m.radiusOfGyration
    }
    expect(make('wrap')).toBeLessThan(make('bounce') * 0.4)
  })
})

/* ================================================================== *
 * 3 · 边界与数值稳定性
 * ================================================================== */

describe('3 · 边界与数值稳定性', () => {
  it('wrap：长时间运行后坐标仍落在 [0,width) × [0,height)', () => {
    const { state } = run({ boundary: 'wrap', minSpeed: 2, maxSpeed: 4 }, 400, { seed: 9, count: 120, ...DENSE })
    for (const b of state.boids) {
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x).toBeLessThan(DENSE.w)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeLessThan(DENSE.h)
    }
  })

  it('bounce / attract：坐标不越界', () => {
    for (const boundary of ['bounce', 'attract'] as const) {
      const { state } = run({ boundary, minSpeed: 2, maxSpeed: 4 }, 400, { seed: 9, count: 120, ...DENSE })
      for (const b of state.boids) {
        expect(b.x).toBeGreaterThanOrEqual(-1e-6)
        expect(b.x).toBeLessThanOrEqual(DENSE.w + 1e-6)
        expect(b.y).toBeGreaterThanOrEqual(-1e-6)
        expect(b.y).toBeLessThanOrEqual(DENSE.h + 1e-6)
      }
    }
  })

  it('bounce：贴着右墙向外飞的鸟，速度 x 分量被反向', () => {
    const params: BoidParams = {
      ...defaultParams(),
      count: 1,
      predatorCount: 0,
      boundary: 'bounce',
      separation: 0,
      alignment: 0,
      cohesion: 0,
      maxForce: 0,
      noise: 0,
      maxSpeed: 4,
      minSpeed: 2
    }
    const rng = mulberry32(3)
    const state = createFlock(params, DENSE.w, DENSE.h, rng)
    state.boids[0].x = DENSE.w - 0.5
    state.boids[0].y = DENSE.h / 2
    state.boids[0].vx = 3
    state.boids[0].vy = 0

    stepFlock(state, params, 1, DENSE.w, DENSE.h, rng)
    expect(state.boids[0].vx).toBeLessThan(0) // 撞墙瞬间反向
    expect(state.boids[0].x).toBeLessThan(DENSE.w)

    for (let i = 0; i < 20; i++) stepFlock(state, params, 1, DENSE.w, DENSE.h, rng)
    expect(state.boids[0].x).toBeLessThanOrEqual(DENSE.w + 1e-6)
    expect(state.boids[0].x).toBeGreaterThanOrEqual(-1e-6)
  })

  it('速度上限不被突破（噪声拉满时也一样）', () => {
    for (const boundary of ['wrap', 'bounce', 'attract'] as const) {
      const { state, params } = run({ boundary, noise: 1 }, 300, { seed: 11, count: 120, ...DENSE })
      for (const b of state.boids) {
        expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(params.maxSpeed + 1e-6)
      }
      for (const p of state.predators) {
        expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(params.predatorSpeed + 1e-6)
      }
    }
  })

  it('坐标与速度始终有限（每个分量都不是 NaN / Infinity）', () => {
    const cases: Partial<BoidParams>[] = [
      { noise: 1 },
      { noise: 0, maxSpeed: 0, minSpeed: 0, maxForce: 0 },
      { noise: 0.7, maxForce: 1.4, minSpeed: 4, maxSpeed: 4 },
      { noise: 0.3, perception: 0, separationRadius: 0 }
    ]
    for (const boundary of ['wrap', 'bounce', 'attract'] as const) {
      for (const c of cases) {
        const { state } = run({ ...c, boundary }, 200, { seed: 4, count: 40, ...DENSE })
        for (const b of [...state.boids, ...state.predators]) {
          expect(Number.isFinite(b.x)).toBe(true)
          expect(Number.isFinite(b.y)).toBe(true)
          expect(Number.isFinite(b.vx)).toBe(true)
          expect(Number.isFinite(b.vy)).toBe(true)
        }
      }
    }
  })

  it('非法（NaN）参数不会污染状态', () => {
    const nan: BoidParams = { ...defaultParams(), count: 20, noise: Number.NaN, perception: Number.NaN, maxForce: Number.NaN }
    const rng = mulberry32(8)
    const state = createFlock(nan, DENSE.w, DENSE.h, rng)
    for (let i = 0; i < 100; i++) stepFlock(state, nan, 1, DENSE.w, DENSE.h, rng)
    for (const b of state.boids) {
      expect(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy)).toBe(true)
    }
    expect(state.boids.length).toBe(20)
  })

  it('粒子数守恒：stepFlock 不会增减 boid 或 predator', () => {
    const { state } = run({ predatorCount: 3 }, 300, { seed: 7, count: 80, ...DENSE })
    expect(state.boids.length).toBe(80)
    expect(state.predators.length).toBe(3)
  })
})

/* ================================================================== *
 * 4 · 噪声与有序–无序相变
 * ================================================================== */

describe('4 · 噪声与有序–无序相变', () => {
  it('noise = 0 的极化度明显高于 noise = 1', () => {
    const quiet = run({ noise: 0 }, 300, { seed: 21, ...DENSE }).after.polarization
    const loud = run({ noise: 1 }, 300, { seed: 21, ...DENSE }).after.polarization
    expect(quiet).toBeGreaterThan(0.9)
    expect(loud).toBeLessThan(0.3)
    expect(quiet - loud).toBeGreaterThan(0.6)
  })

  it('noise = 1 时方向接近全随机（Vicsek 硬噪声：每步 ±π）', () => {
    // 全随机的 |Σ v̂|/N 期望约为 1/√N ≈ 0.06（N=260），远低于有序相
    const { after } = run({ noise: 1 }, 300, { seed: 3, ...DENSE })
    expect(after.polarization).toBeLessThan(0.25)
  })

  it('sweepNoise 复现有序 → 无序相变，且曲线整体单调不增', () => {
    const params = { ...defaultParams(), predatorCount: 0 }
    const curve = sweepNoise(params, { levels: 11, steps: 300, seed: 42, width: DENSE.w, height: DENSE.h })
    const vals = curve.map((c) => c.polarization)
    console.log('[sweepNoise 实测] noise =', curve.map((c) => c.noise.toFixed(2)).join(' '))
    console.log('[sweepNoise 实测] polarization =', vals.map((v) => v.toFixed(3)).join(' '))

    expect(vals[0]).toBeGreaterThan(0.8)
    expect(vals[vals.length - 1]).toBeLessThan(0.3)
    // 整体单调不增：允许 0.12 以内的抖动（有限尺寸 + 混沌），但禁止回升趋势
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i] - vals[i - 1]).toBeLessThan(0.12)
    }
    // 而且必须真的「陡」——至少有一处落差 > 0.25
    let maxDrop = 0
    for (let i = 1; i < vals.length; i++) maxDrop = Math.max(maxDrop, vals[i - 1] - vals[i])
    expect(maxDrop).toBeGreaterThan(0.25)
  })

  it('零噪声有序相对初值稳健（跨种子全部 > 0.9）', () => {
    // 稠密画布下 10 个种子实测最差 0.93（seed 7），其余都 ≥ 0.98。
    // 低密度画布（900×520）不是这样：那里有序相亚稳，会随初值在 0.2~1.0 间跳。
    for (const seed of [7, 21, 99, 123, 2024]) {
      const { after } = run({ noise: 0 }, 300, { seed, ...DENSE })
      expect(after.polarization).toBeGreaterThan(0.9)
    }
  })

  it('sweepNoise 的噪声档位覆盖 [0, 1] 且等距', () => {
    const curve = sweepNoise({ ...defaultParams(), count: 60, predatorCount: 0 }, {
      levels: 5,
      steps: 60,
      seed: 1,
      width: DENSE.w,
      height: DENSE.h
    })
    expect(curve.length).toBe(5)
    expect(curve[0].noise).toBeCloseTo(0, 9)
    expect(curve[curve.length - 1].noise).toBeCloseTo(1, 9)
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].noise - curve[i - 1].noise).toBeCloseTo(0.25, 9)
    }
  })

  it('换个种子与档位数，同样是「低噪声有序、高噪声无序」', () => {
    const p = { ...defaultParams(), predatorCount: 0 }
    const o = { levels: 9, steps: 260, seed: 2024, width: DENSE.w, height: DENSE.h }
    const vals = sweepNoise(p, o).map((c) => c.polarization)
    const head = vals.slice(0, 3).reduce((a, b) => a + b, 0) / 3
    const tail = vals.slice(-3).reduce((a, b) => a + b, 0) / 3
    expect(head).toBeGreaterThan(0.8)
    expect(tail).toBeLessThan(0.25)
  })
})

/* ================================================================== *
 * 5 · 掠食者
 * ================================================================== */

describe('5 · 掠食者', () => {
  it('predators 数组长度等于 predatorCount', () => {
    for (const n of [0, 1, 3]) {
      const { state } = run({ predatorCount: n }, 50, { seed: 7, count: 60, ...DENSE })
      expect(state.predators.length).toBe(n)
    }
  })

  it('掠食者会朝最近的鸟靠近', () => {
    const params: BoidParams = { ...defaultParams(), count: 40, predatorCount: 2, predatorSpeed: 3.6 }
    const rng = mulberry32(5)
    const state = createFlock(params, DENSE.w, DENSE.h, rng)
    // 鸟堆在左侧，掠食者丢到右半边的随机位置
    for (const b of state.boids) {
      b.x = 60 + rng() * 120
      b.y = DENSE.h / 2 + (rng() - 0.5) * 80
    }
    state.predators[0].x = DENSE.w - 30
    state.predators[0].y = 40
    const nearest = (p: { x: number; y: number }) =>
      Math.min(...state.boids.map((b) => Math.hypot(b.x - p.x, b.y - p.y)))
    const before = nearest(state.predators[0])
    for (let i = 0; i < 150; i++) stepFlock(state, params, 1, DENSE.w, DENSE.h, rng)
    expect(nearest(state.predators[0])).toBeLessThan(before * 0.5)
  })

  it('掠食者不计入 polarization（只统计鸟）', () => {
    // 4 只鸟全部朝 +x，掠食者方向随机：极化度必须恰好是 1
    const params = { ...defaultParams(), count: 4, predatorCount: 4 }
    const state: FlockState = {
      boids: [
        { x: 10, y: 10, vx: 2, vy: 0 },
        { x: 90, y: 20, vx: 2, vy: 0 },
        { x: 40, y: 70, vx: 2, vy: 0 },
        { x: 70, y: 90, vx: 2, vy: 0 }
      ],
      predators: [
        { x: 50, y: 50, vx: -3, vy: 0 },
        { x: 20, y: 50, vx: 0, vy: 3 },
        { x: 80, y: 50, vx: 0, vy: -3 },
        { x: 50, y: 10, vx: 3, vy: 0 }
      ],
      time: 0
    }
    expect(computeMetrics(state, params).polarization).toBeCloseTo(1, 12)
  })

  it('predatorFear 让鸟躲开掠食者（全程最近距离变大）', () => {
    const build = (fear: number) => {
      const params: BoidParams = {
        ...defaultParams(),
        count: 30,
        predatorCount: 0,
        predatorFear: fear,
        predatorSpeed: 0,
        noise: 0
      }
      const rng = mulberry32(17)
      const state = createFlock(params, DENSE.w, DENSE.h, rng)
      // 鸟群集中在中线左侧、朝 +x 飞；掠食者静止地挡在它们正前方
      for (const b of state.boids) {
        b.x = 150 + rng() * 40
        b.y = DENSE.h / 2 + (rng() - 0.5) * 40
        b.vx = 2.6
        b.vy = 0
      }
      state.predators.push({ x: 260, y: DENSE.h / 2, vx: 0, vy: 0 })
      const predator = state.predators[0]
      const gap = () =>
        state.boids.reduce((s, b) => s + Math.hypot(b.x - predator.x, b.y - predator.y), 0) / state.boids.length
      let minGap = gap()
      for (let i = 0; i < 120; i++) {
        stepFlock(state, params, 1, DENSE.w, DENSE.h, rng)
        minGap = Math.min(minGap, gap())
      }
      return minGap
    }
    const blind = build(0)
    const scared = build(8)
    expect(scared).toBeGreaterThan(blind + 5)
  })
})

/* ================================================================== *
 * 6 · 预设与参数范围
 * ================================================================== */

describe('6 · 预设与参数范围', () => {
  it('默认参数满足规格（260 只鸟 / 感知 46 / 全向视野 / maxSpeed 2.6）', () => {
    const d = defaultParams()
    expect(d.count).toBe(260)
    expect(d.perception).toBe(46)
    expect(d.fov).toBeCloseTo(2 * Math.PI, 12)
    expect(d.maxSpeed).toBeCloseTo(2.6, 12)
    expect(d.separation).toBeGreaterThan(0)
    expect(d.alignment).toBeGreaterThan(0)
    expect(d.cohesion).toBeGreaterThan(0)
    expect(d.boundary).toBe('wrap')
  })

  it('至少 5 个预设，覆盖经典三规则 / 只看对齐 / 无分离 / 有掠食者 / 高噪声', () => {
    expect(BOID_PRESETS.length).toBeGreaterThanOrEqual(5)
    const ids = BOID_PRESETS.map((p) => p.id)
    for (const id of ['classic', 'alignment-only', 'no-separation', 'predator', 'high-noise']) {
      expect(ids).toContain(id)
    }
    for (const preset of BOID_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.detail.length).toBeGreaterThan(0)
    }
  })

  it('每个预设都能构造出有限、不越界的群体', () => {
    for (const preset of BOID_PRESETS) {
      const params: BoidParams = { ...defaultParams(), count: 60, ...preset.params }
      const rng = mulberry32(1)
      const state = createFlock(params, DENSE.w, DENSE.h, rng)
      expect(state.boids.length).toBe(params.count)
      for (let i = 0; i < 80; i++) stepFlock(state, params, 1, DENSE.w, DENSE.h, rng)
      for (const b of [...state.boids, ...state.predators]) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true)
        expect(b.x).toBeGreaterThanOrEqual(-1e-6)
        expect(b.x).toBeLessThanOrEqual(DENSE.w + 1e-6)
      }
    }
  })

  it('PARAM_RANGES 覆盖每个数值参数，且默认值落在滑块范围内', () => {
    const d = defaultParams()
    for (const key of NUMERIC_KEYS) {
      const range = PARAM_RANGES[key]
      expect(range, key).toBeTruthy()
      expect(range.max).toBeGreaterThan(range.min)
      expect(range.step).toBeGreaterThan(0)
      expect(d[key], key).toBeGreaterThanOrEqual(range.min)
      expect(d[key], key).toBeLessThanOrEqual(range.max)
    }
  })
})
