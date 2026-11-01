import { useState } from 'react'
import { isPickOne, type Suggestion, type SuggestionEntry } from '@shared/suggest'
import { useData } from './data'

const SHOWN = 10
const PICK_SHOWN = 5
const NONE = '-'

/**
 * "Fill this profile": suggested lewd and general mods, each with why it is suggested. Single mods are
 * ticked (untick to leave one out); mods that exclude each other come as one "pick one" choice with the
 * most used one selected. Added mods leave the list (they are in the profile then).
 */
export function FillProfile({ lewd, general, character, onAdd }: {
  lewd: SuggestionEntry[]; general: SuggestionEntry[]; character: string; onAdd(keys: string[]): void
}) {
  const data = useData()
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  if (!lewd.length && !general.length) return null

  const groupId = (e: SuggestionEntry) => (isPickOne(e) ? e.pick[0].key : e.key)
  const visible = (id: string, list: SuggestionEntry[]) => (expanded.has(id) ? list : list.slice(0, SHOWN))
  const chosen = (list: SuggestionEntry[]) => list.flatMap((e) => {
    if (!isPickOne(e)) return skipped.has(e.key) ? [] : [e.key]
    const p = picked[groupId(e)] ?? e.pick[0].key
    return p === NONE ? [] : [p]
  })
  const toggle = (set: (f: (prev: Set<string>) => Set<string>) => void, key: string) => set((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const all = [...chosen(visible('lewd', lewd)), ...chosen(visible('general', general))]
  const name = (s: Suggestion) => (
    <a className="plain" title={s.mod.summary} onClick={(e) => { e.preventDefault(); data.openMod(s.mod.id) }}>{s.mod.name}</a>
  )

  return (
    <section className="fill-profile">
      <div className="fill-head">
        <h2>Fill this profile</h2>
        <span className="muted small">
          Mods that fit {character} and that other players combine with this kind of campaign. All work with what is already in the
          profile; anything they need is added too. Where only one of several can be used, pick one.
        </span>
        <button className="primary" disabled={!all.length} onClick={() => onAdd(all)}>Add all {all.length}</button>
      </div>
      <div className="fill-cols">
        {column('lewd', 'Lewd mods', lewd)}
        {column('general', 'General mods', general)}
      </div>
    </section>
  )

  function column(id: string, title: string, list: SuggestionEntry[]) {
    if (!list.length) return <div className="fill-col"><h3>{title}</h3><p className="small muted">Nothing more to suggest.</p></div>
    const shown = visible(id, list)
    const keys = chosen(shown)
    return (
      <div className="fill-col">
        <h3>
          {title} <span className="muted">{list.length} suggested</span>
          <button disabled={!keys.length} onClick={() => onAdd(keys)}>Add {keys.length}</button>
        </h3>
        {shown.map((e) => isPickOne(e) ? (
          <div key={groupId(e)} className="fill-row fill-pick">
            <div className="pick-head">Pick one <span className="muted">– {e.note}</span></div>
            {[...(expanded.has(groupId(e)) ? e.pick : e.pick.slice(0, PICK_SHOWN)).map((s) => ({ key: s.key, s })), { key: NONE, s: null }].map(({ key, s }) => (
              <label key={key} className="pick-option">
                <input
                  type="radio"
                  name={`pick-${groupId(e)}`}
                  checked={(picked[groupId(e)] ?? e.pick[0].key) === key}
                  onChange={() => setPicked((prev) => ({ ...prev, [groupId(e)]: key }))}
                />
                {s ? <span>{name(s)}<span className="why">{s.reasons.join(' · ')}</span></span> : <span className="muted">None of these</span>}
              </label>
            ))}
            {e.pick.length > PICK_SHOWN && (
              <div className="more"><a onClick={() => toggle(setExpanded, groupId(e))}>{expanded.has(groupId(e)) ? 'Fewer options' : `${e.pick.length - PICK_SHOWN} more options`}</a></div>
            )}
          </div>
        ) : (
          <label key={e.key} className="fill-row">
            <input type="checkbox" checked={!skipped.has(e.key)} onChange={() => toggle(setSkipped, e.key)} />
            {name(e)}
            <div className="why">{e.reasons.join(' · ')}</div>
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
