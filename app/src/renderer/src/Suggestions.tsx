import { useState } from 'react'
import type { PickOne, Suggestion } from '@shared/suggest'
import { useData } from './data'

const SHOWN = 10
const PICK_SHOWN = 5
const NONE = '-'

function SuggestionName({ s }: { s: Suggestion }) {
  const data = useData()
  return <a className="plain" title={s.mod.summary} onClick={(e) => { e.preventDefault(); data.openMod(s.mod.id) }}>{s.mod.name}</a>
}

/**
 * Step 1, "Decide": the places where only one of several mods can be used (versions of one add-on, reskins
 * of the same character). An option is selected at first only where players of this kind of list really use it
 * and it replaces nothing in the profile; "Apply" adds the chosen ones and remembers "None of these" so the
 * question does not come back.
 */
export function DecideChoices({ picks, onApply }: { picks: PickOne[]; onApply(add: string[], declined: string[]): void }) {
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  if (!picks.length) return null

  const id = (p: PickOne) => p.pick[0].key
  const choice = (p: PickOne) => picked[id(p)] ?? p.preselect ?? NONE
  const apply = () => {
    const add = picks.map(choice).filter((k) => k !== NONE)
    // The options not taken are answered too, so the same question does not come back without the chosen one.
    const declined = picks.flatMap((p) => p.pick.map((s) => s.key).filter((k) => k !== choice(p)))
    onApply(add, declined)
  }

  return (
    <section className="fill-profile">
      <div className="fill-head">
        <h2>Decide</h2>
        <span className="muted small">
          The list works as it is; everything here is optional. Where players of this list mostly take one option it is selected, otherwise
          nothing is added until you pick one. “Replaces …” means that mod changes the same character as one already in your list.
        </span>
      </div>
      <div className="fill-col" style={{ marginTop: 12 }}>
        {picks.map((p) => (
          <div key={id(p)} className="fill-row fill-pick">
            <div className="pick-head">Pick one <span className="muted">– {p.note}</span></div>
            {[...(expanded.has(id(p)) ? p.pick : p.pick.slice(0, PICK_SHOWN)).map((s) => ({ key: s.key, s })), { key: NONE, s: null }].map(({ key, s }) => (
              <label key={key} className="pick-option">
                <input type="radio" name={`pick-${id(p)}`} checked={choice(p) === key} onChange={() => setPicked((prev) => ({ ...prev, [id(p)]: key }))} />
                {s ? <span><SuggestionName s={s} /><span className="why">{s.reasons.join(' · ')}</span></span> : <span className="muted">None of these</span>}
              </label>
            ))}
            {p.pick.length > PICK_SHOWN && (
              <div className="more">
                <a onClick={() => setExpanded((prev) => new Set(prev.has(id(p)) ? [...prev].filter((x) => x !== id(p)) : [...prev, id(p)]))}>
                  {expanded.has(id(p)) ? 'Fewer options' : `${p.pick.length - PICK_SHOWN} more options`}
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="decide-actions">
        <button className="primary" onClick={apply}>Apply {picks.length === 1 ? 'this choice' : `these ${picks.length} choices`}</button>
        <span className="small muted">Anything a chosen mod needs is added too. You can change it later under “Browse all”.</span>
      </div>
    </section>
  )
}

/**
 * Step 1, "Add more": suggested lewd and general mods that fit, each with why it is suggested. All are
 * ticked (untick to leave one out); the list itself opens on request. Added mods leave the list.
 */
export function SuggestedMods({ lewd, general, character, total, browsing, onAdd, onBrowse }: {
  lewd: Suggestion[]; general: Suggestion[]; character: string; total: number; browsing: boolean
  onAdd(keys: string[]): void; onBrowse(): void
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(false)

  const visible = (id: string, list: Suggestion[]) => (expanded.has(id) ? list : list.slice(0, SHOWN))
  const chosen = (list: Suggestion[]) => list.filter((s) => !skipped.has(s.key)).map((s) => s.key)
  const toggle = (set: (f: (prev: Set<string>) => Set<string>) => void, key: string) => set((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const all = [...chosen(visible('lewd', lewd)), ...chosen(visible('general', general))]
  const count = lewd.length + general.length

  return (
    <section className="fill-profile">
      <div className="fill-head">
        <h2>Add more</h2>
        <span className="muted small">(optional)</span>
      </div>
      <p className="small muted">
        {count
          ? `${all.length} suggested mods that fit ${character} and that other players combine with this kind of campaign – add them all, some, or none. `
          : 'Nothing more to suggest. '}
        Everything else that works with this profile ({total}) is listed under “Browse all”, with a search.
      </p>
      <p>
        {count > 0 && <button className="primary" disabled={!all.length} onClick={() => onAdd(all)}>Add the {all.length} suggested</button>}{' '}
        {count > 0 && <button onClick={() => setOpen(!open)}>{open ? 'Hide suggestions' : 'Show suggestions'}</button>}{' '}
        <button onClick={onBrowse}>{browsing ? 'Hide the full list' : `Browse all ${total}`}</button>
      </p>
      {open && count > 0 && (
        <div className="fill-cols">
          {column('lewd', 'Lewd mods', lewd)}
          {column('general', 'General mods', general)}
        </div>
      )}
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
          <button disabled={!keys.length} onClick={() => onAdd(keys)}>Add {keys.length}</button>
        </h3>
        {shown.map((s) => (
          <label key={s.key} className="fill-row">
            <input type="checkbox" checked={!skipped.has(s.key)} onChange={() => toggle(setSkipped, s.key)} />
            <SuggestionName s={s} />
            <div className="why">{s.reasons.join(' · ')}</div>
          </label>
        ))}
        {list.length > SHOWN && (
          <div className="more">
            <a onClick={() => toggle(setExpanded, id)}>{expanded.has(id) ? 'Show fewer' : `Show ${list.length - SHOWN} more that fit`}</a>
          </div>
        )}
      </div>
    )
  }
}
