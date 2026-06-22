import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Canton JSON Ledger API does not send CORS headers, so the browser cannot
// call it cross-origin. In dev we proxy /v2 to the sandbox (default 127.0.0.1:6864)
// so the app talks to it same-origin. Override the target with VITE_LEDGER_TARGET.
const target = process.env.VITE_LEDGER_TARGET || 'http://127.0.0.1:6864'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/v2': { target, changeOrigin: true } },
  },
})
