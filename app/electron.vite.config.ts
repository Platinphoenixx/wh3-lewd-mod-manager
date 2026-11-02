import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@catalog': resolve(__dirname, '../catalog'), '@shared': resolve(__dirname, 'src/shared') }

// Shown in Settings next to the version: when this build was made and from which commit.
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
let commit = ''
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
} catch {
  // not a git checkout
}
const buildInfo = {
  date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
  commit
}

export default defineConfig({
  main: {
    define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        // The Steam worker runs as its own process (see src/main/steam.ts).
        input: { index: resolve(__dirname, 'src/main/index.ts'), steamWorker: resolve(__dirname, 'src/main/steamWorker.ts') }
      }
    }
  },
  preload: { resolve: { alias: shared } },
  renderer: {
    resolve: { alias: shared },
    plugins: [react()]
  }
})
