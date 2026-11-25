import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'wh3lmm-catalog-'))
vi.mock('electron', () => ({ app: { getPath: () => home, getAppPath: () => home } }))

const URL = 'https://example.org/catalog.json'
const checked = (hoursAgo: number, url = URL) =>
  writeFileSync(join(home, 'catalog-cache.meta.json'), JSON.stringify({ url, checkedAt: Date.now() - hoursAgo * 3600_000 }))

describe('catalog update check', () => {
  it('asks again every two hours, not once a day', async () => {
    const { catalogCheckDue } = await import('./catalog')
    expect(await catalogCheckDue(URL)).toBe(true) // never asked
    checked(1)
    expect(await catalogCheckDue(URL)).toBe(false)
    checked(2.1)
    expect(await catalogCheckDue(URL)).toBe(true)
    checked(1, 'https://example.org/other.json')
    expect(await catalogCheckDue(URL)).toBe(true) // another address in Settings
    expect(await catalogCheckDue('http://example.org/catalog.json')).toBe(false) // only https
  })

  it('asks again ten minutes after a failed check', async () => {
    const { catalogCheckDue, loadCatalog } = await import('./catalog')
    process.env.WH3_CATALOG = join(home, 'bundled.json')
    writeFileSync(process.env.WH3_CATALOG, JSON.stringify({ schemaVersion: 1, generatedAt: '2026-01-01', mods: [], presets: [] }))
    const unreachable = 'https://127.0.0.1:1/catalog.json'
    await loadCatalog(unreachable)
    expect(await catalogCheckDue(unreachable)).toBe(false)
    const meta = JSON.parse(readFileSync(join(home, 'catalog-cache.meta.json'), 'utf8'))
    expect(Date.now() - meta.checkedAt).toBeGreaterThan(110 * 60_000) // due again after ten minutes
    delete process.env.WH3_CATALOG
  })
})
