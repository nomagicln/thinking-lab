/**
 * engine.ts — 麦克斯韦妖（Maxwell's Demon）实验内核
 * ===========================================================================
 * 纯计算模块：不依赖 React、不依赖任何浏览器 API，可以在 Node 里直接跑测试。
 * 本文件里没有 `Math.random()`，所有随机性都来自调用方传入的 `rng`。
 *
 * ## 一、思想实验
 * 1867 年麦克斯韦设想：箱子里装气体，正中间一道隔板，隔板中央开一扇小门，
 * 由一只「妖」看守。妖只做一件事 ——
 *   · 看到左边的分子朝右飞、而且飞得快 → 开门，放它去右边；
 *   · 看到右边的分子朝左飞、而且飞得慢 → 开门，放它去左边；
 *   · 其余情况关门。
 * 快分子被赶到右边、慢分子被赶到左边，箱子自己分化成一冷一热。
 * 看上去妖把「热量自发从冷流向热」做成了，第二定律似乎被违反。
 *
 * ## 二、Landauer 的账本
 * 1961 年 Landauer 指出：擦除 1 比特信息至少要向环境耗散 kT ln2 的热。
 * 妖必须为每颗粒子记录「快 / 慢」（测量），记忆写满之后必须擦除；擦除就是熵的来源。
 * 把这笔账和气体本身的熵变加在一起，总熵（气体 + 妖 + 环境）从不减少。
 *
 * 本模块实时维护这笔账：
 *     netEntropy = deltaSGas + deltaSErase + deltaSMeasure  ≥ 0
 * 理想妖（无限记忆、不擦除）下 deltaSErase = 0，deltaSGas 可以显著为负 —— 这是悖论；
 * 记忆一旦有限、必须擦除，deltaSErase 就把账补回来 —— 这是解答。
 *
 * ## 三、单位约定（重要，和题面一致）
 * 取 k = m = h = 1（自然单位），所有熵都以 k 为单位，温度以 kT 的能量单位计。
 *   · 二维气体每个粒子只有 2 个自由度。均分定理给 <½mv²> = kT，于是
 *         T = <v²> / 2          （不是三维的 <v²>/3）
 *   · 初始速度按二维麦克斯韦-玻尔兹曼分布抽样：vx, vy ~ Normal(0, √T)。
 *     此时 <vx²> = <vy²> = T，<v²> = 2T，正好给出 T = <v²>/2。
 *   · 二维理想气体熵（Sackur–Tetrode 形式，k = m = h = 1）：
 *         S = N [ ln(2π A T / N) + 2 ]
 *     推导：S = Nk[ln(A/(Nλ²)) + 2]，热德布罗意波长 λ = h/√(2πmkT)，
 *     于是 A/(Nλ²) = 2π A m k T / (N h²) = 2π A T / N（自然单位下）。
 *     绝对熵里差一个可加常数，本身没有意义；有意义的是**熵差**，而差值与该常数无关，
 *     所以这个约定对本书的记账是安全的。N 或 T 为 0 时返回 0（约定，避免 ln0）。
 *   · 隔板把箱子分成左右两半，每半面积 A/2；气体总熵 = 两侧熵之和：
 *         sGas = S(nL, A/2, TL) + S(nR, A/2, TR)
 *     nL = nR 且 TL = TR 时它恰好退化为整箱的 S(N, A, T)，不会凭空多出「混合熵」。
 *   · deltaSErase   = bitsErased   × ln2                    （Landauer 下限）
 *   · deltaSMeasure = bitsRecorded × measurementCost × ln2
 *
 * ## 四、实现上的几个决定（与题面字面表述的差异会在汇报里说明）
 * 1. 妖只在粒子**真正抵达隔板所在平面 x = width/2** 的那一瞬间做判断 ——
 *    「开门 / 关门」的后果此刻才发生。这样每次判断恰好对应一次过门尝试，
 *    天然不会对同一颗粒子在同一时刻重复计费；被关在门外的粒子弹回去、
 *    回头再来一次，就是一次新的测量（物理上也确实要重新看一眼）。
 * 2. 门高按硬圆盘修正：半径 r 的圆盘要穿过高 gateHeight 的门，圆心必须落在
 *    中间 gateHeight/2 − r 的范围内，否则会撞在门框上。
 * 3. `lazy` 采用 ±30% 的迟滞带：只对「明显快 / 明显慢」的粒子动手，
 *    判据是 `maxwell` 判据的严格子集 ⇒ 开门次数更少、温差建立更慢（见测试实测）。
 * 4. `measurementCost` 只进熵账本，不从动能里扣能量。这样「弹性碰撞守恒动能」
 *    在任何参数下都成立；而题面对它的定义本来就是一个熵账目项。
 * 5. 初始气体熵 `sGasInitial` 记在 state 的**可选**字段里，用来算 deltaSGas。
 *    字段缺失时（调用方手工拼 state）退化为「与同总能量的平衡态相比」。
 */

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** 妖的策略。 */
export type DemonPolicy = 'maxwell' | 'lazy' | 'reverse' | 'none'

