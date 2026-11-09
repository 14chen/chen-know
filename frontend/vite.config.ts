import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 正式应用：直接挂在站点根路径 `/`。
// 仍然用 hash 路由（#/notes/12），因此**不需要**后端做 SPA fallback —— 
// Spring Boot 的 WelcomePageHandlerMapping 会把 `/` 映射到 static/index.html，
// 而 hash 部分不会发给服务器，子路由刷新也不会 404。
//
// 旧零构建前端已归档到 frontend-legacy/static-backup/（不参与构建）。
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../backend/src/main/resources/static',
    emptyOutDir: true,
    // 编辑器与编辑器语言包体积较大，警告阈值调高，避免构建输出噪音
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    // 开发时把 /api 反代到真后端，避免跨域
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
