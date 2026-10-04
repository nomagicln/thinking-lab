/**
 * engine.ts — Boids 鸟群模型 · 计算内核
 * ===========================================================================
 * Craig Reynolds (1987) 用三条**局部**规则解释了鸟群、鱼群、羊群的自发秩序：
 *
 *   1. 分离 separation —— 躲开过近的邻居，避免碰撞；
 *   2. 对齐 alignment  —— 转向邻居的平均速度方向，形成共同航向；
 *   3. 聚合 cohesion   —— 转向邻居的平均位置，保持成群。
 *
 * 每只鸟只看得到「感知半径 perception + 视野全角 fov」内的邻居，没有任何
 * 全局信息，也没有领头者。秩序（极化度接近 1 的定向迁移）是局部规则的
 * 涌现结果，这正是这个实验想让人看见的东西。
 *
 * 本文件是纯计算内核：不引用 React，不触碰 window / canvas / performance，
 * 所有随机性来自外部传入的 rng，因此同 seed 在任何环境都能逐位复现。
 *
 * ── 噪声为什么必须按 Vicsek 的方式加 ──────────────────────────────────────
 * Vicsek 等 (1995) 的模型里，每步给速度**方向**加一个均匀分布的角度扰动
 * θ += η·ξ，ξ ~ U(-π, π)，幅度 = noise·π。只有这种「方向上的硬噪声」才能
 * 测出有序–无序相变：它一步就能把方向打乱，而转向力有 maxForce 上限，无
 * 法立刻把方向拉回来。若改成在速度向量上叠加随机量，噪声会被速度上限和
 * 归一化吸收，极化度曲线会变成一条平缓的斜坡，相变消失——那样这个实验
 * 的科学内核就没了。
 */

/* ================================================================== *
 * 类型
 * ================================================================== */

/** 边界处理方式：环绕 / 反弹 / 朝中心弱吸引 */
export type BoundaryMode = 'wrap' | 'bounce' | 'attract'

/** 一次仿真的全部可调参数。单位统一为「像素 / 步」。 */
export interface BoidParams {
  count: number
  perception: number
  fov: number // 视野全角（弧度），2π 表示全向
  separationRadius: number // 硬分离半径
  separation: number // 三条规则的权重
  alignment: number
  cohesion: number
  maxSpeed: number
  minSpeed: number
  maxForce: number // 单步转向力上限（限制转向的剧烈程度）
  noise: number // 方向噪声强度，0..1
  boundary: BoundaryMode
  predatorCount: number
  predatorFear: number // 掠食者带来的额外分离强度
  predatorSpeed: number
}

/** 一只鸟（或一只掠食者）：位置 + 速度，都用笛卡尔分量表示。 */
export interface Boid {
  x: number
  y: number
  vx: number
  vy: number
}

export interface FlockState {
  boids: Boid[]
  predators: Boid[]
  time: number
}

export interface FlockMetrics {
  polarization: number // 序参量：|Σ v̂_i| / N ∈ [0,1]
  meanNeighborDistance: number // 最近邻平均距离
  radiusOfGyration: number // 群体紧致度（到质心的均方根距离）
  alignmentRate: number // 方向一致性（极化度的一个更平滑的版本）
}

/** 单只鸟的三条规则贡献，供界面「规则分解」面板使用。 */
export interface RuleBreakdown {
  separation: [number, number]
  alignment: [number, number]
  cohesion: [number, number]
  total: [number, number]
}

export interface BoidPreset {
  id: string
  name: string
  detail: string
  params: Partial<BoidParams>
}

/* ================================================================== *
 * 常量与内部工具
 * ================================================================== */

const TAU = Math.PI * 2
/** 零长度向量的判定阈值；小于它就没有可信的方向可言。 */
const EPS = 1e-9
/**
 * 单帧 dt 上限。浏览器切回标签页时 requestAnimationFrame 会给出一个很大的
 * dt，若原样乘进速度，鸟会「瞬移」穿墙甚至飞出数值范围。这里把它夹住。
 */
const MAX_DT = 1

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 每个 FlockState 对应的画布尺寸。
 *
 * ruleBreakdown(state, params, index) 与 computeMetrics(state, params) 的签名里
 * 都没有 width/height，但 wrap 模式下必须知道盒子大小才能做最小镜像距离
 * （否则鸟群穿过接缝的一瞬间会被「拉回画布中央」，秩序直接被撕碎）。这里用
 * WeakMap 把尺寸登记在旁表里：不改变 state 的形状、不影响深比较、多个
 * 不同尺寸的群体也互不干扰。手工构造的 state 查不到尺寸，退回欧氏距离。
 */
const BOX = new WeakMap<FlockState, { width: number; height: number }>()

function boxOf(state: FlockState, boundary: BoundaryMode): { width: number; height: number } | null {
  if (boundary !== 'wrap') return null
  const b = BOX.get(state)
  if (!b || !(b.width > EPS) || !(b.height > EPS)) return null
  return b
}