export interface DemonParams {
  particleCount: number
  temperature: number
  radius: number
  gateHeight: number
  /** 「快 / 慢」的分界速度 */
  speedThreshold: number
  /** 妖的记忆容量（比特）。Infinity 表示永不擦除 */
  memoryCapacity: number
  policy: DemonPolicy
  /** 每次测量额外耗散，单位是 kT ln2 的倍数，默认 0 */
  measurementCost: number
}

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

export interface DemonState {
  particles: Particle[]
  time: number
  /** 妖累计记录的比特数 */
  bitsRecorded: number
  /** 累计擦除的比特数 */
  bitsErased: number
  /** 当前占用的记忆位数 */
  memoryUsed: number
  /** 从左穿到右的次数 */
  crossingsLR: number
  crossingsRL: number
  gateOpens: number
  /**
   * 内部记账：创建时的气体熵，deltaSGas 的零点。
   * 设为可选，是为了让 `DemonState` 的字面量仍然可以只写上面 8 个字段；
   * 缺失时 measureDemon 会退化成「同总能量的平衡态」作参考。
   */
  sGasInitial?: number
}

export interface DemonMetrics {
  tempLeft: number
  tempRight: number
  nLeft: number
  nRight: number
  /** 当前气体总熵（单位 k） */
  sGas: number
  /** 相对初始状态的变化 */
  deltaSGas: number
  /** 擦除记忆付出的熵，= bitsErased × ln2 */
  deltaSErase: number
  /** 测量耗散，= bitsRecorded × measurementCost × ln2 */
  deltaSMeasure: number
  /** deltaSGas + deltaSErase + deltaSMeasure */
  netEntropy: number
  /** 热侧温度 / 冷侧温度（≥ 1） */
  hotColdRatio: number
}

/** 箱子尺寸。等价于题面里的 `{ width: number; height: number }`。 */
export interface Box {
  width: number
  height: number
}

export interface DemonPreset {
  id: string
  name: string
  detail: string
  params: Partial<DemonParams>
}

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

const LN2 = Math.LN2

/** lazy 妖的迟滞带宽度：只在偏离阈值 ±30% 之外才动手。 */
const LAZY_HYSTERESIS = 0.3

/** 测试与界面共用的默认箱子（物理单位，不是像素）。 */
export const DEFAULT_BOX: Box = { width: 400, height: 200 }

/**
 * 二维麦克斯韦-玻尔兹曼速率分布（瑞利分布）的中位数：
 * median = σ√(2 ln2)，σ = √T。T = 1 时 ≈ 1.1774。
 * speedThreshold 取在它附近，妖一开始正好把速率分布对半分。
 */
export const RAYLEIGH_MEDIAN_FACTOR = Math.sqrt(2 * Math.LN2)

/* ------------------------------------------------------------------ *
 * 熵
 * ------------------------------------------------------------------ */

/**
 * 二维理想气体熵，Sackur–Tetrode 形式，单位约定 k = m = h = 1：
 *
 *     S = N [ ln(2π A T / N) + 2 ]
 *
 * N、T 或 A 为 0（或非法值）时返回 0 —— 约定，同时避免 ln0 → −∞。
 * 注意绝对熵差一个可加常数，但本实验只关心差值，所以不影响结论。
 */
