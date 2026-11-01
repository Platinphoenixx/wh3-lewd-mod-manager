import { useEffect, useMemo, useState } from 'react'
import { matchInstalled, parseTargetKey } from '@shared/match'
import { anonymize, buildReport, errorSignature, groupFailures, type LaunchSnapshot, type ReportOptions } from '@shared/report'
import { resolveTarget, steamUrl, useData, type AppData } from './data'

const WHERE = ['New Immortal Empires campaign', 'Running Immortal Empires campaign', 'Realm of Chaos campaign', 'Custom battle', 'Main menu / loading', 'Other']

/** Name of the mod an installed pack belongs to, and its page. */
export function packOwner(data: AppData, path: string): { name: string; url?: string; key?: string } {
  for (const [key, packs] of data.scan ? matchInstalled(data.index, data.scan.packs).known : []) {
    if (!packs.some((p) => p.path === path)) continue
    const r = resolveTarget(data, parseTargetKey(key))
    if (r.kind === 'mod') {
      const s = r.mod.sources
      return { name: r.mod.name, url: s.loverslab?.url ?? (s.steam?.[0] ? steamUrl(s.steam[0].id) : s.nexus?.url), key }
    }
    return { name: r.kind === 'external' ? r.ext.name : r.label, key }
  }
  const steamId = data.scan?.packs.find((p) => p.path === path)?.steamId
  return { name: path.replace(/^.*[\\/]/, ''), url: steamId ? steamUrl(steamId) : undefined }
}

/**
 * Everything a modder needs to reproduce a script error: versions, the template and how the started
 * load order differs from it, outdated mods and file overlaps. Paths and user names are removed; the
 * player sees the exact text and copies or saves it – nothing is sent by itself.
 */
