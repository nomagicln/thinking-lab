/**
 * format.ts — 数字格式化、配色、以及从收益矩阵推导出来的展示用派生量
 */

import type { PayoffMatrix } from './engine'

export function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

/** 整数就不带小数，否则保留一位（99.5% 不该被显示成 100%） */
export function pct(fraction: number): string {
  const v = fraction * 100
  return (Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : Number(v.toFixed(1))) + '%'
}

export function pctWhole(fraction: number): string {
  return Math.round(fraction * 100) + '%'
}

/**
 * 选手配色：刻意避开红橙色系 ——
 * 在这套界面里红 = 背叛，不能让选手配色撞上语义。
 */
export const PALETTE = [
  '#57dcaa', '#d9a441', '#6fb3e0', '#a894e8', '#7fd1c8',
  '#e6c86e', '#dd7ba8', '#8fc46a', '#c9a0ff', '#68c6a0',
  '#b8a0e0', '#9ad0e8', '#d6c07a', '#8fbf8f', '#cc8fbf',
  '#a8c8e8', '#7fc9b0', '#c0b0e8'
]

const COLOR_INDEX: Record<string, number> = {}
export function registerColorOrder(ids: string[]): void {
  ids.forEach((id, i) => {
    COLOR_INDEX[id] = i
  })
}

export function colorOf(id: string): string {
  const i = COLOR_INDEX[id] ?? 0
  return PALETTE[i % PALETTE.length]
}

export function heatRamp(t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const stops: [number, [number, number, number]][] = [
    [0, [75, 36, 28]],
    [0.32, [44, 43, 36]],
    [0.62, [29, 86, 71]],
    [1, [87, 220, 170]]
  ]
  for (let i = 1; i < stops.length; i++) {
    if (clamped <= stops[i][0]) {
      const [t0, c0] = stops[i - 1]
      const [t1, c1] = stops[i]
      const span = t1 - t0 || 1
      const k = (clamped - t0) / span
      const mix = c0.map((v, j) => Math.round(v + (c1[j] - v) * k))
      return `rgb(${mix.join(',')})`
    }
  }
  return 'rgb(87,220,170)'
}

/** 深色/浅色自适应的文字色 */
export function onColorText(rgb: string): string {
  const m = rgb.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (!m) return '#ece5d8'
  const lum = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255
  return lum > 0.5 ? '#0f1311' : '#ece9e2'
}

export const JADE = '#57dcaa'
export const VERMILION = '#e8553a'
export const BRASS = '#d9a441'

/** 合作比例 → 朱红..铜..玉绿 */
export function coopColor(frac: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [232, 85, 58]],
    [0.5, [217, 164, 65]],
    [1, [87, 220, 170]]
  ]
  const c = Math.max(0, Math.min(1, frac))
  for (let i = 1; i < stops.length; i++) {
    if (c <= stops[i][0]) {
      const [t0, c0] = stops[i - 1]
      const [t1, c1] = stops[i]
      const k = (c - t0) / (t1 - t0 || 1)
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`
    }
  }
  return 'rgb(87,220,170)'
}

/** 该策略的得分上限：每轮全合作 R 分 × 有效轮数 */
export function scoreCeiling(matrix: PayoffMatrix, effectiveRounds: number): number {
  return matrix.R * effectiveRounds
}

export function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}