/** 最小镜像：把分量差折算到 [-size/2, size/2)，得到环形空间里的最短位移。 */
function wrapDelta(d: number, size: number): number {
  return size > EPS ? d - Math.round(d / size) * size : d
}

/** 把可能来自滑块的 NaN / Infinity / undefined 兜回默认值。 */
function num(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** 把任意向量截断到 max 长度（max <= 0 时截断为零向量）。 */
function limit(x: number, y: number, max: number): [number, number] {
  const m = Math.hypot(x, y)
  if (!(m > EPS)) return [0, 0]
  if (m <= max) return [x, y]
  const s = max / m
  return [x * s, y * s]
}

/** mulberry32：小、快、可复现的 PRNG，用来把 sweepNoise 的数值 seed 展开。 */
function seededRng(seed: number): () => number {
  // 允许传入任意浮点 seed：先混进 32 位整数，避免 0.5 与 0.5+2^-32 撞车。
  let a = (Math.floor(num(seed, 0) * 4294967296) ^ Math.floor(num(seed, 0))) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 统一净化参数：负半径、NaN 权重、minSpeed > maxSpeed 之类的输入都收敛到
 * 合法区间。内核被界面直接驱动，任何一处 NaN 都会污染整个群体，所以宁可
 * 在入口处多花一点时间。
 */
function normParams(raw: BoidParams): BoidParams {
  const d = defaultParams()
  const maxSpeed = Math.max(0, num(raw.maxSpeed, d.maxSpeed))
  const minSpeed = clamp(num(raw.minSpeed, d.minSpeed), 0, maxSpeed)
  const mode = raw.boundary
  return {
    count: Math.max(0, Math.min(20000, Math.floor(num(raw.count, d.count)))),
    perception: clamp(num(raw.perception, d.perception), 0, 100000),
    fov: clamp(num(raw.fov, d.fov), 0, TAU),
    separationRadius: clamp(num(raw.separationRadius, d.separationRadius), 0, 100000),
    separation: clamp(num(raw.separation, d.separation), 0, 1000),
    alignment: clamp(num(raw.alignment, d.alignment), 0, 1000),
    cohesion: clamp(num(raw.cohesion, d.cohesion), 0, 1000),
    maxSpeed,
    minSpeed,
    maxForce: clamp(num(raw.maxForce, d.maxForce), 0, 1000),
    noise: clamp(num(raw.noise, d.noise), 0, 1),
    boundary: mode === 'bounce' || mode === 'attract' || mode === 'wrap' ? mode : d.boundary,
    predatorCount: Math.max(0, Math.min(5000, Math.floor(num(raw.predatorCount, d.predatorCount)))),
    predatorFear: clamp(num(raw.predatorFear, d.predatorFear), 0, 1000),
    predatorSpeed: clamp(num(raw.predatorSpeed, d.predatorSpeed), 0, 100000)
  }
}

/**
 * 邻居是否落在视野角内。
 * fov = 2π 时 cos(fov/2) = -1，理论上所有方向都通过，但浮点误差会让点积
 * 偶尔落到 -1 以下，所以全向直接短路返回，不做点积比较。
 * cosFov 由调用方预先算好传进来——这是 O(N²) 的最内层，不能每个邻居都
 * 调用一次 Math.cos。
 */
function inFieldOfView(dx: number, dy: number, d: number, vx: number, vy: number, speed: number, cosFov: number): boolean {
  if (cosFov <= -1) return true
  if (!(speed > EPS)) return true // 静止的鸟没有朝向，视野无意义，视为全向
  const dot = (dx * vx + dy * vy) / (d * speed)
  return dot >= cosFov - 1e-9
}

/** 单只鸟在三条规则（外加掠食者）上的原始转向向量，均为未加权值。 */
interface Steering {
  sepX: number
  sepY: number
  aliX: number
  aliY: number
  cohX: number
  cohY: number
  predX: number
  predY: number
}

function zeroSteering(): Steering {
  return { sepX: 0, sepY: 0, aliX: 0, aliY: 0, cohX: 0, cohY: 0, predX: 0, predY: 0 }
}

/**
 * 计算第 i 只鸟的规则转向向量。stepFlock 与 ruleBreakdown 共用这一个函数，
 * 所以界面上看到的「规则分解」和真正跑动的物理永远是同一份代码。
 *
 * 关于距离：wrap 模式下用最小镜像距离（环形空间的最短位移），其余模式用
 * 欧氏距离。这不是「细节」——若 wrap 只回卷坐标、却用欧氏距离算聚合，鸟群
 * 穿过接缝时会被质心从画布另一头拽回中央，整群秩序当场散掉。盒子尺寸通过
 * BOX 旁表查到，所以 ruleBreakdown 的固定签名也能和主循环保持同一套邻居判定。
 *
 * 三条规则的原始向量（未乘权重）：
 *   separation —— Σ 远离方向 × (1 - d/r)：越近推力越大，且天然有界；
 *   alignment  —— Reynolds 转向：把速度转向邻居平均速度，desired - v；
 *   cohesion   —— Reynolds 转向：把速度转向邻居质心，desired - v；
 *   predator   —— 与 separation 同形，但用 perception 作为恐慌半径。
 */
function computeSteering(state: FlockState, params: BoidParams, i: number): Steering {
  const out = zeroSteering()
  const boids = state.boids
  const b = boids[i]
  if (!b) return out

  const { perception, separationRadius, fov, maxSpeed } = params
  const box = boxOf(state, params.boundary)
  const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
  const per2 = perception * perception
  const sepR = separationRadius
  // fov = 2π 时 cos(fov/2) 恰为 -1，用 <= -1 短路掉视野判定
  const cosFov = fov >= TAU - 1e-9 ? -1 : Math.cos(fov / 2)

  let aliVX = 0
  let aliVY = 0
  let aliCount = 0
  let cohX = 0
  let cohY = 0
  let cohCount = 0
  let sepX = 0
  let sepY = 0

  for (let j = 0; j < boids.length; j++) {
    if (j === i) continue
    const o = boids[j]
    let dx = o.x - b.x
    let dy = o.y - b.y
    if (box) {
      dx = wrapDelta(dx, box.width)
      dy = wrapDelta(dy, box.height)
    }
    const d2 = dx * dx + dy * dy
    // d2 === 0 的两只鸟完全重合：没有可用的方向，跳过（靠噪声/分离带开）
    if (d2 > per2 || d2 <= 0) continue
    const d = Math.sqrt(d2)
    if (!inFieldOfView(dx, dy, d, b.vx, b.vy, speed, cosFov)) continue

    aliVX += o.vx
    aliVY += o.vy
    aliCount++
    // 聚合累加的是「相对自己的最短位移」，而不是邻居的绝对坐标：
    // 这样环形空间里的局部质心不需要额外的 atan2 圆均值就能算对。
    cohX += dx
    cohY += dy
    cohCount++

    if (d < sepR) {
      const w = 1 - d / sepR // 0（刚好在边界）→ 1（完全重合）
      sepX -= (dx / d) * w
      sepY -= (dy / d) * w
    }
  }

  // 对齐：邻居平均速度方向 × maxSpeed 作为期望速度
  if (aliCount > 0) {
    const mx = aliVX / aliCount
    const my = aliVY / aliCount
    const m = Math.sqrt(mx * mx + my * my)
    // 邻居速度互相抵消（比如两只鸟对飞）时没有「平均方向」，此时不施加对齐力
    if (m > EPS) {
      out.aliX = (mx / m) * maxSpeed - b.vx
      out.aliY = (my / m) * maxSpeed - b.vy
    }
  }

  // 聚合：邻居质心方向 × maxSpeed 作为期望速度
  if (cohCount > 0) {
    const cx = cohX / cohCount
    const cy = cohY / cohCount
    const m = Math.sqrt(cx * cx + cy * cy)
    // 已经与邻居质心重合时不施加聚合力，否则会得到 0/0
    if (m > EPS) {
      out.cohX = (cx / m) * maxSpeed - b.vx
      out.cohY = (cy / m) * maxSpeed - b.vy
    }
  }

  out.sepX = sepX
  out.sepY = sepY

  // 掠食者恐慌：用 perception 作为恐慌半径，同样越大越怕
  for (let k = 0; k < state.predators.length; k++) {
    const p = state.predators[k]
    let dx = b.x - p.x
    let dy = b.y - p.y
    if (box) {
      dx = wrapDelta(dx, box.width)
      dy = wrapDelta(dy, box.height)
    }
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d <= EPS || d > perception) continue
    const w = 1 - d / perception
    out.predX += (dx / d) * w
    out.predY += (dy / d) * w
  }

  return out
}

/**
 * attract 模式下靠近边缘时的向心弱转向。
 * 返回的向量以 maxSpeed 为尺度，随后和三条规则一起被 maxForce 截断，所以
 * 它只是一个「提醒」，不会把鸟猛拽回去。
 */
function boundaryAttract(x: number, y: number, width: number, height: number, maxSpeed: number): [number, number] {
  const margin = Math.min(width, height) * 0.18
  if (!(margin > EPS)) return [0, 0]
  let fx = 0
  let fy = 0
  if (x < margin) fx += (margin - x) / margin
  else if (x > width - margin) fx -= (x - (width - margin)) / margin
  if (y < margin) fy += (margin - y) / margin
  else if (y > height - margin) fy -= (y - (height - margin)) / margin
  return [fx * maxSpeed, fy * maxSpeed]
}

/** 把速度限制在 [minSpeed, maxSpeed]，并处理零向量。 */
function clampSpeed(b: Boid, minSpeed: number, maxSpeed: number): void {
  let speed = Math.hypot(b.vx, b.vy)
  if (!(speed > EPS)) {
    // 速度为 0：minSpeed > 0 时给一个确定性的初始朝向，
    // 否则保持静止（maxSpeed = 0 的极端设置下这是正确行为）
    if (minSpeed > EPS) {
      b.vx = minSpeed
      b.vy = 0
    } else {
      b.vx = 0
      b.vy = 0
    }
    return
  }
  if (speed > maxSpeed) {
    const s = maxSpeed / speed
    b.vx *= s
    b.vy *= s
    speed = maxSpeed
  } else if (speed < minSpeed) {
    const s = minSpeed / speed
    b.vx *= s
    b.vy *= s
  }
}

/** 兜底：任何非有限值都在这里被拉回合法域，保证界面永远拿不到 NaN。 */
function sanitize(b: Boid, width: number, height: number, speed: number): void {
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    b.x = width / 2
    b.y = height / 2
  }
  if (!Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
    b.vx = speed
    b.vy = 0
  }
}