export function ReportDialog({ failure, onClose }: { failure: number; onClose(): void }) {
  const data = useData()
  const scripts = data.scripts!
  const f = scripts.failed[failure]
  // All lines of this session that come from the same packs belong into one report.
  const group = groupFailures(scripts.failed).find((g) => g.index === failure) ?? { lines: [{ line: f.line, count: 1 }] }
  const owner = f.packs.length ? packOwner(data, f.packs[0]) : { name: f.script ? 'base game script' : 'unknown source' }

  const [snapshot, setSnapshot] = useState<LaunchSnapshot | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [home, setHome] = useState('')
  const [overlaps, setOverlaps] = useState<{ winner: string; loser: string; count: number; sample?: string }[]>([])
  const [options, setOptions] = useState<ReportOptions>({ versions: true, differences: true, stale: true, overlaps: true, fullOrder: false })
  const [where, setWhere] = useState(WHERE[0])
  const [detail, setDetail] = useState('')
  const [copied, setCopied] = useState('')
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (!confirm('Send the report shown on the right to the catalog maintainers?\n\nOnly this text and a random id of this installation are sent (so the same player counts once). Once 3 or more players report the same error, it is shown in the catalog as a known problem.')) return
    setSending(true)
    const key = 'key' in owner && owner.key ? owner.key : `pack:${f.packs[0]?.replace(/^.*[\\/]/, '') ?? 'unknown'}`
    const r = await window.api.sendReport({
      app: appVersion,
      game: data.scan?.gameVersion,
      catalog: data.catalog.generatedAt.slice(0, 10),
      modId: key.startsWith('mod:') ? key.slice(4) : undefined,
      modName: owner.name,
      signature: errorSignature(key, group.lines[0].line),
      text: report.full
    })
    setSending(false)
    setCopied(r.ok ? r.message : `Not sent: ${r.message}`)
  }

  useEffect(() => {
    void window.api.appVersion().then(setAppVersion)
    void window.api.homeDir().then(setHome)
    void window.api.lastLaunch().then((s) => {
      // Only a launch shortly before the log was written describes this session.
      const fits = s && scripts.written && s.at <= scripts.written && scripts.written - s.at < 12 * 3600_000
      setSnapshot(fits ? s : null)
      const paths = fits ? s.entries.flatMap((e) => e.paths) : []
      const files = new Set(f.packs.map((p) => p.replace(/^.*[\\/]/, '').toLowerCase()))
      if (paths.length && files.size) {
        void window.api.packConflicts(paths).then((r) => setOverlaps(r.overlaps
          .filter((o) => files.has(o.winner.toLowerCase()) || files.has(o.loser.toLowerCase()))
          .map((o) => ({ winner: o.winner, loser: o.loser, count: o.count, sample: o.samples[0] }))))
      }
    })
  }, [f, scripts.written])

  const report = useMemo(() => {
    const input = {
      modName: owner.name,
      errors: group.lines,
      packs: f.packs.map((p) => p.replace(/^.*[\\/]/, '')),
      snapshot,
      game: { version: data.scan?.gameVersion, build: data.scan?.gameBuild },
      appVersion,
      catalogDate: data.catalog.generatedAt.slice(0, 10),
      where: [where, detail.trim()].filter(Boolean).join(' – '),
      overlaps,
      options
    }
    const ctx = { home, gamePath: data.scan?.gamePath, workshopPaths: data.scan?.workshopPaths }
    return { full: anonymize(buildReport(input), ctx), short: anonymize(buildReport(input, true), ctx) }
  }, [owner.name, group, f.packs, snapshot, data.scan, data.catalog.generatedAt, appVersion, where, detail, overlaps, options, home])

  const diffCount = snapshot ? snapshot.entries.filter((e) => e.origin !== 'base').length + snapshot.removed.length : 0
  const staleCount = snapshot?.entries.filter((e) => e.stale).length ?? 0
  const check = (k: keyof ReportOptions, label: string, hint?: string, disabled = false) => (
    <label className="check">
      <input type="checkbox" checked={options[k] && !disabled} disabled={disabled} onChange={(e) => setOptions({ ...options, [k]: e.target.checked })} />
      <span>{label}{hint && <span className="muted small"> ({hint})</span>}</span>
    </label>
  )
  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(what)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(1180px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>✕</button>
        <h2 style={{ margin: 0 }}>Report to the modder – {owner.name}</h2>
        <div className="small muted">
          Everything the modder needs to reproduce it. Windows user names and folders are replaced; nothing is sent by itself.
        </div>
        <div className="report-grid">
          <div>
            <h3 style={{ marginTop: 0 }}>Include</h3>
            {check('versions', 'Game, app and catalog version', data.scan?.gameVersion ? `game ${data.scan.gameVersion}` : undefined)}
            {check('differences', 'Differences from the template', snapshot ? `${diffCount}` : 'game not started from the app', !snapshot)}
            {check('stale', 'Mods older than the last major update', snapshot ? `${staleCount}` : undefined, !snapshot)}
            {check('overlaps', 'Packs that change the same files', `${overlaps.length}`, !overlaps.length)}
            {check('fullOrder', 'Full load order', snapshot ? `${snapshot.entries.length} mods – in the file, not in the Discord version` : undefined, !snapshot)}
            <h3>Where did it happen?</h3>
            <select style={{ width: '100%' }} value={where} onChange={(e) => setWhere(e.target.value)}>
              {WHERE.map((w) => <option key={w}>{w}</option>)}
            </select>
            <input style={{ width: '100%', marginTop: 8 }} placeholder="e.g. turn 40, after building the temple" value={detail} onChange={(e) => setDetail(e.target.value)} />
            <div className="report-actions">
              <button className="primary" style={{ margin: 0 }} onClick={() => copy(report.short, 'Discord version copied')}>Copy for Discord</button>
              <button onClick={() => copy(report.full, 'Full report copied')}>Copy full report</button>
              <button onClick={async () => {
                const p = await window.api.saveTextFile(`problem report – ${owner.name}.md`, report.full)
                if (p) setCopied('Saved')
              }}>Save as file…</button>
            </div>
            {copied && <p className="small" style={{ color: 'var(--ok)' }}>✓ {copied}</p>}
            {data.relayUrl && (
              <div className="report-actions">
                <button disabled={sending} onClick={send}>{sending ? 'Sending…' : 'Send anonymously to the catalog…'}</button>
              </div>
            )}
            {'url' in owner && owner.url && (
              <div className="report-actions">
                <button className="link" style={{ padding: 0 }} onClick={() => window.api.openExternal(owner.url!)}>Open the mod's page ↗</button>
              </div>
            )}
          </div>
          <pre className="report-text">{report.full}</pre>
        </div>
      </div>
    </div>
  )
}
