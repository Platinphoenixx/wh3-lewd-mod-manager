import { useEffect, useMemo, useState } from 'react'
import type { Mod, Preset } from '@catalog/schema'
import type { InstalledPack } from '@shared/api'
import { fitInProfile, missingNeeds, withMod } from '@shared/fit'
import { installSourceFor } from '@shared/install'
import { resolveProfile, type Profile, type ResolvedEntry } from '@shared/profile'
import { useData } from './data'
import { InstallPanel } from './InstallPanel'
import { openPlace } from './nav'
import { useEscape } from './escape'

/** Where the mod itself comes from, as its button says it. */
function sourceOf(mod: Mod): { label: string; where: string } {
  const s = mod.sources
  if (mod.packs.some((p) => p.from === 'steam') || (!mod.packs.length && s.steam?.length)) return { label: 'Subscribe', where: 'Steam Workshop' }
  if (s.loverslab) return { label: 'Download', where: 'LoversLab' }
  if (s.nexus) return { label: 'Download', where: 'Nexus Mods' }
  if (s.discord?.length) return { label: 'Open post', where: 'Discord' }
  return { label: 'Download', where: 'by hand' }
}

/** A list with nothing in it: the mod and what it needs, as the profile builder would add them. */
const ALONE = { id: 'catalog', name: 'Catalog', playAs: [], phase: 'any', origin: 'guide', entries: [], source: { type: 'inferred' } } as unknown as Preset

/**
 * The catalog's buttons for one mod (cards and the mod's page): get it – Subscribe on Steam, Download from LoversLab or
 * Nexus in the app's own window, with what it needs – and "Add to profile ▾" with how it fits each profile.
 */
export function ModActions({ mod, installed }: { mod: Mod; installed: Map<string, InstalledPack[]> }) {
  const data = useData()
  const key = `mod:${mod.id}`
  const has = (k: string) => installed.has(k)
  const needs = useMemo(() => missingNeeds(data.index, mod, has), [data.index, mod, installed])
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<ResolvedEntry[] | null>(null)
  const src = sourceOf(mod)
  useEscape(() => { setDialog(null); data.rescan() }, !!dialog)

  const get = async () => {
    // The mod and what it needs, as a profile with only this mod would load them; what is installed is left out.
    const entries = resolveProfile(data.catalog, data.index, ALONE, { extras: [key], removed: [] }).entries.filter((e) => !has(e.key))
    if (!entries.length) return
    const sources = entries.map((e) => installSourceFor(data.catalog, data.index, e))
    if (sources.every((s) => s.kind === 'steam')) {
      const ids = [...new Set(sources.map((s) => (s as { id: string }).id))]
      setBusy(true)
      data.notify({ id: `get-${mod.id}`, kind: 'info', text: `Subscribing to ${mod.name}${ids.length > 1 ? ` and ${ids.length - 1} it needs` : ''}…`, timeout: 0 })
      const r = await window.api.subscribeWorkshop(ids)
      setBusy(false)
      const done = r.results.filter((x) => x.status === 'installed').length
      data.notify({ id: `get-${mod.id}`, kind: r.ok && done === ids.length ? 'done' : 'error',
        text: r.ok ? `${mod.name}: ${done} of ${ids.length} Workshop item${ids.length === 1 ? '' : 's'} installed.` : r.message ?? 'Steam failed.' })
      data.rescan()
      return
    }
    setDialog(entries)
  }

  return (
    <div className="mod-actions" onClick={(e) => e.stopPropagation()}>
      {has(key)
        ? <span className="small ok-text">✓ Installed</span>
        : <button disabled={busy} onClick={() => void get()}>{busy ? 'Subscribing…' : src.label}</button>}
      <AddToProfile mod={mod} />
      <span className="small muted">
        {has(key) ? '' : src.where}
        {needs.length > 0 && <span title={needs.map((m) => m.name).join(', ')}>{has(key) ? '' : ' · '}+ {needs.length} it needs</span>}
      </span>
      {dialog && (
        <div className="modal-backdrop" onClick={() => { setDialog(null); data.rescan() }}>
          <div className="modal install-dialog" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => { setDialog(null); data.rescan() }}>×</button>
            <h2>Get {mod.name}</h2>
            {dialog.length > 1 && <p className="small muted">With what it needs: {dialog.filter((e) => e.key !== key).map((e) => e.name).join(', ')}.</p>}
            <InstallPanel missing={dialog} characters={mod.playAs?.map((p) => p.character) ?? []} />
          </div>
        </div>
      )}
    </div>
  )
}

/** "Add to profile ▾": the player's profiles, how the mod fits each, and a new profile around it. */
function AddToProfile({ mod }: { mod: Mod }) {
  const data = useData()
  const key = `mod:${mod.id}`
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  useEffect(() => {
    if (!open) return
    window.api.listProfiles().then((l) => setProfiles([...l].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))), () => setProfiles([]))
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])
  const fits = useMemo(() => (profiles ?? []).flatMap((p) => {
    const preset = data.catalog.presets.find((x) => x.id === p.presetId)
    return preset ? [{ p, fit: fitInProfile(data.catalog, data.index, preset, p, key) }] : []
  }), [profiles, data.catalog, data.index, key])

  const add = async (p: Profile) => {
    const next = withMod(p, key)
    await window.api.saveProfile(next)
    setOpen(false)
    data.notify({
      kind: 'done', text: `${mod.name} is in “${p.name}”.`,
      actions: [{ label: 'Install what is missing', run: () => data.openProfile({ profile: p.id }, 'install') }]
    })
  }

  return (
    <span className={`add-profile ${open ? 'open' : ''}`}>
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open) }}>Add to profile ▾</button>
      {open && (
        <div className="add-profile-pop" onClick={(e) => e.stopPropagation()}>
          <div className="small muted add-profile-head">Add {mod.name} to</div>
          {profiles === null && <div className="small muted add-profile-row">Loading…</div>}
          {profiles?.length === 0 && <div className="small muted add-profile-row">No profiles yet.</div>}
          {fits.map(({ p, fit }) => (
            <div key={p.id} className="add-profile-row">
              <div className="add-profile-name">
                <div>{p.name}</div>
                <div className={`small ${fit.state === 'in' ? 'ok-text' : fit.state === 'fits' || fit.state === 'off' ? 'muted' : fit.state === 'avoided' ? 'warn-text' : 'danger'}`}
                  title={fit.adds.length ? `Comes along: ${fit.adds.join(', ')}` : undefined}>
                  {fit.state === 'in' ? '✓ ' : ''}{fit.text}
                </div>
              </div>
              {fit.canAdd && <button onClick={() => void add(p)}>{fit.state === 'avoided' ? 'Add anyway' : fit.state === 'off' ? 'Switch on' : 'Add'}</button>}
            </div>
          ))}
          <div className="add-profile-row">
            <a onClick={() => { setOpen(false); openPlace({ mod: null, tab: 'play', 'play.withMod': mod.id }) }}>New profile with this mod…</a>
          </div>
        </div>
      )}
    </span>
  )
}
