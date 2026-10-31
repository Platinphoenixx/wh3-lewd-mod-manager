import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@catalog': resolve(__dirname, '../catalog'), '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
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
