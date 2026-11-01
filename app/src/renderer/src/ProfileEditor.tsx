import { useEffect, useMemo, useRef, useState } from 'react'
import type { Preset } from '@catalog/schema'
import type { InstalledPack } from '@shared/api'
import { matchInstalled, parseTargetKey } from '@shared/match'
import { candidates, nameOf, resolveProfile, type Candidate, type CandidateGroup, type Profile } from '@shared/profile'
import { checkOwnMod, isOwnKey, ownKeyOf, placeOwnMods, type FactsReport, type OrderedEntry } from '@shared/own'
import { KIND_LABEL, useData } from './data'
import { ModCover, withParents } from './ModCover'
import { ConflictList } from './ConflictList'
import { InstallPanel } from './InstallPanel'
import { AddOwnMod, CheckLines, INSTALLED_EVENT, keysForInstalled, OwnCard, ownName, type InstalledDetail } from './OwnMods'
import { planLaunch } from '@shared/launch'

const GROUP_TITLE: Record<CandidateGroup, string> = {
  recommended: 'Recommended by mods in this profile',
  character: 'For your character',
  translation: 'Translations',
  other: 'More compatible mods'
}

const NO_FACTS: FactsReport = { packs: {}, overlaps: [] }

function OptionCard({ c, on, toggle }: { c: Candidate; on: boolean; toggle(): void }) {
  const data = useData()
  return (
    <article className={`option ${on ? 'on' : ''} ${c.conflicts.length ? 'has-conflict' : ''}`}>
      <div className="thumb" onClick={() => c.mod && data.openMod(c.mod.id)}>
        <ModCover mods={c.mod ? withParents(data.index.mods, c.mod) : []} placeholder={c.mod ? KIND_LABEL[c.mod.kind] : 'External'} />
      </div>
      <div className="body">
        <label className="option-head">
          <input type="checkbox" checked={on} onChange={toggle} />
          <strong>{c.name}</strong>
        </label>
        <div className="badges">
          {c.mod && <span className="badge">{KIND_LABEL[c.mod.kind]}</span>}
          {c.superseded && <span className="badge status-superseded">outdated</span>}
          {c.mod?.curation.confidence === 'low' && <span className="badge warn">unverified</span>}
        </div>
        <p className="small">{c.mod?.recommendedFor ?? c.mod?.summary}</p>
        {c.reasons.slice(0, 2).map((r) => <p key={r} className="small muted">{r}</p>)}
        {c.alternativeTo.length > 0 && (
          <p className="small warn-text">Alternative to {c.alternativeTo.map((k) => nameOf(data.catalog, data.index, k)).join(', ')} – use only one</p>
        )}
        {c.conflicts.length > 0 && (
          <p className="small danger">Conflicts with: {c.conflicts.map((k) => nameOf(data.catalog, data.index, k)).join(', ')}</p>
        )}
        {c.addsDependencies.length > 0 && (
          <p className="small muted">Also adds: {c.addsDependencies.map((k) => nameOf(data.catalog, data.index, k)).join(', ')}</p>
        )}
        {c.mod && <a className="small" onClick={() => data.openMod(c.mod!.id)}>Details</a>}
      </div>
    </article>
  )
}

