/**
 * p-editor 自己的开发/构建配置（不碰项目根 vite.config.ts）。
 *
 * 用途一（安全隔离）：起一个**只把 /api 反代到 8090 测试实例**的 dev server。
 *   项目根配置的 proxy 指向 8080（用户真实数据），本文件把测试隔离到 8090。
 *   npx vite --config src/editor/lab/vite.lab.config.mjs   → http://localhost:5199/editor-lab.html
 *
 * 用途二：验证编辑器在 Vite 8 / rolldown 生产构建下能正确打包。
 *   npx vite build --config src/editor/lab/vite.lab.config.mjs
 */
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('../../../', import.meta.url))

export default defineConfig({
  root,
  base: '/',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) },
  },
  server: {
    port: 5199,
    strictPort: true,
    // 只允许打到隔离实例 8090；绝不允许 8080（用户真实数据）
    proxy: { '/api': { target: 'http://127.0.0.1:8090', changeOrigin: true } },
  },
  build: {
    outDir: fileURLToPath(new URL('../../../../.kb-lab-build/', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('../../../editor-lab.html', import.meta.url)) },
  },
})
