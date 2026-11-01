// Tests the relay with an in-memory KV and a fake GitHub: node relay/worker.test.mjs
import assert from 'node:assert/strict'
import worker from './worker.js'

const store = new Map()
const env = {
  REPO: 'owner/repo', GITHUB_TOKEN: 'gh', EXPORT_TOKEN: 'export', SALT: 'salt',
  REPORTS: {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
    list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true })
  }
}
const issues = []
globalThis.fetch = async (url, init) => {
  issues.push({ url, ...JSON.parse(init.body), auth: init.headers.authorization })
  return new Response(JSON.stringify({ html_url: 'https://github.com/owner/repo/issues/1' }), { status: 201 })
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

// 20 requests per hour per sender; the counter key does not contain the IP.
let last
for (let i = 0; i < 25; i++) last = await call('POST', '/report', { ...report, installId: 'i' + i })
assert.equal(last.status, 429)
assert.ok([...store.keys()].every((k) => !k.includes('1.2.3.4')))
console.log('relay tests passed')
