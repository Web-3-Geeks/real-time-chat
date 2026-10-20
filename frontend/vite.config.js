import os from 'node:os'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The project lives inside OneDrive, which locks files while syncing and
  // makes Vite fail with EPERM when it tries to clear node_modules/.vite.
  // Keep the dependency cache in the OS temp folder instead.
  cacheDir: path.join(os.tmpdir(), 'vite-cache-real-time-chat'),
})