/** 位置更新后的边界处理。 */
function applyBoundary(b: Boid, mode: BoundaryMode, width: number, height: number): void {
  if (mode === 'wrap') {
    // 取模保证落在 [0, width)；用 floor 而不是 % 是为了正确处理负数
    if (width > EPS) b.x = b.x - Math.floor(b.x / width) * width
    if (height > EPS) b.y = b.y - Math.floor(b.y / height) * height
    if (b.x >= width) b.x = 0
    if (b.y >= height) b.y = 0
    return
  }

  if (mode === 'bounce') {
    // 用反射公式而不是简单取反，是为了兼容「一帧跨过整面墙」的极端 dt
    let guard = 0
    while (guard++ < 8) {
      if (b.x < 0) {
        b.x = -b.x
        b.vx = -b.vx
      } else if (b.x > width) {
        b.x = 2 * width - b.x
        b.vx = -b.vx
      } else if (b.y < 0) {
        b.y = -b.y
        b.vy = -b.vy
      } else if (b.y > height) {
        b.y = 2 * height - b.y
        b.vy = -b.vy
      } else break
    }
    // 极端情况（反复反射仍在外侧）兜底夹回墙内
    b.x = clamp(b.x, 0, width)
    b.y = clamp(b.y, 0, height)
    return
  }

  // attract：弱转向是主力，这里只做「贴到墙上」的硬兜底，
  // 保证坐标不越界，同时把朝外的速度分量翻回来
  if (b.x < 0) {
    b.x = 0
    if (b.vx < 0) b.vx = -b.vx
  } else if (b.x > width) {
    b.x = width
    if (b.vx > 0) b.vx = -b.vx
  }
  if (b.y < 0) {
    b.y = 0
    if (b.vy < 0) b.vy = -b.vy
  } else if (b.y > height) {
    b.y = height
    if (b.vy > 0) b.vy = -b.vy
  }
}

