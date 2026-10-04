/**
 * rng.ts — 可复现的伪随机数
 *
 * 所有实验的模拟都必须可复现：同一个 seed 必得同一结果。
 * 引擎侧的接口统一是「外部传一个 () => number 进来」，所以这里只提供构造器。
 */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createRng(seed: string | number): () => number {
  const s = typeof seed === 'number' && Number.isFinite(seed) ? seed >>> 0 : xmur3(String(seed))() >>> 0
  return mulberry32(s)
}

/** 标准正态分布（Box–Muller），麦克斯韦-玻尔兹曼抽样要用 */
export function gaussian(rng: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
