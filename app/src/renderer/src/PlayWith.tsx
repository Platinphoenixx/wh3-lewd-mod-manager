import { useMemo, useState } from 'react'
import type { CommunityFix, Mod } from '@catalog/schema'
import { playWith, playWithLine, searchMods, type PlayWithOption, type SubjectFacts } from '@shared/playwith'
import type { Subject, TierId } from '@shared/setups'
import { useData } from './data'
import { ModCover } from './ModCover'
import { SupportButton, creatorOfMod } from './Creators'

/** A mod the player starts from; with a community fix (its id) when the mod does not work as published. */
export interface Pin {
  mod: string
  fix?: string
}

/** A character or theme card (Play home, "Play with" page). */
export function SubjectCard({ s, extra, dim, rec, onClick }: { s: Subject; extra?: React.ReactNode; dim?: boolean; rec?: string; onClick?(): void }) {
  const data = useData()
  return (
    <div className={`play-card${dim ? ' dim' : ''}${rec ? ' best' : ''}`} onClick={dim ? undefined : onClick}>
      <div className="ph"><ModCover mods={s.coverMods.map((id) => data.index.mods.get(id))} placeholder={s.name} /></div>
      <div className="body">
        {rec && <div className="rec">{rec}</div>}
        <div className="name">{s.name}</div>
        {s.kind === 'theme' && <div className="small muted">{s.characters.slice(0, 4).join(', ')}{s.characters.length > 4 ? ' …' : ''}</div>}
        <div className="small muted">
          {s.presets.length} ready-made list{s.presets.length === 1 ? '' : 's'}
          {s.presets.some((p) => p.launchTest?.result === 'main menu') ? ' · launch-tested' : ''}
        </div>
        {extra}
      </div>
    </div>
  )
}

/** "Play with a mod…": a search over the catalog by name or link; each result says what the player gets with it. */
export function ModSearch({ facts, onFocus, onPick }: { facts: SubjectFacts[] | null; onFocus(): void; onPick(id: string): void }) {
  const data = useData()
  const [q, setQ] = useState('')
  const results = useMemo(() => searchMods(data.catalog, q), [data.catalog, q])
  const count = data.catalog.mods.filter((m) => m.kind !== 'collection' && m.kind !== 'translation').length
  return (
    <div className="play-with">
      <div className="play-with-bar">
        <span className="label">Play with a mod…</span>
        <input
          value={q} onFocus={onFocus} onChange={(e) => { setQ(e.target.value); if (!facts) onFocus() }}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) onPick(results[0].id); if (e.key === 'Escape') setQ('') }}
          placeholder="Name of a mod, or paste its Steam / LoversLab / Nexus link"
        />
        <span className="small muted">{count} mods</span>
      </div>
      {q.trim() && (
        <div className="play-with-results">
          {results.map((m) => {
            const line = facts ? playWithLine(playWith(data.catalog, data.index, facts, m)) : null
            return (
              <div key={m.id} className="res" onClick={() => onPick(m.id)}>
                <div className="ph"><ModCover mods={[m]} placeholder={m.name} /></div>
                <div className="txt">
                  <div className="n">{m.name}</div>
                  <div className={`w ${line?.tone ?? ''}`}>{line?.text ?? 'Looking for setups…'}</div>
                </div>
              </div>
            )
          })}
          {!results.length && <div className="res muted">No mod of that name in the catalog. <a onClick={() => data.contribute({ type: 'new-mod', prefill: { name: q.trim() } })}>Suggest it</a></div>}
        </div>
      )}
    </div>
  )
}

const FROM: Record<TierId, string> = {
  essentials: 'every size from Essentials', full: 'Full campaign and larger', extended: 'Extended and Everything', everything: 'Everything'
}