export function ProfileEditor({ profile, preset, onChange, onDelete }: {
  profile: Profile; preset: Preset; onChange(p: Profile): void; onDelete(): void
}) {
  const data = useData()
  const [view, setView] = useState<'options' | 'order'>(() => (location.hash.endsWith('-order') ? 'order' : 'options'))
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<CandidateGroup>>(new Set())
  const [launchMessage, setLaunchMessage] = useState<string | null>(null)
  const [hideConflicts, setHideConflicts] = useState(true)

  const options = useMemo(() => candidates(data.catalog, data.index, preset, profile), [data.catalog, data.index, preset, profile])
  const resolved = useMemo(() => resolveProfile(data.catalog, data.index, preset, profile), [data.catalog, data.index, preset, profile])

  // Installed packs by profile key: catalog mods, and the player's own mods (packs the catalog does not know).
  const matched = useMemo(
    () => (data.scan ? matchInstalled(data.index, data.scan.packs) : { known: new Map<string, InstalledPack[]>(), unknown: [] as InstalledPack[] }),
    [data.scan, data.index]
  )
  const ownGroups = useMemo(() => {
    const m = new Map<string, InstalledPack[]>()
    for (const p of matched.unknown) m.set(ownKeyOf(p), [...(m.get(ownKeyOf(p)) ?? []), p])
    return m
  }, [matched])
  const installed = useMemo(() => new Map([...matched.known, ...ownGroups]), [matched, ownGroups])
  const installedKeys = useMemo(() => {
    const m = new Map<string, string>()
    for (const [k, packs] of installed) for (const p of packs) m.set(p.file.toLowerCase(), k)
    return m
  }, [installed])

  // What the packs contain (dependencies, shared files), read by the main process and cached there.
  const [facts, setFacts] = useState<FactsReport | null>(null)
  const factKey = useMemo(
    () => [...new Set([...resolved.entries.flatMap((e) => installed.get(e.key) ?? []), ...matched.unknown].map((p) => p.path))].sort().join('\n'),
    [resolved, installed, matched]
  )
  useEffect(() => {
    let live = true
    window.api.packFacts(factKey ? factKey.split('\n') : []).then((f) => live && setFacts(f), () => {})
    return () => { live = false }
  }, [factKey])

  const ownOn = useMemo(
    () => profile.extras.filter(isOwnKey).map((k) => ({ key: k, name: ownName(data, k, installed.get(k) ?? []), paths: (installed.get(k) ?? []).map((p) => p.path) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile.extras, installed, data.workshopDetails]
  )
  const baseOrder: OrderedEntry[] = useMemo(
    () => resolved.entries.map((e) => ({ key: e.key, name: e.name, paths: (installed.get(e.key) ?? []).map((p) => p.path) })),
    [resolved, installed]
  )
  const order = useMemo(() => placeOwnMods(baseOrder, ownOn, facts ?? NO_FACTS, profile.pins ?? {}), [baseOrder, ownOn, facts, profile.pins])
  const byKey = new Map(resolved.entries.map((e) => [e.key, e]))

  // Switch on what was just installed (dropped files, file picker, Workshop link).
  const latest = useRef(profile)
  latest.current = profile
  useEffect(() => {
    const onInstalled = (e: Event) => {
      const p = latest.current
      const add = keysForInstalled(data.index, (e as CustomEvent<InstalledDetail>).detail).filter((k) => !p.extras.includes(k))
      if (add.length) onChange({ ...p, extras: [...p.extras, ...add], removed: p.removed.filter((k) => !add.includes(k)) })
    }
    window.addEventListener(INSTALLED_EVENT, onInstalled)
    return () => window.removeEventListener(INSTALLED_EVENT, onInstalled)
  }, [data.index, onChange])

  const extras = new Set(profile.extras)
  const toggleExtra = (key: string) =>
    onChange({ ...profile, extras: extras.has(key) ? profile.extras.filter((k) => k !== key) : [...profile.extras, key] })
  const addExtra = (key: string) => !extras.has(key) && onChange({ ...profile, extras: [...profile.extras, key] })
  const toggleBase = (key: string) =>
    onChange({ ...profile, removed: profile.removed.includes(key) ? profile.removed.filter((k) => k !== key) : [...profile.removed, key] })

  // Moving an own mod pins it directly above its new lower neighbour; "auto" drops the pin again.
  const move = (key: string, dir: -1 | 1) => {
    const i = order.findIndex((e) => e.key === key)
    if (dir < 0 && i <= 0) return
    if (dir > 0 && i >= order.length - 1) return
    const target = dir < 0 ? order[i - 1].key : order[i + 2]?.key ?? null
    onChange({ ...profile, pins: { ...profile.pins, [key]: target } })
  }
  const unpin = (key: string) => {
    const pins = { ...profile.pins }
    delete pins[key]
    onChange({ ...profile, pins })
  }
  const share = (o: OrderedEntry) => {
    const check = checkOwnMod(order, o.key, facts ?? NO_FACTS, installedKeys)
    const i = order.findIndex((e) => e.key === o.key)
    const neighbours = [order[i - 1] && `loads below ${order[i - 1].name}`, order[i + 1] && `loads above ${order[i + 1].name}`].filter(Boolean)
    const steamId = o.key.startsWith('steamId:') ? o.key.slice(8) : ''
    data.contribute({
      type: 'new-mod',
      prefill: {
        name: o.name,
        links: steamId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${steamId}` : '',
        requirements: [
          `Pack: ${(installed.get(o.key) ?? []).map((p) => p.file).join(', ')}`,
          `In my load order it ${neighbours.join(' and ')}.`,
          ...check.overlaps.slice(0, 5).map((v) => (v.wins ? `Overrides ${v.count} files of ${v.name}.` : `${v.name} overrides ${v.count} of its files.`)),
          ...check.missing.map((m) => `Needs ${m}.`)
        ].join('\n')
      }
    })
  }

  const q = query.trim().toLowerCase()
  const visible = options.filter(
    (c) =>
      (!hideConflicts || !c.conflicts.length || extras.has(c.key)) &&
      (!q || [c.name, c.mod?.summary, ...c.reasons].some((s) => s?.toLowerCase().includes(q)))
  )
  // Switched-on extras stay visible in their group even though they are now part of the profile.
  const onCards = profile.extras
    .filter((k) => !isOwnKey(k) && !options.some((c) => c.key === k))
    .map((k): Candidate => {
      const t = parseTargetKey(k)
      const mod = 'mod' in t ? data.index.mods.get(t.mod) : undefined
      const superseded = ['superseded', 'abandoned'].includes(mod?.status ?? '')
      return { key: k, mod, name: nameOf(data.catalog, data.index, k), group: 'recommended', reasons: ['Switched on'], conflicts: [], alternativeTo: [], addsDependencies: [], superseded }
    })
  const ownKeys = [...new Set([...ownGroups.keys(), ...profile.extras.filter(isOwnKey)])]
    .map((k) => ({ k, name: ownName(data, k, installed.get(k) ?? []) }))
    .filter((o) => !q || o.name.toLowerCase().includes(q))
    .sort((a, b) => Number(extras.has(b.k)) - Number(extras.has(a.k)) || a.name.localeCompare(b.name))
  const groups: CandidateGroup[] = ['recommended', 'character', 'translation', 'other']
  const baseCount = resolved.entries.filter((e) => e.origin === 'base').length
  const launch = useMemo(
    () => planLaunch(order.map((o) => ({ key: o.key, name: o.name, pack: byKey.get(o.key)?.pack })), (k) => installed.get(k) ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, installed]
  )

  const play = async () => {
    if (launch.missing.length) {
      const list = launch.missing.slice(0, 15).join('\n')
      const more = launch.missing.length > 15 ? `\n…and ${launch.missing.length - 15} more` : ''
      if (!confirm(`${launch.missing.length} mods of this profile are not installed:\n\n${list}${more}\n\nStart the game with the ${launch.packs.length} installed packs anyway?`)) return
    }
    const r = await window.api.launchGame(launch.packs.map((p) => p.path))
    setLaunchMessage(r.message)
  }

  return (
    <div className="profile-editor">
      <div className="profile-head">
        <input className="profile-name" value={profile.name} onChange={(e) => onChange({ ...profile, name: e.target.value })} />
        <span className="muted small">based on “{preset.name}”</span>
        <span className="badge">{baseCount} from template</span>
        <span className="badge ok">{profile.extras.length} switched on</span>
        <span className="badge">{order.length} mods total</span>
        <button className="primary play" onClick={play} disabled={!data.scan?.gamePath}>
          ▶ Play{launch.missing.length ? ` (${launch.missing.length} missing)` : ''}
        </button>
        <button className="danger-btn" onClick={() => confirm(`Delete profile “${profile.name}”?`) && onDelete()}>Delete</button>
      </div>
      {launchMessage && <p className="callout small">{launchMessage}</p>}
      {preset.phaseNote && <p className="callout">{preset.phaseNote}</p>}
      {resolved.notes.length > 0 && (
        <details className="callout small">
          <summary>{resolved.notes.length} special case{resolved.notes.length === 1 ? '' : 's'} to keep in mind (the template uses these mods together)</summary>
          <ul>
            {resolved.notes.map((c) => (
              <li key={c.a + c.b}>{nameOf(data.catalog, data.index, c.a)} ↔ {nameOf(data.catalog, data.index, c.b)}{c.note ? ` – ${c.note}` : ''}</li>
            ))}
          </ul>
        </details>
      )}
      {resolved.conflicts.length > 0 && (
        <div className="callout warn">
          <strong>Conflicts in this profile</strong>
          <ul>
            {resolved.conflicts.map((c) => (
              <li key={c.a + c.b}>{nameOf(data.catalog, data.index, c.a)} ↔ {nameOf(data.catalog, data.index, c.b)}{c.note ? ` – ${c.note}` : ''}</li>
            ))}
          </ul>
        </div>
      )}
      <nav className="subtabs">
        <button className={view === 'options' ? 'active' : ''} onClick={() => setView('options')}>Options ({options.length + ownGroups.size})</button>
        <button className={view === 'order' ? 'active' : ''} onClick={() => setView('order')}>Load order ({order.length})</button>
      </nav>

      {view === 'options' && (
        <>
          <div className="filters inline">
            <input placeholder="Search options…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="toggle"><input type="checkbox" checked={hideConflicts} onChange={(e) => setHideConflicts(e.target.checked)} /> Hide conflicting</label>
          </div>
          <section>
            <h3>Your mods ({ownKeys.length})</h3>
            <AddOwnMod />
            {ownKeys.length > 0 && (
              <div className="options">
                {ownKeys.map(({ k }) => {
                  const on = extras.has(k)
                  const packs = installed.get(k) ?? []
                  const preview = on ? order : placeOwnMods(order, [{ key: k, name: ownName(data, k, packs), paths: packs.map((p) => p.path) }], facts ?? NO_FACTS)
                  return (
                    <OwnCard key={k} k={k} packs={packs} on={on} toggle={() => toggleExtra(k)} order={facts ? preview : null}
                      facts={facts} installedKeys={installedKeys} onAdd={addExtra} />
                  )
                })}
              </div>
            )}
          </section>
          {onCards.length > 0 && (
            <section>
              <h3>Switched on</h3>
              <div className="options">{onCards.map((c) => <OptionCard key={c.key} c={c} on toggle={() => toggleExtra(c.key)} />)}</div>
            </section>
          )}
          {groups.map((g) => {
            const list = visible.filter((c) => c.group === g)
            if (!list.length) return null
            const collapsible = g === 'other' || g === 'translation'
            const collapsed = collapsible && !expanded.has(g) && !q
            return (
              <section key={g}>
                <h3>
                  {GROUP_TITLE[g]} ({list.length})
                  {collapsible && !q && (
                    <button className="link" onClick={() => setExpanded((s) => new Set(s.has(g) ? [...s].filter((x) => x !== g) : [...s, g]))}>
                      {collapsed ? 'show' : 'hide'}
                    </button>
                  )}
                </h3>
                {!collapsed && <div className="options">{list.map((c) => <OptionCard key={c.key} c={c} on={extras.has(c.key)} toggle={() => toggleExtra(c.key)} />)}</div>}
              </section>
            )
          })}
        </>
      )}

      {view === 'order' && (
        <section>
          <InstallPanel missing={resolved.entries.filter((e) => !installed.has(e.key))} />
          <p className="small muted">
            Top = highest priority (its files win over the mods below). Template mods keep the tested community order; switched-on mods are
            placed by their load-order rules; your own mods by what their packs contain – move them with ↑ ↓ if you know better.
          </p>
          <table className="entries">
            <tbody>
              {order.map((o, i) => {
                const e = byKey.get(o.key)
                const isInstalled = installed.has(o.key)
                return (
                  <tr key={o.key} className={isInstalled ? 'state-installed' : 'state-missing'}>
                    <td className="num">{i + 1}</td>
                    <td>
                      {'mod' in parseTargetKey(o.key) ? <a onClick={() => data.openMod((parseTargetKey(o.key) as { mod: string }).mod)}>{o.name}</a> : o.name}
                      {e?.pack && <div className="small muted">{e.pack}</div>}
                      {o.own && (
                        <>
                          <div className="small muted">{(installed.get(o.key) ?? []).map((p) => p.file).join(', ')}</div>
                          <div className="small">{o.own.reason}</div>
                          {facts && <CheckLines check={checkOwnMod(order, o.key, facts, installedKeys)} onAdd={addExtra} />}
                        </>
                      )}
                    </td>
                    <td>
                      {o.own ? (
                        <span className="badge own">your mod{o.own.pinned ? ', placed by you' : ''}</span>
                      ) : (
                        <span className={`badge origin-${e?.origin}`}>{e?.origin === 'base' ? 'template' : e?.origin === 'extra' ? 'switched on' : `needed by ${e?.requiredBy}`}</span>
                      )}
                    </td>
                    <td className="state">{isInstalled ? 'installed' : 'not installed'}</td>
                    <td className="row-actions">
                      {o.own && (
                        <>
                          <button className="link" title="Load earlier (higher priority)" onClick={() => move(o.key, -1)}>↑</button>
                          <button className="link" title="Load later (lower priority)" onClick={() => move(o.key, 1)}>↓</button>
                          {o.own.pinned && <button className="link" title="Let the app place it again" onClick={() => unpin(o.key)}>auto</button>}
                          <button className="link" title="Suggest this mod and its place for the catalog" onClick={() => share(o)}>share</button>
                        </>
                      )}
                      {e?.origin === 'base' && <button className="link" onClick={() => toggleBase(o.key)}>remove</button>}
                      {(e?.origin === 'extra' || o.own) && <button className="link" onClick={() => toggleExtra(o.key)}>remove</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <h3>Overlaps in this load order</h3>
          <ConflictList
            paths={order.flatMap((o) => o.paths)}
            orderNote="Installed mods of this profile, compared in the order above: the higher mod's files are the ones the game uses."
          />
          {profile.removed.length > 0 && (
            <>
              <h3>Removed from the template</h3>
              <ul>{profile.removed.map((k) => <li key={k}>{nameOf(data.catalog, data.index, k)} <button className="link" onClick={() => toggleBase(k)}>restore</button></li>)}</ul>
            </>
          )}
        </section>
      )}
    </div>
  )
}
