import { useMemo, useState } from 'react'
import type { Preset } from '@catalog/schema'
import { matchInstalled, parseTargetKey } from '@shared/match'
import { candidates, nameOf, resolveProfile, type Candidate, type CandidateGroup, type Profile } from '@shared/profile'
import { KIND_LABEL, useData } from './data'
import { ModCover, withParents } from './ModCover'
import { ConflictList } from './ConflictList'

const GROUP_TITLE: Record<CandidateGroup, string> = {
  recommended: 'Recommended by mods in this profile',
  character: 'For your character',
  translation: 'Translations',
  other: 'More compatible mods'
}

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
  const [view, setView] = useState<'options' | 'order'>('options')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<CandidateGroup>>(new Set())
  const [hideConflicts, setHideConflicts] = useState(true)

  const options = useMemo(() => candidates(data.catalog, data.index, preset, profile), [data.catalog, data.index, preset, profile])
  const resolved = useMemo(() => resolveProfile(data.catalog, data.index, preset, profile), [data.catalog, data.index, preset, profile])
  const installed = useMemo(() => (data.scan ? matchInstalled(data.index, data.scan.packs).known : new Map()), [data.scan, data.index])

  const extras = new Set(profile.extras)
  const toggleExtra = (key: string) =>
    onChange({ ...profile, extras: extras.has(key) ? profile.extras.filter((k) => k !== key) : [...profile.extras, key] })
  const toggleBase = (key: string) =>
    onChange({ ...profile, removed: profile.removed.includes(key) ? profile.removed.filter((k) => k !== key) : [...profile.removed, key] })

  const q = query.trim().toLowerCase()
  const visible = options.filter(
    (c) =>
      (!hideConflicts || !c.conflicts.length || extras.has(c.key)) &&
      (!q || [c.name, c.mod?.summary, ...c.reasons].some((s) => s?.toLowerCase().includes(q)))
  )
  // Switched-on extras stay visible in their group even though they are now part of the profile.
  const onCards = profile.extras
    .filter((k) => !options.some((c) => c.key === k))
    .map((k): Candidate => {
      const t = parseTargetKey(k)
      const mod = 'mod' in t ? data.index.mods.get(t.mod) : undefined
      const superseded = ['superseded', 'abandoned'].includes(mod?.status ?? '')
      return { key: k, mod, name: nameOf(data.catalog, data.index, k), group: 'recommended', reasons: ['Switched on'], conflicts: [], alternativeTo: [], addsDependencies: [], superseded }
    })
  const groups: CandidateGroup[] = ['recommended', 'character', 'translation', 'other']
  const baseCount = resolved.entries.filter((e) => e.origin === 'base').length

  return (
    <div className="profile-editor">
      <div className="profile-head">
        <input className="profile-name" value={profile.name} onChange={(e) => onChange({ ...profile, name: e.target.value })} />
        <span className="muted small">based on “{preset.name}”</span>
        <span className="badge">{baseCount} from template</span>
        <span className="badge ok">{profile.extras.length} switched on</span>
        <span className="badge">{resolved.entries.length} mods total</span>
        <button className="danger-btn" onClick={() => confirm(`Delete profile “${profile.name}”?`) && onDelete()}>Delete</button>
      </div>
      {preset.phaseNote && <p className="callout">{preset.phaseNote}</p>}
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
        <button className={view === 'options' ? 'active' : ''} onClick={() => setView('options')}>Options ({options.length})</button>
        <button className={view === 'order' ? 'active' : ''} onClick={() => setView('order')}>Load order ({resolved.entries.length})</button>
      </nav>

      {view === 'options' && (
        <>
          <div className="filters inline">
            <input placeholder="Search options…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="toggle"><input type="checkbox" checked={hideConflicts} onChange={(e) => setHideConflicts(e.target.checked)} /> Hide conflicting</label>
          </div>
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
          <p className="small muted">Top = highest priority (loaded last). Template mods keep the tested community order; switched-on mods are placed by their load-order rules.</p>
          <table className="entries">
            <tbody>
              {resolved.entries.map((e, i) => {
                const isInstalled = installed.has(e.key)
                return (
                  <tr key={e.key} className={isInstalled ? 'state-installed' : 'state-missing'}>
                    <td className="num">{i + 1}</td>
                    <td>
                      {'mod' in parseTargetKey(e.key) ? <a onClick={() => data.openMod((parseTargetKey(e.key) as { mod: string }).mod)}>{e.name}</a> : e.name}
                      {e.pack && <div className="small muted">{e.pack}</div>}
                    </td>
                    <td><span className={`badge origin-${e.origin}`}>{e.origin === 'base' ? 'template' : e.origin === 'extra' ? 'switched on' : `needed by ${e.requiredBy}`}</span></td>
                    <td className="state">{isInstalled ? 'installed' : 'not installed'}</td>
                    <td>
                      {e.origin === 'base' && <button className="link" onClick={() => toggleBase(e.key)}>remove</button>}
                      {e.origin === 'extra' && <button className="link" onClick={() => toggleExtra(e.key)}>remove</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <h3>Overlaps in this load order</h3>
          <ConflictList
            paths={resolved.entries.flatMap((e) => (installed.get(e.key) ?? []).map((p: { path: string }) => p.path))}
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
