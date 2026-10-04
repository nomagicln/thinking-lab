import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 相对路径：GitHub Pages 的项目站点（/thinking-lab/）与本地预览都能直接用
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