/* ================================================================== *
 * 默认参数 / 预设 / 滑块范围
 * ================================================================== */

/**
 * 默认值：一打开就看到一条定向迁移的鸟群，同时让噪声扫描能画出干净的相变。
 *
 * 为什么是「对齐主导 + 近恒速」：
 *   · cohesion 是唯一会制造「磨盘」的规则。磨盘（整群绕公共质心打转，极化度
 *     ≈0）与迁移带是两个亚稳吸引子，cohesion 一强，磨盘就赢，而且赢得看运气
 *     ——同一个参数换个初值，低噪声端就能从 0.2 跳到 0.99。把 cohesion 压到
 *     0.4，迁移带才是稳定解。
 *   · alignment 2.4 略高于 separation 1.8，是为了让「共同航向」跑赢「互相推
 *     开」。分离仍然是硬约束（1.8），鸟不会叠在一起。
 *   · minSpeed 2.2 / maxSpeed 2.6 接近恒速：Vicsek 模型本来就是恒速的，允许
 *     鸟在密集处大幅减速会额外助长磨盘。
 *
 * ⚠️ 相变曲线对**密度**敏感：sweepNoise 要求平均邻居数 ≳6 才能稳定看到
 * 「低噪声有序」。按下面的 count/perception，画布面积最好 ≲ 600×400；
 * 画布更大时有序相是亚稳的，低噪声端会在 0.7~1.0 之间随初值波动——那本身
 * 也是有限尺寸、低密度下的真实物理，而不是 bug。
 */
export function defaultParams(): BoidParams {
  return {
    count: 260,
    perception: 46,
    fov: TAU,
    separationRadius: 18,
    separation: 1.8,
    alignment: 2.4,
    cohesion: 0.4,
    maxSpeed: 2.6,
    minSpeed: 2.2,
    maxForce: 0.6,
    noise: 0.03,
    boundary: 'wrap',
    predatorCount: 0,
    predatorFear: 2.6,
    predatorSpeed: 3.4
  }
}

