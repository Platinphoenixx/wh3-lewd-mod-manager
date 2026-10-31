/**
 * Separate process (Electron utilityProcess) that talks to the running Steam client as Total War:
 * Warhammer III, subscribes to Workshop items and waits for their downloads, then exits. Keeping
 * this out of the app process means Steam shows the game as running only while subscribing.
 *
 * Messages: in  { ids: string[] }
 *           out { type: 'progress', id, status, current?, total? } … { type: 'done', results } | { type: 'error', message }
 */
import * as steamworks from 'steamworks.js'

const APP_ID = 1142710
const STATE_INSTALLED = 4
const STATE_NEEDS_UPDATE = 8
const STATE_DOWNLOADING = 16
const STATE_DOWNLOAD_PENDING = 32
const POLL_MS = 1000
const ITEM_TIMEOUT_MS = 10 * 60 * 1000

type Status = 'subscribed' | 'downloading' | 'installed' | 'failed'
interface Result { id: string; status: Status; folder?: string; error?: string }

const post = (msg: unknown) => process.parentPort.postMessage(msg)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function run(ids: string[]): Promise<Result[]> {
  const client = steamworks.init(APP_ID)
  const results: Result[] = []
  for (const id of ids) {
    const item = BigInt(id)
    try {
      await client.workshop.subscribe(item)
      post({ type: 'progress', id, status: 'subscribed' })
      client.workshop.download(item, true)
      const started = Date.now()
      for (;;) {
        const state = client.workshop.state(item)
        const installed = state & STATE_INSTALLED && !(state & (STATE_NEEDS_UPDATE | STATE_DOWNLOADING | STATE_DOWNLOAD_PENDING))
        if (installed) {
          results.push({ id, status: 'installed', folder: client.workshop.installInfo(item)?.folder })
          post({ type: 'progress', id, status: 'installed' })
          break
        }
        const info = client.workshop.downloadInfo(item)
        post({ type: 'progress', id, status: 'downloading', current: Number(info?.current ?? 0), total: Number(info?.total ?? 0) })
        if (Date.now() - started > ITEM_TIMEOUT_MS) {
          results.push({ id, status: 'downloading', error: 'Still downloading; Steam will finish it in the background.' })
          break
        }
        await sleep(POLL_MS)
      }
    } catch (e) {
      results.push({ id, status: 'failed', error: (e as Error).message })
      post({ type: 'progress', id, status: 'failed' })
    }
  }
  return results
}

process.parentPort.once('message', async (e) => {
  const ids: string[] = (e.data?.ids ?? []).filter((x: unknown) => typeof x === 'string' && /^\d{6,12}$/.test(x))
  try {
    post({ type: 'done', results: await run(ids) })
  } catch (err) {
    // Typical causes: Steam not running, or the account does not own the game.
    post({ type: 'error', message: (err as Error).message })
  }
  process.exit(0)
})
