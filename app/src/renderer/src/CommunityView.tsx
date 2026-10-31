import { useEffect, useState } from 'react'
import { CONTRIBUTION_LABEL, type Contribution } from '@shared/community'
import { nameOf } from '@shared/profile'
import { useData } from './data'

const RULE_TEXT: Record<string, string> = {
  requires: 'requires', incompatible: 'is incompatible with', recommends: 'works well with', optional: 'optional for',
  loadAbove: 'loads above', loadBelow: 'loads below', supersedes: 'replaces', extends: 'extends'
}

export function CommunityView() {
  const data = useData()
  const [sent, setSent] = useState<Contribution[]>([])
  useEffect(() => {
    window.api.listContributions().then(setSent)
  }, [])

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

      <section>
        <h2>Sent contributions ({sent.length})</h2>
        <ul className="small">
          {[...sent].reverse().map((c) => (
            <li key={c.id}>
              <span className="badge">{CONTRIBUTION_LABEL[c.type]}</span> {c.title} <span className="muted">· {c.createdAt.slice(0, 10)} · {c.sentAs === 'issue' ? 'GitHub issue' : 'copied'}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
