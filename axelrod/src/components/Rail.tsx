/**
 * Rail.tsx — 左侧控制台：收益矩阵、对局规则、参赛阵容
 */

import { MATRIX_PRESETS, validateMatrix, type PayoffMatrix } from '../lib/engine'
import { ROSTER_PRESETS, STRATEGIES, type RosterPreset } from '../lib/strategies'
import { Chips, Slider } from '../../../shared/components/ui'
import { colorOf } from '../lib/format'

export interface Params {
  matrix: PayoffMatrix
  matrixPresetId: string
  rounds: number
  repetitions: number
  noise: number
  mode: 'fixed' | 'geometric'
  discount: number
  seedBase: string
  selectedIds: string[]
  rosterPresetId: string | null
}

/* ------------------------------------------------------------------ *
 * 收益矩阵
 * ------------------------------------------------------------------ */

const CELLS: { key: keyof PayoffMatrix; tag: string; cls: string }[] = [
  { key: 'R', tag: 'R 奖赏', cls: 'matrix-cell--cc' },
  { key: 'S', tag: 'S 受骗', cls: 'matrix-cell--cd' },
  { key: 'T', tag: 'T 诱惑', cls: 'matrix-cell--dc' },
  { key: 'P', tag: 'P 惩罚', cls: 'matrix-cell--dd' }
]

