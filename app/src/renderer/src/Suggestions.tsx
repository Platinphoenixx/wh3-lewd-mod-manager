import { useState } from 'react'
import type { Suggestion } from '@shared/suggest'
import { useData } from './data'

const SHOWN = 10

/**
 * "Fill this profile": suggested lewd and general mods, each with why it is suggested. All are ticked;
 * unticking leaves a mod out of the next "Add". Added mods leave the list (they are in the profile then).
 */
export function FillProfile({ lewd, general, character, onAdd }: {
  lewd: Suggestion[]; general: Suggestion[]; character: string; onAdd(keys: string[]): void
}) {
  const data = useData()
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  if (!lewd.length && !general.length) return null
  const visible = (id: string, list: Suggestion[]) => (expanded.has(id) ? list : list.slice(0, SHOWN))
  const chosen = (list: Suggestion[]) => list.filter((s) => !skipped.has(s.key)).map((s) => s.key)
  const all = [...chosen(visible('lewd', lewd)), ...chosen(visible('general', general))]
  return (
    <section className="fill-profile">
      <div className="fill-head">
        <h2>Fill this profile</h2>
        <span className="muted small">
          Mods that fit {character} and that other players combine with this kind of campaign. All work with what is already in the
          profile; anything they need is added too.
        </span>
        <button className="primary" disabled={!all.length} onClick={() => onAdd(all)}>Add all {all.length}</button>
      </div>
      <div className="fill-cols">
        {column('lewd', 'Lewd mods', lewd)}
        {column('general', 'General mods', general)}
      </div>
    </section>
  )

  function column(id: string, title: string, list: Suggestion[]) {
    if (!list.length) return <div className="fill-col"><h3>{title}</h3><p className="small muted">Nothing more to suggest.</p></div>
    const shown = visible(id, list)
    const keys = chosen(shown)
    return (
      <div className="fill-col">
        <h3>
          {title} <span className="muted">{list.length} suggested</span>
          <button disabled={!keys.length} onClick={() => onAdd(keys)}>Add {keys.length === shown.length ? `these ${keys.length}` : `${keys.length} selected`}</button>
        </h3>
        {shown.map((s) => (
          <label key={s.key} className="fill-row">
            <input
              type="checkbox"
              checked={!skipped.has(s.key)}
              onChange={() => setSkipped((prev) => {
                const next = new Set(prev)
                if (next.has(s.key)) next.delete(s.key)
                else next.add(s.key)
                return next
              })}
            />
            <a className="plain" title={s.mod.summary} onClick={(e) => { e.preventDefault(); data.openMod(s.mod.id) }}>{s.mod.name}</a>
            <div className="why">{s.reasons.join(' · ')}</div>
          </label>
        ))}
        {list.length > SHOWN && (
          <div className="more">
            <a onClick={() => setExpanded((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })}>{expanded.has(id) ? 'Show fewer' : `Show ${list.length - SHOWN} more that fit`}</a>
          </div>
        )}
      </div>
    )
  }
}
