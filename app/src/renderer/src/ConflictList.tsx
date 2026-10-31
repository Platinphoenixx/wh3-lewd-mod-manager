import { useEffect, useState } from 'react'
import type { ConflictReport } from '@shared/conflicts'

const KIND_LABEL: Record<string, string> = {
  db: 'database', text: 'texts', script: 'scripts', ui: 'UI images', audio: 'audio', texture: 'textures', model: 'models', other: 'other'
}

type Report = ConflictReport & { unreadable: string[] }

/** Reads the given packs (highest priority first) and lists which ones override files of others. */
export function ConflictList({ paths, orderNote }: { paths: string[]; orderNote: string }) {
  const [report, setReport] = useState<Report | null>(null)
  const key = paths.join('|')
  useEffect(() => {
    let alive = true
    setReport(null)
    if (paths.length > 1) window.api.packConflicts(paths).then((r) => alive && setReport(r))
    return () => {
      alive = false
    }
  }, [key])

  if (paths.length < 2) return <p className="small muted">Fewer than two installed packs – nothing to compare.</p>
  if (!report) return <p className="small muted">Reading {paths.length} packs…</p>

  return (
    <div className="conflicts">
      <p className="small muted">{orderNote}</p>
      {report.overlaps.length === 0 ? (
        <p className="ok-text">No two packs contain the same file.</p>
      ) : (
        <ul>
          {report.overlaps.map((o) => (
            <li key={o.winner + o.loser}>
              <details>
                <summary>
                  <strong>{o.winner}</strong> overrides <strong>{o.loser}</strong> in {o.count} file{o.count === 1 ? '' : 's'}{' '}
                  <span className="muted small">
                    ({Object.entries(o.byKind).map(([k, n]) => `${n} ${KIND_LABEL[k] ?? k}`).join(', ')})
                  </span>
                </summary>
                <ul className="small muted">{o.samples.map((s) => <li key={s}><code>{s}</code></li>)}</ul>
                {o.count > o.samples.length && <p className="small muted">…and {o.count - o.samples.length} more</p>}
              </details>
            </li>
          ))}
        </ul>
      )}
      {report.sharedTables.length > 0 && (
        <details>
          <summary className="small">
            {report.sharedTables.length} pair{report.sharedTables.length === 1 ? '' : 's'} add rows to the same database tables (possible conflicts)
          </summary>
          <ul className="small">
            {report.sharedTables.map((s) => (
              <li key={s.a + s.b}>{s.a} & {s.b}: <span className="muted">{s.tables.join(', ')}</span></li>
            ))}
          </ul>
        </details>
      )}
      {report.unreadable.length > 0 && <p className="small warn-text">Could not read: {report.unreadable.join(', ')}</p>}
    </div>
  )
}
