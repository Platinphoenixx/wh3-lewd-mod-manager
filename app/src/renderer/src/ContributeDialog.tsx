import { useState } from 'react'
import type { Mod } from '@catalog/schema'
import { CONTRIBUTION_LABEL, issueBody, issueUrl, type Contribution, type ContributionType, type UserRule } from '@shared/community'
import { KIND_LABEL, useData } from './data'

export interface ContributeRequest {
  type: ContributionType
  modId?: string
  /** Form fields filled in advance (e.g. what the app knows about an own mod). */
  prefill?: Record<string, string>
}

const RULE_KINDS: { value: UserRule['kind']; label: string }[] = [
  { value: 'requires', label: 'requires' },
  { value: 'incompatible', label: 'is incompatible with' },
  { value: 'recommends', label: 'works well with (recommends)' },
  { value: 'loadAbove', label: 'must load above' },
  { value: 'loadBelow', label: 'must load below' },
  { value: 'supersedes', label: 'replaces' }
]

function ModPicker({ value, onChange, exclude }: { value: string; onChange(v: string): void; exclude?: string }) {
  const data = useData()
  const [q, setQ] = useState('')
  const matches = q.trim().length >= 2
    ? data.catalog.mods.filter((m) => m.id !== exclude && m.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
    : []
  const chosen = value && data.index.mods.get(value.replace(/^mod:/, ''))
  return (
    <div className="picker">
      {chosen ? (
        <div className="chosen">{chosen.name} <button className="link" onClick={() => onChange('')}>change</button></div>
      ) : (
        <>
          <input placeholder="Type to search a mod…" value={q} onChange={(e) => setQ(e.target.value)} />
          {matches.length > 0 && (
            <ul className="picker-list">
              {matches.map((m) => <li key={m.id} onClick={() => { onChange(`mod:${m.id}`); setQ('') }}>{m.name} <span className="muted small">{KIND_LABEL[m.kind]}</span></li>)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

export function ContributeDialog({ req, onClose }: { req: ContributeRequest; onClose(): void }) {
  const data = useData()
  const mod: Mod | undefined = req.modId ? data.index.mods.get(req.modId) : undefined
  const [f, setF] = useState<Record<string, string>>({ verdict: 'works', ruleKind: 'requires', far: 'Played 20+ turns', gameVersion: data.scan?.gameVersion ?? '', ...req.prefill })
  const [applyLocally, setApplyLocally] = useState(true)
  const [done, setDone] = useState<string | null>(null)
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const valid =
    req.type === 'new-mod' ? !!f.name && !!f.links :
    req.type === 'feedback' ? !!f.comment :
    req.type === 'rule' ? !!f.other :
    req.type === 'fix' ? /https?:\/\/\S+/.test(f.links ?? '') && !!f.steps?.trim() :
    !!f.field && !!f.suggestion

  let viaGithub = false
  const submit = async () => {
    const now = new Date().toISOString()
    const title =
      req.type === 'new-mod' ? `New mod: ${f.name}` :
      req.type === 'feedback' ? `Feedback (${f.verdict}): ${mod?.name}` :
      req.type === 'rule' ? `Rule: ${mod?.name} ${RULE_KINDS.find((r) => r.value === f.ruleKind)?.label} ${data.index.mods.get(f.other.replace(/^mod:/, ''))?.name ?? f.other}` :
      req.type === 'fix' ? `Fix: ${mod?.name}` :
      `Correction: ${mod?.name} – ${f.field}`
    const payload: Record<string, unknown> =
      req.type === 'new-mod' ? { name: f.name, links: f.links.split(/\s+/).filter(Boolean), kind: f.kind, characters: f.characters, description: f.description, requirements: f.requirements } :
      req.type === 'feedback' ? { verdict: f.verdict, gameVersion: f.gameVersion, modVersion: f.modVersion, comment: f.comment } :
      req.type === 'rule' ? { kind: f.ruleKind, other: f.other, note: f.note, evidence: f.evidence } :
      req.type === 'fix' ? { links: (f.links ?? '').split(/\s+/).filter((u) => /^https?:\/\//.test(u)), steps: f.steps.trim(), far: f.far, gameVersion: f.gameVersion } :
      { field: f.field, suggestion: f.suggestion, evidence: f.evidence }
    const c: Contribution = { id: crypto.randomUUID(), type: req.type, modId: req.modId, title, payload, createdAt: now }

    if (req.type === 'rule' && applyLocally && req.modId) {
      const rule: UserRule = { id: c.id, modId: req.modId, kind: f.ruleKind as UserRule['kind'], other: f.other, note: f.note, createdAt: now }
      data.saveRules([...data.rules, rule])
    }
    const repo = data.contribRepo
    const body = issueBody(c, data.catalog.generatedAt.slice(0, 10))
    // Without an account: the project's relay files the issue. GitHub in the browser stays the fallback.
    if (data.relayUrl && !viaGithub) {
      const r = await window.api.sendContribution({ type: req.type, title, body })
      if (r.ok) {
        c.sentAs = 'relay'
        setDone(`${r.message}${r.url ? ` It is public at ${r.url}` : ''}`)
        await window.api.addContribution(c)
        return
      }
      setDone(`Could not send it (${r.message}). Try again later or use “Open as GitHub issue”.`)
      return
    }
    if (repo) {
      c.sentAs = 'issue'
      await window.api.openExternal(issueUrl(repo, c, data.catalog.generatedAt.slice(0, 10)))
      setDone('Your browser opened a prefilled GitHub issue. Check it and press “Submit new issue”.')
    } else {
      c.sentAs = 'clipboard'
      await navigator.clipboard.writeText(`# ${title}\n\n${issueBody(c, data.catalog.generatedAt.slice(0, 10))}`)
      setDone('No contribution repository is configured yet, so the text was copied to your clipboard. Post it where the catalog is maintained.')
    }
    await window.api.addContribution(c)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <h2>{CONTRIBUTION_LABEL[req.type]}{mod ? `: ${mod.name}` : ''}</h2>
        {done ? (
          <>
            <p className="callout">{done}</p>
            {req.type === 'rule' && applyLocally && <p className="small muted">The rule is active in your app right away (see Community → My rules).</p>}
            <button onClick={onClose}>Close</button>
          </>
        ) : (
          <div className="form">
            {req.type === 'new-mod' && (
              <>
                <label>Name<input value={f.name ?? ''} onChange={set('name')} /></label>
                <label>Links (LoversLab, Steam, Discord message, …), separated by spaces<textarea rows={2} value={f.links ?? ''} onChange={set('links')} /></label>
                <label>Kind
                  <select value={f.kind ?? ''} onChange={set('kind')}>
                    <option value="">unknown</option>
                    {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                <label>Characters / factions<input value={f.characters ?? ''} onChange={set('characters')} placeholder="e.g. Alarielle, Miao Ying" /></label>
                <label>What does it do?<textarea rows={3} value={f.description ?? ''} onChange={set('description')} /></label>
                <label>Requirements, incompatibilities, load order<textarea rows={3} value={f.requirements ?? ''} onChange={set('requirements')} /></label>
              </>
            )}
            {req.type === 'feedback' && (
              <>
                <label>How does it work for you?
                  <select value={f.verdict} onChange={set('verdict')}>
                    <option value="works">Works fine</option>
                    <option value="issues">Works with issues</option>
                    <option value="broken">Broken</option>
                  </select>
                </label>
                <label>Game version<input value={f.gameVersion ?? ''} onChange={set('gameVersion')} placeholder="e.g. 9.0.1" /></label>
                <label>Mod version<input value={f.modVersion ?? ''} onChange={set('modVersion')} /></label>
                <label>Details (what happened, which other mods, tips)<textarea rows={4} value={f.comment ?? ''} onChange={set('comment')} /></label>
              </>
            )}
            {req.type === 'rule' && (
              <>
                <label>{mod?.name}
                  <select value={f.ruleKind} onChange={set('ruleKind')}>
                    {RULE_KINDS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </label>
                <label>Other mod<ModPicker value={f.other ?? ''} onChange={(v) => setF({ ...f, other: v })} exclude={req.modId} /></label>
                <label>Why / details<textarea rows={2} value={f.note ?? ''} onChange={set('note')} /></label>
                <label>Source (link to a post, page, …)<input value={f.evidence ?? ''} onChange={set('evidence')} /></label>
                <label className="inline-check"><input type="checkbox" checked={applyLocally} onChange={(e) => setApplyLocally(e.target.checked)} /> Apply this rule in my app right away</label>
              </>
            )}
            {req.type === 'fix' && (
              <>
                <p className="small muted">Links only – files are not uploaded. Nothing about you is sent besides what you write here. A maintainer checks it; once accepted, every player gets it offered with this mod.</p>
                <label>Where is the fix? One link per line (Discord post, LoversLab, Steam Workshop, Nexus Mods, Mega, Google Drive)
                  <textarea rows={3} value={f.links ?? ''} onChange={set('links')} placeholder="https://discord.com/channels/…" />
                </label>
                <label>What does a player have to do?<textarea rows={3} value={f.steps ?? ''} onChange={set('steps')} placeholder="e.g. take both packs from the post instead of the Workshop ones" /></label>
                <label>How far did you get?
                  <select value={f.far ?? 'Played 20+ turns'} onChange={set('far')}>
                    {['Reached the main menu', 'Played a few turns', 'Played 20+ turns', 'Finished a campaign'].map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <label>Game version<input value={f.gameVersion ?? ''} onChange={set('gameVersion')} placeholder="e.g. 9.0.4" /></label>
              </>
            )}
            {req.type === 'correction' && (
              <>
                <label>What is wrong or missing?
                  <select value={f.field ?? ''} onChange={set('field')}>
                    <option value="">choose…</option>
                    {['description', 'requirements', 'files / packs', 'version / download link', 'images', 'status (outdated, broken, …)', 'other'].map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <label>Correct information<textarea rows={4} value={f.suggestion ?? ''} onChange={set('suggestion')} /></label>
                <label>Source (link)<input value={f.evidence ?? ''} onChange={set('evidence')} /></label>
              </>
            )}
            <div className="form-actions">
              {data.relayUrl && <button className="primary" disabled={!valid} onClick={() => { viaGithub = false; void submit() }}>Send (no account needed)</button>}
              <button className={data.relayUrl ? '' : 'primary'} disabled={!valid} onClick={() => { viaGithub = true; void submit() }}>{data.contribRepo ? 'Open as GitHub issue' : 'Copy for sending'}</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
