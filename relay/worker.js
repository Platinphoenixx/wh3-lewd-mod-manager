/**
 * Relay for the app (Cloudflare Worker): players send problem reports and catalog contributions
 * without any account.
 *
 *   POST /report        problem report (anonymous text the player saw before sending)
 *                       → stored privately in KV for 180 days; only counts ever become public
 *   POST /contribution  new mod / feedback / rule / correction
 *                       → becomes a GitHub issue in the project repo, like contributions made on GitHub
 *   GET  /reports       all stored reports, for the weekly catalog update (Authorization: Bearer EXPORT_TOKEN)
 *   POST /setup         a mod list a player shares (load order, the template it builds on, a few words)
 *                       → stored in KV; one with packs the catalog does not know also becomes a GitHub issue for review
 *   POST /vote          "this setup worked / did not work for me": one vote per install and setup (the last one counts)
 *   GET  /setups, /votes  for the daily catalog update (Authorization: Bearer EXPORT_TOKEN); votes as counts only
 *
 * Nothing about the sender is stored: no IP address, no name; votes and setups keep only a salted hash of the
 * app's random install id (so one install has one vote per setup). Cloudflare's rate limiter counts
 * requests per minute under a salted hash of the IP (kept in memory only, not in KV).
 *
 * Bindings (wrangler.toml): KV namespace REPORTS, rate limiter LIMITER, variable REPO ("owner/name").
 * Secrets: GITHUB_TOKEN (issues: write on REPO only), EXPORT_TOKEN, SALT.
 */

const MAX_TEXT = 30000
const TYPES = ['new-mod', 'feedback', 'rule', 'correction']

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      if (request.method === 'POST' && url.pathname === '/report') return await report(request, env)
      if (request.method === 'POST' && url.pathname === '/contribution') return await contribution(request, env)
      if (request.method === 'GET' && url.pathname === '/reports') return await exportReports(request, env, url)
      if (request.method === 'POST' && url.pathname === '/setup') return await setup(request, env)
      if (request.method === 'POST' && url.pathname === '/vote') return await vote(request, env)
      if (request.method === 'GET' && url.pathname === '/setups') return await exportSetups(request, env)
      if (request.method === 'GET' && url.pathname === '/votes') return await exportVotes(request, env)
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
  const { success } = await env.LIMITER.limit({ key })
  return !success
}

async function report(request, env) {
  if (await limited(request, env)) return json({ ok: false, message: 'Too many reports from here; please wait a minute.' }, 429)
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
  if (await limited(request, env)) return json({ ok: false, message: 'Too many contributions from here; please wait a minute.' }, 429)
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

const allowed = (request, env) => request.headers.get('authorization') === `Bearer ${env.EXPORT_TOKEN}`
const hash = async (env, s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SALT + s)))]
  .slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
// Free text other players see: no links (spam) and no control characters.
const plain = (v, max) => (optStr(v, max) ?? '').replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim()
const ID = /^[a-z0-9][a-z0-9-]{1,79}$/