function MatrixEditor(props: {
  matrix: PayoffMatrix
  presetId: string
  onChange: (m: PayoffMatrix, presetId: string | null) => void
}) {
  const { matrix } = props
  const v = validateMatrix(matrix)

  const set = (key: keyof PayoffMatrix, raw: number) => {
    props.onChange({ ...matrix, [key]: Number.isFinite(raw) ? raw : 0 }, null)
  }

  return (
    <section className="panel">
      <h2 className="panel__title">
        收益矩阵<em>单次博弈的四个数字</em>
      </h2>

      <div className="matrix-grid">
        <div className="matrix-grid__corner">我 ＼ 对方</div>
        <div className="matrix-grid__colhead">对方合作</div>
        <div className="matrix-grid__colhead">对方背叛</div>

        <div className="matrix-grid__rowhead">我合作</div>
        {CELLS.slice(0, 2).map((c) => (
          <label className={`matrix-cell ${c.cls}`} key={c.key}>
            <span className="matrix-cell__tag">{c.tag}</span>
            <input
              id={`in-${c.key}`}
              type="number"
              inputMode="numeric"
              value={matrix[c.key]}
              onChange={(e) => set(c.key, Number(e.target.value))}
            />
          </label>
        ))}

        <div className="matrix-grid__rowhead">我背叛</div>
        {CELLS.slice(2).map((c) => (
          <label className={`matrix-cell ${c.cls}`} key={c.key}>
            <span className="matrix-cell__tag">{c.tag}</span>
            <input
              id={`in-${c.key}`}
              type="number"
              inputMode="numeric"
              value={matrix[c.key]}
              onChange={(e) => set(c.key, Number(e.target.value))}
            />
          </label>
        ))}
      </div>

      <div className="constraints" id="constraints" aria-live="polite">
        {v.checks.map((c) => (
          <div key={c.key} className={'constraint ' + (c.ok ? 'is-ok' : 'is-bad')}>
            {c.text}
          </div>
        ))}
        <div className={'constraint-banner ' + (v.valid ? 'is-ok' : 'is-bad')}>
          {v.valid
            ? '✓ 这是一个合法的囚徒困境。合作在长期是「可能」的，但背叛始终是短期最优。'
            : '✗ 当前数值不构成囚徒困境，下面的结果只是普通的博弈得分，不再具备「困境」的含义。'}
        </div>
      </div>

      <Chips
        items={MATRIX_PRESETS}
        activeId={props.presetId}
        tight
        hostId="matrix-presets"
        onPick={(p) => props.onChange(p.matrix, p.id)}
      />
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * 对局规则
 * ------------------------------------------------------------------ */

function MatchRules(props: {
  p: Params
  onPatch: (patch: Partial<Params>) => void
  onReseed: () => void
}) {
  const { p, onPatch } = props
  const expected = 1 / (1 - p.discount)

  return (
    <section className="panel">
      <h2 className="panel__title">
        对局规则<em>它们相遇多久、多干净</em>
      </h2>

      {p.mode === 'fixed' && (
        <Slider
          id="in-rounds"
          label="每场轮数"
          value={p.rounds}
          min={5}
          max={1000}
          step={5}
          display={String(p.rounds)}
          hint="1980 年首届锦标赛用的是 200 轮。"
          onChange={(v) => onPatch({ rounds: v })}
        />
      )}

      <Slider
        id="in-reps"
        label="重复次数"
        value={p.repetitions}
        min={1}
        max={50}
        display={String(p.repetitions)}
        hint="对每组对手反复开局，抹平运气成分，取平均分。"
        onChange={(v) => onPatch({ repetitions: v })}
      />

      <Slider
        id="in-noise"
        label="误操作率"
        value={Math.round(p.noise * 100)}
        min={0}
        max={30}
        display={`${Math.round(p.noise * 100)}%`}
        hint="「颤抖的手」：出手前有概率把自己想好的动作做反。"
        onChange={(v) => onPatch({ noise: v / 100 })}
      />

      <div className="field">
        <span className="field__label">未来阴影</span>
        <div className="seg">
          <button
            type="button"
            className={p.mode === 'fixed' ? 'is-on' : ''}
            onClick={() => onPatch({ mode: 'fixed' })}
          >
            固定轮数
          </button>
          <button
            type="button"
            className={p.mode === 'geometric' ? 'is-on' : ''}
            onClick={() => onPatch({ mode: 'geometric' })}
          >
            几何延续 w
          </button>
        </div>
        {p.mode === 'geometric' && (
          <>
            <Slider
              id="in-discount"
              label="继续概率 w"
              value={Math.round(p.discount * 100)}
              min={30}
              max={99}
              display={p.discount.toFixed(2)}
              hint={`期望轮数 1/(1−w) = ${expected.toFixed(1)} 轮。`}
              onChange={(v) => onPatch({ discount: v / 100 })}
            />
          </>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="in-seed">
          随机种子
        </label>
        <div className="seed-row">
          <input
            id="in-seed"
            type="text"
            spellCheck={false}
            value={p.seedBase}
            onChange={(e) => onPatch({ seedBase: e.target.value })}
          />
          <button type="button" className="btn btn--ghost" title="换一组随机数" onClick={props.onReseed}>
            换
          </button>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * 参赛阵容
 * ------------------------------------------------------------------ */

function RosterPicker(props: {
  p: Params
  preset: RosterPreset | undefined
  onPreset: (preset: RosterPreset) => void
  onToggle: (id: string) => void
  onAll: () => void
  onNone: () => void
}) {
  const { p } = props
  const on = new Set(p.selectedIds)

  return (
    <section className="panel">
      <h2 className="panel__title">
        参赛阵容<em>谁被允许进场</em>
      </h2>

      <Chips
        items={ROSTER_PRESETS.map((r) => ({ id: r.id, name: r.name, detail: r.detail }))}
        activeId={p.rosterPresetId}
        hostId="roster-presets"
        onPick={(it) => {
          const preset = ROSTER_PRESETS.find((r) => r.id === it.id)
          if (preset) props.onPreset(preset)
        }}
      />

      <div className="roster-actions">
        <button type="button" className="btn btn--link" onClick={props.onAll}>
          全选
        </button>
        <button type="button" className="btn btn--link" onClick={props.onNone}>
          全不选
        </button>
        <span className="roster-count">
          <b>{p.selectedIds.length}</b> 位选手
        </span>
      </div>

      <div className="roster">
        {STRATEGIES.map((s) => {
          const isOn = on.has(s.id)
          return (
            <label
              key={s.id}
              className={'roster-item' + (isOn ? ' is-on' : '')}
              title={`${s.origin}\n${s.philosophy}`}
            >
              <input type="checkbox" checked={isOn} onChange={() => props.onToggle(s.id)} hidden />
              <span className="roster-item__mark">✓</span>
              <span className="roster-item__swatch" style={{ background: colorOf(s.id) }} />
              <span className="roster-item__name">{s.name}</span>
              <span className="roster-item__short">{s.short}</span>
            </label>
          )
        })}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * 整条控制栏
 * ------------------------------------------------------------------ */

export function ControlRail(props: {
  p: Params
  onPatch: (patch: Partial<Params>) => void
  onPreset: (preset: RosterPreset) => void
  onToggleStrategy: (id: string) => void
  onAll: () => void
  onNone: () => void
  onReseed: () => void
  preset: RosterPreset | undefined
  computeMs: number
}) {
  return (
    <aside className="rail" aria-label="实验参数">
      <div className="rail__sticky">
        <MatrixEditor
          matrix={props.p.matrix}
          presetId={props.p.matrixPresetId}
          onChange={(m, id) => props.onPatch({ matrix: m, matrixPresetId: id ?? '' })}
        />
        <MatchRules p={props.p} onPatch={props.onPatch} onReseed={props.onReseed} />
        <RosterPicker
          p={props.p}
          preset={props.preset}
          onPreset={props.onPreset}
          onToggle={props.onToggleStrategy}
          onAll={props.onAll}
          onNone={props.onNone}
        />
        <section className="panel panel--run">
          <div className="run-note">
            {props.preset?.detail ?? '自定义阵容'}。所有改动即时重算（最近一次 {props.computeMs.toFixed(0)} ms）。
          </div>
        </section>
      </div>
    </aside>
  )
}
