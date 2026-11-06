import { useState } from 'react'
import type { CheckPoint } from '@shared/check'
import type { RelayFlag } from '@shared/api'
import { nameOf } from '@shared/profile'
import { useData } from './data'

const WHY: { value: NonNullable<RelayFlag['why']>; label: string }[] = [
  { value: 'works', label: 'They work together, I play them that way' },
  { value: 'outdated', label: 'It was true once but is out of date' },
  { value: 'reason', label: 'The reason or the source is wrong' },
  { value: 'other', label: 'Something else' }
]
const FAR = ['Main menu only', 'A few turns', 'A long campaign']

/**
 * "Flag as wrong": a player tells the maintainers that a rule of the catalog is wrong, with what the app said next to it.
 * Sent through the relay; what the player writes becomes part of a public GitHub issue, and the dialog says so.
 */
export function FlagDialog({ point, order, onClose, onSent }: { point: CheckPoint; order: string[]; onClose(): void; onSent(rule: string): void }) {
  const data = useData()
  const [why, setWhy] = useState<NonNullable<RelayFlag['why']>>('works')
  const [text, setText] = useState('')
  const [far, setFar] = useState(FAR[1])
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linkOk = !link.trim() || /^https?:\/\/\S+$/.test(link.trim())
  // The order of the two mods it is about, the one thing of the list that goes along.
  const positions = point.keys.filter((k) => order.includes(k)).sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const orderText = positions.length === 2 ? `${nameOf(data.catalog, data.index, positions[0])} above ${nameOf(data.catalog, data.index, positions[1])}` : undefined

  const send = async () => {
    setBusy(true)
    setError(null)
    const r = await window.api.sendFlag({
      rule: point.rule, title: point.title, says: point.why, source: point.source, why, text: text.trim(), link: link.trim() || undefined, far,
      order: orderText, game: data.scan?.gameVersion, catalog: data.catalog.generatedAt.slice(0, 10)
    })
    setBusy(false)
    if (r.ok) {
      data.notify({ kind: 'done', text: r.message })
      onSent(point.rule)
    } else setError(r.message)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <h2>Flag as wrong</h2>
        <div className="flag-says">
          <strong>What the app says:</strong> {point.title}. {point.why}
          <div className="small muted">{point.source}</div>
        </div>
        <div className="form">
          <div className="flag-why">
            <strong>What is wrong about it?</strong>
            {WHY.map((w) => (
              <label key={w.value} className="inline-check"><input type="radio" name="flag-why" checked={why === w.value} onChange={() => setWhy(w.value)} /> {w.label}</label>
            ))}
          </div>
          <label>What do you know?<textarea rows={3} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="What happens in your game, what you checked" /></label>
          <div className="flag-row">
            <label>How far did you play like this?
              <select value={far} onChange={(e) => setFar(e.target.value)}>{FAR.map((x) => <option key={x}>{x}</option>)}</select>
            </label>
            <label>A link that shows it (optional)
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Mod page, Discord post, …" />
            </label>
          </div>
          <p className="small muted flag-sent">
            Sent along: which rule this is{orderText ? `, the order of these two mods in your list (${orderText})` : ''}, your game version. No user name, no folders, not the rest
            of your list. What you write is public in the catalog's issue tracker. One flag changes nothing for other players by itself: a maintainer decides, and from 3 players on
            the point says it is disputed.
          </p>
          {error && <p className="small warn-text">{error}</p>}
          <div className="form-actions">
            <button className="primary" disabled={busy || !text.trim() || !linkOk} onClick={() => void send()}>Send flag</button>
            <button onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The small link next to anything the app claims: flag it, or take a sent flag back. */
export function FlagLink({ rule, flagged, onFlag, onUnflag }: { rule: string; flagged?: Record<string, string>; onFlag(): void; onUnflag(): void }) {
  if (flagged?.[rule]) return <span className="flag-link small muted">You flagged this · <a onClick={onUnflag}>take it back</a></span>
  return <a className="flag-link small" onClick={onFlag}>Flag as wrong…</a>
}