export function idealGasEntropy(n: number, area: number, temperature: number): number {
  if (!(n > 0) || !(area > 0) || !(temperature > 0)) return 0
  return n * (Math.log((2 * Math.PI * area * temperature) / n) + 2)
}

/** 把粒子按隔板分到左右两半，算出气体总熵（两半熵之和）。 */
function gasEntropy(particles: readonly Particle[], box: Box): number {
  const mid = box.width / 2
  const halfArea = (box.width / 2) * box.height
  let nLeft = 0
  let nRight = 0
  let sumV2Left = 0
  let sumV2Right = 0
  for (const p of particles) {
    const v2 = p.vx * p.vx + p.vy * p.vy
    if (p.x < mid) {
      nLeft += 1
      sumV2Left += v2
    } else {
      nRight += 1
      sumV2Right += v2
    }
  }
  // 二维温度：T = <v²>/2
  const tLeft = nLeft > 0 ? sumV2Left / (2 * nLeft) : 0
  const tRight = nRight > 0 ? sumV2Right / (2 * nRight) : 0
  return idealGasEntropy(nLeft, halfArea, tLeft) + idealGasEntropy(nRight, halfArea, tRight)
}

/* ------------------------------------------------------------------ *
 * 随机数工具（只用调用方给的 rng，绝不碰 Math.random）
 * ------------------------------------------------------------------ */

/** 标准正态抽样（Box–Muller）。对 rng 的退化返回值做保护，避免 log(0)。 */
function sampleNormal(rng: () => number): number {
  const u = Math.max(1e-12, rng())
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Fisher–Yates：返回 0..n−1 的一个随机排列（用传入的 rng，保证同 seed 同结果）。 */
function shuffledIndices(n: number, rng: () => number): Int32Array {
  const idx = new Int32Array(n)
  for (let i = 0; i < n; i++) idx[i] = i
  for (let i = n - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(rng() * (i + 1))))
    const tmp = idx[i]
    idx[i] = idx[j]
    idx[j] = tmp
  }
  return idx
}

/* ------------------------------------------------------------------ *
 * 构造
 * ------------------------------------------------------------------ */

export function defaultParams(): DemonParams {
  return {
    particleCount: 220,
    temperature: 1,
    radius: 3,
    gateHeight: 26,
    // 二维瑞利分布（麦克斯韦速率分布）的中位数 √(2 ln2) ≈ 1.1774（T = 1）
    speedThreshold: Math.round(RAYLEIGH_MEDIAN_FACTOR * 1000) / 1000,
    memoryCapacity: 24,
    policy: 'maxwell',
    measurementCost: 0
  }
}

/**
 * 造一个初始状态：位置在箱内（留出半径边距）近似均匀撒点，速度按二维
 * 麦克斯韦-玻尔兹曼分布抽样（vx, vy ~ N(0, √T)），因此 <v²>/2 = T。
 *
 * 位置用有限次拒绝采样避免初始重叠：重叠本身不会破坏物理（下一步就会弹开），
 * 但会带来一个巨大的初始势能假象与额外噪声，不如一开始就撒干净。
 */
export function createDemon(params: DemonParams, box: Box, rng: () => number): DemonState {
  const width = Math.max(1e-6, box.width)
  const height = Math.max(1e-6, box.height)
  const radius = Math.max(1e-6, params.radius)
  const count = Number.isFinite(params.particleCount) ? Math.max(0, Math.floor(params.particleCount)) : 0
  const temperature = Number.isFinite(params.temperature) ? Math.max(0, params.temperature) : 0
  const sigma = Math.sqrt(temperature)

  const margin = radius
  const spanX = Math.max(0, width - 2 * margin)
  const spanY = Math.max(0, height - 2 * margin)
  const minGap2 = (2 * radius) * (2 * radius)
  const maxAttempts = 24

  const particles: Particle[] = []
  for (let i = 0; i < count; i++) {
    let x = margin + spanX / 2
    let y = margin + spanY / 2
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      x = margin + rng() * spanX
      y = margin + rng() * spanY
      let free = true
      for (let j = 0; j < particles.length; j++) {
        const dx = particles[j].x - x
        const dy = particles[j].y - y
        if (dx * dx + dy * dy < minGap2) {
          free = false
          break
        }
      }
      if (free) break
    }
    particles.push({
      x,
      y,
      vx: sampleNormal(rng) * sigma,
      vy: sampleNormal(rng) * sigma,
      r: radius
    })
  }

  const state: DemonState = {
    particles,
    time: 0,
    bitsRecorded: 0,
    bitsErased: 0,
    memoryUsed: 0,
    crossingsLR: 0,
    crossingsRL: 0,
    gateOpens: 0
  }
  // 记下真实的初始气体熵：deltaSGas(0) 于是恰好为 0（有限样本涨落被抵消）。
  state.sGasInitial = gasEntropy(particles, { width, height })
  return state
}

