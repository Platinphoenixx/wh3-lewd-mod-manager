import { join } from 'node:path'
import { utilityProcess, type WebContents } from 'electron'

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
