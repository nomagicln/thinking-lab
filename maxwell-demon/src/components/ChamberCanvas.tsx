/**
 * ChamberCanvas.tsx — 麦克斯韦妖的观察窗
 *
 * 和 Boids 一样，仿真状态由外层 ref 持有：熵账本要读的是同一份状态，
 * 不能再跑一遍影子模拟，否则账本和画面会对不上。
 */

import { useEffect, useRef } from 'react'
import { createDemon, stepDemon, type DemonMetrics, type DemonParams, type DemonState } from '../lib/engine'
import { createRng } from '../../../shared/lib/rng'

const W = 900
const H = 440
const DT = 1

/** 速度 → 颜色：慢（冷）偏蓝，快（热）偏红 */
function speedColor(v: number, vRef: number): string {
  const t = Math.max(0, Math.min(1, v / (vRef * 1.9)))
  const cold = [111, 179, 224]
  const warm = [232, 85, 58]
  const c = cold.map((x, i) => Math.round(x + (warm[i] - x) * t))
  return `rgb(${c.join(',')})`
}

export function ChamberCanvas(props: {
  params: DemonParams
  running: boolean
  seed: string
  resetToken: number
  simRef: React.RefObject<DemonState | null>
  onSample: (m: DemonMetrics, fps: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = props.simRef
  const paramsRef = useRef(props.params)
  const runningRef = useRef(props.running)
  const onSampleRef = useRef(props.onSample)
  const gateFlash = useRef(0)
  const lastOpens = useRef(0)
  const rngRef = useRef<(() => number) | null>(null)
  const frames = useRef(0)
  const lastSample = useRef(0)

  paramsRef.current = props.params
  runningRef.current = props.running
  onSampleRef.current = props.onSample

  const box = { width: W, height: H }

  // 重建：状态与随机流必须成对生成，否则步进用的会是另一条流
  useEffect(() => {
    const rng = createRng(props.seed)
    rngRef.current = rng
    stateRef.current = createDemon(paramsRef.current, box, rng)
    lastOpens.current = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.seed, props.resetToken, props.params.particleCount])

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
      const p = paramsRef.current
      if (!state) return

      if (runningRef.current && rngRef.current) {
        const m = stepDemon(state, p, box, DT, rngRef.current)
        if (state.gateOpens > lastOpens.current) gateFlash.current = 1
        lastOpens.current = state.gateOpens
        frames.current++
        if (now - lastSample.current > 200) {
          onSampleRef.current(m, frames.current / ((now - lastSample.current) / 1000))
          frames.current = 0
          lastSample.current = now
        }
      }

      gateFlash.current *= 0.9

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // 箱体
      ctx.fillStyle = 'rgba(0,0,0,.35)'
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = 'rgba(236,229,216,.18)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(0.75, 0.75, W - 1.5, H - 1.5)

      // 左右两半的底色：随温差加深
      const tL = Math.max(0.05, Math.min(1, m0TempL(state) / (p.temperature * 2)))
      const tR = Math.max(0.05, Math.min(1, m0TempR(state) / (p.temperature * 2)))
      ctx.fillStyle = `rgba(111,179,224,${0.10 * (1.6 - tL)})`
      ctx.fillRect(0, 0, W / 2, H)
      ctx.fillStyle = `rgba(232,85,58,${0.10 * (1.6 - tR)})`
      ctx.fillRect(W / 2, 0, W / 2, H)

      // 隔板与门
      const gateH = p.gateHeight
      const gateTop = H / 2 - gateH / 2
      ctx.strokeStyle = 'rgba(236,229,216,.4)'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(W / 2, 0)
      ctx.lineTo(W / 2, gateTop)
      ctx.moveTo(W / 2, gateTop + gateH)
      ctx.lineTo(W / 2, H)
      ctx.stroke()

      // 门开时点亮
      if (gateFlash.current > 0.05) {
        ctx.strokeStyle = `rgba(168,148,232,${gateFlash.current})`
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(W / 2, gateTop)
        ctx.lineTo(W / 2, gateTop + gateH)
        ctx.stroke()
      }

      // 粒子
      for (const pt of state.particles) {
        const v = Math.hypot(pt.vx, pt.vy)
        ctx.fillStyle = speedColor(v, Math.sqrt(p.temperature))
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2)
        ctx.fill()
      }

      // 妖：门边一个小小的菱形，开门时发亮
      const demonX = W / 2 - 16
      const demonGlow = 0.35 + gateFlash.current * 0.65
      ctx.save()
      ctx.translate(demonX, H / 2)
      ctx.rotate(Math.PI / 4)
      ctx.fillStyle = `rgba(168,148,232,${demonGlow})`
      ctx.fillRect(-5.5, -5.5, 11, 11)
      ctx.restore()

      // 两侧温度标注
      ctx.font = '11px ui-monospace, Menlo, monospace'
      ctx.fillStyle = 'rgba(236,229,216,.5)'
      ctx.textAlign = 'left'
      ctx.fillText(`冷侧 ${state.particles.filter((q) => q.x < W / 2).length} 粒`, 14, 22)
      ctx.textAlign = 'right'
      ctx.fillText(`${state.particles.filter((q) => q.x >= W / 2).length} 粒 热侧`, W - 14, 22)
      ctx.textAlign = 'left'
    }

    raf = requestAnimationFrame(draw)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.seed])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      aria-label="麦克斯韦妖的箱体：左冷右热，中间的门由妖控制"
    />
  )
}

/* 供底色渐变的两个小工具（避免在 draw 里重复写滤波） */
function m0TempL(state: DemonState): number {
  let s = 0
  let n = 0
  const mid = 900 / 2
  for (const p of state.particles) {
    if (p.x < mid) {
      s += p.vx * p.vx + p.vy * p.vy
      n++
    }
  }
  return n ? s / (2 * n) : 0
}
function m0TempR(state: DemonState): number {
  let s = 0
  let n = 0
  const mid = 900 / 2
  for (const p of state.particles) {
    if (p.x >= mid) {
      s += p.vx * p.vx + p.vy * p.vy
      n++
    }
  }
  return n ? s / (2 * n) : 0
}