export const BOID_PRESETS: BoidPreset[] = [
  {
    id: 'classic',
    name: '经典三规则',
    detail: 'Reynolds 原始配比（分离 > 对齐 > 聚合），三条规则势均力敌，常常绕成缓慢旋转的磨盘。',
    params: { separation: 1.8, alignment: 1.2, cohesion: 0.8, noise: 0.03, predatorCount: 0, fov: TAU, boundary: 'wrap' }
  },
  {
    id: 'alignment-only',
    name: '只看对齐',
    detail: '关掉分离与聚合，只剩对齐：方向极快地统一成一条定向迁移的带，但鸟会互相穿插。',
    params: { separation: 0, alignment: 2.4, cohesion: 0, noise: 0.02, predatorCount: 0, fov: TAU }
  },
  {
    id: 'no-separation',
    name: '无分离',
    detail: '把分离权重归零：聚合会把整群鸟压成一个几乎重合的球，鸟叠在一起也不躲。',
    params: { separation: 0, alignment: 2.4, cohesion: 1.4, noise: 0.02, predatorCount: 0 }
  },
  {
    id: 'predator',
    name: '有掠食者',
    detail: '两只高速掠食者追最近的鸟：鸟群被冲散、躲闪，再靠对齐重新聚成一条带。',
    params: { predatorCount: 2, predatorSpeed: 3.4, predatorFear: 2.6, separation: 1.8, alignment: 2.4, cohesion: 0.4 }
  },
  {
    id: 'high-noise',
    name: '高噪声 · 秩序崩塌',
    detail: '每步方向扰动接近 π：个体方向被彻底打乱，全局极化度掉到随机水平（≈1/√N）。',
    params: { noise: 0.85, separation: 1.8, alignment: 2.4, cohesion: 0.4, predatorCount: 0 }
  },
  {
    id: 'cohesion-only',
    name: '只看聚合',
    detail: '只保留聚合：所有鸟塌向局部质心，回转半径迅速缩小，但完全没有共同航向。',
    params: { separation: 0, alignment: 0, cohesion: 1, noise: 0, predatorCount: 0 }
  },
  {
    id: 'bounce-wall',
    name: '反弹边界 · 撞墙',
    detail: '改用 bounce 边界：鸟群撞到墙会整体折返，极化度的方向会周期性地翻面。',
    params: { boundary: 'bounce', separation: 1.8, alignment: 2.4, cohesion: 0.4, noise: 0.03 }
  }
]

/**
 * 界面滑块范围。键名与 BoidParams 的数值字段一一对应（boundary 是枚举，
 * 不在表里，用分段按钮切换）。step 取值保证滑块拖到头也不会出现 NaN。
 */
export const PARAM_RANGES: Record<string, { min: number; max: number; step: number }> = {
  count: { min: 10, max: 900, step: 10 },
  perception: { min: 5, max: 140, step: 1 },
  fov: { min: Math.PI / 6, max: TAU, step: 0.01 },
  separationRadius: { min: 0, max: 60, step: 0.5 },
  separation: { min: 0, max: 4, step: 0.05 },
  alignment: { min: 0, max: 4, step: 0.05 },
  cohesion: { min: 0, max: 4, step: 0.05 },
  maxSpeed: { min: 0.4, max: 6, step: 0.05 },
  minSpeed: { min: 0, max: 4, step: 0.05 },
  maxForce: { min: 0.02, max: 1.4, step: 0.02 },
  noise: { min: 0, max: 1, step: 0.01 },
  predatorCount: { min: 0, max: 8, step: 1 },
  predatorFear: { min: 0, max: 6, step: 0.1 },
  predatorSpeed: { min: 0.4, max: 8, step: 0.1 }
}

/* ================================================================== *
 * 初始化
 * ================================================================== */

/**
 * 生成初始群体。位置在画布内均匀随机，速度方向均匀随机，速率在
 * [minSpeed, maxSpeed] 内随机——初始就是完全无序的，所以后面看到的
 * 任何秩序都只能来自三条局部规则。
 */
export function createFlock(params: BoidParams, width: number, height: number, rng: () => number): FlockState {
  const p = normParams(params)
  const w = Math.max(1, num(width, 1))
  const h = Math.max(1, num(height, 1))
  const lo = Math.min(p.minSpeed, p.maxSpeed)
  const hi = Math.max(p.minSpeed, p.maxSpeed)

  const boids: Boid[] = []
  for (let i = 0; i < p.count; i++) {
    const angle = rng() * TAU
    const speed = lo + rng() * (hi - lo)
    const x = rng() * w
    const y = rng() * h
    boids.push({
      x: Number.isFinite(x) ? x : w / 2,
      y: Number.isFinite(y) ? y : h / 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed
    })
  }

  const predators: Boid[] = []
  const pSpeed = p.predatorSpeed
  for (let k = 0; k < p.predatorCount; k++) {
    const angle = rng() * TAU
    predators.push({
      x: rng() * w,
      y: rng() * h,
      vx: Math.cos(angle) * pSpeed,
      vy: Math.sin(angle) * pSpeed
    })
  }

  const state: FlockState = { boids, predators, time: 0 }
  BOX.set(state, { width: w, height: h })
  return state
}

