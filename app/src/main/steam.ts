import { join } from 'node:path'
import { utilityProcess, type WebContents } from 'electron'
import { readJson, writeJson } from './store'

export interface SubscribeResult {
  ok: boolean
  message?: string
  results: { id: string; status: string; error?: string }[]
}

/**
 * Subscribes to Workshop items through the Steam worker process. Progress messages are forwarded
 * to the window as 'steam:progress' events.
 */
export function subscribeWorkshop(ids: string[], sender: WebContents): Promise<SubscribeResult> {
  return new Promise((resolve) => {
    const worker = utilityProcess.fork(join(__dirname, 'steamWorker.js'), [], { serviceName: 'WH3 Steam worker' })
    let settled = false
    const finish = (r: SubscribeResult) => {
      if (settled) return
      settled = true
      resolve(r)
    }
    worker.on('message', (msg) => {
      if (msg?.type === 'progress') sender.send('steam:progress', msg)
      else if (msg?.type === 'done') finish({ ok: true, results: msg.results })
      else if (msg?.type === 'error')
        finish({ ok: false, message: `Steam: ${msg.message}. Is Steam running and does this account own the game?`, results: [] })
    })
    worker.on('exit', (code) => finish({ ok: false, message: `The Steam helper stopped unexpectedly (code ${code}).`, results: [] }))
    worker.postMessage({ ids })
  })
}

export type WorkshopDetails = Record<string, { title: string; updated: number; preview?: string }>

const CACHE = 'workshop-details.json'
const asked = new Set<string>()

/**
 * Titles of Workshop items the catalog does not know, from the player's own Steam client. Each item
 * is asked for once and kept in workshop-details.json; when Steam is not running, the cached ones
 * are returned and the rest stay unnamed until the next app start.
 */
export async function workshopDetails(ids: string[]): Promise<WorkshopDetails> {
  const cache = await readJson<WorkshopDetails>(CACHE, {})
  const todo = ids.filter((id) => !cache[id] && !asked.has(id))
  if (!todo.length) return cache
  todo.forEach((id) => asked.add(id))
  const items = await new Promise<{ id: string; title: string; updated: number; preview?: string }[]>((resolve) => {
    const worker = utilityProcess.fork(join(__dirname, 'steamWorker.js'), [], { serviceName: 'WH3 Steam worker' })
    worker.on('message', (msg) => resolve(msg?.type === 'details' ? msg.items : []))
    worker.on('exit', () => resolve([]))
    worker.postMessage({ details: todo })
  })
  for (const i of items) cache[i.id] = { title: i.title, updated: i.updated, preview: i.preview }
  if (items.length) await writeJson(CACHE, cache)
  return cache
}
