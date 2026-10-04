/**
 * Hub.tsx — 实验室首页：三个实验的入口卡片
 *
 * 每张卡片带一个跟主题呼应的小图案，主色与实验内部一致，
 * 点进去不会觉得换了个网站。
 */

import { EXPERIMENTS, Lab, LabNav } from '../../shared/components/lab'

/** 目录名以 EXPERIMENTS 为准，别在卡片里另拼一遍 —— 拼错过一次 */
const PATH_OF = Object.fromEntries(EXPERIMENTS.map((e) => [e.id, e.path]))

interface Card {
  id: 'axelrod' | 'boids' | 'maxwell'
  accent: string
  name: string
  en: string
  tagline: string
  desc: string
  facts: [string, string][]
  motif: React.ReactNode
}

/* ---------------- 主题图案 ---------------- */

const MotifAxelrod = (
  <svg viewBox="0 0 240 62" className="hub-card__motif" aria-hidden="true">
    {/* 一报还一报的出手序列：合作与背叛交替，最后稳定在合作 */}
    {['C', 'C', 'D', 'C', 'D', 'C', 'C', 'C', 'C', 'C'].map((m, i) => (
      <rect
        key={i}
        x={8 + i * 23}
        y={18}
        width={18}
        height={18}
        rx={3}
        fill={m === 'C' ? '#57dcaa' : '#e8553a'}
        opacity={m === 'C' ? 0.9 : 0.85}
      />
    ))}
    <text x={8} y={54} fontFamily="monospace" fontSize={9} fill="#5f5c55" letterSpacing="1">
      合作 · 背叛 · 合作 · 合作 …
    </text>
  </svg>
)

const MotifBoids = (
  <svg viewBox="0 0 240 62" className="hub-card__motif" aria-hidden="true">
    {/* 一群朝同一方向飞的小三角，末尾两只偏离（还在收敛） */}
    {[
      [30, 22, -12],
      [58, 34, -18],
      [86, 20, -8],
      [112, 38, -22],
      [142, 26, -14],
      [170, 40, -19],
      [196, 24, -2]
    ].map(([x, y, rot], i) => (
      <polygon
        key={i}
        points="-7,5 7,0 -7,-5"
        fill="#6fb3e0"
        opacity={i === 6 ? 0.4 : 0.85}
        transform={`translate(${x},${y}) rotate(${rot})`}
      />
    ))}
    <text x={8} y={56} fontFamily="monospace" fontSize={9} fill="#5f5c55" letterSpacing="1">
      分离 · 对齐 · 聚合
    </text>
  </svg>
)

const MotifMaxwell = (
  <svg viewBox="0 0 240 62" className="hub-card__motif" aria-hidden="true">
    <rect x={8} y={10} width={224} height={34} rx={4} fill="none" stroke="#3a3a44" />
    <line x1={120} y1={10} x2={120} y2={44} stroke="#a894e8" strokeDasharray="3 4" strokeWidth={1.5} />
    {/* 左侧偏冷、右侧偏热 */}
    {[
      [26, 20, 0.35], [50, 33, 0.3], [74, 24, 0.4], [98, 36, 0.32], [62, 15, 0.38],
      [138, 20, 0.95], [162, 34, 1], [188, 22, 0.9], [212, 35, 1], [148, 38, 0.88]
    ].map(([cx, cy, heat], i) => (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={3.4}
        fill={heat > 0.7 ? '#e8553a' : '#6fb3e0'}
        opacity={0.45 + heat * 0.5}
      />
    ))}
    <text x={8} y={58} fontFamily="monospace" fontSize={9} fill="#5f5c55" letterSpacing="1">
      慢 ← 门 → 快
    </text>
  </svg>
)