/* ================================================================== *
 * 单步演化
 * ================================================================== */

/**
 * 推进一步。更新是**同步**的：先用 t 时刻的状态算出所有鸟的加速度，再统一
 * 更新速度和位置。若改成原地逐只更新（Gauss–Seidel），下标小的鸟会先于
 * 下标大的鸟被读取，群体行为会带上一个虚假的方向偏好。
 *
 * 顺序：转向力 → 限幅 → 积分速度 → 限速 → Vicsek 噪声 → 积分位置 → 边界。
 * 噪声放在限速之后，是为了让它不被 maxSpeed 的归一化削弱；旋转保持速度
 * 模长不变，所以噪声之后速度上限依然成立。
 */
export function stepFlock(
  state: FlockState,
  params: BoidParams,
  dt: number,
  width: number,
  height: number,
  rng: () => number
): FlockMetrics {
  const p = normParams(params)
  const w = Math.max(1, num(width, 1))
  const h = Math.max(1, num(height, 1))
  const step = clamp(num(dt, 0), 0, MAX_DT)

  // 登记画布尺寸，供 computeSteering / computeMetrics 做最小镜像距离。
  // 放在这里而不是只在 createFlock：手工拼出来的 state 一旦经过 stepFlock
  // 也能拿到正确的环形几何。
  BOX.set(state, { width: w, height: h })

  const boids = state.boids
  const n = boids.length
  const ax = new Float64Array(n)
  const ay = new Float64Array(n)

  // ── 1. 同步计算所有鸟的加权合力并截断 ────────────────────────────
  for (let i = 0; i < n; i++) {
    const s = computeSteering(state, p, i)
    let fx = p.separation * s.sepX + p.alignment * s.aliX + p.cohesion * s.cohX
    let fy = p.separation * s.sepY + p.alignment * s.aliY + p.cohesion * s.cohY
    // 掠食者恐慌：额外的一份「分离」，权重由 predatorFear 给出
    fx += p.predatorFear * s.predX
    fy += p.predatorFear * s.predY
    if (p.boundary === 'attract') {
      const [bx, by] = boundaryAttract(boids[i].x, boids[i].y, w, h, p.maxSpeed)
      fx += bx
      fy += by
    }
    const [lx, ly] = limit(fx, fy, p.maxForce)
    ax[i] = lx
    ay[i] = ly
  }

  // ── 2. 积分速度 + 限速 + 方向噪声 ────────────────────────────────
  const noiseAmp = p.noise * Math.PI
  for (let i = 0; i < n; i++) {
    const b = boids[i]
    b.vx += ax[i] * step
    b.vy += ay[i] * step
    clampSpeed(b, p.minSpeed, p.maxSpeed)

    // Vicsek 噪声：方向上加 U(-noise·π, noise·π) 的均匀角度扰动。
    // noise = 0 时仍然抽一次随机数，这样 sweepNoise 里各档位用的是同一串
    // 随机数（common random numbers），曲线上的差异只来自噪声幅度而不是
    // 运气，相变位置不会被采样噪声糊掉。
    const u = rng()
    const jitter = (num(u, 0.5) * 2 - 1) * noiseAmp
    if (jitter !== 0) {
      const c = Math.cos(jitter)
      const s = Math.sin(jitter)
      const vx = b.vx
      const vy = b.vy
      b.vx = vx * c - vy * s
      b.vy = vx * s + vy * c
    }
    clampSpeed(b, p.minSpeed, p.maxSpeed)
  }

  // ── 3. 掠食者：追最近的鸟 ────────────────────────────────────────
  // 掠食者比鸟更敏捷（转向上限取 maxForce 与 predatorSpeed/4 的较大者），
  // 否则它永远咬不到同样受 maxForce 限制的鸟，实验就变成「掠食者陪跑」。
  const predMaxForce = Math.max(p.maxForce, p.predatorSpeed * 0.25)
  for (let k = 0; k < state.predators.length; k++) {
    const pd = state.predators[k]
    let best = -1
    let bestD2 = Infinity
    for (let i = 0; i < n; i++) {
      const b = boids[i]
      const dx = b.x - pd.x
      const dy = b.y - pd.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        best = i
      }
    }
    if (best >= 0) {
      const b = boids[best]
      const dx = b.x - pd.x
      const dy = b.y - pd.y
      const d = Math.hypot(dx, dy)
      if (d > EPS) {
        const dvx = (dx / d) * p.predatorSpeed - pd.vx
        const dvy = (dy / d) * p.predatorSpeed - pd.vy
        const [lx, ly] = limit(dvx, dvy, predMaxForce)
        pd.vx += lx * step
        pd.vy += ly * step
      }
    }
    clampSpeed(pd, 0, p.predatorSpeed)
    // 掠食者不参与 Vicsek 噪声：它是「外部扰动源」，自身乱走会削弱追逐行为
    pd.x += pd.vx * step
    pd.y += pd.vy * step
    applyBoundary(pd, p.boundary, w, h)
    sanitize(pd, w, h, p.predatorSpeed)
  }

  // ── 4. 积分位置 + 边界 + 兜底 ────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const b = boids[i]
    b.x += b.vx * step
    b.y += b.vy * step
    applyBoundary(b, p.boundary, w, h)
    sanitize(b, w, h, p.maxSpeed)
  }

  state.time += step
  return computeMetrics(state, p)
}

