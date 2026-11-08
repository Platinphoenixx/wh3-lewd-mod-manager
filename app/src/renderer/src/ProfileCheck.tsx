import { useState } from 'react'
import { CHECK_LABEL, type CheckAction, type CheckPoint } from '@shared/check'
import { parseTargetKey } from '@shared/match'
import { ideaGroups, type SuggestionEntry } from '@shared/suggest'
import { KIND_LABEL, useData } from './data'
import { ModCover, withParents } from './ModCover'
import { FlagLink } from './FlagDialog'
import { untilLabel } from './Suggestions'

/**
 * Check tab of an imported list: what the catalog would warn about, with its reasons. The list runs for the player, so
 * these are hints: change something, keep it as it is, or flag the rule as wrong.
 */
export function ProfileCheck({ points, kept, flagged, onAction, onKeep, onShowAgain, onFlag, onUnflag }: {
  points: CheckPoint[]; kept: string[]; flagged?: Record<string, string>
  onAction(a: CheckAction): void; onKeep(rule: string): void; onShowAgain(rule: string): void; onFlag(p: CheckPoint): void; onUnflag(rule: string): void
}) {
  const data = useData()
  const isKept = (p: CheckPoint) => kept.includes(p.rule)
  const cover = (p: CheckPoint) => p.keys.flatMap((k) => {
    const t = parseTargetKey(k)
    const m = 'mod' in t ? data.index.mods.get(t.mod) : undefined
    return m ? withParents(data.index.mods, m) : []
  })
  const sorted = [...points].sort((a, b) => Number(isKept(a)) - Number(isKept(b)))
  return (
    <section>
      <p className="callout small">
        This list works for you, so it stays as it is. These are the things the catalog would warn about, with its reasons. Change what you like; <strong>Keep as it is</strong> hides
        a point for this profile. If the app has it wrong, <strong>Flag as wrong</strong> tells the maintainers why, and other players see that it is disputed.
      </p>
      {!points.length && <p className="muted">The catalog has nothing to say about this list.</p>}
      {sorted.map((p) => (
        <article key={p.rule} className={`doubt ${isKept(p) ? 'kept' : ''}`}>
          <div className="doubt-thumb"><ModCover mods={cover(p)} placeholder={CHECK_LABEL[p.kind]} /></div>
          <div>
            <div className={`doubt-kind ${p.info ? 'info' : ''}`}>
              {CHECK_LABEL[p.kind]}
              {isKept(p) && <span className="doubt-state"> · kept, it works for you</span>}
              {flagged?.[p.rule] && <span className="doubt-state flagged"> · you flagged this {flagged[p.rule]}</span>}
            </div>
            <strong>{p.title}</strong>
            <div className="doubt-why">{p.why}</div>
            <div className="small muted">
              {p.sourceUrl ? <a onClick={() => window.api.openExternal(p.sourceUrl!)}>{p.source}</a> : p.source}
            </div>
            {flagged?.[p.rule] && <div className="doubt-status">Nothing changes for other players until a maintainer has looked at it.</div>}
            {p.status && <div className="doubt-status">{p.status}</div>}
          </div>
          <div className="doubt-acts">
            {isKept(p) ? <button onClick={() => onShowAgain(p.rule)}>Show again</button> : (
              <>
                {p.actions.map((a) => <button key={a.type + a.key} className={a.primary ? 'primary' : ''} onClick={() => onAction(a)}>{a.label}</button>)}
                <button onClick={() => onKeep(p.rule)}>Keep as it is</button>
              </>
            )}
            <FlagLink rule={p.rule} flagged={flagged} onFlag={() => onFlag(p)} onUnflag={() => onUnflag(p.rule)} />
          </div>
        </article>
      ))}
    </section>
  )
}

const SHOWN = 12

/** Ideas tab of an imported list: what fits the mods it already has. Nothing is added until the player picks it. */
export function ProfileIdeas({ entries, declined, onAdd }: { entries: SuggestionEntry[]; declined: Set<string>; onAdd(keys: string[]): void }) {
  const data = useData()
  const [picked, setPicked] = useState<Map<string, string | undefined>>(new Map())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const groups = ideaGroups(entries, declined)
  const toggle = (key: string, pickOf?: string) => setPicked((prev) => {
    const next = new Map(prev)
    if (next.has(key)) next.delete(key)
    else {
      // Options of one choice exclude each other.
      if (pickOf) for (const [k, g] of next) if (g === pickOf) next.delete(k)
      next.set(key, pickOf)
    }
    return next
  })
  const n = picked.size
  return (
    <section>
      <p className="callout small">Things that fit the mods you already have. Nothing is added until you pick it, and each idea says why it fits.</p>
      {!groups.length && <p className="muted">No ideas for this list right now.</p>}
      {groups.map((g) => (
        <div key={g.id}>
          <h3>{g.title}</h3>
          <p className="small muted">{g.hint}</p>
          <div className="ideas">
            {(open.has(g.id) ? g.ideas : g.ideas.slice(0, SHOWN)).map(({ s, pickOf, note }) => (
              <article key={s.key} className={`idea ${picked.has(s.key) ? 'on' : ''}`}>
                <div className="idea-cover" onClick={() => data.openMod(s.mod.id)}><ModCover mods={withParents(data.index.mods, s.mod)} placeholder={KIND_LABEL[s.mod.kind]} /></div>
                <div className="idea-body">
                  <strong><a className="plain" onClick={() => data.openMod(s.mod.id)}>{s.mod.name}</a></strong>
                  {s.until && <div className="small warn-text">{untilLabel(s.until)}</div>}
                  {note && <div className="small warn-text">Pick one: {note}</div>}
                  <div className="small muted">{s.reasons.join(' · ')}</div>
                  <button className={picked.has(s.key) ? 'primary' : ''} onClick={() => toggle(s.key, pickOf)}>{picked.has(s.key) ? '✓ Added' : 'Add'}</button>
                </div>
              </article>
            ))}
          </div>
          {g.ideas.length > SHOWN && !open.has(g.id) && <p><a onClick={() => setOpen((o) => new Set([...o, g.id]))}>Show {g.ideas.length - SHOWN} more</a></p>}
        </div>
      ))}
      {groups.length > 0 && (
        <div className="step-next ideas-foot">
          <button className="primary" disabled={!n} onClick={() => { onAdd([...picked.keys()]); setPicked(new Map()) }}>Add the {n} you picked</button>
          <span className="small muted">They go to the Install step; your load order stays, new mods are placed by the catalog's rules.</span>
        </div>
      )}
    </section>
  )
}
