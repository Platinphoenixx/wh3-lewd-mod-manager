import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Catalog } from '@catalog/schema'

/** catalog.json lives next to the app in the repo during development, in resources when packaged. */
function bundledCatalogPath(): string {
  const candidates = [
    process.env.WH3_CATALOG,
    join(app.getAppPath(), '..', 'catalog', 'catalog.json'),
    process.resourcesPath && join(process.resourcesPath, 'catalog.json')
  ].filter((p): p is string => !!p)
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error(`catalog.json not found (looked in: ${candidates.join(', ')})`)
  return found
}

const cachePath = () => join(app.getPath('userData'), 'catalog-cache.json')
const metaPath = () => join(app.getPath('userData'), 'catalog-cache.meta.json')
/** How often the update URL is asked (a 304 when nothing changed); the daily community job and maintainers' fixes reach players within this time. */
export const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000
const RETRY_MS = 10 * 60 * 1000

interface CacheMeta {
  url: string
  etag?: string
  checkedAt: number
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

/**
 * Newest catalog available: the cached download, else the bundled one (an older catalog is never used).
 * The update URL is checked at most every two hours, and only downloaded when it changed (ETag), so a
 * community of users costs GitHub a tiny request per user every two hours, and LoversLab/Steam nothing.
 */
/** Whether the update URL is due to be asked again (reads only the small meta file). */
export async function catalogCheckDue(catalogUrl?: string): Promise<boolean> {
  if (!catalogUrl || !/^https:\/\//.test(catalogUrl)) return false
  const meta = await readJson<CacheMeta>(metaPath())
  return meta?.url !== catalogUrl || Date.now() - meta.checkedAt >= CHECK_INTERVAL_MS
}

export async function loadCatalog(catalogUrl?: string): Promise<Catalog> {
  const bundled = (await readJson<Catalog>(bundledCatalogPath()))!
  let best = bundled
  const consider = (c: Catalog | null) => {
    if (c?.schemaVersion === bundled.schemaVersion && c.generatedAt > best.generatedAt) best = c
  }
  consider(existsSync(cachePath()) ? await readJson<Catalog>(cachePath()) : null)

  if (!catalogUrl || !/^https:\/\//.test(catalogUrl)) return best
  const meta = await readJson<CacheMeta>(metaPath())
  const sameUrl = meta?.url === catalogUrl
  if (sameUrl && Date.now() - meta.checkedAt < CHECK_INTERVAL_MS) return best

  try {
    const res = await fetch(catalogUrl, {
      signal: AbortSignal.timeout(15000),
      headers: sameUrl && meta.etag ? { 'If-None-Match': meta.etag } : {}
    })
    const next: CacheMeta = { url: catalogUrl, etag: sameUrl ? meta.etag : undefined, checkedAt: Date.now() }
    if (res.ok) {
      const remote = (await res.json()) as Catalog
      next.etag = res.headers.get('etag') ?? undefined
      consider(remote)
      if (best === remote) await writeFile(cachePath(), JSON.stringify(remote), 'utf8')
    }
    // 304 Not Modified: nothing to download, the cache is current.
    await writeFile(metaPath(), JSON.stringify(next), 'utf8')
  } catch {
    // Offline or unreachable: keep the cached/bundled catalog and ask again in ten minutes (not on every look).
    const retry: CacheMeta = { url: catalogUrl, etag: sameUrl ? meta.etag : undefined, checkedAt: Date.now() - CHECK_INTERVAL_MS + RETRY_MS }
    await writeFile(metaPath(), JSON.stringify(retry), 'utf8').catch(() => {})
  }
  return best
}
