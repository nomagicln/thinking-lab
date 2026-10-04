/**
 * App.tsx — Boids 鸟群模型
 *
 * 状态分两层：
 *   - 参数走 React state，因为界面要响应
 *   - 仿真本身在 FlockCanvas 的 ref 里跑，每帧不惊动 React
 * 只在采样点（约 5Hz）把指标推上来，供读数与曲线使用。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BOID_PRESETS,
  PARAM_RANGES,
  defaultParams,
  ruleBreakdown,
  type BoidParams,
  type FlockMetrics,
  type FlockState
} from './lib/engine'
import { Lab, LabNav, Masthead, Section, Colophon } from '../../shared/components/lab'
import { Chips, Readout, Seg, Slider, Switch, TooltipHost } from '../../shared/components/ui'
import { FlockCanvas } from './components/FlockCanvas'
import {
  OrderChart,
  PhaseChart,
  PhaseReadout,
  RuleSplit,
  useAblation,
  usePhaseSweep,
  type HistoryPoint
} from './components/BoidSections'

export default function App() {
  const [params, setParams] = useState<BoidParams>(() => defaultParams())
  const [presetId, setPresetId] = useState<string | null>(BOID_PRESETS[0]?.id ?? null)
  const [running, setRunning] = useState(true)
  const [showTrails, setShowTrails] = useState(false)
  const [showVectors, setShowVectors] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const [metrics, setMetrics] = useState<FlockMetrics | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [fps, setFps] = useState(0)
  const [seed, setSeed] = useState('flock-1')
  const [resetToken, setResetToken] = useState(0)
  // 仿真的唯一真相在这里，画布与规则分解面板读的是同一份
  const simRef = useRef<FlockState | null>(null)

  const patch = useCallback((p: Partial<BoidParams>) => {
    setParams((prev) => ({ ...prev, ...p }))
    setPresetId(null)
  }, [])

  const applyPreset = useCallback((id: string) => {
    const preset = BOID_PRESETS.find((p) => p.id === id)
    if (!preset) return
    setParams((prev) => ({ ...prev, ...preset.params }))
    setPresetId(id)
  }, [])

  const reset = useCallback(() => {
    setHistory([])
    setSelected(null)
    setSeed((s) => `flock-${Number(s.split('-')[1] ?? 1) + 1}`)
    setResetToken((t) => t + 1)
  }, [])

  // 始终有一只被选中的鸟，否则「规则分解」面板一打开就是空白
  useEffect(() => {
    setSelected((s) => (s == null ? 0 : Math.min(s, Math.max(0, params.count - 1))))
  }, [params.count, resetToken])

  /* ---------------- 指标采样 ---------------- */

  const onSample = useCallback((m: FlockMetrics, f: number) => {
    setMetrics(m)
    setFps(f)
    setHistory((prev) => {
      const next = prev.length > 220 ? prev.slice(prev.length - 220) : prev.slice()
      next.push({
        t: next.length + 1,
        polarization: m.polarization,
        radiusOfGyration: m.radiusOfGyration,
        meanNeighborDistance: m.meanNeighborDistance
      })
      return next
    })
  }, [])

  /* ---------------- 后台计算 ---------------- */

  const sweep = usePhaseSweep(params)
  const ablation = useAblation(params)

  const sweepRun = useRef(sweep.run)
  sweepRun.current = sweep.run
  const ablationRun = useRef(ablation.run)
  ablationRun.current = ablation.run
  const metricsRef = useRef(metrics)
  metricsRef.current = metrics
  const booted = useRef(false)

  // 挂载后自动跑一次相变扫描与消融对比（都放在后台分片执行，不挡界面）
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    const t = setTimeout(() => {
      sweepRun.current()
      ablationRun.current()
    }, 900)
    return () => clearTimeout(t)
  }, [])

  /* ---------------- 读数 ---------------- */

  const readouts = useMemo(() => {
    const m = metrics
    const tone: 'good' | 'bad' | 'accent' =
      m && m.polarization > 0.8 ? 'good' : m && m.polarization < 0.35 ? 'bad' : 'accent'
    return [
      {
        label: '极化度',
        value: m ? m.polarization.toFixed(3) : '—',
        tone,
        hint: '序参量 |Σ v̂| / N。1 = 全部同向，0 = 方向完全随机'
      },
      {
        label: '最近邻距离',
        value: m ? m.meanNeighborDistance.toFixed(1) : '—',
        hint: '每只鸟到最近同伴的平均距离。太小说明分离不够，太大会散架'
      },
      {
        label: '群体半径',
        value: m ? m.radiusOfGyration.toFixed(0) : '—',
        hint: '到质心的均方根距离。聚合强就小，聚合弱就大'
      },
      {
        label: '帧率',
        value: fps ? `${fps.toFixed(0)} fps` : '—',
        hint: `${params.count} 只鸟两两比较，单帧约 ${Math.round((params.count * params.count) / 1000)} 千次距离计算`
      }
    ]
  }, [metrics, fps, params.count])

  const R = (k: string) => PARAM_RANGES[k] ?? { min: 0, max: 1, step: 0.01 }

  return (
    <Lab theme="boids">
      <TooltipHost />
      <LabNav current="boids" />
      <Masthead
        meta={['实验 02 · 1987', 'Reynolds, SIGGRAPH', '局部规则 → 全局秩序']}
        titleCn="Boids 鸟群模型"
        titleEn="Flocking"
        lede={
          <>
            没有领头的鸟，也没有全局的编队指令。每只鸟只看得到身边几十像素内的同伴，
            只遵守三条规则：躲开太近的、朝向邻居的平均方向、朝邻居的中心靠拢。
            整个鸟群却会自己组织起来 —— 秩序是从下面长出来的，不是上面派下来的。
            下面每个参数都是活的，你可以一条一条把规则拆掉，看它怎么散架。
          </>
        }
        toc={[
          ['sec-flock', '观察窗'],
          ['sec-rules', '规则分解'],
          ['sec-order', '秩序从哪来'],
          ['sec-critical', '临界点']
        ]}
      />

      <main className="shell">
        <aside className="rail" aria-label="仿真参数">
          <div className="rail__sticky">
            <section className="panel">
              <h2 className="panel__title">
                群体<em>多少只鸟，看多远</em>
              </h2>
              <Slider
                id="in-count"
                label="鸟的数量"
                value={params.count}
                min={R('count').min}
                max={R('count').max}
                step={R('count').step}
                display={String(params.count)}
                hint="两两比较是 O(n²)，数量拉到 600 以上会开始掉帧。"
                onChange={(v) => patch({ count: v })}
              />
              <Slider
                id="in-perception"
                label="感知半径"
                value={params.perception}
                min={R('perception').min}
                max={R('perception').max}
                step={R('perception').step}
                display={String(params.perception)}
                hint="看得越远越容易对齐，但也越容易被远处的鸟带偏。"
                onChange={(v) => patch({ perception: v })}
              />
              <Slider
                id="in-fov"
                label="视野角"
                value={Math.round((params.fov * 180) / Math.PI)}
                min={60}
                max={360}
                step={5}
                display={`${Math.round((params.fov * 180) / Math.PI)}°`}
                hint="360° 是全向感知。收窄到 120° 以下，鸟就看不到身后的同伴了。"
                onChange={(v) => patch({ fov: (v * Math.PI) / 180 })}
              />
            </section>

            <section className="panel">
              <h2 className="panel__title">
                三条规则<em>整个模型就这么点东西</em>
              </h2>
              <Slider
                id="in-sep"
                label="分离"
                value={params.separation}
                min={R('separation').min}
                max={R('separation').max}
                step={R('separation').step}
                display={params.separation.toFixed(2)}
                hint="躲开过近的邻居。归零会看到鸟挤成一团。"
                onChange={(v) => patch({ separation: v })}
              />
              <Slider
                id="in-ali"
                label="对齐"
                value={params.alignment}
                min={R('alignment').min}
                max={R('alignment').max}
                step={R('alignment').step}
                display={params.alignment.toFixed(2)}
                hint="朝向邻居的平均方向。归零之后鸟群不再有共同朝向。"
                onChange={(v) => patch({ alignment: v })}
              />
              <Slider
                id="in-coh"
                label="聚合"
                value={params.cohesion}
                min={R('cohesion').min}
                max={R('cohesion').max}
                step={R('cohesion').step}
                display={params.cohesion.toFixed(2)}
                hint="朝邻居的中心靠拢。归零之后鸟群会慢慢散开。"
                onChange={(v) => patch({ cohesion: v })}
              />
            </section>

            <section className="panel">
              <h2 className="panel__title">
                运动与扰动<em>速度上限、噪声、边界</em>
              </h2>
              <Slider
                id="in-speed"
                label="最高速度"
                value={params.maxSpeed}
                min={R('maxSpeed').min}
                max={R('maxSpeed').max}
                step={R('maxSpeed').step}
                display={params.maxSpeed.toFixed(2)}
                onChange={(v) => patch({ maxSpeed: v })}
              />
              <Slider
                id="in-force"
                label="转向力上限"
                value={params.maxForce}
                min={R('maxForce').min}
                max={R('maxForce').max}
                step={R('maxForce').step}
                display={params.maxForce.toFixed(2)}
                hint="限制单步能拐多急的弯。调小会让鸟群转向变得笨重。"
                onChange={(v) => patch({ maxForce: v })}
              />
              <Slider
                id="in-noise"
                label="方向噪声"
                value={params.noise}
                min={0}
                max={1}
                step={0.02}
                display={params.noise.toFixed(2)}
                hint="每步给方向加一个随机扰动。这是让秩序崩塌的那个旋钮。"
                onChange={(v) => patch({ noise: v })}
              />

              <div className="field">
                <span className="field__label">边界模式</span>
                <Seg
                  options={[
                    ['wrap', '环绕'],
                    ['bounce', '反弹'],
                    ['attract', '向心']
                  ]}
                  value={params.boundary}
                  onChange={(v) => patch({ boundary: v })}
                />
              </div>
            </section>

            <section className="panel">
              <h2 className="panel__title">
                掠食者<em>加一个天敌会怎样</em>
              </h2>
              <Slider
                id="in-pred"
                label="掠食者数量"
                value={params.predatorCount}
                min={0}
                max={4}
                step={1}
                display={String(params.predatorCount)}
                onChange={(v) => patch({ predatorCount: v })}
              />
              <Slider
                id="in-fear"
                label="恐惧强度"
                value={params.predatorFear}
                min={R('predatorFear').min}
                max={R('predatorFear').max}
                step={R('predatorFear').step}
                display={params.predatorFear.toFixed(2)}
                hint="鸟对掠食者的额外逃离力。调大能看到群体被冲散又重组。"
                onChange={(v) => patch({ predatorFear: v })}
              />

              <Chips
                items={BOID_PRESETS.map((p) => ({ id: p.id, name: p.name, detail: p.detail }))}
                activeId={presetId}
                onPick={(it) => applyPreset(it.id)}
              />
            </section>

            <section className="panel panel--run">
              <button type="button" className="btn btn--primary" id="btn-reset" onClick={reset}>
                重新放飞
              </button>
              <p className="run-note">换一个随机种子，所有鸟的位置重新洗牌。</p>
            </section>
          </div>
        </aside>

        <div className="stage">
          <Section id="sec-flock" variant="verdict" title="">
            <div className="stage-card">
              <div className="stage-canvas">
                <FlockCanvas
                  params={params}
                  running={running}
                  showTrails={showTrails}
                  showVectors={showVectors}
                  selectedIndex={selected}
                  seed={seed}
                  resetToken={resetToken}
                  simRef={simRef}
                  onSelect={setSelected}
                  onSample={onSample}
                />
                <div className="stage-canvas__hint">点任意一只鸟 → 查看它的转向分解</div>
              </div>

              <div className="stage-toolbar">
                <div className="stage-toolbar__group">
                  <button
                    type="button"
                    className="btn btn--small"
                    id="btn-play"
                    onClick={() => setRunning((r) => !r)}
                  >
                    {running ? '暂停' : '继续'}
                  </button>
                  <button type="button" className="btn btn--small btn--ghost" id="btn-reset-2" onClick={reset}>
                    重新放飞
                  </button>
                </div>
                <span className="stage-toolbar__sep" />
                <div className="stage-toolbar__group">
                  <Switch label="轨迹" checked={showTrails} onChange={setShowTrails} />
                  <Switch label="转向箭头" checked={showVectors} onChange={setShowVectors} />
                </div>
                <span className="stage-toolbar__note" id="selection-note">
                  {selected != null ? `已选中第 ${selected + 1} 只` : '未选中个体'}
                </span>
              </div>
            </div>

            <div style={{ marginTop: 16 }} id="flock-readouts">
              <Readout items={readouts} />
            </div>
          </Section>

          <Section
            id="sec-rules"
            num="01"
            title="这一刻，是谁在推它"
            note={
              <>
                三条规则给出的转向力其实各不相同：离群的鸟主要被<b>聚合</b>拉回去，
                快要撞上的鸟主要被<b>分离</b>推开，夹在队伍中间的鸟几乎只受<b>对齐</b>支配。
                群体的复杂行为，就是这三股力在每只鸟身上不同的配比。
                下方消融表把每条规则单独抽出来跑：任何一条单干都会退化 ——
                只有分离是一盘散沙，只有对齐是薄薄一片，只有聚合挤成一坨；
                三条同时在，最近邻距离才降到最低。
              </>
            }
          >
            <LiveRuleSplit params={params} selected={selected} simRef={simRef} />
          </Section>

          <Section
            id="sec-order"
            num="02"
            title="秩序是怎么长出来的"
            note={
              <>
                极化度是衡量「大家朝同一个方向飞」的序参量：1 表示完全同向，0 表示方向彻底随机。
                刚放飞时它接近 0，几秒之内自己爬到 0.8 以上 —— 没有任何一只鸟知道「整群」在做什么。
                把对齐权重调到 0 再按下「重新放飞」，这条线就再也爬不起来了。
                下面还并排给了群体半径：秩序和紧致是两件事，对齐让方向统一，聚合才让它收紧。
              </>
            }
          >
            <OrderChart history={history} ablation={ablation.data} />
            {ablation.busy && (
              <p className="field__hint" style={{ marginTop: 12 }} id="ablation-progress">
                正在跑消融对比 {(ablation.progress * 100).toFixed(0)}%…
              </p>
            )}
          </Section>

          <Section
            id="sec-critical"
            num="03"
            title="秩序崩塌的临界点"
            note={
              <>
                Reynolds 的模型里有秩序，但秩序并不总是活得下来。把方向噪声从 0 慢慢拧到 1，
                极化度不会平滑下降，而是在某个位置<b>突然塌掉</b> —— 这就是 Vicsek 模型
                预言的有序–无序相变。临界点两边是两种截然不同的集体状态，
                而不是「吵一点」和「吵很多」。下面这条曲线是现场跑出来的：
                固定其它参数，只改噪声，12 个档位每个各跑 900 步。
              </>
            }
          >
            {sweep.data ? (
              <div id="phase-result">
                <PhaseReadout data={sweep.data} />
                <div style={{ marginTop: 16 }}>
                  <PhaseChart data={sweep.data} />
                </div>
              </div>
            ) : (
              <div
                className="chart-wrap"
                id="phase-pending"
                style={{ minHeight: 200, display: 'grid', placeItems: 'center' }}
              >
                <p className="field__hint">
                  {sweep.busy ? '正在扫描噪声（每个档位跑 900 步，约 1.5 秒）…' : '正在准备相变扫描…'}
                </p>
              </div>
            )}
            <div className="chart-controls">
              <button
                type="button"
                className="btn btn--small"
                id="btn-sweep"
                onClick={() => sweep.run()}
                disabled={sweep.busy}
              >
                {sweep.busy ? '扫描中…' : '重新扫描'}
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                id="btn-ablation"
                onClick={() => ablation.run()}
                disabled={ablation.busy}
              >
                重跑消融对比
              </button>
            </div>
          </Section>

          <Colophon
            source={
              <>
                　Reynolds, C. W. (1987){' '}
                <i>Flocks, Herds, and Schools: A Distributed Behavioral Model</i>, SIGGRAPH '87, 25–34；
                Vicsek, T. et al. (1995){' '}
                <i>Novel Type of Phase Transition in a System of Self-Driven Particles</i>, Physical
                Review Letters 75(6): 1226.
              </>
            }
            footnotes={[
              <>
                三条规则：分离（separation）· 对齐（alignment）· 聚合（cohesion）。序参量取 Vicsek
                的极化度 |Σ v̂| / N。
              </>,
              <>
                每帧两两比较是 O(n²)。默认 260 只鸟时单帧约 6.8 万次距离计算，浏览器里仍有充足余量。
              </>
            ]}
          />
        </div>
      </main>
    </Lab>
  )
}