/* ================================================================== *
 * 观测量
 * ================================================================== */

/**
 * 计算宏观观测量。掠食者一律不参与统计——它是外部扰动，不是群体成员。
 *
 * polarization     |Σ v̂_i| / N，Vicsek 序参量。完全同向 = 1，方向随机 ≈ 1/√N。
 * alignmentRate    局部序参量：(1/N)Σ_i |Σ_{j∈N_i} v̂_j| / |N_i|，邻域含自己。
 *                  它是极化度「更平滑的版本」：全局方向互相抵消时（磨盘、
 *                  两支对穿的鸟群）极化度接近 0，但局部一致性依然很高，
 *                  这个量能区分「真的乱了」和「整体有序但方向相反」。
 *                  只有自己的孤立鸟不参与平均（否则稀疏群的局部序参量会
 *                  被一堆 1 灌水）。
 * meanNeighborDistance 每只鸟到最近邻的距离再对鸟平均；不足两只时为 0。
 * radiusOfGyration 到质心的均方根距离，衡量群体紧致度。
 */
export function computeMetrics(state: FlockState, params: BoidParams): FlockMetrics {
  const p = normParams(params)
  const boids = state.boids
  const n = boids.length

  if (n === 0) {
    return { polarization: 0, meanNeighborDistance: 0, radiusOfGyration: 0, alignmentRate: 0 }
  }

  // 每只鸟的单位速度与速率先算一遍：后面 O(N²) 的最近邻/局部序参量循环都要
  // 用它，放在内层会把复杂度乘上一个 Math.sqrt。
  const ux = new Float64Array(n)
  const uy = new Float64Array(n)
  let sumVX = 0
  let sumVY = 0
  for (let i = 0; i < n; i++) {
    const b = boids[i]
    const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
    if (s > EPS) {
      ux[i] = b.vx / s
      uy[i] = b.vy / s
      sumVX += ux[i]
      sumVY += uy[i]
    }
  }
  const polarization = clamp(Math.sqrt(sumVX * sumVX + sumVY * sumVY) / n, 0, 1)

  // 质心与回转半径
  // wrap 模式下的质心必须用圆均值（每维把坐标映射到单位圆再取平均角）：
  // 直接对 0 与 width 附近的坐标做算术平均，会得到一个「画布中央」的假
  // 质心，回转半径会虚高，紧致度指标就废了。
  const wrap = boxOf(state, p.boundary)
  let cx = 0
  let cy = 0
  if (wrap) {
    let scx = 0
    let ssx = 0
    let scy = 0
    let ssy = 0
    for (let i = 0; i < n; i++) {
      const ax = (boids[i].x / wrap.width) * TAU
      const ay = (boids[i].y / wrap.height) * TAU
      scx += Math.cos(ax)
      ssx += Math.sin(ax)
      scy += Math.cos(ay)
      ssy += Math.sin(ay)
    }
    cx = (Math.atan2(ssx, scx) / TAU) * wrap.width
    cy = (Math.atan2(ssy, scy) / TAU) * wrap.height
    if (cx < 0) cx += wrap.width
    if (cy < 0) cy += wrap.height
  } else {
    for (let i = 0; i < n; i++) {
      cx += boids[i].x
      cy += boids[i].y
    }
    cx /= n
    cy /= n
  }
  let sumR2 = 0
  for (let i = 0; i < n; i++) {
    let dx = boids[i].x - cx
    let dy = boids[i].y - cy
    if (wrap) {
      dx = wrapDelta(dx, wrap.width)
      dy = wrapDelta(dy, wrap.height)
    }
    sumR2 += dx * dx + dy * dy
  }
  const radiusOfGyration = Math.sqrt(sumR2 / n)

  // 最近邻平均距离 + 局部序参量（一趟 O(N²) 同时算完）
  const per2 = p.perception * p.perception
  const cosFov = p.fov >= TAU - 1e-9 ? -1 : Math.cos(p.fov / 2)
  let nnSum = 0
  let nnCount = 0
  let localSum = 0
  let localCount = 0
  for (let i = 0; i < n; i++) {
    const b = boids[i]
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
    let nearest = Infinity
    let lx = 0
    let ly = 0
    let ln = 0 // 邻域规模（不含自己）
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const o = boids[j]
      let dx = o.x - b.x
      let dy = o.y - b.y
      if (wrap) {
        dx = wrapDelta(dx, wrap.width)
        dy = wrapDelta(dy, wrap.height)
      }
      const d2 = dx * dx + dy * dy
      if (d2 < nearest) nearest = d2
      if (d2 > per2 || d2 <= 0) continue
      if (!inFieldOfView(dx, dy, Math.sqrt(d2), b.vx, b.vy, speed, cosFov)) continue
      if (ux[j] !== 0 || uy[j] !== 0) {
        lx += ux[j]
        ly += uy[j]
        ln++
      }
    }
    if (Number.isFinite(nearest)) {
      nnSum += Math.sqrt(nearest)
      nnCount++
    }
    if (ln > 0) {
      const self = speed > EPS ? 1 : 0
      localSum += clamp(Math.sqrt((lx + ux[i] * self) ** 2 + (ly + uy[i] * self) ** 2) / (ln + self), 0, 1)
      localCount++
    }
  }

  const meanNeighborDistance = nnCount > 0 ? nnSum / nnCount : 0
  const alignmentRate = localCount > 0 ? clamp(localSum / localCount, 0, 1) : polarization

  return {
    polarization: Number.isFinite(polarization) ? polarization : 0,
    meanNeighborDistance: Number.isFinite(meanNeighborDistance) ? meanNeighborDistance : 0,
    radiusOfGyration: Number.isFinite(radiusOfGyration) ? radiusOfGyration : 0,
    alignmentRate: Number.isFinite(alignmentRate) ? alignmentRate : 0
  }
}

