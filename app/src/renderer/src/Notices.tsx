import { useCallback, useState, type ReactNode } from 'react'

/**
 * Messages as cards in the bottom right corner: what happened, the next step as a button, and a bar
 * that runs down until the card goes away (hovering pauses it). Errors stay longer than the rest.
 */
export type NoticeKind = 'error' | 'info' | 'done'

export interface NoticeInput {
  kind: NoticeKind
  text: ReactNode
  actions?: { label: string; run(): void }[]
  /** ms until the card goes; 0 keeps it until closed. Default: 8 s, errors 20 s. */
  timeout?: number
  /** A notice with the same id replaces the earlier one ("Installing…" → result). */
  id?: string
}

interface Notice extends NoticeInput {
  id: string
  /** Changes on every replacement, so the timer bar starts again. */
  version: number
}

const LABEL: Record<NoticeKind, [string, string]> = { error: ['✕', 'Error'], info: ['•', 'Info'], done: ['✓', 'Done'] }
let counter = 0

export function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([])
  const dismiss = useCallback((id: string) => setNotices((list) => list.filter((n) => n.id !== id)), [])
  const notify = useCallback((n: NoticeInput) => {
    const id = n.id ?? `n${++counter}`
    setNotices((list) => [...list.filter((x) => x.id !== id), { ...n, id, version: ++counter }].slice(-4))
    return id
  }, [])
  return { notices, notify, dismiss }
}

export function NoticeStack({ notices, dismiss }: { notices: Notice[]; dismiss(id: string): void }) {
  if (!notices.length) return null
  return (
    <div className="notices">
      {notices.map((n) => {
        const ms = n.timeout ?? (n.kind === 'error' ? 20000 : 8000)
        return (
          <div key={n.id} className={`notice ${n.kind}`} role={n.kind === 'error' ? 'alert' : 'status'}>
            <div className="notice-kind"><span className="notice-sym">{LABEL[n.kind][0]}</span>{LABEL[n.kind][1]}</div>
            <div className="notice-text">{n.text}</div>
            {n.actions?.length ? (
              <div className="notice-actions">
                {n.actions.map((a) => <button key={a.label} onClick={() => { a.run(); dismiss(n.id) }}>{a.label}</button>)}
              </div>
            ) : null}
            <button className="notice-close" title="Close" onClick={() => dismiss(n.id)}>✕</button>
            {ms > 0 && (
              <div className="notice-bar">
                <i key={n.version} style={{ animationDuration: `${ms}ms` }} onAnimationEnd={() => dismiss(n.id)} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
