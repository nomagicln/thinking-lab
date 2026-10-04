/**
 * App.tsx — 麦克斯韦妖
 *
 * 核心叙事：先让你看到「气体自己变出一冷一热」（表观违反第二定律），
 * 再把妖的账本摊开——它换了多少次、擦了多少比特、付了多少熵。
 * 最后用记忆容量扫描给出结论：只有无限记忆的理想妖才「不守规矩」，
 * 而无限记忆在物理上不存在。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEMON_PRESETS,
  PARAM_RANGES,
  defaultParams,
  measureDemon,
  type DemonMetrics,
  type DemonParams,
  type DemonState
} from './lib/engine'
import { Lab, LabNav, Masthead, Section, Colophon } from '../../shared/components/lab'
import { Chips, Readout, Seg, Slider, Switch, TooltipHost } from '../../shared/components/ui'
import { ChamberCanvas } from './components/ChamberCanvas'
import {
  Balance,
  CapacityChart,
  CapacityTable,
  Ledger,
  TempChart,
  useCapacitySweep,
  type TempPoint
} from './components/DemonSections'

export default function App() {
  const [params, setParams] = useState<DemonParams>(() => defaultParams())
  const [presetId, setPresetId] = useState<string | null>(DEMON_PRESETS[0]?.id ?? null)
  const [running, setRunning] = useState(true)
  const [seed, setSeed] = useState('demon-1')
  const [resetToken, setResetToken] = useState(0)
  const [metrics, setMetrics] = useState<DemonMetrics | null>(null)
  const [history, setHistory] = useState<TempPoint[]>([])
  const [fps, setFps] = useState(0)
  const [showHotCold, setShowHotCold] = useState(true)
  const [unlimited, setUnlimited] = useState(false)

  // 仿真的唯一真相，画布与账本读的是同一份
  const simRef = useRef<DemonState | null>(null)

  const patch = useCallback((p: Partial<DemonParams>) => {
    setParams((prev) => ({ ...prev, ...p }))
    setPresetId(null)
  }, [])

  const applyPreset = useCallback((id: string) => {
    const preset = DEMON_PRESETS.find((p) => p.id === id)
    if (!preset) return
    setParams((prev) => ({ ...prev, ...preset.params }))
    setPresetId(id)
    setUnlimited(preset.params.memoryCapacity === Infinity)
  }, [])

  const reset = useCallback(() => {
    setHistory([])
    setSeed((s) => `demon-${Number(s.split('-')[1] ?? 1) + 1}`)
    setResetToken((t) => t + 1)
  }, [])

  const onSample = useCallback((m: DemonMetrics, f: number) => {
    setMetrics(m)
    setFps(f)
    setHistory((prev) => {
      const next = prev.length > 200 ? prev.slice(prev.length - 200) : prev.slice()
      next.push({ t: next.length + 1, left: m.tempLeft, right: m.tempRight })
      return next
    })
  }, [])

  /* ---------------- 容量扫描 ---------------- */

  const sweep = useCapacitySweep(params)
  const sweepRun = useRef(sweep.run)
  sweepRun.current = sweep.run
  const booted = useRef(false)

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    const t = setTimeout(() => sweepRun.current(), 1200)
    return () => clearTimeout(t)
  }, [])

  /* ---------------- 读数 ---------------- */

  const readouts = useMemo(() => {
    const m = metrics
    return [
      {
        label: '冷侧温度',
        value: m ? m.tempLeft.toFixed(2) : '—',
        hint: `左半 ${m?.nLeft ?? 0} 个粒子`
      },
      {
        label: '热侧温度',
        value: m ? m.tempRight.toFixed(2) : '—',
        hint: `右半 ${m?.nRight ?? 0} 个粒子`
      },
      {
        label: '冷热比',
        value: m ? m.hotColdRatio.toFixed(2) : '—',
        tone: (m && m.hotColdRatio > 1.15 ? 'accent' : undefined) as 'accent' | undefined,
        hint: '热侧温度 / 冷侧温度。初始为 1，妖工作后应大于 1'
      },
      {
        label: '妖开门次数',
        value: m ? String(simRef.current?.gateOpens ?? 0) : '—',
        hint: `记录 ${simRef.current?.bitsRecorded ?? 0} 比特，擦除 ${simRef.current?.bitsErased ?? 0} 比特`
      },
      { label: '帧率', value: fps ? `${fps.toFixed(0)} fps` : '—' }
    ]
  }, [metrics, fps])

  const R = (k: string) => PARAM_RANGES[k] ?? { min: 0, max: 1, step: 0.01 }

  const capacityLabel = unlimited ? '无限（理想妖，从不擦除）' : `${params.memoryCapacity} 位`

  return (
    <Lab theme="maxwell">
      <TooltipHost />
      <LabNav current="maxwell" />
      <Masthead
        meta={['实验 03 · 1867 / 1961', 'Maxwell → Szilard → Landauer', '信息 · 熵 · 第二定律']}
        titleCn="麦克斯韦妖"
        titleEn="Maxwell&apos;s Demon"
        lede={
          <>
            箱子里装满气体，中间一道隔板，隔板上开一扇小门，门口站着一个小妖。
            它只做一件事：看见快分子从左边过来就开门放它去右边，看见慢分子从右边过来就放它去左边。
            于是左边越来越冷、右边越来越热 —— 箱子自己分出了温差，看上去第二定律就这么被打败了。
            这里把妖的账本也一并摊开：它换来的秩序，到底花了多少钱。
          </>
        }
        toc={[
          ['sec-chamber', '观察窗'],
          ['sec-ledger', '熵账本'],
          ['sec-temp', '温差是怎么建立的'],
          ['sec-capacity', '妖的代价']
        ]}
      />

      <main className="shell">
        <aside className="rail" aria-label="实验参数">
          <div className="rail__sticky">
            <section className="panel">
              <h2 className="panel__title">
                箱子<em>有多少分子，多热</em>
              </h2>
              <Slider
                id="in-count"
                label="粒子数"
                value={params.particleCount}
                min={R('particleCount').min}
                max={R('particleCount').max}
                step={R('particleCount').step}
                display={String(params.particleCount)}
                hint="粒子越多温差越平滑，但建立得也越慢。"
                onChange={(v) => patch({ particleCount: v })}
              />
              <Slider
                id="in-temp"
                label="初始温度"
                value={params.temperature}
                min={R('temperature').min}
                max={R('temperature').max}
                step={R('temperature').step}
                display={params.temperature.toFixed(2)}
                hint="温度 = 平均动能。两侧初始温度相同，温差全靠妖制造。"
                onChange={(v) => patch({ temperature: v })}
              />
              <Slider
                id="in-gate"
                label="门高"
                value={params.gateHeight}
                min={R('gateHeight').min}
                max={R('gateHeight').max}
                step={R('gateHeight').step}
                display={String(params.gateHeight)}
                hint="门越大穿过的分子越多，但妖也越难挑得准。"
                onChange={(v) => patch({ gateHeight: v })}
              />
            </section>

            <section className="panel">
              <h2 className="panel__title">
                妖<em>它怎么判断，能记多少</em>
              </h2>

              <Slider
                id="in-threshold"
                label="快慢阈值"
                value={params.speedThreshold}
                min={R('speedThreshold').min}
                max={R('speedThreshold').max}
                step={R('speedThreshold').step}
                display={params.speedThreshold.toFixed(2)}
                hint="判据：速度高于它算「快」。取初始分布的中位数附近时妖最有效。"
                onChange={(v) => patch({ speedThreshold: v })}
              />

              <div className="field">
                <span className="field__label">妖的策略</span>
                <Seg
                  options={[
                    ['maxwell', '正经妖'],
                    ['lazy', '懒妖'],
                    ['reverse', '反向妖'],
                    ['none', '不设妖']
                  ]}
                  value={params.policy}
                  onChange={(v) => patch({ policy: v })}
                />
                <p className="field__hint">
                  懒妖判据更宽（放行更多、开门更少）；反向妖把快慢判断反过来，会造出反向温差；
                  不设妖是不开门的对照组。
                </p>
              </div>

              <div className="field">
                <span className="field__label">
                  记忆容量 <b style={{ color: 'var(--accent)' }}>{capacityLabel}</b>
                </span>
                <Slider
                  id="in-memory"
                  label=""
                  value={unlimited ? 10 : Math.log2(Math.max(2, params.memoryCapacity))}
                  min={1}
                  max={10}
                  step={1}
                  display={capacityLabel}
                  hint="妖每做一次判断就要记一笔。记忆满了必须清空 —— 清空就是擦除，擦除要付 kT ln2。"
                  onChange={(v) => {
                    setUnlimited(false)
                    patch({ memoryCapacity: Math.pow(2, v) })
                  }}
                />
                <Switch
                  label="无限记忆（理想妖，从不擦除）"
                  checked={unlimited}
                  onChange={(v) => {
                    setUnlimited(v)
                    patch({ memoryCapacity: v ? Infinity : 32 })
                  }}
                />
              </div>

              <Slider
                id="in-measure"
                label="每次测量的额外耗散"
                value={params.measurementCost}
                min={0}
                max={3}
                step={0.1}
                display={params.measurementCost.toFixed(1)}
                hint="单位是 kT ln2 的倍数。理想测量取 0；调大可以看到「测量本身也要花钱」时账本怎么变。"
                onChange={(v) => patch({ measurementCost: v })}
              />

              <Chips
                items={DEMON_PRESETS.map((p) => ({ id: p.id, name: p.name, detail: p.detail }))}
                activeId={presetId}
                onPick={(it) => applyPreset(it.id)}
              />
            </section>

            <section className="panel panel--run">
              <button type="button" className="btn btn--primary" id="btn-reset" onClick={reset}>
                重置实验
              </button>
              <p className="run-note">重新抽样所有分子的初始速度，账本归零。</p>
            </section>
          </div>
        </aside>

        <div className="stage">
          <Section id="sec-chamber" variant="verdict" title="">
            <div className="stage-card">
              <div className={'chamber-wrap' + (showHotCold ? '' : ' is-plain')}>
                <ChamberCanvas
                  params={params}
                  running={running}
                  seed={seed}
                  resetToken={resetToken}
                  simRef={simRef}
                  onSample={onSample}
                />
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
                    重置
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    id="btn-freeze"
                    onClick={() => {
                      const s = simRef.current
                      if (s) setMetrics(measureDemon(s, params, { width: 900, height: 440 }))
                      setRunning(false)
                    }}
                  >
                    结算当前
                  </button>
                </div>
                <span className="stage-toolbar__sep" />
                <Switch label="冷热底色" checked={showHotCold} onChange={setShowHotCold} />
                <span className="stage-toolbar__note" id="chamber-note">
                  {params.policy === 'none' ? '当前不设妖，箱子应保持均匀' : '妖正在门口工作'}
                </span>
              </div>
            </div>

            <div style={{ marginTop: 16 }} id="demon-readouts">
              <Readout items={readouts} />
            </div>
          </Section>

          <Section
            id="sec-ledger"
            num="01"
            title="妖的账本"
            note={
              <>
                上面是气体自己的账：妖把快慢分子分开，气体确实变「有序」了，<b>ΔS气体是负的</b>。
                但妖不是免费的 —— 它每做一次判断就要记一比特，记忆满了必须擦掉，
                而按 Landauer 原理，<b>擦除一比特至少要耗散 kT ln2</b>。
                把这三项加起来，才是这个宇宙真正的账。
              </>
            }
          >
            <Ledger
              m={metrics}
              bitsErased={simRef.current?.bitsErased ?? 0}
              bitsRecorded={simRef.current?.bitsRecorded ?? 0}
            />
            <div style={{ marginTop: 20 }}>
              <Balance m={metrics} />
            </div>
            {unlimited && (
              <p className="field__hint" style={{ marginTop: 14 }} id="unlimited-warning">
                当前是<b>无限记忆</b>的理想妖：它从不需要擦除，所以 ΔS擦除 恒为 0，
                净熵可以是负的。这不是物理被推翻了 —— 是一个容量无限的记忆体在物理上不存在。
                把上面的开关关掉，账本立刻就平了。
              </p>
            )}
          </Section>

          <Section
            id="sec-temp"
            num="02"
            title="温差是怎么建立的"
            note={
              <>
                两条线从同一个温度出发，然后自己分开。这就是妖的全部业绩：
                它没有做功、没有加热，只是「选择」了让哪些分子通过。
                把策略切成「不设妖」，两条线会一直缠在一起 —— 对照组说明这个温差确实来自妖，
                而不是随机涨落。
              </>
            }
          >
            {history.length > 2 ? (
              <TempChart history={history} />
            ) : (
              <div className="chart-wrap" style={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
                <p className="field__hint">正在积累数据…</p>
              </div>
            )}
          </Section>

          <Section
            id="sec-capacity"
            num="03"
            title="妖的代价：把记忆容量扫一遍"
            note={
              <>
                这是整个实验的结论。固定其它参数，只改妖的记忆容量，跑同样的 16000 步，看净熵怎么变。
                表格里的分界线非常干脆：<b>只要记忆容量有限，净熵一律为正</b> ——
                妖换来的秩序，被擦除记忆的账买了回去；<b>只有容量无限时才变成负数</b>，
                悖论重新出现。但无限容量的记忆体在物理上不存在。
                Landauer 的 kT ln2 不是修辞，它是这个思想实验唯一的出口。
              </>
            }
          >
            {sweep.data ? (
              <div id="capacity-result">
                <CapacityTable data={sweep.data} />
                <div style={{ marginTop: 18 }}>
                  <CapacityChart data={sweep.data} />
                </div>
              </div>
            ) : (
              <div
                className="chart-wrap"
                id="capacity-pending"
                style={{ minHeight: 200, display: 'grid', placeItems: 'center' }}
              >
                <p className="field__hint">
                  {sweep.busy
                    ? `正在扫描记忆容量 (${(sweep.progress * 100).toFixed(0)}%)…`
                    : '正在准备容量扫描…'}
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
            </div>
          </Section>

          <Colophon
            source={
              <>
                　Maxwell, J. C. (1867) <i>Letter to P. G. Tait</i>；Szilard, L. (1929){' '}
                <i>Über die Entropieverminderung in einem thermodynamischen System bei Eingriffen
                intelligenter Wesen</i>, Zeitschrift für Physik 53: 840–856；Landauer, R. (1961){' '}
                <i>Irreversibility and Heat Generation in the Computing Process</i>, IBM Journal of
                Research and Development 5(3): 183–191；Bennett, C. H. (1982){' '}
                <i>The Thermodynamics of Computation</i>, International Journal of Theoretical
                Physics 21(12): 905–940.
              </>
            }
            footnotes={[
              <>
                熵的单位取 k = 1、m = 1、h = 1。二维理想气体用 Sackur–Tetrode 形式：
                S = N[ln(2πAT/N) + 2]。
              </>,
              <>
                「擦除一比特耗散 kT ln2」是 Landauer 下限，此处按理想情况取等号 ——
                所以账本算出来的净熵是<b>下限</b>，真实机器只会更亏。
              </>,
            ]}
          />
        </div>
      </main>
    </Lab>
  )
}