/**
 * 第 index 只鸟的规则分解，给界面的「规则分解」面板用。
 *
 * 语义约定（重要）：
 *   separation / alignment / cohesion 都是**未加权**的原始转向向量；
 *   total = w_s·separation + w_a·alignment + w_c·cohesion，
 *   即三条规则的加权和，**不含**掠食者恐慌力、边界向心力与 maxForce 截断
 *   —— 那几个量不属于「三条规则」，混进来会让面板无法自洽。
 *   界面若要显示完整合力，把 predatorFear 的那一项自己加上即可。
 *
 * 越界 index（界面动画帧与索引不同步时会遇到）返回零向量，不抛异常。
 */
export function ruleBreakdown(state: FlockState, params: BoidParams, index: number): RuleBreakdown {
  const p = normParams(params)
  const empty: RuleBreakdown = { separation: [0, 0], alignment: [0, 0], cohesion: [0, 0], total: [0, 0] }
  if (!Number.isFinite(index) || index < 0 || index >= state.boids.length) return empty

  const s = computeSteering(state, p, index)
  const total: [number, number] = [
    p.separation * s.sepX + p.alignment * s.aliX + p.cohesion * s.cohX,
    p.separation * s.sepY + p.alignment * s.aliY + p.cohesion * s.cohY
  ]
  return {
    separation: [s.sepX, s.sepY],
    alignment: [s.aliX, s.aliY],
    cohesion: [s.cohX, s.cohY],
    total
  }
}

/* ================================================================== *
 * 噪声扫描：有序–无序相变
 * ================================================================== */

/**
 * 扫一遍噪声强度，返回每个档位的极化度，用来画相变曲线。
 *
 * 每个档位都从**同一个初始构型**出发（同一个 seed 生成同一个 flock），并
 * 且每只鸟每步都恰好消耗一个随机数，所以各档位用的是同一串随机数、只是
 * 缩放幅度不同。这叫 common random numbers：把「运气」从比较里消掉，曲线
 * 的抖动只剩物理本身，相变拐点才看得清。
 *
 * 低噪声时对齐规则足以让全群锁定同一航向（polarization → 1）；噪声超过
 * 临界值后，每步的方向扰动比 maxForce 能给的最大修正还大，局部对齐再也
 * 来不及传导，全局序参量塌到随机水平（≈ 1/√N）。这就是 Vicsek 相变。
 */
export function sweepNoise(
  params: BoidParams,
  opts: { levels: number; steps: number; seed: number; width: number; height: number }
): { noise: number; polarization: number }[] {
  const levels = Math.max(1, Math.floor(num(opts.levels, 8)))
  const steps = Math.max(0, Math.floor(num(opts.steps, 200)))
  const width = Math.max(1, num(opts.width, 900))
  const height = Math.max(1, num(opts.height, 600))
  const seed = num(opts.seed, 1)

  const out: { noise: number; polarization: number }[] = []
  for (let li = 0; li < levels; li++) {
    const noise = levels === 1 ? 0 : li / (levels - 1) // 含 0 与 1 两个端点
    const level: BoidParams = { ...params, noise }
    // 每档位都用同一个 seed：初始构型与随机数序列完全一致
    const rng = seededRng(seed)
    const state = createFlock(level, width, height, rng)
    let metrics = computeMetrics(state, level)
    for (let s = 0; s < steps; s++) {
      metrics = stepFlock(state, level, 1, width, height, rng)
    }
    out.push({ noise, polarization: metrics.polarization })
  }
  return out
}
