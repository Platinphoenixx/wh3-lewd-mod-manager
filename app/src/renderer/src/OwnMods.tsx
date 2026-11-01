import { useState } from 'react'
import type { InstalledPack } from '@shared/api'
import { targetFor, targetKey, type CatalogIndex } from '@shared/match'
import { checkOwnMod, type FactsReport, type OrderedEntry, type OwnCheck } from '@shared/own'
import { useData, type AppData } from './data'

/** Fired on window after the app installed something, so an open profile can switch it on. */
export const INSTALLED_EVENT = 'wh3lmm:installed'
export interface InstalledDetail { packs?: string[]; steamIds?: string[] }
export const announceInstalled = (detail: InstalledDetail) => window.dispatchEvent(new CustomEvent(INSTALLED_EVENT, { detail }))

/** Profile key for a freshly installed pack or Workshop item: the catalog mod if known, else an own key. */
export function keysForInstalled(index: CatalogIndex, d: InstalledDetail): string[] {
  const packs = (d.packs ?? []).map((file) => {
    const t = targetFor(index, { file, source: 'data', path: '', size: 0, mtime: 0 })
    return t ? targetKey(t) : `pack:${file}`
  })
  const steam = (d.steamIds ?? []).map((id) => {
    const t = index.bySteamId.get(id)
    return t ? targetKey(t) : `steamId:${id}`
  })
  return [...new Set([...packs, ...steam])]
}

export function ownName(data: AppData, key: string, packs: InstalledPack[]): string {
  if (key.startsWith('steamId:')) {
    const title = data.workshopDetails[key.slice(8)]?.title
    if (title) return title
  }
  return packs.length ? packs.map((p) => p.file.replace(/\.pack$/i, '')).join(' + ') : key.replace(/^(pack|steamId):/, '')
}

/** "Add your own mod": file picker, Workshop link; dropping files anywhere works too. */
export function AddOwnMod() {
  const data = useData()
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const id = /(?:id=|^)(\d{6,12})\b/.exec(link.trim())?.[1]

  const fromFile = async () => {
    setBusy(true)
    const r = await window.api.installFromFile()
    setBusy(false)
    if (r.message) setMsg(r.message)
    if (r.ok) {
      data.rescan()
      announceInstalled({ packs: r.packs })
    }
  }
  const fromWorkshop = async () => {
    if (!id) return
    setBusy(true)
    setMsg('Subscribing in Steam…')
    const r = await window.api.subscribeWorkshop([id])
    setBusy(false)
    const res = r.results[0]
    setMsg(r.ok ? (res?.error ?? (res?.status === 'installed' ? 'Downloaded and switched on.' : `Steam: ${res?.status ?? 'no answer'}`)) : r.message ?? 'Steam failed.')
    if (r.ok && res?.status === 'installed') {
      setLink('')
      data.rescan()
      announceInstalled({ steamIds: [id] })
    }
  }

  return (
    <div className="own-add callout">
      <strong>Add a mod of your own</strong>
      <span className="small muted"> – drop .pack / .7z / .zip / .rar files anywhere on this window, or:</span>
      <div className="own-add-row">
        <button disabled={busy} onClick={fromFile}>Choose file…</button>
        <input placeholder="Paste a Steam Workshop link" value={link} onChange={(e) => setLink(e.target.value)} />
        <button disabled={busy || !id} onClick={fromWorkshop}>Subscribe</button>
      </div>
      {msg && <p className="small">{msg}</p>}
      <p className="small muted">The app reads each pack: what it needs, which files of other mods it changes, and places it in the load order with the reason shown.</p>
    </div>
  )
}

export function CheckLines({ check, onAdd }: { check: OwnCheck; onAdd(key: string): void }) {
  const data = useData()
  return (
    <>
      {check.missing.map((p) => <p key={p} className="small danger">Needs {p}, which is not installed.</p>)}
      {check.notInProfile.map((n) => (
        <p key={n.pack} className="small warn-text">
          Needs {n.pack} (installed, not in this profile) <button className="link" onClick={() => onAdd(n.key)}>add it</button>
        </p>
      ))}
      {check.overlaps.slice(0, 3).map((o) => (
        <p key={o.key} className="small muted">
          {o.wins ? `Overrides ${o.count} file${o.count === 1 ? '' : 's'} of ${o.name}` : `${o.name} overrides ${o.count} of its files`}
        </p>
      ))}
      {check.overlaps.length > 3 && <p className="small muted">…and shares files with {check.overlaps.length - 3} more mods</p>}
      {check.sharedTables.length > 0 && (
        <p className="small muted" title={check.sharedTables.map((s) => `${s.name}: ${s.tables.join(', ')}`).join('\n')}>
          Writes to the same database tables as {check.sharedTables.slice(0, 3).map((s) => s.name).join(', ')}
          {check.sharedTables.length > 3 ? ` and ${check.sharedTables.length - 3} more` : ''} (only a problem if they change the same rows)
        </p>
      )}
      {data.scan && !check.missing.length && !check.notInProfile.length && !check.overlaps.length && !check.sharedTables.length && (
        <p className="small ok-text">No overlap with this profile.</p>
      )}
    </>
  )
}

export function OwnCard({ k, packs, on, toggle, order, facts, installedKeys, onAdd }: {
  k: string
  packs: InstalledPack[]
  on: boolean
  toggle(): void
  /** Load order with this mod placed (switched on or as a preview). */
  order: OrderedEntry[] | null
  facts: FactsReport | null
  installedKeys: Map<string, string>
  onAdd(key: string): void
}) {
  const data = useData()
  const steamId = k.startsWith('steamId:') ? k.slice(8) : undefined
  const placed = order?.find((e) => e.key === k)
  const check = order && facts ? checkOwnMod(order, k, facts, installedKeys) : null
  return (
    <article className={`option ${on ? 'on' : ''}`}>
      <div className="thumb">
        {steamId ? <img src={`wh3lmm://workshop/${steamId}`} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} /> : <div className="thumb-placeholder" />}
      </div>
      <div className="body">
        <label className="option-head">
          <input type="checkbox" checked={on} onChange={toggle} />
          <strong>{ownName(data, k, packs)}</strong>
        </label>
        <div className="badges">
          <span className="badge own">your mod</span>
          <span className="badge">{steamId ? 'Workshop' : 'data folder'}</span>
        </div>
        <p className="small muted">{packs.map((p) => p.file).join(', ')}</p>
        {placed?.own && <p className="small">{on ? '' : 'Would go: '}{placed.own.reason}</p>}
        {check ? <CheckLines check={check} onAdd={onAdd} /> : <p className="small muted">Reading the pack…</p>}
        {steamId && <a className="small" onClick={() => window.api.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${steamId}`)}>Workshop page</a>}
      </div>
    </article>
  )
}
