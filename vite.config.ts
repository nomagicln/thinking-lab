import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * 多页应用：一个实验室首页 + 每实验一页。
 * base 用相对路径，所以 GitHub Pages 的项目子路径与本地预览都能直接用。
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        hub: resolve(__dirname, 'index.html'),
        axelrod: resolve(__dirname, 'axelrod/index.html'),
        boids: resolve(__dirname, 'boids/index.html'),
        maxwell: resolve(__dirname, 'maxwell-demon/index.html')
      }
    }
  },
  test: {
    environment: 'node',
    include: ['**/src/**/*.test.ts', '**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    // 默认 5 秒不够：Boids 的相变扫描每个用例要跑几千步群体仿真。
    // 本地约 1 秒，GitHub runner 上慢两倍多 —— 不设这个会在 CI 超时，
    // 而本地永远复现不出来。
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
