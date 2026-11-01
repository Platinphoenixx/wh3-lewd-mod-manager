/**
 * Relay for the app (Cloudflare Worker): players send problem reports and catalog contributions
 * without any account.
 *
 *   POST /report        problem report (anonymous text the player saw before sending)
 *                       → stored privately in KV for 180 days; only counts ever become public
 *   POST /contribution  new mod / feedback / rule / correction
 *                       → becomes a GitHub issue in the project repo, like contributions made on GitHub
 *   GET  /reports       all stored reports, for the weekly catalog update (Authorization: Bearer EXPORT_TOKEN)
 *
 * Nothing about the sender is stored: no IP address, no name. A rate limit counts requests per hour
 * under a salted hash of the IP that expires after that hour.
 *
 * Bindings (wrangler.toml): KV namespace REPORTS, variable REPO ("owner/name").
 * Secrets: GITHUB_TOKEN (issues: write on REPO only), EXPORT_TOKEN, SALT.
 */

const MAX_TEXT = 30000
const PER_HOUR = 20
const TYPES = ['new-mod', 'feedback', 'rule', 'correction']

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      if (request.method === 'POST' && url.pathname === '/report') return await report(request, env)
      if (request.method === 'POST' && url.pathname === '/contribution') return await contribution(request, env)
      if (request.method === 'GET' && url.pathname === '/reports') return await exportReports(request, env, url)
      return json({ ok: false, message: 'Not found' }, 404)
    } catch (e) {
      if (!(e instanceof UserError)) console.error(e)
      return json({ ok: false, message: e instanceof UserError ? e.message : 'Something went wrong; please try again later.' }, e instanceof UserError ? 400 : 500)
    }
  }
}

class UserError extends Error {}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const str = (v, max, name) => {
  if (typeof v !== 'string' || !v.trim()) throw new UserError(`${name} is missing.`)
  if (v.length > max) throw new UserError(`${name} is too long.`)
  return v
}
const optStr = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined)

async function limited(request, env) {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SALT + ip))
  const key = 'rl:' + [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
  const n = Number((await env.REPORTS.get(key)) ?? 0)
  if (n >= PER_HOUR) return true
  await env.REPORTS.put(key, String(n + 1), { expirationTtl: 3600 })
  return false
}

async function report(request, env) {
  if (await limited(request, env)) return json({ ok: false, message: 'Too many reports from here in the last hour.' }, 429)
  const b = await request.json()
  const entry = {
    at: new Date().toISOString(),
    // Random id the app made once on this PC; it only lets the update count players instead of reports.
    installId: str(b.installId, 64, 'installId'),
    app: optStr(b.app, 20),
    game: optStr(b.game, 20),
    catalog: optStr(b.catalog, 20),
    modId: optStr(b.modId, 80),
    modName: str(b.modName, 200, 'modName'),
    signature: str(b.signature, 500, 'signature'),
    text: str(b.text, MAX_TEXT, 'text')
  }
  const id = `report:${entry.at}:${crypto.randomUUID().slice(0, 8)}`
  await env.REPORTS.put(id, JSON.stringify(entry), { expirationTtl: 180 * 86400 })
  return json({ ok: true, message: 'Thank you – the report was sent.' })
}

async function contribution(request, env) {
  if (await limited(request, env)) return json({ ok: false, message: 'Too many contributions from here in the last hour.' }, 429)
  const b = await request.json()
  const type = TYPES.includes(b.type) ? b.type : null
  if (!type) throw new UserError('Unknown contribution type.')
  const title = str(b.title, 200, 'title')
  const body = str(b.body, MAX_TEXT, 'body') + '\n\n---\n*Sent from the app without a GitHub account.*'
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'wh3lmm-relay',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ title, body, labels: [type] })
  })
  if (!res.ok) return json({ ok: false, message: 'The catalog repository did not accept it; please try again later.' }, 502)
  const issue = await res.json()
  return json({ ok: true, message: 'Thank you – sent to the catalog maintainers.', url: issue.html_url })
}

async function exportReports(request, env, url) {
  if (request.headers.get('authorization') !== `Bearer ${env.EXPORT_TOKEN}`) return json({ ok: false, message: 'Not allowed' }, 401)
  const page = await env.REPORTS.list({ prefix: 'report:', cursor: url.searchParams.get('cursor') ?? undefined, limit: 200 })
  const reports = []
  for (const k of page.keys) {
    const v = await env.REPORTS.get(k.name)
    if (v) reports.push(JSON.parse(v))
  }
  return json({ ok: true, reports, cursor: page.list_complete ? null : page.cursor })
}