/* ------------------------------------------------------------------ *
 * 妖的判据
 * ------------------------------------------------------------------ */

/**
 * 妖是否开门。
 * @param policy   策略
 * @param speed    粒子在门口时的速率 |v|
 * @param threshold 快 / 慢分界
 * @param fromLeft 粒子来自左半（正在向右穿过）
 *
 * maxwell：左边来的快粒子放行，右边来的慢粒子放行。
 * reverse：把快慢判断反过来，于是制造出反向（左热右冷）的梯度。
 * lazy   ：±30% 迟滞带 —— 只有明显快 / 明显慢才动手，判据是 maxwell 的子集，
 *          所以开门次数更少（「懒得动」），代价是温差建立更慢。
 * none   ：门焊死，作为对照组。
 */
function demonOpens(policy: DemonPolicy, speed: number, threshold: number, fromLeft: boolean): boolean {
  switch (policy) {
    case 'none':
      return false
    case 'maxwell':
      return fromLeft ? speed > threshold : speed < threshold
    case 'reverse':
      return fromLeft ? speed < threshold : speed > threshold
    case 'lazy': {
      const lo = threshold * (1 - LAZY_HYSTERESIS)
      const hi = threshold * (1 + LAZY_HYSTERESIS)
      return fromLeft ? speed > hi : speed < lo
    }
  }
}

/* ------------------------------------------------------------------ *
 * 硬圆盘碰撞
 * ------------------------------------------------------------------ */

function clampIndex(value: number, size: number): number {
  if (!Number.isFinite(value)) return 0
  const v = Math.floor(value)
  if (v < 0) return 0
  if (v > size - 1) return size - 1
  return v
}

/**
 * 一对等质量硬圆盘的弹性碰撞。
 * 先做位置修正（把重叠各退一半，只动位置、不动速度，因此不改变动能），
 * 再交换法向速度分量 —— 等质量弹性碰撞的法向分量互换，切向不变，
 * 于是 Σv² 精确守恒（浮点意义下）。
 */
function collidePair(a: Particle, b: Particle): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const sum = a.r + b.r
  const d2 = dx * dx + dy * dy
  if (d2 >= sum * sum) return
  if (d2 <= 1e-24) return // 完全重合：无法定义法向，留到下一步再说
  const d = Math.sqrt(d2)
  const nx = dx / d
  const ny = dy / d

  const overlap = sum - d
  const shift = 0.5 * overlap
  a.x -= nx * shift
  a.y -= ny * shift
  b.x += nx * shift
  b.y += ny * shift

  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (vn >= 0) return // 已经在分离，不施加冲量

  a.vx += vn * nx
  a.vy += vn * ny
  b.vx -= vn * nx
  b.vy -= vn * ny
}

/**
 * 粒子-粒子碰撞。低密度下 O(N²) 也够，但用均匀网格做宽相：
 * 格子边长取最大直径 2r_max，则任何可能相碰的一对必然落在同一格或相邻格，
 * 只需扫 3×3 邻域，复杂度降到 O(N)。
 *
 * `placement` 是每颗粒子这一步被隔板判定后归属的一侧：**跨隔板的一对粒子
 * 不许碰撞**，否则两半会隔着隔板交换动量与能量，左右两侧就不再是
 * 「被墙隔开」的两个子系统 —— 实测会让 none 对照组也慢慢长出温差来。
 * 代价是同时穿过门口的一对粒子不会互碰，这是零厚度隔板模型下可以接受的近似。
 */
