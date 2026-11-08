import { useEffect, useMemo, useState } from 'react'
import type { CommunityFix, Mod } from '@catalog/schema'
import type { LoversLabJob, LoversLabProgress, SteamProgress } from '@shared/api'
import { archivesFor, downloadHints, installSourceFor, neededParts, packHints, packsToFetch, type InstallSource } from '@shared/install'
import type { ResolvedEntry } from '@shared/profile'
import { useData } from './data'
import { findLocal, type LocalMatch, type LocalScan } from '@shared/localfiles'

interface Missing {
  entry: ResolvedEntry
  source: InstallSource
  modId?: string
}

/** Everything a profile still needs, grouped by where it comes from, with one action per group/entry. */
/** characters = the profile's characters: for mods with one version per character, theirs is taken. */
/** A community fix the profile uses, and whether its files are installed. */
export interface UsedFix {
  mod: Mod
  fix: CommunityFix
  installed: boolean
}

export function InstallPanel({ missing, characters = [], fixes = [] }: { missing: ResolvedEntry[]; characters?: string[]; fixes?: UsedFix[] }) {
  const data = useData()
  const wanted = (i: Missing) => {
    const mod = i.modId ? data.index.mods.get(i.modId) : undefined
    return mod ? packsToFetch(mod, i.entry.pack, i.entry.need, characters) : undefined
  }
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

  // Files the player already has in their folders (Settings → Files you already have) stand in for downloads.
  const [local, setLocal] = useState<LocalScan | null>(null)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [useOlder, setUseOlder] = useState<Set<string>>(new Set())
  useEffect(() => { if (others.length) void window.api.localFiles().then(setLocal) }, [others.length])
  const needs = others.map((i) => {
    const packs = wanted(i) ?? i.entry.need ?? (i.entry.pack ? [i.entry.pack] : [])
    // A mod made only of versions to pick from: any of its download packs that is on the PC.
    const mod = i.modId ? data.index.mods.get(i.modId) : undefined
    return packs.length ? { key: i.entry.key, modId: i.modId, name: i.entry.name, packs }
      : { key: i.entry.key, modId: i.modId, name: i.entry.name, packs: (mod?.packs ?? []).filter((x) => x.from === 'download').map((x) => x.file), anyOf: true }
  })
  const needed = needs.reduce((s, n) => s + (n.anyOf ? 1 : n.packs.length), 0)
  const found = local ? findLocal(data.index, local.files, needs) : []
  const id = (m: LocalMatch) => `${m.key}|${m.pack}`
  const preferNewer = data.settings.preferNewer !== false
  const chosen = found.filter((m) => !skip.has(id(m)) && (!m.newer || !preferNewer || useOlder.has(id(m))))
  const useLocal = async () => {
    setBusy('local')
    const r = await window.api.installLocal(chosen)
    note(r.ok ? `${r.message} – from your folders${data.settings.sourceMove ? '' : '; the originals stay where they are'}.` : r.message)
    setBusy(null)
    setSkip(new Set())
    data.rescan()
    setLocal(await window.api.localFiles())
  }
  const toggle = (set: (f: (s: Set<string>) => Set<string>) => void, k: string) =>
    set((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const [allFound, setAllFound] = useState(false)
  const foundGroup = found.length > 0 && (
    <div className="install-group local-found">
      <div className="local-head">
        <h4>{found.length} of the {needed} missing file{needed === 1 ? '' : 's'} {found.length === 1 ? 'is' : 'are'} already on your PC</h4>
        <button className="primary" disabled={!!busy || !chosen.length} onClick={() => void useLocal()}>Use {chosen.length === found.length ? 'the' : ''} {chosen.length} file{chosen.length === 1 ? '' : 's'}</button>
      </div>
      <p className="small muted">Found in the folders you gave the app (Settings → Files you already have). {data.settings.sourceMove ? 'They are moved into the game’s data folder.' : 'They are copied into the game’s data folder; your files stay where they are.'}</p>
      <table className="local-files small">
        <tbody>
          {(allFound ? found : found.slice(0, 8)).map((m) => {
            const off = skip.has(id(m)) || (!!m.newer && preferNewer && !useOlder.has(id(m)))
            return (
              <tr key={id(m)} className={off ? 'off' : ''}>
                <td className="name">{m.name}{needs.find((n) => n.key === m.key)!.packs.length > 1 && <span className="muted"> · {m.pack}</span>}</td>
                <td className="path">{m.file.path}{m.file.inArchive ? ` → ${m.file.name}` : ''}{m.file.name.toLowerCase() !== m.pack.toLowerCase() && <span> (installed as {m.pack})</span>}</td>
                <td className={m.newer ? 'warn-text' : 'ok-text'}>{m.newer ? `from ${m.file.date} · the mod’s page has a version from ${m.newer}` : `from ${m.file.date}`}</td>
                <td className="act">
                  {m.newer && preferNewer
                    ? <button className="link" onClick={() => toggle(setUseOlder, id(m))}>{useOlder.has(id(m)) ? 'Download the new one instead' : 'Use mine anyway'}</button>
                    : <button className="link" onClick={() => toggle(setSkip, id(m))}>{skip.has(id(m)) ? 'Use this one' : 'Not this one'}</button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {found.length > 8 && <button className="link small" onClick={() => setAllFound(!allFound)}>{allFound ? 'Show fewer' : `Show ${found.length - 8} more`}</button>}
    </div>
  )

  const subscribeAll = async () => {
    setBusy('steam')
    const ids = [...new Set(steam.map((i) => (i.source as { id: string }).id))]
    const r = await window.api.subscribeWorkshop(ids)
    note(r.ok ? `Steam: ${r.results.filter((x) => x.status === 'installed').length} of ${ids.length} installed.` : r.message ?? 'Steam failed.')
    r.results.filter((x) => x.error).forEach((x) => note(`Workshop ${x.id}: ${x.error}`))
    setBusy(null)
    data.rescan()
  }

  const fromNexus = async (i: Missing) => {
    setBusy(i.entry.key)
    const mod = i.modId ? data.index.mods.get(i.modId) : undefined
    const hints = mod ? packHints(mod, wanted(i)) : []
    const r = await window.api.installFromNexus((i.source as { url: string }).url, i.modId, hints)
    note(r.message)
    setBusy(null)
    if (r.ok) data.rescan()
  }

  const fromLL = async (i: Missing) => {
    setBusy(i.entry.key)
    // The window marks the file this profile uses and says what the other files are.
    const mod = i.modId ? data.index.mods.get(i.modId) : undefined
    const hints = mod ? downloadHints(mod, wanted(i)) : []
    const r = await window.api.installFromLoversLab((i.source as { url: string }).url, i.modId, hints)
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
        archives: mod ? archivesFor(mod, wanted(i)) : undefined,
        hints: mod ? downloadHints(mod, wanted(i)) : undefined
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

  // Files from a community fix stand in for the published ones; they come from the links the player shared.
  const fixFile = async (u: UsedFix) => {
    setBusy(`fix:${u.fix.id}`)
    const r = await window.api.installFromFile(u.mod.id, u.fix.id)
    note(r.message)
    setBusy(null)
    if (r.ok) data.rescan()
  }
  const fixGroup = fixes.length > 0 && (
    <div className="install-group install-fixes">
      <h4>Community fixes this profile uses</h4>
      <ul className="small">
        {fixes.map((u) => (
          <li key={u.fix.id}>
            <b>{u.mod.name}</b> – {u.installed ? <span className="ok-text">fix installed</span> : <span>{u.fix.steps}</span>}
            <div className="row-actions">
              {u.fix.links.map((l) => <button key={l} onClick={() => window.api.openExternal(l)}>Open {new URL(l).hostname.replace(/^www\./, '')}</button>)}
              <button disabled={!!busy} onClick={() => void fixFile(u)}>Add the fix's file…</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )

  if (!items.length) return fixes.length && fixes.some((u) => !u.installed)
    ? <div className="install-panel callout">{fixGroup}{log.length > 0 && <ul className="small install-log">{log.map((l, n) => <li key={n}>{l}</li>)}</ul>}</div>
    : <p className="callout ok small">Everything in this profile is installed.</p>

  return (
    <div className="install-panel callout">
      {fixGroup}
      {foundGroup}
      <h3>Install what is missing ({new Set(items.map((i) => i.entry.key)).size} mod{new Set(items.map((i) => i.entry.key)).size === 1 ? '' : 's'})</h3>
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
                <li key={`${i.entry.key}:${i.entry.pack ?? ''}:${i.entry.steamId ?? ''}`}>
                  {i.entry.name}{items.filter((x) => x.entry.key === i.entry.key).length > 1 && i.entry.pack ? <span className="muted"> · {i.entry.pack}</span> : null}
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
          {data.settings.autoLoversLab !== false && fromLLs.length > 1 && (
            <p>
              <button className="primary" disabled={!!busy} onClick={queueAll}>
                Download {fromLLs.length} mod{fromLLs.length === 1 ? '' : 's'} from LoversLab
              </button>
              <span className="small muted"> One window downloads and installs them one after another; LoversLab decides if a file needs a wait.</span>
            </p>
          )}
          <ul className="small">
            {others.map((i) => (
              <li key={`${i.entry.key}:${i.entry.pack ?? ''}:${i.entry.steamId ?? ''}`}>
                <strong>{i.entry.name}</strong>{' '}
                {i.modId && queue[i.modId] && <span className="muted">– {queue[i.modId].status === 'installed' ? 'partly installed' : QUEUE_LABEL[queue[i.modId].status]} </span>}
                {neededParts(i.modId ? data.index.mods.get(i.modId) : undefined, i.entry.need).length > 0 && (
                  <span className="muted">– needs {neededParts(i.modId ? data.index.mods.get(i.modId) : undefined, i.entry.need).join(', ')} </span>
                )}
                {i.source.kind === 'loverslab' && (
                  <button disabled={!!busy} onClick={() => fromLL(i)}>Download from LoversLab</button>
                )}
                {i.source.kind === 'nexus' && (
                  <>
                    <button disabled={!!busy} onClick={() => fromNexus(i)}>Download from Nexus Mods</button>{' '}
                    <button className="link" onClick={() => window.api.openExternal((i.source as { url: string }).url)}>open in browser</button>
                  </>
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
          {others.some((i) => i.source.kind === 'nexus') && (
            <p className="small muted">Nexus Mods opens in its own window: sign in once, then click “Manual download” (Premium starts at once). If the sign-in check does not let you through there, open the page in your browser and drop the downloaded file onto this window.</p>
          )}
          <p className="small muted">LoversLab opens in its own window. Downloads need a LoversLab account: sign in there once (the window remembers it). The window shows which file to take; each window installs what it downloads and then closes.</p>
        </div>
      )}
      {log.length > 0 && <ul className="small install-log">{log.map((l, n) => <li key={n}>{l}</li>)}</ul>}
    </div>
  )
}