/** Where a mod stands: the setups it is in or fits, or why it is not offered (with fixes players shared). */
export function PlayWithPage({ modId, facts, onBack, onStart, onOpen }: {
  modId: string; facts: SubjectFacts[]; onBack(): void; onStart(subjectKey: string, pin?: Pin): void; onOpen(modId: string): void
}) {
  const data = useData()
  const mod = data.index.mods.get(modId)!
  const pw = useMemo(() => playWith(data.catalog, data.index, facts, mod), [data.catalog, data.index, facts, mod])
  const usable = pw.options.filter((o) => !o.conflicts.length)
  const subjectsBy = (how: PlayWithOption['how']) => new Set(usable.filter((o) => o.how === how).map((o) => o.subject.key)).size
  const role = usable.find((o) => o.role)?.role
  const best = usable[0]
  const creator = creatorOfMod(data, mod)

  const answer = pw.blocked === 'stops-game' ? null
    : pw.blocked === 'outdated' ? null
    : subjectsBy('in') ? `It is in the setups of ${subjectsBy('in')} ${subjectsBy('in') === 1 ? 'character' : 'characters'}. Who do you want to play?`
    : subjectsBy('fits') ? `No setup has it yet, but it fits${role ? ` as ${role}` : ` ${subjectsBy('fits')} of them`}. Which setup do you want it in?`
    : usable.length ? 'No setup has it yet. Which setup do you want it in?'
    : 'It does not work with any of the setups.'
  const where = (o: PlayWithOption) => {
    if (o.conflicts.length) return <div className="where no">Does not work with {o.conflicts.slice(0, 2).join(', ')}{o.conflicts.length > 2 ? ' …' : ''}</div>
    if (pw.blocked) return <div className="where no">Without it</div>
    if (o.how === 'in') return <div className="where">✓ In {FROM[o.from!]}</div>
    const who = o.role?.replace(/'s look$/, '')
    if (o.how === 'fits') return <div className="where add">{o.role ? `${o.role}, ${o.own ? `playing ${who}` : `when you meet ${who}`}` : 'Offered as an add-on'}</div>
    return <div className="where add">Added to the full campaign with what it needs</div>
  }

  return (
    <div className="content play">
      <div className="play-crumbs"><a onClick={onBack}>Play</a> › Play with {mod.name}</div>
      <div className="play-hero">
        <div className="ph"><ModCover mods={[mod]} placeholder={mod.name} /></div>
        <div>
          <div className="play-head">
            <h2>{mod.name}</h2>
            <a className="play-advanced" onClick={() => data.openMod(mod.id)}>Details</a>
          </div>
          {creator && <div className="play-by">by {creator.name} <SupportButton c={creator} /></div>}
          <p className="play-lead">{mod.summary}</p>
          {answer && <div className={`play-answer${usable.length ? ' ok' : ' warn'}`}>{answer}</div>}
          {!pw.blocked && pw.options.some((o) => o.how === 'add' && !o.conflicts.length) && !subjectsBy('in') && (
            <div className="small muted">It loads above the setup's own mods of the same kind, so it shows in the game.</div>
          )}
          {pw.blocked === 'outdated' && (
            <>
              <div className="play-answer warn">This mod is outdated{pw.successor ? `; ${pw.successor.name} replaces it` : ''}.</div>
              {pw.successor && <div className="play-foot"><button className="primary" onClick={() => onOpen(pw.successor!.id)}>Play with {pw.successor.name} instead →</button></div>}
            </>
          )}
          {pw.blocked === 'stops-game' && pw.blockedBy && pw.blockedBy !== mod && (
            <>
              <div className="play-answer warn">It needs {pw.blockedBy.name}, which the game does not start with since the last big game update.</div>
              <div className="play-foot"><button onClick={() => onOpen(pw.blockedBy!.id)}>About {pw.blockedBy.name} →</button></div>
            </>
          )}
          {pw.blocked === 'stops-game' && pw.blockedBy === mod && <Blocked mod={mod} onUseFix={(fix) => best && onStart(best.subject.key, { mod: mod.id, fix: fix.id })} withFixFor={best?.subject.name} />}
        </div>
      </div>
      {pw.blocked === 'stops-game' && usable.length > 0 && <h3 className="play-section">{pw.characters.join(', ') || 'The setups'} without it</h3>}
      <div className="play-grid">
        {pw.options.map((o) => (
          <SubjectCard
            key={o.subject.key} s={o.subject} extra={where(o)} dim={!!o.conflicts.length}
            rec={o === best && o.own && !pw.blocked ? 'Recommended' : undefined}
            onClick={() => onStart(o.subject.key, pw.blocked ? undefined : { mod: mod.id })}
          />
        ))}
      </div>
    </div>
  )
}

/** The game does not start with the mod as published: why, the fixes players shared, and a way to share one. */
function Blocked({ mod, onUseFix, withFixFor }: { mod: Mod; onUseFix(f: CommunityFix): void; withFixFor?: string }) {
  const data = useData()
  const fixes = mod.fixes ?? []
  return (
    <>
      <div className="play-answer warn">{fixes.length ? 'The published version does not start since the last big game update – players found a fix.' : 'The game does not start with it since the last big game update.'}</div>
      <p className="small muted">{mod.stopsGame}</p>
      {fixes.map((f) => (
        <div key={f.id} className="play-fix found">
          <b>Fix from the community</b> · shared {f.date}{f.far ? ` · ${f.far.toLowerCase()}` : ''}{f.game ? ` · game ${f.game}` : ''} · checked by a maintainer
          <div className="links">{f.links.map((u) => <a key={u} onClick={() => window.api.openExternal(u)}>{u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 90)}</a>)}</div>
          <div>{f.steps}</div>
          {f.votes && <div className="small muted">▲ {f.votes.up} players say it worked · ▼ {f.votes.down}</div>}
          {withFixFor && <div className="play-foot"><button className="primary" onClick={() => onUseFix(f)}>Play {withFixFor} with it, using this fix →</button></div>}
        </div>
      ))}
      <div className="play-fix">
        <b>Got it working?</b> If you play it with a fix or a patched version, share the link – a maintainer checks it, and then everyone gets it offered here.
        <button onClick={() => data.contribute({ type: 'fix', modId: mod.id })}>{fixes.length ? 'Share another fix…' : 'Share a fix…'}</button>
      </div>
    </>
  )
}