const CARDS: Card[] = [
  {
    id: 'axelrod',
    accent: '#d9a441',
    name: '阿克塞尔罗德实验',
    en: 'Axelrod 1980',
    tagline: '重复囚徒困境锦标赛',
    desc:
      '1980 年，阿克塞尔罗德向学界征集策略，让它们两两相遇两百个回合。结果最不精明的那个赢了。' +
      '这里可以把那场锦标赛拆开：17 位策略、对阵得分矩阵、收敛曲线、生态演化，以及多人逐轮同步回放。',
    facts: [
      ['策略', '17 位'],
      ['默认阵容', '11 位 × 200 轮'],
      ['复现偏差', '0.8%']
    ],
    motif: MotifAxelrod
  },
  {
    id: 'boids',
    accent: '#6fb3e0',
    name: 'Boids 鸟群模型',
    en: 'Reynolds 1987',
    tagline: '三条局部规则涌现出群体秩序',
    desc:
      '每只鸟只看得到身边几步之内的同伴，只遵守分离、对齐、聚合三条规则，' +
      '整个鸟群却会自己组织起来。这里可以逐个拆掉规则看它怎么散架，也可以测出秩序崩塌的临界点。',
    facts: [
      ['规则', '分离 / 对齐 / 聚合'],
      ['序参量', '极化度'],
      ['相变', '有临界噪声']
    ],
    motif: MotifBoids
  },
  {
    id: 'maxwell',
    accent: '#a894e8',
    name: '麦克斯韦妖',
    en: 'Maxwell 1867 · Landauer 1961',
    tagline: '信息能不能换熵',
    desc:
      '一只小妖守在小门边上，只放快分子往右、慢分子往左，于是箱子自己变出一冷一热 —— ' +
      '看上去违反了第二定律。这里把它的账本摊开：气体少掉的熵，够不够付擦除记忆的那笔钱。',
    facts: [
      ['粒子', '硬球理想气体'],
      ['账本', 'ΔS气体 + kT ln2 × 比特'],
      ['结论', '净熵不减少']
    ],
    motif: MotifMaxwell
  }
]

export default function Hub() {
  return (
    <Lab theme="axelrod">
      <LabNav />
      <main className="hub">
        <div className="hub__kicker">thinking-lab · 三个实验</div>

        <h1 className="hub__title">
          想一点东西
          <small>HOW WE THINK · HOW WE COOPERATE · HOW WE GET THINGS WRONG</small>
        </h1>

        <p className="hub__lede">
          三个能动手的经典模型：一个是关于人怎么在反复打交道里学会合作，
          一个是关于简单规则怎么能长出复杂秩序，一个是关于信息与熵到底谁买单。
          每一个都可以把参数拆开重来 —— 光看结论不算真懂。
        </p>

        <div className="hub__grid">
          {CARDS.map((c, i) => (
            <a
              className="hub-card"
              key={c.id}
              href={PATH_OF[c.id]}
              style={{ '--card-accent': c.accent, animationDelay: `${200 + i * 90}ms` } as React.CSSProperties}
            >
              {c.motif}
              <div className="hub-card__name">{c.name}</div>
              <div className="hub-card__tagline">{c.en} · {c.tagline}</div>
              <p className="hub-card__desc">{c.desc}</p>
              <div className="hub-card__facts">
                {c.facts.map(([k, v]) => (
                  <span key={k}>
                    {k} <b>{v}</b>
                  </span>
                ))}
              </div>
              <div className="hub-card__go">
                进入实验 <span>→</span>
              </div>
            </a>
          ))}
        </div>

        <footer className="colophon">
          <div className="colophon__rule" />
          <p>
            <b>关于</b>
            　这里放的都是「规则很简单、结果很不直观」的模型。
            每个实验的计算内核都是不依赖界面的纯函数，可以单独跑测试；界面上每个参数都是活的。
          </p>
          <p className="colophon__dim">
            源码与各实验的详细说明见仓库 README。{EXPERIMENTS.length} 个实验，持续增加中。
          </p>
        </footer>
      </main>
    </Lab>
  )
}
