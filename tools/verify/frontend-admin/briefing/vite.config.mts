import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/**
 * 简报视图验收 harness 的独立 vite 配置。
 * - 不读仓库 tsconfig（该文件当时被工具截断，会把任何 src 文件的 transform 打断）
 * - resolve.extensions 把 .ts/.tsx 排在 .js 前面（src 下曾混入过 tsc 误emit 的 .js）
 * - /api 反代到 mock（8899）
 */
const frontend = fileURLToPath(new URL('../../../../frontend/src', import.meta.url))
const harness = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: harness,
  base: '/',
  server: {
    port: 5210,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8899', changeOrigin: false } },
  },
  resolve: {
    alias: { '@': frontend },
    extensions: ['.mjs', '.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  esbuild: {
    jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', target: 'es2022', useDefineForClassFields: true } },
  },
})
