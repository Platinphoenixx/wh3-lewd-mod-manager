import { useMemo } from 'react'
import { matchInstalled, parseTargetKey, staleDataPacks } from '@shared/match'
import { resolveTarget, useData } from './data'
import { ConflictList } from './ConflictList'

export function InstallView() {
  const data = useData()
  const scan = data.scan
  const result = useMemo(() => (scan ? matchInstalled(data.index, scan.packs) : null), [scan, data.index])
  const stale = useMemo(() => (scan ? staleDataPacks(data.index, scan.packs) : []), [scan, data.index])
  if (!scan || !result) return <p className="content">Scanning…</p>

  return (
    <div className="content install">
      <section>
        <h2>Game</h2>
        <p>{scan.gamePath ?? 'Not found'}</p>
        <p className="small muted">
          {scan.vanillaPackCount} vanilla packs · {scan.packs.filter((p) => p.source === 'data').length} mod packs in data ·{' '}
          {scan.packs.filter((p) => p.source === 'workshop').length} Workshop packs in {scan.workshopPaths.length} folder(s)
        </p>
        {scan.errors.map((e) => <p key={e} className="callout warn">{e}</p>)}
        <button onClick={data.rescan}>Rescan</button>
      </section>

      {stale.length > 0 && (
        <section>
          <h2 className="danger">Outdated packs in the data folder</h2>
          <button onClick={async () => {
            const r = await window.api.backupPacks(stale.map((w) => w.pack.path))
            alert(r.moved.length ? `Moved ${r.moved.length} pack(s) to ${r.folder}` : 'Nothing was moved.')
            data.rescan()
          }}>Move these packs to a backup folder</button>
          <ul>
            {stale.map((w) => (
              <li key={w.pack.path}>
                <strong>{w.pack.file}</strong> – {w.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Overlaps between installed mods</h2>
        <ConflictList
          paths={[...scan.packs].sort((a, b) => a.file.localeCompare(b.file)).map((p) => p.path)}
          orderNote="Compared in alphabetical order. Who actually wins depends on your load order – open a profile's load order to see it for that profile."
        />
      </section>

      <section>
        <h2>Recognised mods ({result.known.size})</h2>
        <table className="entries">
          <tbody>
            {[...result.known.entries()].map(([key, packs]) => {
              const t = resolveTarget(data, parseTargetKey(key))
              return (
                <tr key={key}>
                  <td>{t.kind === 'mod' ? <a onClick={() => data.openMod(t.mod.id)}>{t.mod.name}</a> : t.kind === 'external' ? t.ext.name : t.label}</td>
                  <td className="small muted">{packs.map((p) => `${p.file}${p.steamId ? ` (${p.steamId})` : ' (data)'}`).join(', ')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Not in the catalog ({result.unknown.length})</h2>
        <p className="small muted">Regular mods unrelated to the lewd scene show up here too.</p>
        <ul className="small">
          {result.unknown.map((p) => <li key={p.path}>{p.file} {p.steamId ? `(Workshop ${p.steamId})` : '(data)'}</li>)}
        </ul>
      </section>
    </div>
  )
}
