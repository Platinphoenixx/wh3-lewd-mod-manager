import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { isNewerVersion } from '@shared/version'

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const metaPath = () => join(app.getPath('userData'), 'app-update.json')

interface UpdateMeta {
  repo: string
  checkedAt: number
  etag?: string
  latest?: { version: string; url: string }
}

/**
 * A newer release of the app on GitHub, if there is one. Asked at most once a day (with an ETag, so an
 * unchanged answer costs almost nothing); the app never downloads or installs anything by itself.
 */
export async function checkAppUpdate(repo: string): Promise<{ version: string; url: string } | null> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null
  let meta: UpdateMeta | null = null
  try {
    meta = JSON.parse(await readFile(metaPath(), 'utf8')) as UpdateMeta
  } catch { /* first check */ }
  const same = meta?.repo === repo
  if (!same || Date.now() - meta!.checkedAt >= CHECK_INTERVAL_MS) {
    const next: UpdateMeta = { repo, checkedAt: Date.now(), etag: same ? meta?.etag : undefined, latest: same ? meta?.latest : undefined }
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        signal: AbortSignal.timeout(15000),
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'wh3lmm-app', ...(next.etag ? { 'if-none-match': next.etag } : {}) }
      })
      if (res.ok) {
        const r = (await res.json()) as { tag_name?: string; html_url?: string }
        next.etag = res.headers.get('etag') ?? undefined
        next.latest = r.tag_name && r.html_url ? { version: r.tag_name.replace(/^v/, ''), url: r.html_url } : undefined
      } else if (res.status === 404) {
        next.latest = undefined // no release yet
      }
      // 304: unchanged since the last check.
      await writeFile(metaPath(), JSON.stringify(next), 'utf8')
      meta = next
    } catch {
      // Offline: try again at the next start.
    }
  }
  const latest = meta?.repo === repo ? meta.latest : undefined
  return latest && isNewerVersion(latest.version, app.getVersion()) ? latest : null
}
