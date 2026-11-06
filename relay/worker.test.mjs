// Tests the relay with an in-memory KV and a fake GitHub: node relay/worker.test.mjs
import assert from 'node:assert/strict'
import worker from './worker.js'

const store = new Map()
const meta = new Map() // KV metadata per key
const counts = new Map() // fake rate limiter: 5 per key
const env = {
  REPO: 'owner/repo', GITHUB_TOKEN: 'gh', EXPORT_TOKEN: 'export', SALT: 'salt',
  LIMITER: { limit: async ({ key }) => { counts.set(key, (counts.get(key) ?? 0) + 1); return { success: counts.get(key) <= 5 } } },
  REPORTS: {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v, opts) => { store.set(k, v); if (opts?.metadata) meta.set(k, opts.metadata) },
    delete: async (k) => { store.delete(k); meta.delete(k) },
    list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })), list_complete: true })
  }
}
const issues = []
const github = { state: 'open', closed_at: null, next: 1 }
globalThis.fetch = async (url, init) => {
  if (!init.method || init.method === 'GET') return new Response(JSON.stringify({ state: github.state, closed_at: github.closed_at }))
  issues.push({ url, method: init.method, ...JSON.parse(init.body), auth: init.headers.authorization })
  const number = init.method === 'POST' ? github.next++ : undefined
  return new Response(JSON.stringify({ number, html_url: 'https://github.com/owner/repo/issues/1' }), { status: 201 })
}
const call = (method, path, body, headers = {}) =>
  worker.fetch(new Request('https://relay.test' + path, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4', ...headers }, body: body && JSON.stringify(body) }), env)
const report = { installId: 'i1', app: '0.1.0', game: '9.0.4', catalog: '2026-11-01', modId: 'll-1', modName: 'X', signature: 'mod:ll-1 | boom', text: '## report' }

// A report is stored without anything about the sender.
let r = await call('POST', '/report', report)
assert.equal(r.status, 200)
const saved = [...store.entries()].find(([k]) => k.startsWith('report:'))
assert.ok(saved)
assert.ok(!saved[1].includes('1.2.3.4'))
assert.equal(JSON.parse(saved[1]).signature, 'mod:ll-1 | boom')

// Missing fields and oversized texts are refused with a message.
r = await call('POST', '/report', { installId: 'i1' })
assert.equal(r.status, 400)
assert.match((await r.json()).message, /missing/)
r = await call('POST', '/report', { ...report, text: 'x'.repeat(30001) })
assert.equal(r.status, 400)

// Export only with the token.
assert.equal((await call('GET', '/reports')).status, 401)
r = await call('GET', '/reports', null, { authorization: 'Bearer export' })
assert.equal((await r.json()).reports.length, 1)

// Contributions become issues labelled with their type.
r = await call('POST', '/contribution', { type: 'feedback', title: 'Feedback: X', body: 'works' })
assert.equal((await r.json()).url, 'https://github.com/owner/repo/issues/1')
assert.equal(issues[0].url, 'https://api.github.com/repos/owner/repo/issues')
assert.deepEqual(issues[0].labels, ['feedback'])
assert.equal(issues[0].auth, 'Bearer gh')
assert.equal((await call('POST', '/contribution', { type: 'spam', title: 't', body: 'b' })).status, 400)

// 5 sends per minute per sender; the limiter key does not contain the IP, and nothing but reports is in KV.
let last
for (let i = 0; i < 8; i++) last = await call('POST', '/report', { ...report, installId: 'i' + i })
assert.equal(last.status, 429)
assert.ok([...counts.keys()].every((k) => !k.includes('1.2.3.4')))
assert.ok([...store.keys()].every((k) => k.startsWith('report:')))

// Setups and votes come from another sender (the first one used up its limit above).
const from = (ip) => (method, path, body, headers = {}) => call(method, path, body, { 'cf-connecting-ip': ip, ...headers })
const s = from('5.6.7.8')
const list = { installId: 'install-a', name: 'Alarielle + heroes https://spam.example', shownAs: 'Velvet', far: 'turn 160', notes: 'Fine.\u0007',
  base: 'readman-alarielle-early', playAs: ['Alarielle'], game: '9.0.4', entries: [{ pack: 'a.pack', mod: 'll-1' }, { pack: 'b.pack', mod: 'steam-2', steamId: '2' }] }

// A list of catalog mods only is stored for the daily update, without links or control characters, and without an issue.
const before = issues.length
r = await s('POST', '/setup', list)
const auto = await r.json()
assert.equal(r.status, 200)
assert.match(auto.message, /within a day/)
assert.equal(issues.length, before)
const stored = JSON.parse(store.get(`setup:${auto.id}`))
assert.equal(stored.name, 'Alarielle + heroes')
assert.equal(stored.notes, 'Fine.')
assert.equal(stored.review, false)
assert.ok(!JSON.stringify(stored).includes('install-a'))

// Packs the catalog does not know (or own mods) make it an issue for a maintainer.
r = await s('POST', '/setup', { ...list, own: ['my_tweaks.pack'] })
const held = await r.json()
assert.match(held.message, /maintainer/)
assert.deepEqual(issues.at(-1).labels, ['setup'])
assert.match(issues.at(-1).body, /my_tweaks\.pack/)
assert.match(issues.at(-1).body, new RegExp(`"setupId":"${held.id}"`))
assert.match(issues.at(-1).body, /"base":"readman-alarielle-early"/) // the whole list for the review
assert.equal((await s('POST', '/setup', { ...list, entries: [] })).status, 400)

// One vote per install and setup: voting again replaces it; counts and reasons in the export, never install ids.
const v = from('9.9.9.9')
await v('POST', '/vote', { installId: 'install-a', setup: 'readman-alarielle-early', worked: false, reason: 'start' })
await v('POST', '/vote', { installId: 'install-a', setup: 'readman-alarielle-early', worked: true })
await v('POST', '/vote', { installId: 'install-b', setup: 'readman-alarielle-early', worked: false, reason: 'campaign' })
assert.equal((await v('POST', '/vote', { installId: 'install-c', setup: 'Bad Id!', worked: true })).status, 400)
assert.equal((await call('GET', '/votes')).status, 401)
const counted = (await (await call('GET', '/votes', null, { authorization: 'Bearer export' })).json()).votes
assert.deepEqual(counted['readman-alarielle-early'], { up: 1, down: 1, reasons: { campaign: 1 } })
const shared = (await (await call('GET', '/setups', null, { authorization: 'Bearer export' })).json()).setups
assert.equal(shared.length, 2)
assert.ok([...store.keys()].every((k) => !k.includes('install-')))

// One flag per install and rule; all flags on a rule are one issue; a mention cannot notify anyone.
const rule = 'conflict|mod:a|mod:b'
const f = from('7.7.7.7')
const flagged = { rule, title: 'A and B', says: 'They conflict.', source: 'Discord post', why: 'works', far: 'A long campaign', order: 'A above B', game: '9.0.5' }
const created = issues.length
r = await f('POST', '/flag', { ...flagged, installId: 'install-a', text: 'Works for me @someone `x`', link: 'https://discord.com/channels/1/2/3' })
assert.equal(r.status, 200)
assert.equal(issues.length, created + 1)
assert.deepEqual(issues.at(-1).labels, ['flag'])
assert.equal(issues.at(-1).title, 'Flag: A and B')
assert.match(issues.at(-1).body, /"type":"flag"/)
assert.ok(issues.at(-1).body.includes('@\u200bsomeone'))
assert.ok(!issues.at(-1).body.includes('`x`'))
await f('POST', '/flag', { ...flagged, installId: 'install-a', text: 'Changed my mind on the wording' })
await f('POST', '/flag', { ...flagged, installId: 'install-b', text: 'Same here' })
assert.equal(issues.length, created + 3)
assert.equal(issues.at(-1).method, 'PATCH')
assert.match(issues.at(-1).body, /Players \(2\)/)
const g = from('7.7.7.8')
assert.equal((await g('POST', '/flag', { ...flagged, installId: 'install-b', rule: 'nonsense', text: 'x' })).status, 400)
assert.equal((await g('POST', '/flag', { ...flagged, installId: 'install-b', text: '' })).status, 400)
assert.equal((await call('GET', '/flags')).status, 401)
const flagCount = async () => (await (await call('GET', '/flags', null, { authorization: 'Bearer export' })).json()).flags
assert.deepEqual(await flagCount(), { [rule]: 2 })
// Taking a flag back; after a decision (issue closed) a new flag opens a new issue with only what came later.
await g('POST', '/flag', { rule, installId: 'install-b', withdraw: true })
assert.deepEqual(await flagCount(), { [rule]: 1 })
await new Promise((r) => setTimeout(r, 5))
Object.assign(github, { state: 'closed', closed_at: new Date().toISOString() })
await new Promise((r) => setTimeout(r, 5))
await g('POST', '/flag', { ...flagged, installId: 'install-d', text: 'After the decision' })
assert.equal(issues.at(-1).method, 'POST')
assert.ok(issues.at(-1).body.includes('After the decision'))
assert.ok(!issues.at(-1).body.includes('Changed my mind'))
assert.ok([...store.keys()].every((k) => !k.includes('install-')))
console.log('relay tests passed')