/* ------------------------------------------------------------------ *
 * 规则分解：直接读仿真里那一只鸟的真实受力
 * ------------------------------------------------------------------ */

function LiveRuleSplit(props: {
  params: BoidParams
  selected: number | null
  simRef: React.RefObject<FlockState | null>
}) {
  const [breakdown, setBreakdown] = useState<ReturnType<typeof ruleBreakdown> | null>(null)
  const { selected, simRef, params } = props

  useEffect(() => {
    if (selected == null) {
      setBreakdown(null)
      return
    }
    const sample = () => {
      const state = simRef.current
      if (!state || !state.boids[selected]) return
      // ruleBreakdown 给的是「未加权的几何向量」，total 才是加权和。
      // 面板要回答的是「此刻谁在推它」，所以这里补上权重 ——
      // 否则把某个权重调到 0，面板上那条力还是满格，会误导人。
      const raw = ruleBreakdown(state, params, selected)
      const w = (v: [number, number], k: number): [number, number] => [v[0] * k, v[1] * k]
      const separation = w(raw.separation, params.separation)
      const alignment = w(raw.alignment, params.alignment)
      const cohesion = w(raw.cohesion, params.cohesion)
      setBreakdown({
        separation,
        alignment,
        cohesion,
        total: [separation[0] + alignment[0] + cohesion[0], separation[1] + alignment[1] + cohesion[1]]
      })
    }
    sample()
    const id = window.setInterval(sample, 200)
    return () => window.clearInterval(id)
  }, [selected, simRef, params])

  return <RuleSplit breakdown={breakdown} selected={selected != null} />
}
