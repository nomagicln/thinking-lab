/**
 * Playback.tsx — 多人同步回放
 *
 * 泳道用 canvas 画（17 位 × 1000 轮的 DOM 会撑爆），
 * 当前轮快照矩阵用 DOM，因为要逐格更新文字。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RoundRobinResult, Strategy } from '../lib/engine'
import { coopColor, pctWhole } from '../lib/format'

const STRIP_H = 22

/** 画一条泳道：每一列是一轮，颜色 = 该轮对多少个对手选择了合作 */
function paintStrip(
  canvas: HTMLCanvasElement,
  frac: number[][],
  row: number,
  cursor: number,
  T: number
) {
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  if (!cssW) return
  const bw = Math.round(cssW * dpr)
  const bh = Math.round(STRIP_H * dpr)
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, STRIP_H)

  const w = cssW / T
  const step = Math.max(w, 0.6)
  for (let t = 0; t < T; t++) {
    // 还没轮到的部分压暗，保留「未来」的轮廓
    ctx.globalAlpha = t < cursor ? 1 : 0.13
    ctx.fillStyle = coopColor(frac[t][row])
    ctx.fillRect(t * w, 0, step + 0.5, STRIP_H)
  }

  ctx.globalAlpha = 1
  if (cursor > 0) {
    ctx.fillStyle = 'rgba(236,229,216,.92)'
    ctx.fillRect(Math.min(cssW - 1.5, cursor * w), 0, 1.5, STRIP_H)
  }
}

export function Playback(props: {
  data: RoundRobinResult
  strategies: Strategy[]
  /** 显示顺序（数组下标排列）：默认按最终得分从高到低 */
  order: number[]
  cursor: number
  onCursor: (k: number) => void
}) {
  const { data: D, strategies, order } = props
  const K = D.K
  const T = D.rounds
  // 数据换长度的那一帧，外部 cursor 可能还停在上一份数据的末尾。
  // 组件自己夹一次，绝不越界取值。
  const cursor = Math.max(0, Math.min(T, props.cursor))
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const [, forceRepaint] = useState(0)

  const paintAll = useCallback(() => {
    order.forEach((dataIdx, pos) => {
      const c = canvasRefs.current[pos]
      if (c) paintStrip(c, D.coopFrac, dataIdx, cursor, T)
    })
  }, [D, order, cursor, T])

  // 换了数据/顺序要重画；拖动游标也要重画（canvas 不受 React 差分控制）
  useLayoutEffect(() => {
    paintAll()
  }, [paintAll])

  // 容器宽度变化时重画
  useEffect(() => {
    const onResize = () => forceRepaint((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 实时名次
  const scores = cursor > 0 ? D.cum[cursor - 1] : null
  const rankOf: number[] = new Array(K).fill(0)
  order
    .slice()
    .sort((a, b) => (scores ? scores[b] - scores[a] : 0))
    .forEach((dataIdx, r) => {
      rankOf[dataIdx] = r + 1
    })

  // 本轮全局统计
  let tally = '—'
  if (cursor > 0) {
    let coopMoves = 0
    let totalMoves = 0
    for (let a = 0; a < K; a++) {
      for (let b = 0; b < K; b++) {
        if (a === b) continue
        const row = D.move[a][b]
        if (!row) continue
        totalMoves++
        if (row[cursor - 1] === 'C') coopMoves++
      }
    }
    tally = `本轮共 ${totalMoves} 次出手，${coopMoves} 次选择合作（${pctWhole(
      coopMoves / totalMoves
    )}）`
  }

  const showText = K <= 10

  return (
    <div className="pb">
      <div className="pb__lead">
        <span className="pb__round">{cursor === 0 ? '准备开局' : `第 ${cursor} / ${T} 轮`}</span>
        <span className="pb__tally">{tally}</span>
      </div>

      <div className="pb__lanes">
        {order.map((dataIdx, pos) => {
          const st = strategies[dataIdx]
          const sc = cursor > 0 ? D.cum[cursor - 1][dataIdx] : 0
          const roundScore = cursor > 0 ? D.roundScore[cursor - 1][dataIdx] : null
          let acc = 0
          for (let t = 0; t < cursor; t++) acc += D.coopFrac[t][dataIdx]

          return (
            <div className="pb__lane" key={st.id}>
              <div className="pb__info">
                <span
                  className={'pb__rank' + (cursor > 0 && rankOf[dataIdx] === 1 ? ' is-first' : '')}
                >
                  {cursor > 0 ? String(rankOf[dataIdx]).padStart(2, '0') : '—'}
                </span>
                <span className="pb__name">
                  {st.name}
                  <span className="pb__short">{st.short}</span>
                </span>
                <span className="pb__round-score">
                  {roundScore != null ? (roundScore >= 0 ? '+' : '') + roundScore : ''}
                </span>
                <span className="pb__score">{sc}</span>
                <span className="pb__per">{cursor > 0 ? `每轮 ${(sc / cursor).toFixed(2)}` : '每轮 —'}</span>
                <span className="pb__coop">
                  {cursor > 0 ? `合作 ${pctWhole(acc / cursor)}` : '合作 —'}
                </span>
              </div>
              <canvas
                className="pb__canvas"
                style={{ height: STRIP_H }}
                ref={(el) => {
                  canvasRefs.current[pos] = el
                }}
              />
            </div>
          )
        })}
      </div>

      <div className="pb__snapshot">
        <h4 className="pb__snapshot-title">
          {cursor === 0 ? '还没开局' : `第 ${cursor} 轮：谁对谁做了什么`}
        </h4>
        <div
          className="pb__grid"
          style={{ gridTemplateColumns: `60px repeat(${K}, minmax(0, 1fr))` }}
        >
          <div className="pb__grid-corner">我 ＼ 对方</div>
          {order.map((dataIdx) => (
            <div className="pb__grid-colhead" key={`h-${strategies[dataIdx].id}`}>
              {strategies[dataIdx].short}
            </div>
          ))}
          {order.map((rowIdx) => (
            <RowCells
              key={`r-${strategies[rowIdx].id}`}
              rowIdx={rowIdx}
              order={order}
              strategies={strategies}
              move={D.move}
              cursor={cursor}
              showText={showText}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function RowCells(props: {
  rowIdx: number
  order: number[]
  strategies: Strategy[]
  move: RoundRobinResult['move']
  cursor: number
  showText: boolean
}) {
  const { rowIdx, order, strategies, move, cursor, showText } = props
  return (
    <>
      <div className="pb__grid-rowhead">{strategies[rowIdx].short}</div>
      {order.map((colIdx) => {
        if (colIdx === rowIdx) {
          return (
            <div className="pb__grid-cell is-self" key={`${rowIdx}-${colIdx}`}>
              —
            </div>
          )
        }
        const row = move[rowIdx][colIdx]
        if (cursor === 0 || !row) {
          return <div className="pb__grid-cell" key={`${rowIdx}-${colIdx}`} />
        }
        const mv = row[cursor - 1]
        return (
          <div
            className={`pb__grid-cell is-${mv === 'C' ? 'c' : 'd'}`}
            key={`${rowIdx}-${colIdx}`}
            title={`${strategies[rowIdx].short} 在第 ${cursor} 轮对 ${strategies[colIdx].short}：${
              mv === 'C' ? '合作' : '背叛'
            }`}
          >
            {showText ? mv : ''}
          </div>
        )
      })}
    </>
  )
}