function collideParticles(ps: Particle[], box: Box, placement: Uint8Array): void {
  const n = ps.length
  if (n < 2) return

  let maxR = 0
  for (let i = 0; i < n; i++) {
    if (ps[i].r > maxR) maxR = ps[i].r
  }
  const cell = Math.max(2 * maxR, 1e-9)
  const cols = Math.max(1, Math.floor(box.width / cell) + 1)
  const rows = Math.max(1, Math.floor(box.height / cell) + 1)

  const head = new Int32Array(cols * rows).fill(-1)
  const next = new Int32Array(n)
  const cellX = new Int32Array(n)
  const cellY = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const p = ps[i]
    const gx = clampIndex(p.x / cell, cols)
    const gy = clampIndex(p.y / cell, rows)
    cellX[i] = gx
    cellY[i] = gy
    const c = gy * cols + gx
    next[i] = head[c]
    head[c] = i
  }

  for (let i = 0; i < n; i++) {
    const a = ps[i]
    const gx = cellX[i]
    const gy = cellY[i]
    for (let oy = -1; oy <= 1; oy++) {
      const yy = gy + oy
      if (yy < 0 || yy >= rows) continue
      for (let ox = -1; ox <= 1; ox++) {
        const xx = gx + ox
        if (xx < 0 || xx >= cols) continue
        for (let j = head[yy * cols + xx]; j !== -1; j = next[j]) {
          // 只处理 j > i：每一对检查一次，且网格里每个粒子只被访问一次
          if (j <= i) continue
          // 隔板两侧的粒子不碰撞（隔板是固体墙）
          if (placement[i] !== placement[j]) continue
          collidePair(a, ps[j])
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * 推进一步
 * ------------------------------------------------------------------ */

/**
 * 推进一个时间步 dt，**原地修改** state（粒子是热路径上的大数组，
 * 每步拷贝一份不划算），并返回本步结束后的度量。
 *
 * 顺序：自由飞行 → 隔板 / 门 → 箱壁 → 粒子碰撞 → 隔板约束 → 箱内兜底 → 记账。
 * 之所以先判门、再碰粒子，是因为「门开不开」决定了粒子这一步属于哪一侧；
 * 若先碰粒子，一个本该被门挡回去的粒子会先跟另一侧的粒子交换能量，
 * 再被弹回来 —— 能量就这样隔着隔板漏过去了（实测 none 对照组会因此凭空升温）。
 * `rng` 只用来打乱「同一帧内多个粒子同时抵达门口」的判定顺序，
 * 避免固定遍历顺序带来系统性偏差；力学积分本身是确定性的，不含噪声。
 */
export function stepDemon(
  state: DemonState,
  params: DemonParams,
  box: Box,
  dt: number,
  rng: () => number
): DemonMetrics {
  const ps = state.particles
  const n = ps.length
  const mid = box.width / 2
  const gateCenterY = box.height / 2
  const halfGate = Math.max(0, params.gateHeight / 2)
  const SIDE_EPS = 1e-9

  // 1) 自由飞行。prevX 是这一步开始时的位置，ballisticX 是无碰撞的自由飞行终点，
  //    两者用来判断粒子是否**真的朝隔板飞了过去**（而不是被撞过去的）。
  const prevX = new Float64Array(n)
  const ballisticX = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = ps[i]
    prevX[i] = p.x
    p.x += p.vx * dt
    p.y += p.vy * dt
    ballisticX[i] = p.x
  }

  // 2) 隔板与门。placement[i] 记下这颗粒子这一步归属哪一侧（0 左 / 1 右）。
  const placement = new Uint8Array(n)
  const order = shuffledIndices(n, rng)
  for (let k = 0; k < n; k++) {
    const i = order[k]
    const p = ps[i]
    const startLeft = prevX[i] < mid
    const wantLeft = startLeft ? 0 : 1
    placement[i] = wantLeft

    // 没有跨过隔板所在平面：门与它无关
    if ((ballisticX[i] < mid) === startLeft) continue

    // 真的朝隔板飞过去并穿过了平面，这才轮到妖做判断
    const openHalf = Math.max(0, halfGate - p.r)
    const inGate = Math.abs(p.y - gateCenterY) <= openHalf
    if (!inGate) {
      // 撞在门框 / 隔板实体上：镜像弹回，不需要判断，也不消耗记忆
      p.x = 2 * mid - p.x
      p.vx = -p.vx
      continue
    }

    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
    const open = demonOpens(params.policy, speed, params.speedThreshold, startLeft)

    // 每次判断（无论开不开门）都算一次测量：记录一位，占用一位记忆
    state.bitsRecorded += 1
    state.memoryUsed += 1
    const capacity = params.memoryCapacity
    if (Number.isFinite(capacity) && state.memoryUsed >= capacity) {
      // 记忆写满：全部擦除，Landauer 的账在这里发生
      state.bitsErased += state.memoryUsed
      state.memoryUsed = 0
    }

    if (open) {
      state.gateOpens += 1
      if (startLeft) state.crossingsLR += 1
      else state.crossingsRL += 1
      placement[i] = startLeft ? 1 : 0
    } else {
      p.x = 2 * mid - p.x
      p.vx = -p.vx
    }
  }

  // 3) 箱壁：镜面反射，并把位置夹回箱内（半径边距）
  for (let i = 0; i < n; i++) {
    const p = ps[i]
    if (p.x < p.r) {
      p.x = p.r
      if (p.vx < 0) p.vx = -p.vx
    } else if (p.x > box.width - p.r) {
      p.x = box.width - p.r
      if (p.vx > 0) p.vx = -p.vx
    }
    if (p.y < p.r) {
      p.y = p.r
      if (p.vy < 0) p.vy = -p.vy
    } else if (p.y > box.height - p.r) {
      p.y = box.height - p.r
      if (p.vy > 0) p.vy = -p.vy
    }
  }

  // 4) 粒子之间的弹性碰撞（隔板两侧不互碰，所以不会隔着墙传能量）
  collideParticles(ps, box, placement)

  // 5) 隔板约束：碰撞修正可能把粒子推过隔板平面，这里把它夹回自己那一侧。
  //    只动位置、不动速度，所以不涉及能量转移；没有这一步，两半会缓慢互漏。
  for (let i = 0; i < n; i++) {
    const p = ps[i]
    const wantLeft = placement[i] === 0
    if ((p.x < mid) !== wantLeft) p.x = wantLeft ? mid - SIDE_EPS : mid + SIDE_EPS
  }

  // 6) 兜底：位置修正同样可能把粒子挤出箱外，最后只夹位置、不动速度。
  //    放在最后是为了保证「粒子始终留在箱内」这条硬约束在任何情况下都成立。
  for (let i = 0; i < n; i++) {
    const p = ps[i]
    if (p.x < p.r) p.x = p.r
    else if (p.x > box.width - p.r) p.x = box.width - p.r
    if (p.y < p.r) p.y = p.r
    else if (p.y > box.height - p.r) p.y = box.height - p.r
  }

  state.time += dt
  return measureDemon(state, params, box)
}

/* ------------------------------------------------------------------ *
 * 度量
 * ------------------------------------------------------------------ */

/**
 * 只读地算一遍全部度量，不推进时间、不改动 state。
 *
 * 熵的记账：
 *   sGas        = S(nL, A/2, TL) + S(nR, A/2, TR)
 *   deltaSGas   = sGas − sGasInitial
 *   deltaSErase = bitsErased × ln2
 *   deltaSMeasure = bitsRecorded × measurementCost × ln2
 *   netEntropy  = 三者之和（Landauer 要求它不显著为负）
 */
export function measureDemon(state: DemonState, params: DemonParams, box: Box): DemonMetrics {
  const ps = state.particles
  const mid = box.width / 2
  const halfArea = (box.width / 2) * box.height

  let nLeft = 0
  let nRight = 0
  let sumV2Left = 0
  let sumV2Right = 0
  for (const p of ps) {
    const v2 = p.vx * p.vx + p.vy * p.vy
    if (p.x < mid) {
      nLeft += 1
      sumV2Left += v2
    } else {
      nRight += 1
      sumV2Right += v2
    }
  }

  // 二维温度定义 T = <v²>/2
  const tempLeft = nLeft > 0 ? sumV2Left / (2 * nLeft) : 0
  const tempRight = nRight > 0 ? sumV2Right / (2 * nRight) : 0

  const sGas = idealGasEntropy(nLeft, halfArea, tempLeft) + idealGasEntropy(nRight, halfArea, tempRight)

  // 参考点：优先用创建时记下的真实初始熵；缺失时退化为「同总能量的平衡态」，
  // 后者在初始时刻与前者一致（都等于 <v²>/2 = T 的均匀气体）。
  const reference =
    state.sGasInitial ??
    idealGasEntropy(ps.length, box.width * box.height, totalTemperature(ps))

  const deltaSGas = sGas - reference
  const deltaSErase = state.bitsErased * LN2
  const deltaSMeasure = state.bitsRecorded * params.measurementCost * LN2
  const netEntropy = deltaSGas + deltaSErase + deltaSMeasure

  // 温度下限，避免 0/0 → NaN 或 Infinity（两个都空时比值约定为 1）
  const tLeft = Math.max(tempLeft, 1e-12)
  const tRight = Math.max(tempRight, 1e-12)
  const hotColdRatio = Math.max(tLeft, tRight) / Math.min(tLeft, tRight)

  return {
    tempLeft,
    tempRight,
    nLeft,
    nRight,
    sGas,
    deltaSGas,
    deltaSErase,
    deltaSMeasure,
    netEntropy,
    hotColdRatio
  }
}

/** 整箱温度 T = Σv² / (2N)（二维）。 */
function totalTemperature(particles: readonly Particle[]): number {
  if (particles.length === 0) return 0
  let sumV2 = 0
  for (const p of particles) sumV2 += p.vx * p.vx + p.vy * p.vy
  return sumV2 / (2 * particles.length)
}

/* ------------------------------------------------------------------ *
 * 界面用的预设与滑块范围
 * ------------------------------------------------------------------ */

export const DEMON_PRESETS: DemonPreset[] = [
  {
    id: 'ideal',
    name: '理想妖',
    detail: '记忆无限、测量不花钱。气体熵真的掉下去 —— 悖论就摆在眼前：netEntropy < 0。',
    params: { policy: 'maxwell', memoryCapacity: Number.POSITIVE_INFINITY, measurementCost: 0 }
  },
  {
    id: 'finite',
    name: '有限记忆妖',
    detail: '记忆只有 24 比特，写满就必须擦除。Landauer 的账把总熵补回 0 以上。',
    params: { policy: 'maxwell', memoryCapacity: 24, measurementCost: 0 }
  },
  {
    id: 'lazy',
    name: '懒妖',
    detail: '±30% 迟滞带：只有明显快 / 明显慢才动手。开门更少，温差建立得更慢。',
    params: { policy: 'lazy', memoryCapacity: 64, measurementCost: 0 }
  },
  {
    id: 'reverse',
    name: '反向妖',
    detail: '把快慢判断反过来：专放慢的往右、快的往左，于是自己制造出反向梯度。',
    params: { policy: 'reverse', memoryCapacity: 24, measurementCost: 0 }
  },
  {
    id: 'none',
    name: '无妖对照',
    detail: '门焊死。气体只是普通热浴，冷热温度比停在 1 附近。',
    params: { policy: 'none', memoryCapacity: Number.POSITIVE_INFINITY, measurementCost: 0 }
  },
  {
    id: 'costly',
    name: '昂贵的测量',
    detail: '每次测量额外耗散 1 个 kT ln2。就算妖永不擦除记忆，账也已经回正。',
    params: { policy: 'maxwell', memoryCapacity: Number.POSITIVE_INFINITY, measurementCost: 1 }
  }
]

export const PARAM_RANGES: Record<string, { min: number; max: number; step: number }> = {
  particleCount: { min: 40, max: 600, step: 10 },
  temperature: { min: 0.2, max: 3, step: 0.05 },
  radius: { min: 1.5, max: 6, step: 0.5 },
  gateHeight: { min: 8, max: 80, step: 2 },
  speedThreshold: { min: 0.2, max: 3, step: 0.02 },
  // 滑块只能给有限范围；「理想妖」（永不擦除）用 DEMON_PRESETS 里的 Infinity。
  memoryCapacity: { min: 8, max: 1024, step: 8 },
  measurementCost: { min: 0, max: 5, step: 0.1 }
}