/** Every KV key under a prefix (KV lists 1000 per page), with its metadata. */
async function listAll(env, prefix) {
  const keys = []
  let cursor
  do {
    const page = await env.REPORTS.list({ prefix, cursor })
    keys.push(...page.keys)
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return keys
}

async function setup(request, env) {
  if (await limited(request, env)) return json({ ok: false, message: 'Too many sends from here; please wait a minute.' }, 429)
  const b = await request.json()
  const entries = Array.isArray(b.entries) ? b.entries : []
  if (entries.length < 1 || entries.length > 500) throw new UserError('The mod list is empty or too long.')
  const clean = entries.map((e) => ({
    pack: str(e?.pack, 200, 'pack'),
    ...(typeof e.mod === 'string' && ID.test(e.mod) ? { mod: e.mod } : {}),
    ...(/^\d{6,12}$/.test(e?.steamId ?? '') ? { steamId: e.steamId } : {})
  }))
  const own = (Array.isArray(b.own) ? b.own : []).slice(0, 200).map((p) => str(p, 200, 'own pack'))
  const name = plain(b.name, 120)
  if (!name) throw new UserError('name is missing.')
  const entry = {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    at: new Date().toISOString(),
    by: await hash(env, str(b.installId, 64, 'installId')),
    name,
    shownAs: plain(b.shownAs, 40) || undefined,
    far: plain(b.far, 120) || undefined,
    notes: plain(b.notes, 1000) || undefined,
    base: typeof b.base === 'string' && ID.test(b.base) ? b.base : undefined,
    playAs: (Array.isArray(b.playAs) ? b.playAs : []).slice(0, 8).map((c) => plain(c, 60)).filter(Boolean),
    theme: plain(b.theme, 60) || undefined,
    game: optStr(b.game, 20), app: optStr(b.app, 20), catalog: optStr(b.catalog, 20),
    entries: clean, own,
    // A list of catalog mods only is shown after the next daily update; anything else waits for a maintainer.
    review: own.length > 0 || clean.some((e) => !e.mod)
  }
  await env.REPORTS.put(`setup:${entry.id}`, JSON.stringify(entry))
  if (!entry.review) return json({ ok: true, id: entry.id, message: 'Thank you – your setup will appear in the app within a day.' })
  const unknown = [...own, ...clean.filter((e) => !e.mod).map((e) => e.pack)]
  const body = [
    `**Shared setup:** ${entry.name}`, '', `Packs the catalog does not know (${unknown.length}):`, ...unknown.slice(0, 50).map((p) => `- \`${p}\``),
    '', 'Label this issue `accepted` to show the setup in the app.', '',
    // The whole list for the maintainer (the app's Review tab shows it against the catalog); public anyway once accepted.
    '```json', JSON.stringify({
      type: 'setup', setupId: entry.id, name: entry.name,
      setup: { base: entry.base, playAs: entry.playAs, theme: entry.theme, shownAs: entry.shownAs, far: entry.far, notes: entry.notes, game: entry.game, own, entries: clean.slice(0, 400) }
    }), '```', '', '---', '*Sent from the app without a GitHub account.*'
  ].join('\n')
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'wh3lmm-relay', 'content-type': 'application/json' },
    body: JSON.stringify({ title: `Setup: ${entry.name}`, body, labels: ['setup'] })
  })
  return json({
    ok: true, id: entry.id, url: res.ok ? (await res.json()).html_url : undefined,
    message: 'Thank you – a maintainer checks the packs the catalog does not know; then your setup appears in the app.'
  })
}

async function vote(request, env) {
  if (await limited(request, env)) return json({ ok: false, message: 'Too many sends from here; please wait a minute.' }, 429)
  const b = await request.json()
  const setupId = str(b.setup, 80, 'setup')
  if (!ID.test(setupId)) throw new UserError('Unknown setup.')
  if (typeof b.worked !== 'boolean') throw new UserError('worked is missing.')
  const reason = ['start', 'campaign', 'content', 'other'].includes(b.reason) ? b.reason : undefined
  // One vote per install and setup (a new one replaces the old), kept as metadata so counting needs no reads.
  const key = `vote:${setupId}:${await hash(env, str(b.installId, 64, 'installId'))}`
  await env.REPORTS.put(key, '', { metadata: { w: b.worked ? 1 : 0, ...(reason ? { r: reason } : {}), d: new Date().toISOString().slice(0, 10) } })
  return json({ ok: true, message: 'Thank you – counted.' })
}

async function exportSetups(request, env) {
  if (!allowed(request, env)) return json({ ok: false, message: 'Not allowed' }, 401)
  const setups = []
  for (const k of await listAll(env, 'setup:')) {
    const v = await env.REPORTS.get(k.name)
    if (v) setups.push(JSON.parse(v))
  }
  return json({ ok: true, setups })
}

async function exportVotes(request, env) {
  if (!allowed(request, env)) return json({ ok: false, message: 'Not allowed' }, 401)
  const votes = {}
  for (const k of await listAll(env, 'vote:')) {
    const v = (votes[k.name.split(':')[1]] ??= { up: 0, down: 0, reasons: {} })
    if (k.metadata?.w) v.up++
    else {
      v.down++
      if (k.metadata?.r) v.reasons[k.metadata.r] = (v.reasons[k.metadata.r] ?? 0) + 1
    }
  }
  return json({ ok: true, votes })
}
