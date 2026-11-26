import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000, 
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:8002',
        changeOrigin: true,
        // 修复：FastAPI 307 重定向的 Location 会带 target 主机（跨源），
        // 浏览器跟随跨源重定向会丢弃 Authorization 头导致 403，autoRewrite 改写回请求方主机
        autoRewrite: true,
      }
    }
  }
})
