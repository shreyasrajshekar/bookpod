import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cross-origin isolation lets the voice engine use several CPU threads.
// "credentialless" keeps cross-origin fetches (model files, fonts) working without CORP headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 2500 },
  server: { headers: isolation },
  preview: { headers: isolation },
})
