import { useEffect, useMemo, useState } from 'react'
import type { LoversLabJob, LoversLabProgress, SteamProgress } from '@shared/api'
import { archivesFor, installSourceFor, type InstallSource } from '@shared/install'
import type { ResolvedEntry } from '@shared/profile'
import { useData } from './data'

interface Missing {
  entry: ResolvedEntry
  source: InstallSource
  modId?: string
}

/** Everything a profile still needs, grouped by where it comes from, with one action per group/entry. */
export function InstallPanel({ missing }: { missing: ResolvedEntry[] }) {
  const data = useData()
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [progress, setProgress] = useState<Record<string, SteamProgress>>({})

  useEffect(() => window.api.onSteamProgress((p) => setProgress((s) => ({ ...s, [p.id]: p }))), [])

  const items: Missing[] = useMemo(
    () =>
      missing.map((entry) => {
        const t = entry.key.startsWith('mod:') ? entry.key.slice(4) : undefined
        return { entry, source: installSourceFor(data.catalog, data.index, entry), modId: t }
      }),
    [missing, data.catalog, data.index]
  )
  const steam = items.filter((i) => i.source.kind === 'steam')
  const others = items.filter((i) => i.source.kind !== 'steam')
  const note = (m: string) => m && setLog((l) => [m, ...l].slice(0, 12))

  const subscribeAll = async () => {
    setBusy('steam')
    const ids = [...new Set(steam.map((i) => (i.source as { id: string }).id))]
    const r = await window.api.subscribeWorkshop(ids)
    note(r.ok ? `Steam: ${r.results.filter((x) => x.status === 'installed').length} of ${ids.length} installed.` : r.message ?? 'Steam failed.')
    r.results.filter((x) => x.error).forEach((x) => note(`Workshop ${x.id}: ${x.error}`))
    setBusy(null)
    data.rescan()
  }

  const fromLL = async (i: Missing) => {
    setBusy(i.entry.key)
    const r = await window.api.installFromLoversLab((i.source as { url: string }).url, i.modId)
    note(r.message)
    setBusy(null)
    if (r.ok) data.rescan()
  }

  // All LoversLab mods in one go (setting): one window works through the list.
  const fromLLs = others.filter((i) => i.source.kind === 'loverslab')
  const [queue, setQueue] = useState<Record<string, LoversLabProgress>>({})
  useEffect(() => window.api.onQueueProgress((p) => setQueue((s) => ({ ...s, [p.modId]: p }))), [])
  const queueAll = async () => {
    setBusy('queue')
    setQueue({})
    const jobs: LoversLabJob[] = fromLLs.map((i) => {
      const mod = i.modId ? data.index.mods.get(i.modId) : undefined
      return {
        modId: i.modId ?? i.entry.key,
        name: i.entry.name,
        url: (i.source as { url: string }).url,
        archives: mod ? archivesFor(mod, i.entry.pack ? [i.entry.pack] : undefined) : undefined
      }
    })
    const r = await window.api.installQueueFromLoversLab(jobs)
    note(`LoversLab: ${r.filter((x) => x.ok).length} of ${jobs.length} installed.`)
    r.filter((x) => !x.ok).forEach((x) => note(`${data.index.mods.get(x.modId)?.name ?? x.modId}: ${x.message}`))
    setBusy(null)
    data.rescan()
  }
  const QUEUE_LABEL: Record<LoversLabProgress['status'], string> = {
    downloading: 'downloading…', choose: 'choose the file in the LoversLab window', installed: 'installed', failed: 'failed', skipped: 'skipped'
  }

  const fromFile = async (i?: Missing) => {
    setBusy(i?.entry.key ?? 'file')
    const r = await window.api.installFromFile(i?.modId)
    note(r.message)
    setBusy(null)
    if (r.ok) data.rescan()
  }

  if (!items.length) return <p className="callout ok small">Everything in this profile is installed.</p>

  return (
    <div className="install-panel callout">
      <h3>Install what is missing ({items.length})</h3>
      {steam.length > 0 && (
        <div className="install-group">
          <button className="primary" disabled={!!busy} onClick={subscribeAll}>
            Subscribe to {steam.length} Steam Workshop mod{steam.length === 1 ? '' : 's'}
          </button>
          <span className="small muted"> Steam must be running. Downloads continue in Steam if they take long.</span>
          <ul className="small">
            {steam.map((i) => {
              const p = progress[(i.source as { id: string }).id]
              return (
                <li key={i.entry.key}>
                  {i.entry.name}
                  {p && (
                    <span className="muted">
                      {' '}– {p.status}
                      {p.status === 'downloading' && p.total ? ` ${Math.round(((p.current ?? 0) / p.total) * 100)} %` : ''}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {others.length > 0 && (
        <div className="install-group">
          {data.settings.autoLoversLab && fromLLs.length > 0 && (
            <p>
              <button className="primary" disabled={!!busy} onClick={queueAll}>
                Download {fromLLs.length} mod{fromLLs.length === 1 ? '' : 's'} from LoversLab
              </button>
              <span className="small muted"> One window works through the list; LoversLab decides if a file needs a wait.</span>
            </p>
          )}
          <ul className="small">
            {others.map((i) => (
              <li key={i.entry.key}>
                <strong>{i.entry.name}</strong>{' '}
                {i.modId && queue[i.modId] && <span className="muted">– {QUEUE_LABEL[queue[i.modId].status]} </span>}
                {i.source.kind === 'loverslab' && (
                  <button disabled={!!busy} onClick={() => fromLL(i)}>Download from LoversLab</button>
                )}
                {i.source.kind === 'discord' && (
                  <button onClick={() => window.api.openExternal((i.source as { url: string }).url)}>Open Discord post</button>
                )}
                {i.source.kind === 'manual' && i.source.url && (
                  <button onClick={() => window.api.openExternal((i.source as { url: string }).url)}>Open page</button>
                )}{' '}
                <button disabled={!!busy} onClick={() => fromFile(i)}>Add downloaded file…</button>
              </li>
            ))}
          </ul>
          <p className="small muted">LoversLab opens in its own window. Downloads need a LoversLab account: sign in there once (the window remembers it), then pick the file and it is installed automatically.</p>
        </div>
      )}
      {log.length > 0 && <ul className="small install-log">{log.map((l, n) => <li key={n}>{l}</li>)}</ul>}
    </div>
  )
}
