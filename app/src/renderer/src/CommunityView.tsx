import { useEffect, useState } from 'react'
import type { Preset } from '@catalog/schema'
import { CONTRIBUTION_LABEL, type Contribution, type ContributionStatus, type SharedRecord } from '@shared/community'
import { nameOf } from '@shared/profile'
import { useData } from './data'

const RULE_TEXT: Record<string, string> = {
  requires: 'requires', incompatible: 'is incompatible with', recommends: 'works well with', optional: 'optional for',
  loadAbove: 'loads above', loadBelow: 'loads below', supersedes: 'replaces', extends: 'extends'
}

const REASON: Record<string, string> = { start: 'it did not start', campaign: 'a crash in the campaign', content: 'content missing or broken', other: 'something else' }

export function CommunityView() {
  const data = useData()
  const [sent, setSent] = useState<Contribution[]>([])
  const [shared, setShared] = useState<SharedRecord[]>([])
  const [statuses, setStatuses] = useState<Record<string, ContributionStatus>>({})
  const [flagged, setFlagged] = useState<{ rule: string; at: string }[]>([])
  const [editing, setEditing] = useState<SharedRecord | null>(null)
  useEffect(() => {
    window.api.listContributions().then((list) => {
      setSent(list)
      const urls = list.flatMap((c) => (c.url ? [c.url] : []))
      if (urls.length) window.api.contributionStatus(urls).then(setStatuses, () => {})
    })
    window.api.listShared().then(setShared, () => {})
    // Rules flagged from any profile (one entry per rule, the first time it was flagged).
    window.api.listProfiles().then((ps) => {
      const all = new Map<string, string>()
      for (const p of ps) for (const [rule, at] of Object.entries(p.flagged ?? {})) if (!all.has(rule) || at < all.get(rule)!) all.set(rule, at)
      setFlagged([...all].map(([rule, at]) => ({ rule, at })))
    }, () => {})
  }, [])
  const statusText = (c: Contribution) => {
    const st = c.url ? statuses[c.url] : undefined
    if (!st) return c.sentAs === 'relay' ? 'sent' : c.sentAs === 'issue' ? 'GitHub issue' : 'copied'
    return st.state === 'added' ? 'in the catalog now' : st.state === 'not-added' ? `not added${st.reason ? `: ${st.reason}` : ''}` : 'waiting for a maintainer'
  }
  const flagText = (rule: string) => {
    const f = data.catalog.ruleFlags?.[rule]
    if (f?.decision === 'retired') return f.by === 'players' ? 'rule retired – enough players agreed' : 'rule retired after the flags'
    if (f?.decision === 'changed') return `rule changed${f.answer ? `: ${f.answer}` : ''}`
    if (f?.decision === 'kept') return `checked, the rule stays${f.answer ? `: ${f.answer}` : ''}`
    return f?.flags ? `waiting – ${f.flags} players flagged it` : 'waiting'
  }

  return (
    <div className="content community">
      <section>
        <h2>Help improve the catalog</h2>
        <p>
          The catalog is curated from LoversLab, the Discord and the Lewdhammer wiki. You can add what is missing: suggest mods with their
          sources, report how a mod works for you, and add rules (requires, incompatible, load order). Contributions go to the catalog's
          GitHub repository as issues and end up in the next catalog update.
        </p>
        <p className="small muted">
          {data.contribRepo ? `Contributions go to github.com/${data.contribRepo}.` : 'No contribution repository is configured yet; contributions are copied to the clipboard.'}
          {' '}Open a mod for feedback, rules and corrections.
        </p>
        <button className="primary" onClick={() => data.contribute({ type: 'new-mod' })}>Suggest a new mod</button>
      </section>

      <section>
        <h2>My rules ({data.rules.length})</h2>
        <p className="small muted">Your own rules apply in this app immediately: profile options and load orders respect them.</p>
        {data.rules.length === 0 ? <p className="muted">None yet. Open a mod and use “Suggest a rule”.</p> : (
          <ul>
            {data.rules.map((r) => (
              <li key={r.id}>
                <a onClick={() => data.openMod(r.modId)}>{data.index.mods.get(r.modId)?.name ?? r.modId}</a> {RULE_TEXT[r.kind] ?? r.kind}{' '}
                {nameOf(data.catalog, data.index, r.other)}
                {r.note && <span className="muted small"> – {r.note}</span>}{' '}
                <button className="link" onClick={() => data.saveRules(data.rules.filter((x) => x.id !== r.id))}>remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="your-setups">
        <h2>Your shared setups ({shared.length})</h2>
        <p className="small muted">What players say about the lists you shared. Counted once a day; nobody sees who voted.</p>
        {shared.length === 0 ? <p className="muted">None yet. Played a list that works? Share it from Play (“Share your setup”) or from a profile (Share…).</p> : (
          <table className="play-comm">
            <tbody>
              {[...shared].reverse().map((s) => {
                const p = data.catalog.presets.find((x) => x.id === `community-${s.id}`)
                return (
                  <tr key={s.id}>
                    <td>
                      <b>{p?.name ?? s.name}</b>
                      <div className="small muted">{sharedState(s, p)}</div>
                      {p && <div className="small">{sharedStats(p)}</div>}
                    </td>
                    <td className="votes">
                      <div><button onClick={() => setEditing(s)}>Edit your notes…</button></div>
                      {p && <div style={{ marginTop: 6 }}><a onClick={() => data.openProfile({ preset: p.id })}>Open in the editor</a></div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section id="your-contributions">
        <h2>Sent contributions ({sent.length + flagged.length})</h2>
        <ul className="small">
          {[...sent].reverse().map((c) => (
            <li key={c.id}>
              <span className="badge">{CONTRIBUTION_LABEL[c.type]}</span> {c.title} <span className="muted">· {c.createdAt.slice(0, 10)} · {statusText(c)}</span>
            </li>
          ))}
          {flagged.map((f) => (
            <li key={f.rule}>
              <span className="badge">Flag</span> {ruleTitle(f.rule, data)} <span className="muted">· {f.at.slice(0, 10)} · {flagText(f.rule)}</span>
            </li>
          ))}
        </ul>
      </section>
      {editing && <EditSetupDialog setup={editing} onClose={() => setEditing(null)} onSaved={(s) => {
        const next = shared.map((x) => (x.id === s.id ? s : x))
        setShared(next)
        void window.api.saveShared(next)
      }} />}
    </div>
  )
}

/** "Shared 2026-11-17 · shown in Play · not reviewed yet" */
function sharedState(s: SharedRecord, p?: Preset): string {
  const days = (Date.now() - Date.parse(s.at)) / 86400000
  return [
    `Shared ${s.at.slice(0, 10)}`,
    p ? 'shown in Play' : days < 3 ? 'appears in Play within a day' : 'not shown in Play (a maintainer took it out, or the daily update has not run)',
    p?.community?.reviewed === false ? 'not reviewed yet' : '',
    p?.community?.corrected ? 'a maintainer corrected its name or character' : ''
  ].filter(Boolean).join(' · ')
}

/** "▲ 14 worked · ▼ 1 didn't (it did not start) · 23 players use it" */
function sharedStats(p: Preset): string {
  const v = p.votes
  const why = Object.entries(v?.reasons ?? {}).map(([k, n]) => `${n > 1 ? `${n}× ` : ''}${REASON[k] ?? k}`).join(', ')
  return [
    v ? `▲ ${v.up} worked` : 'no votes yet',
    v?.down ? `▼ ${v.down} didn't${why ? ` (${why})` : ''}` : '',
    p.uses ? `${p.uses} ${p.uses === 1 ? 'player uses' : 'players use'} it` : ''
  ].filter(Boolean).join(' · ')
}

/** A flagged rule in words: "conflict|mod:a|mod:b" → "A and B do not go together" (names from the catalog). */
function ruleTitle(rule: string, data: ReturnType<typeof useData>): string {
  const [kind, ...keys] = rule.split('|')
  const name = (k: string) => (k.startsWith('mod:') ? data.index.mods.get(k.slice(4))?.name ?? k.slice(4) : k)
  if (kind === 'conflict') return `${name(keys[0])} and ${name(keys[1])} do not go together`
  if (kind === 'requires') return `${name(keys[0])} needs ${name(keys[1])}`
  if (kind === 'load') return `${name(keys[0])} loads above ${name(keys[1])}`
  if (kind === 'outdated') return `${name(keys[0])} is replaced by ${name(keys[1])}`
  if (kind === 'stops') return `${name(keys[0])} does not start`
  if (kind === 'old') return `${name(keys[0])} is older than the last big game update`
  if (kind === 'looks') return `${name(keys[0])} changes ${keys[1]}'s look by stage`
  if (kind === 'avoid') return `${name(keys[1])} is avoided in a setup`
  return rule
}

/** Changes the words of a setup this install shared; the relay accepts it only from this install. */
function EditSetupDialog({ setup, onClose, onSaved }: { setup: SharedRecord; onClose(): void; onSaved(s: SharedRecord): void }) {
  const [name, setName] = useState(setup.name)
  const [shownAs, setShownAs] = useState(setup.shownAs ?? '')
  const [far, setFar] = useState(setup.far ?? '')
  const [notes, setNotes] = useState(setup.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    const s = { ...setup, name: name.trim(), shownAs: shownAs.trim() || undefined, far: far.trim() || undefined, notes: notes.trim() || undefined }
    const r = await window.api.editSetup({ id: s.id, name: s.name, shownAs: s.shownAs, far: s.far, notes: s.notes })
    setBusy(false)
    setDone(r.message)
    if (r.ok) onSaved(s)
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <h2>Edit your shared setup</h2>
        {done ? (
          <>
            <p>{done}</p>
            <div className="form-actions"><button className="primary" onClick={onClose}>Close</button></div>
          </>
        ) : (
          <div className="form">
            <p className="small muted">The mod list stays as you shared it; to share a changed list, share it again.</p>
            <label>Name<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
            <label>Shown as<input value={shownAs} maxLength={40} placeholder="Anonymous (or a nickname)" onChange={(e) => setShownAs(e.target.value)} /></label>
            <label>How far did you play?<input value={far} maxLength={120} placeholder="e.g. turn 160, corruption stage 7" onChange={(e) => setFar(e.target.value)} /></label>
            <label>Notes for players<textarea rows={4} value={notes} maxLength={1000} placeholder="What it is good for, what you changed and why (no links)" onChange={(e) => setNotes(e.target.value)} /></label>
            <div className="form-actions">
              <button className="primary" disabled={!name.trim() || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
