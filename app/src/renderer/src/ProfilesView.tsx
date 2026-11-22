import { useCallback, useEffect, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import type { CampaignGuide, Preset } from '@catalog/schema'
import { presetStatus, type PresetEntryStatus } from '@shared/match'
import type { Profile } from '@shared/profile'
import { resolveTarget, useData } from './data'
import { ModCover } from './ModCover'
import { ProfileEditor } from './ProfileEditor'
import { ImportDialog } from './ImportDialog'
import { MadeBy, worksOf } from './Creators'
import { useNavState } from './nav'
import { moveProfile, sortProfiles, usedLabel, type ProfileSort } from '@shared/profileSort'

/** KPW's guide for the characters of a preset (guides name characters loosely, e.g. "Miao"). */
export function guideFor(guides: CampaignGuide[], preset: Preset): CampaignGuide | undefined {
  const names = preset.playAs.map((c) => c.toLowerCase().replace(/[^a-z]/g, ''))
  return guides.find((g) => {
    const gn = g.character.toLowerCase().replace(/[^a-z/]/g, '')
    return names.some((n) => gn.includes(n.slice(0, 4)))
  })
}

const STATE_LABEL: Record<PresetEntryStatus['state'], string> = {
  installed: 'installed',
  missing: 'missing',
  'other-version': 'other version'
}

function EntryRow({ e, pos }: { e: PresetEntryStatus; pos: number }) {
  const data = useData()
  const t = e.target ? resolveTarget(data, e.target) : null
  const name = t?.kind === 'mod' ? t.mod.name : t?.kind === 'external' ? t.ext.name : e.pack
  return (
    <tr className={`state-${e.state}`}>
      <td className="num">{pos}</td>
      <td>
        {t?.kind === 'mod' ? <a onClick={() => data.openMod(t.mod.id)}>{name}</a> : name}
        <div className="small muted">{e.pack}</div>
      </td>
      <td>{e.from === 'steam' ? 'Steam' : 'Download'}</td>
      <td className="state">
        {STATE_LABEL[e.state]}
        {e.found && <div className="small muted">{e.found.file} ({e.found.source})</div>}
      </td>
    </tr>
  )
}

function PresetDetail({ preset }: { preset: Preset }) {
  const data = useData()
  const status = useMemo(
    () => (data.scan ? presetStatus(data.index, preset, data.scan.packs) : null),
    [data.scan, data.index, preset]
  )
  const guide = guideFor(data.catalog.campaignGuides, preset)
  const covers = presetCover(data, preset).slice(0, preset.coverMods?.length || 3)
  const counts = status?.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.state]: (acc[s.state] ?? 0) + 1 }), {})

  return (
    <div className="preset-detail">
      <div className="hero">
        {covers.map((m) => <ModCover key={m.id} mods={[m]} onClick={() => data.openMod(m.id)} />)}
      </div>
      <h2>{preset.name}</h2>
      <p className="small muted">{ORIGIN_NOTE[preset.origin ?? 'tested']}</p>
      <div className="badges">
        <span className={`badge origin-${preset.origin}`}>{ORIGIN_TITLE[preset.origin ?? 'tested']}</span>
        <span className={`badge phase-${preset.phase}`}>{preset.phase === 'any' ? 'whole campaign' : `${preset.phase} game`}</span>
        <span className="badge">{preset.entries.length} mods</span>
        {guide?.campaigns?.map((c) => <span key={c} className="badge">{c}</span>)}
      </div>
      {preset.phaseNote && <p className="callout">{preset.phaseNote}</p>}
      {preset.modernized && preset.modernized.length > 0 && (
        <details className="callout ok">
          <summary>Updated to the newest versions ({preset.modernized.length} changes since the original list)</summary>
          <ul className="small">
            {preset.modernized.map((m) => (
              <li key={m.from}>
                <code>{m.from}</code> → {m.to === 'removed' ? <em>removed</em> : <code>{m.to}</code>}
                {m.note && <div className="muted">{m.note}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="markdown"><Markdown>{preset.description ?? ''}</Markdown></div>
      {preset.highlights && <ul>{preset.highlights.map((h) => <li key={h}>{h}</li>)}</ul>}

      <MadeBy preset={preset} works={worksOf(data, preset.entries.flatMap((e) => (e.target ? [e.target] : [])))} />

      {guide && guide.dlc?.length > 0 && (
        <section>
          <h3>Required DLC</h3>
          <ul>{guide.dlc.map((d) => <li key={d.name}>{d.name}{d.why ? <span className="muted"> – {d.why}</span> : null}</li>)}</ul>
        </section>
      )}

      <section>
        <h3>Mod list (top = highest priority)</h3>
        {counts && (
          <p className="small">
            {counts.installed ?? 0} installed · {counts['other-version'] ?? 0} other version · {counts.missing ?? 0} missing
          </p>
        )}
        <table className="entries">
          <tbody>
            {(status ?? preset.entries.map((e) => ({ ...e, state: 'missing' as const }))).map((e, i) => (
              <EntryRow key={e.pack + i} e={e} pos={i + 1} />
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Source: {preset.source.author} – {preset.source.file}
        </p>
      </section>
    </div>
  )
}

const ORIGIN_TITLE: Record<Preset['origin'], string> = {
  tested: 'Tested community lists',
  guide: 'Community guides',
  derived: 'From mod pages',
  community: 'Shared by players',
  vanilla: "Lords in the game's own campaign"
}

const ORIGIN_NOTE: Record<Preset['origin'], string> = {
  tested: 'A complete list someone played with; the load order is tested.',
  guide: "A community guide's list; the order follows the guide and is not tested as a whole.",
  derived: 'Built automatically from the mod page: the mod plus everything it requires. Add options in your profile.',
  community: 'A list a player shared from the app; the load order is the one they played with.',
  vanilla: 'No mod is needed to play this lord: the template is empty, and the editor suggests looks, the army look and add-ons that fit.'
}

function presetCover(data: ReturnType<typeof useData>, p: Preset) {
  // Cover mods first, then the preset's own entries, so every template gets a picture.
  const ids = [...(p.coverMods ?? []), ...p.entries.flatMap((e) => (e.target && 'mod' in e.target ? [e.target.mod] : []))]
  return [...new Set(ids)].map((id) => data.index.mods.get(id)).filter((m) => !!m)
}

/** The last openProfile request the Profiles tab followed (data.focus.at). */
let focusSeen = 0

/** The profile the player had open last, per PC: the Profiles tab opens it again instead of the first in the list. */
const LAST_PROFILE = 'lastProfile'
function lastProfile(): string | null {
  try { return localStorage.getItem(LAST_PROFILE) } catch { return null }
}
function rememberProfile(id: string): void {
  try { localStorage.setItem(LAST_PROFILE, id) } catch { /* then the first profile opens */ }
}

/** Per PC: how the own profiles are sorted, when each was opened last, and the player's own order (dragged). */
function readStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function store(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* only for this session then */ }
}

export function ProfilesView() {
  const data = useData()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selected, setSelected] = useNavState<{ kind: 'profile' | 'preset'; id: string } | null>('profiles.selected', null)
  const [importing, setImporting] = useState(false)
  const [sortBy, setSortBy] = useState<ProfileSort>(() => readStored<ProfileSort>('profileSort', 'used'))
  const [used, setUsed] = useState<Record<string, string>>(() => readStored('profileUsed', {}))
  const [order, setOrder] = useState<string[]>(() => readStored('profileOrder', []))
  const [dragging, setDragging] = useState<string | null>(null)
  const sorted = useMemo(() => sortProfiles(profiles, sortBy, used, order), [profiles, sortBy, used, order])
  const changeSort = (how: ProfileSort) => {
    setSortBy(how)
    store('profileSort', how)
    // "Your order" starts from the order the player sees now.
    if (how === 'own' && !order.length) {
      const ids = sorted.map((x) => x.id)
      setOrder(ids)
      store('profileOrder', ids)
    }
  }
  const drop = (onto: string) => {
    if (!dragging) return
    const ids = moveProfile(sorted.map((x) => x.id), dragging, onto)
    setOrder(ids)
    store('profileOrder', ids)
    setDragging(null)
  }

  useEffect(() => {
    window.api.listProfiles().then((list) => {
      setProfiles(list)
      // A profile or template opened from Play comes first.
      // Only a new request counts: going back to this tab keeps the profile the player had open then.
      const f = data.focus && data.focus.at !== focusSeen ? data.focus : null
      if (f) focusSeen = f.at
      const wanted = f?.profile && list.some((p) => p.id === f.profile) ? { kind: 'profile' as const, id: f.profile }
        : f?.preset ? { kind: 'preset' as const, id: f.preset } : null
      // Opening the tab picks a profile by itself; that is no step of its own for the back button.
      // Otherwise the profile the player had open last (also after a restart), else the first one.
      const last = lastProfile()
      const fallback = last && list.some((p) => p.id === last) ? { kind: 'profile' as const, id: last }
        : list[0] ? { kind: 'profile' as const, id: list[0].id } : data.catalog.presets[0] && { kind: 'preset' as const, id: data.catalog.presets[0].id }
      setSelected((s) => wanted ?? s ?? fallback, wanted ? undefined : { replace: true })
    })
  }, [data.catalog, data.focus])

  useEffect(() => {
    if (selected?.kind !== 'profile') return
    rememberProfile(selected.id)
    // Opening a profile counts as using it; the list re-sorts only on the next visit, so the row does not jump away.
    const all = { ...readStored<Record<string, string>>('profileUsed', {}), [selected.id]: new Date().toISOString() }
    store('profileUsed', all)
  }, [selected])
  useEffect(() => { setUsed(readStored('profileUsed', {})) }, [profiles.length])

  // Saving on every change keeps profiles safe; the editor calls this per toggle.
  const save = useCallback((p: Profile) => {
    setProfiles((list) => list.map((x) => (x.id === p.id ? p : x)))
    void window.api.saveProfile(p)
  }, [])

  const create = (preset: Preset) => {
    const now = new Date().toISOString()
    const p: Profile = { id: crypto.randomUUID(), name: `My ${preset.name}`, presetId: preset.id, extras: [], removed: [], createdAt: now, updatedAt: now }
    void window.api.saveProfile(p).then(setProfiles)
    setSelected({ kind: 'profile', id: p.id })
  }

  const remove = (id: string) => {
    void window.api.deleteProfile(id).then(setProfiles)
    setSelected(null)
  }

  const profile = selected?.kind === 'profile' ? profiles.find((p) => p.id === selected.id) : undefined
  const preset =
    selected?.kind === 'preset'
      ? data.catalog.presets.find((p) => p.id === selected.id)
      : profile && data.catalog.presets.find((p) => p.id === profile.presetId)

  return (
    <div className="split">
      <div className="sidebar-list">
        <h4 className="profiles-head">
          My profiles
          {profiles.length > 1 && (
            <select className="profile-sort" value={sortBy} title="Sort your profiles" onChange={(e) => changeSort(e.target.value as ProfileSort)}>
              <option value="used">Last used</option>
              <option value="name">Name</option>
              <option value="own">Your order</option>
            </select>
          )}
        </h4>
        {sortBy === 'own' && profiles.length > 1 && <p className="small muted pad profile-sort-hint">Drag a profile to move it.</p>}
        <div className="pad"><button className="link" onClick={() => setImporting(true)}>Import a mod list from another launcher…</button></div>
        {importing && (
          <ImportDialog
            onClose={() => setImporting(false)}
            onCreate={(p) => {
              setImporting(false)
              void window.api.saveProfile(p).then(setProfiles)
              setSelected({ kind: 'profile', id: p.id })
            }}
          />
        )}
        {profiles.length === 0 && <p className="small muted pad">No profiles yet. Pick a template below and create one.</p>}
        <ul>
          {sorted.map((p) => {
            const base = data.catalog.presets.find((x) => x.id === p.presetId)
            const cover = base ? presetCover(data, base) : []
            return (
              <li key={p.id} className={[selected?.kind === 'profile' && selected.id === p.id ? 'active' : '', dragging === p.id ? 'dragging' : ''].filter(Boolean).join(' ')}
                onClick={() => setSelected({ kind: 'profile', id: p.id })}
                draggable={sortBy === 'own'} onDragStart={() => setDragging(p.id)} onDragEnd={() => setDragging(null)}
                onDragOver={(e) => { if (dragging) e.preventDefault() }} onDrop={(e) => { e.preventDefault(); drop(p.id) }}>
                <ModCover mods={cover} />
                <div>
                  <strong>{p.name}</strong>
                  <div className="small muted">
                    {base?.name ?? 'template missing'} · {p.extras.length} extras
                    {sortBy === 'used' && usedLabel(used[p.id] ?? p.updatedAt) && <> · {usedLabel(used[p.id] ?? p.updatedAt)}</>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
        {(['tested', 'guide', 'derived', 'community', 'vanilla'] as const).map((origin) => {
          const list = data.catalog.presets.filter((p) => (p.origin ?? 'tested') === origin)
          if (!list.length) return null
          return (
            <div key={origin}>
              <h4>{ORIGIN_TITLE[origin]}</h4>
              <ul>
                {list.map((p) => {
                  const cover = presetCover(data, p)
                  return (
                    <li key={p.id} className={selected?.kind === 'preset' && selected.id === p.id ? 'active' : ''} onClick={() => setSelected({ kind: 'preset', id: p.id })}>
                      <ModCover mods={cover} />
                      <div>
                        <strong>{p.name}</strong>
                        <div className="small muted">{p.playAs.join(', ')} · {p.entries.length} mods</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
      <div className="content">
        {profile && preset && <ProfileEditor key={profile.id} profile={profile} preset={preset} onChange={save} onDelete={() => remove(profile.id)} />}
        {profile && !preset && <p className="callout warn">The template of this profile is no longer in the catalog.</p>}
        {selected?.kind === 'preset' && preset && (
          <>
            <div className="use-list">
              <button className="primary" onClick={() => create(preset)}>Use this list</button>
              <span className="small muted">Makes your own copy of the list. In it you decide the optional parts, install what is missing and start the game.</span>
            </div>
            <PresetDetail preset={preset} />
          </>
        )}
      </div>
    </div>
  )
}
