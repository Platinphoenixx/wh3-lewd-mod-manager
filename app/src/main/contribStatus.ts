import type { ContributionStatus } from '@shared/community'
import { readJson, writeJson } from './store'

// Tests point this at a local fake (WH3LMM_GITHUB_API=http://127.0.0.1:…); never set for players.
const API = process.env.WH3LMM_GITHUB_API || 'https://api.github.com'
const DAY = 24 * 60 * 60 * 1000

/**
 * What became of contributions the relay filed as GitHub issues, read from the public issues (no account, no token):
 * open = waiting; closed with the label "accepted" = in the catalog; closed otherwise = not added, with the maintainer's
 * reason from the last comment ("Not added to the catalog: …"). A decided issue is not asked again; an open one at most
 * once a day (cached in userData/contribution-status.json).
 */
export async function contributionStatus(urls: string[]): Promise<Record<string, ContributionStatus>> {
  const cache = await readJson<Record<string, ContributionStatus>>('contribution-status.json', {})
  let changed = false
  for (const url of urls) {
    const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/.exec(url)
    const known = cache[url]
    if (!m || (known && (known.state !== 'waiting' || Date.now() - Date.parse(known.checkedAt) < DAY))) continue
    try {
      const get = async (path: string) => {
        const res = await fetch(`${API}/repos/${m[1]}/issues/${m[2]}${path}`, {
          signal: AbortSignal.timeout(15000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'wh3lmm-app' }
        })
        if (!res.ok) throw new Error(String(res.status))
        return res.json()
      }
      const issue = (await get('')) as { state: string; labels: { name: string }[] }
      let next: ContributionStatus = { state: 'waiting', checkedAt: new Date().toISOString() }
      if (issue.state === 'closed' && issue.labels.some((l) => l.name === 'accepted')) next = { ...next, state: 'added' }
      else if (issue.state === 'closed') {
        const comments = (await get('/comments?per_page=100')) as { body: string }[]
        const why = [...comments].reverse().map((c) => /^Not added to the catalog: ([\s\S]{1,300})/.exec(c.body)?.[1]).find(Boolean)
        next = { ...next, state: 'not-added', ...(why ? { reason: why.trim() } : {}) }
      }
      cache[url] = next
      changed = true
    } catch {
      // Offline or GitHub busy: ask again next time.
    }
  }
  if (changed) await writeJson('contribution-status.json', cache)
  return Object.fromEntries(urls.filter((u) => cache[u]).map((u) => [u, cache[u]]))
}
