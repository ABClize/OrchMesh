import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  // Read only server-side settings; never inject the root environment into the client.
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const env = loadEnv(mode, root, 'ORCHMESH_')
  const host = env.ORCHMESH_HOST || '127.0.0.1'
  const apiHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      host,
      port: Number(env.ORCHMESH_WEB_PORT || 5173),
      strictPort: true,
      proxy: { '/api': `http://${apiHost}:${env.ORCHMESH_PORT || 8000}` },
    },
  }
})
