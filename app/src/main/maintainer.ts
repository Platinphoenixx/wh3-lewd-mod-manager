import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, net, safeStorage } from 'electron'
import type { MaintainerStatus, ReviewItem } from '@shared/api'

/**
 * Maintainer access: a GitHub token the maintainer enters in Settings (fine-grained, issues of the catalog repository).
 * It is kept encrypted with Windows' own protection (safeStorage) and only ever sent to api.github.com. With it the app
 * lists the contributions and shared setups waiting for review, and accepts (label "accepted" – the repository's
 * workflow does the rest) or rejects them (closed with a comment).
 */
const FILE = () => join(app.getPath('userData'), 'maintainer.bin')
const REVIEW_LABELS = ['setup', 'new-mod', 'feedback', 'rule', 'correction']
// Tests point this at a local fake (WH3LMM_GITHUB_API=http://127.0.0.1:…); never set for players.
const API = process.env.WH3LMM_GITHUB_API || 'https://api.github.com'

async function token(): Promise<string | null> {
  if (!existsSync(FILE()) || !safeStorage.isEncryptionAvailable()) return null
  return safeStorage.decryptString(await readFile(FILE()))
}

async function github(repo: string, path: string, init: { method?: string; body?: object } = {}, t?: string) {
  const tok = t ?? (await token())
  if (!tok) throw new Error('No maintainer token is set.')
  const res = await net.fetch(`${API}/repos/${repo}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${tok}`, accept: 'application/vnd.github+json', 'user-agent': 'wh3lmm-maintainer',
      ...(init.body ? { 'content-type': 'application/json' } : {})
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  })
  if (!res.ok) throw new Error(res.status === 401 ? 'GitHub does not accept the token.' : res.status === 403 || res.status === 404
    ? 'The token may not do this in that repository (it needs "Issues: Read and write").' : `GitHub answered ${res.status}.`)
  return res.status === 204 ? null : res.json()
}

/** Stores the token after GitHub accepted it for reading the repository's issues. */
export async function setToken(repo: string, t: string): Promise<MaintainerStatus> {
  if (!safeStorage.isEncryptionAvailable()) return { hasToken: false, ok: false, message: 'Windows cannot encrypt it on this PC; not stored.' }
  try {
    await github(repo, '/issues?per_page=1', {}, t.trim())
  } catch (e) {
    return { hasToken: false, ok: false, message: (e as Error).message }
  }
  await writeFile(FILE(), safeStorage.encryptString(t.trim()))
  return status(repo)
}

export async function clearToken(): Promise<MaintainerStatus> {
  await rm(FILE(), { force: true })
  return { hasToken: false, ok: false }
}

export async function status(repo: string): Promise<MaintainerStatus> {
  if (!(await token())) return { hasToken: false, ok: false }
  try {
    await github(repo, '/issues?per_page=1')
    return { hasToken: true, ok: true, message: `Token works for the issues of ${repo}.` }
  } catch (e) {
    return { hasToken: true, ok: false, message: (e as Error).message }
  }
}

/** Open issues the app and players created that wait for a decision (not yet accepted). */
export async function listReview(repo: string): Promise<ReviewItem[]> {
  const out: ReviewItem[] = []
  for (let page = 1; page <= 5; page++) {
    const issues = (await github(repo, `/issues?state=open&per_page=100&page=${page}`)) as {
      number: number; title: string; body: string | null; created_at: string; html_url: string; labels: { name: string }[]; pull_request?: object
    }[]
    for (const i of issues) {
      const labels = i.labels.map((l) => l.name)
      const kind = REVIEW_LABELS.find((l) => labels.includes(l))
      if (i.pull_request || !kind || labels.includes('accepted')) continue
      out.push({ number: i.number, title: i.title, body: i.body ?? '', created: i.created_at, url: i.html_url, kind })
    }
    if (issues.length < 100) break
  }
  return out
}

export async function accept(repo: string, n: number): Promise<void> {
  await github(repo, `/issues/${n}/labels`, { method: 'POST', body: { labels: ['accepted'] } })
}

export async function reject(repo: string, n: number, reason: string): Promise<void> {
  await github(repo, `/issues/${n}/comments`, { method: 'POST', body: { body: `Not added to the catalog: ${reason}` } })
  await github(repo, `/issues/${n}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'not_planned' } })
}
