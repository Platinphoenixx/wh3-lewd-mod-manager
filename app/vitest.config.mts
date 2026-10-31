import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@catalog': resolve(import.meta.dirname, '../catalog'), '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: { include: ['src/**/*.test.ts'] }
})
