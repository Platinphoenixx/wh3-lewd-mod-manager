import { useEffect, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import type { FlagDecision, ReviewItem } from '@shared/api'
import { useData } from './data'

const KIND: Record<string, string> = { flag: 'Rule flagged', setup: 'Shared setup', fix: 'Fix for a mod', 'new-mod': 'New mod', feedback: 'Feedback', rule: 'Rule', correction: 'Correction' }
const REASONS = [
  'Own mods other players cannot get',
  'Duplicate of an existing setup or entry',
  'Broken or incomplete list',
  'Inappropriate name or notes',
  'Not about a Total War: Warhammer III mod'
]

interface SharedList {
  base?: string; playAs?: string[]; shownAs?: string; far?: string; notes?: string; game?: string
  own?: string[]; entries?: { pack: string; mod?: string; steamId?: string }[]
}

interface FlagReport { why: string; text: string; link?: string; far?: string; game?: string; order?: string }
const FLAG_WHY: Record<string, string> = { works: 'They work together', outdated: 'It is out of date', reason: 'The reason or source is wrong', other: 'Something else' }

/** The ```json block the app puts into every issue it creates (type, ids, and for a setup the whole list). */
function block(body: string): { setup?: SharedList; title?: string; says?: string; source?: string; reports?: FlagReport[] } | null {
  const m = /```json\s*(\{[\s\S]*?\})\s*```/.exec(body)
  try { return m ? JSON.parse(m[1]) : null } catch { return null }
}

const norm = (s: string) => s.toLowerCase().replace(/\.pack$/, '').replace(/[^a-z0-9]/g, '')

/**
 * Review (maintainers only): open GitHub issues from the app – shared setups with packs the catalog does not know, and
 * contributions. Accept labels the issue "accepted" (the repository's workflow puts it into the catalog); Reject
 * closes it with the reason as a comment.
 */
export function ReviewView({ onCount }: { onCount(n: number): void }) {
  const data = useData()
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<{ decision: 'change' | 'keep'; text: string } | null>(null)

  const load = () => window.api.reviewList().then((l) => { setItems(l); setError(null); onCount(l.length); setOpen((o) => o ?? l[0]?.number ?? null) },
    (e) => setError(String((e as Error).message ?? e)))
  useEffect(() => { void load() }, [])

  const item = items?.find((i) => i.number === open)
  const run = async (act: () => Promise<void>, done: string) => {
    if (!item) return
    setBusy(true)
    try {
      await act()
      data.notify({ kind: 'done', text: done })
      const rest = items!.filter((i) => i.number !== item.number)
      setItems(rest)
      onCount(rest.length)
      setOpen(rest[0]?.number ?? null)
      setReason('')
      setOther('')
      setAnswer(null)
    } catch (e) {
      data.notify({ kind: 'error', text: (e as Error).message })
    }
    setBusy(false)
  }
  const decide = (accepting: boolean) => {
    if (!item) return
    void run(
      () => (accepting ? window.api.reviewAccept(item.number) : window.api.reviewReject(item.number, reason === 'other' ? other.trim() : reason)),
      accepting ? `Accepted #${item.number} – it is in the catalog in a few minutes.` : `Rejected #${item.number}.`
    )
  }
  const decideFlag = (decision: FlagDecision, text?: string) => {
    if (!item) return
    void run(() => window.api.reviewFlag(item.number, decision, text), `Decided #${item.number} – it is in the catalog in a few minutes.`)
  }

  return (
    <div className="split review">
      <div className="sidebar-list">
        <h4>Waiting for you{items ? ` · ${items.length}` : ''}</h4>
        {error && <p className="small warn-text pad">{error}</p>}
        {!items && !error && <p className="small muted pad">Loading from GitHub…</p>}
        {items?.length === 0 && <p className="small muted pad">Nothing waits for a decision.</p>}
        <ul>
          {items?.map((i) => (
            <li key={i.number} className={i.number === open ? 'active' : ''} onClick={() => setOpen(i.number)}>
              <div>
                <div className="review-kind">{KIND[i.kind] ?? i.kind}</div>
                <strong>{i.title.replace(/^(Setup|Flag): /, '')}</strong>
                <div className="small muted">#{i.number} · {i.created.slice(0, 10)}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="small muted pad"><a onClick={() => void load()}>Refresh</a> · open GitHub issues of the catalog repository</p>
      </div>
      <div className="content">
        {item && (
          <>
            <div className="small muted">{KIND[item.kind] ?? item.kind} · issue #{item.number} · {item.created.slice(0, 10)} · <a onClick={() => window.api.openExternal(item.url)}>open on GitHub</a></div>
            <h2>{item.title.replace(/^(Setup|Flag): /, '')}</h2>
            {item.kind === 'flag' && <FlagDetails item={block(item.body)} />}
            {item.kind === 'setup' && block(item.body)?.setup && <SetupDetails list={block(item.body)!.setup!} />}
            {item.kind !== 'flag' && !(item.kind === 'setup' && block(item.body)?.setup) && (
              <div className="markdown"><Markdown>{item.body.replace(/```json[\s\S]*?```/, '')}</Markdown></div>
            )}
            {item.kind === 'flag' && (
              <div className="review-flag">
                <div><button className="primary" disabled={busy} onClick={() => decideFlag('retire')}>Retire the rule</button><span className="small muted">It goes out of the catalog with the next build, for everyone.</span></div>
                <div><button disabled={busy} onClick={() => setAnswer({ decision: 'change', text: '' })}>Change the text…</button><span className="small muted">The rule stays, with a new reason.</span></div>
                <div><button disabled={busy} onClick={() => setAnswer({ decision: 'keep', text: '' })}>Keep the rule, say why…</button><span className="small muted">Players see your answer on this point instead of the flag count.</span></div>
                <div><button disabled={busy} onClick={() => void run(() => window.api.reviewReject(item.number, 'Not a real report'), `Closed #${item.number}.`)}>Close, not a real report</button></div>
                {answer && (
                  <div className="form">
                    <label>{answer.decision === 'change' ? 'The new reason, shown to players' : 'Why the rule stays, shown to players'}
                      <textarea rows={3} value={answer.text} onChange={(e) => setAnswer({ ...answer, text: e.target.value })} />
                    </label>
                    <div className="form-actions">
                      <button className="primary" disabled={busy || !answer.text.trim()} onClick={() => decideFlag(answer.decision, answer.text)}>Save the decision</button>
                      <button onClick={() => setAnswer(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {item.kind !== 'flag' && <div className="review-decide">
              <button className="primary" disabled={busy} onClick={() => void decide(true)}>Accept – {item.kind === 'setup' ? 'show it in the app' : item.kind === 'fix' ? 'offer the fix in the app' : 'add it to the catalog'}</button>
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Reject because…</option>
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                <option value="other">Other (write a reason)</option>
              </select>
              {reason === 'other' && <input value={other} placeholder="Reason, shown on GitHub" onChange={(e) => setOther(e.target.value)} />}
              <button disabled={busy || !reason || (reason === 'other' && !other.trim())} onClick={() => void decide(false)}>Reject</button>
              <span className="small muted">Accept adds the label “accepted”: the repository's workflow puts it into the catalog. Reject closes the issue with the reason as a comment.</span>
            </div>}
          </>
        )}
      </div>
    </div>
  )
}

/** A flagged rule: what the catalog says and everything players wrote about it. */
function FlagDetails({ item }: { item: ReturnType<typeof block> }) {
  if (!item) return <p className="warn-text">This issue has no readable data.</p>
  return (
    <>
      <div className="flag-says">
        <strong>What the catalog says:</strong> {item.says}
        <div className="small muted">{item.source}</div>
      </div>
      <h4>Players · {item.reports?.length ?? 0}</h4>
      {item.reports?.map((r, i) => (
        <div key={i} className="flag-report">
          {r.text}{r.link && <> <a onClick={() => window.api.openExternal(r.link!)}>{r.link}</a></>}
          <div className="small muted">{[FLAG_WHY[r.why] ?? r.why, r.far, r.game && `game ${r.game}`, r.order].filter(Boolean).join(' · ')}</div>
        </div>
      ))}
    </>
  )
}

/** A shared setup against the catalog: what it builds on, the packs nobody knows (with a guess), the list as played. */
function SetupDetails({ list }: { list: SharedList }) {
  const data = useData()
  const base = data.catalog.presets.find((p) => p.id === list.base)
  const baseIds = new Set(base?.entries.map((e) => (e.target ? Object.values(e.target)[0] : e.pack)) ?? [])
  const name = (id?: string) => (id && (data.index.mods.get(id)?.name ?? data.catalog.external.find((x) => x.id === id)?.name)) || undefined
  const entries = list.entries ?? []
  const unknown = [...(list.own ?? []).map((p) => ({ pack: p, own: true })), ...entries.filter((e) => !name(e.mod)).map((e) => ({ pack: e.pack, own: false }))]
  // A pack nobody knows that starts like a known one is often a new upload or variant of that mod.
  const packs = useMemo(() => data.catalog.mods.flatMap((m) => m.packs.map((p) => ({ key: norm(p.file), mod: m.name }))), [data.catalog])
  const guess = (pack: string) => {
    const k = norm(pack)
    const hit = packs.find((p) => p.key !== k && k.length >= 8 && p.key.slice(0, 12) === k.slice(0, 12))
    return hit ? `starts like a pack of ${hit.mod} – maybe a new upload or variant` : undefined
  }
  const added = new Set(entries.filter((e) => e.mod && !baseIds.has(e.mod)).map((e) => e.mod))
  return (
    <>
      <p className="share-sum">
        {list.playAs?.length ? <>for <b>{list.playAs.join(', ')}</b> · </> : null}
        based on <b>{base?.name ?? list.base ?? 'no template'}</b> · <b>{entries.length}</b> packs
        {list.far ? <> · played to <b>{list.far}</b></> : null}{list.game ? <> · game <b>{list.game}</b></> : null}
        {list.shownAs ? <> · shown as <b>{list.shownAs}</b></> : null}
      </p>
      {list.notes && <p className="play-lead">“{list.notes}”</p>}
      {unknown.length > 0 && (
        <div className="review-unknown">
          <h4>Packs the catalog does not know · {unknown.length}</h4>
          <ul>
            {unknown.map((u) => (
              <li key={u.pack}><code>{u.pack}</code> <span className="small muted">{u.own ? 'own mod – the player’s file' : 'in the list, not in the catalog'}{guess(u.pack) ? ` · ${guess(u.pack)}` : ''}</span></li>
            ))}
          </ul>
        </div>
      )}
      <h4>Load order as played · <span className="ok-text">green = not in the template</span></h4>
      <ol className="review-list">
        {entries.map((e, i) => <li key={i} className={added.has(e.mod) ? 'ok-text' : ''}>{name(e.mod) ?? e.pack}</li>)}
      </ol>
    </>
  )
}
