/**
 * FlockCanvas.tsx — 鸟群仿真画布
 *
 * 架构上的关键决定：模拟状态放在 ref 里、不进 React state。
 * 每帧 60 次的更新如果走 state 会把整棵树重渲染；这里只在采样点
 * （约每 200ms）把指标推给外层，画布则由 rAF 自己重绘。
 */

import { useCallback, useEffect, useRef } from 'react'
import {
  createFlock,
  ruleBreakdown,
  stepFlock,
  type BoidParams,
  type FlockMetrics,
  type FlockState
} from '../lib/engine'
import { createRng } from '../../../shared/lib/rng'

/** 仿真空间的逻辑尺寸（画布按此比例自适应缩放） */
const W = 900
const H = 520
const DT = 1

const JADE = '#57dcaa'
const ACCENT = '#6fb3e0'
const VERM = '#e8553a'

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `rgb(${c.join(',')})`
}

// 低对齐 → 冷蓝；高对齐 → 玉绿
const COLD: [number, number, number] = [111, 179, 224]
const WARM: [number, number, number] = [87, 220, 170]

export function FlockCanvas(props: {
  params: BoidParams
  running: boolean
  showTrails: boolean
  showVectors: boolean
  selectedIndex: number | null
  seed: string
  resetToken: number
  /** 仿真状态由外层持有：面板要读同一只鸟的真实受力，不能另跑一份影子仿真 */
  simRef: React.RefObject<FlockState | null>
  onSelect: (index: number | null) => void
  onSample: (m: FlockMetrics, fps: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = props.simRef
  const rngRef = useRef<(() => number) | null>(null)
  const paramsRef = useRef(props.params)
  const uiRef = useRef({
    running: props.running,
    showTrails: props.showTrails,
    showVectors: props.showVectors,
    selectedIndex: props.selectedIndex
  })
  const onSampleRef = useRef(props.onSample)
  const framesRef = useRef(0)
  const lastSampleRef = useRef(0)
  const fpsRef = useRef(0)

  paramsRef.current = props.params
  uiRef.current = {
    running: props.running,
    showTrails: props.showTrails,
    showVectors: props.showVectors,
    selectedIndex: props.selectedIndex
  }
  onSampleRef.current = props.onSample

  /* ---------------- 重建群体 ---------------- */

  const rebuild = useCallback(() => {
    const rng = createRng(props.seed)
    rngRef.current = rng
    stateRef.current = createFlock(paramsRef.current, W, H, rng)
  }, [props.seed])

  useEffect(() => {
    rebuild()
  }, [rebuild, props.resetToken, props.params.count, props.params.predatorCount])

  /* ---------------- 渲染循环 ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let stopped = false

    const draw = (now: number) => {
      if (stopped) return
      raf = requestAnimationFrame(draw)

      const state = stateRef.current
      const rng = rngRef.current
      const p = paramsRef.current
      const ui = uiRef.current
      if (!state || !rng) return

      if (ui.running) {
        const metrics = stepFlock(state, p, DT, W, H, rng)
        framesRef.current++
        if (now - lastSampleRef.current > 200) {
          const elapsed = (now - lastSampleRef.current) / 1000
          fpsRef.current = framesRef.current / elapsed
          framesRef.current = 0
          lastSampleRef.current = now
          onSampleRef.current(metrics, fpsRef.current)
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // 轨迹模式：盖一层半透明底色，让旧位置自然淡出
      if (ui.showTrails) {
        ctx.fillStyle = 'rgba(8, 10, 9, 0.16)'
        ctx.fillRect(0, 0, W, H)
      } else {
        ctx.clearRect(0, 0, W, H)
      }

      // 全局平均方向：用来给每只鸟上色（对齐好的偏绿，乱的偏蓝）
      let mvx = 0
      let mvy = 0
      for (const b of state.boids) {
        const s = Math.hypot(b.vx, b.vy) || 1
        mvx += b.vx / s
        mvy += b.vy / s
      }
      const mlen = Math.hypot(mvx, mvy) || 1
      const dx = mvx / mlen
      const dy = mvy / mlen

      ctx.lineWidth = 1

      for (let i = 0; i < state.boids.length; i++) {
        const b = state.boids[i]
        const s = Math.hypot(b.vx, b.vy) || 1
        const align = Math.max(0, (b.vx / s) * dx + (b.vy / s) * dy)
        const isSel = ui.selectedIndex === i

        // 感知范围
        if (isSel) {
          ctx.beginPath()
          ctx.arc(b.x, b.y, p.perception, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(236,229,216,.22)'
          ctx.setLineDash([3, 4])
          ctx.stroke()
          ctx.setLineDash([])
        }

        const a = Math.atan2(b.vy, b.vx)
        const size = isSel ? 7.5 : 5.2
        ctx.save()
        ctx.translate(b.x, b.y)
        ctx.rotate(a)
        ctx.beginPath()
        ctx.moveTo(size, 0)
        ctx.lineTo(-size * 0.72, size * 0.56)
        ctx.lineTo(-size * 0.32, 0)
        ctx.lineTo(-size * 0.72, -size * 0.56)
        ctx.closePath()
        if (isSel) {
          ctx.fillStyle = '#ece5d8'
          ctx.fill()
          ctx.strokeStyle = ACCENT
          ctx.lineWidth = 1.5
          ctx.stroke()
        } else {
          ctx.fillStyle = mix(COLD, WARM, align)
          ctx.globalAlpha = 0.5 + align * 0.5
          ctx.fill()
          ctx.globalAlpha = 1
        }
        ctx.restore()
      }

      // 掠食者
      for (const pr of state.predators) {
        const a = Math.atan2(pr.vy, pr.vx)
        ctx.save()
        ctx.translate(pr.x, pr.y)
        ctx.rotate(a)
        ctx.beginPath()
        ctx.moveTo(11, 0)
        ctx.lineTo(-7, 7.5)
        ctx.lineTo(-3, 0)
        ctx.lineTo(-7, -7.5)
        ctx.closePath()
        ctx.fillStyle = VERM
        ctx.fill()
        ctx.restore()
      }

      // 选中个体的三条转向向量
      const sel = ui.selectedIndex
      if (ui.showVectors && sel != null && state.boids[sel]) {
        const b = state.boids[sel]
        const brk = ruleBreakdown(state, p, sel)
        const arrows: [number, number, string][] = [
          [brk.separation[0], brk.separation[1], VERM],
          [brk.alignment[0], brk.alignment[1], ACCENT],
          [brk.cohesion[0], brk.cohesion[1], JADE]
        ]
        ctx.lineWidth = 2
        for (const [ax, ay, color] of arrows) {
          const len = Math.hypot(ax, ay)
          if (len < 1e-6) continue
          const scale = Math.min(70 / len, 14)
          ctx.beginPath()
          ctx.moveTo(b.x, b.y)
          ctx.lineTo(b.x + ax * scale, b.y + ay * scale)
          ctx.strokeStyle = color
          ctx.stroke()
        }
      }
    }

    raf = requestAnimationFrame(draw)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
    }
  }, [])

  /* ---------------- 点选个体 ---------------- */

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const state = stateRef.current
    const canvas = canvasRef.current
    if (!state || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const y = ((e.clientY - rect.top) / rect.height) * H

    let best = -1
    let bestD = 18 * 18
    for (let i = 0; i < state.boids.length; i++) {
      const b = state.boids[i]
      const d = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    props.onSelect(best >= 0 ? best : null)
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      onClick={handleClick}
      aria-label="鸟群仿真画布，点击任意一只鸟可以查看它的转向分解"
    />
  )
}
