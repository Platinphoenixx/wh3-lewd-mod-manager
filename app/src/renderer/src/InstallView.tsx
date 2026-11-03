import { useMemo } from 'react'
import { harmlessNote, lastMajorUpdate } from '@shared/health'
import { matchInstalled, parseTargetKey, staleDataPacks } from '@shared/match'
import { resolveTarget, useData } from './data'
import { packOwner } from './ReportDialog'
import { groupFailures } from '@shared/report'
import { ConflictList } from './ConflictList'

export function InstallView() {
  const data = useData()
  const scan = data.scan
  const result = useMemo(() => (scan ? matchInstalled(data.index, scan.packs) : null), [scan, data.index])
  const stale = useMemo(() => (scan ? staleDataPacks(data.index, scan.packs) : []), [scan, data.index])
  const scripts = data.scripts
  // One entry per mod, its lines counted.
  const groups = useMemo(() => groupFailures(scripts?.failed ?? []), [scripts])
  // Messages the catalog knows as harmless are listed apart and not counted as errors.
  const known = (i: number) => (scripts ? harmlessNote(data.catalog, scripts.failed[i]) : undefined)
  const errors = groups.filter((g) => !known(g.index))
  const harmless = groups.filter((g) => known(g.index))
  const real = (scripts?.failed ?? []).filter((f) => !harmlessNote(data.catalog, f)).length
  const major = lastMajorUpdate(data.catalog.gameUpdates, scan?.gameUpdated)
  if (!scan || !result) return <p className="content">Scanning…</p>

  return (
    <div className="content install">
      <section>
        <h2>Game</h2>
        <p>{scan.gamePath ?? 'Not found'}</p>
        {(scan.gameVersion || major) && (
          <p className="small">
            {scan.gameVersion && <>Version <strong>{scan.gameVersion}</strong>{scan.gameBuild && ` (Steam build ${scan.gameBuild})`}</>}
            {scan.gameVersion && major && ' · '}
            {major && `last major update: ${major.title}, ${new Date(major.date).toISOString().slice(0, 10)}`}
          </p>
        )}
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
        <h2>Script errors in the last game start</h2>
        {!scripts?.written && <p className="small muted">No script log yet (the game writes lua_mod_log.txt when it starts).</p>}
        {scripts?.written && (
          <>
            <p className="small muted">
              lua_mod_log.txt from {new Date(scripts.written).toLocaleString()}: {scripts.loaded} mod scripts loaded, {real} problem
              {real === 1 ? '' : 's'}{harmless.length ? `, ${harmless.length} known harmless message${harmless.length === 1 ? '' : 's'}` : ''}.
            </p>
            {errors.map(({ index, lines }) => {
              const f = scripts.failed[index]
              return (
                <div key={index} className="callout warn small script-error">
                  <div>
                    <strong>{f.packs.length ? f.packs.map((p) => packOwner(data, p).name).join(', ') : f.script ? 'base game script' : 'unknown source'}</strong>
                    {f.packs.length > 0 && <span className="muted"> ({f.packs.map((p) => p.replace(/^.*[\\/]/, '')).join(', ')})</span>}
                    {lines.slice(0, 3).map((l) => <div key={l.line} className="muted">{l.line}{l.count > 1 && ` · ${l.count}×`}</div>)}
                    {lines.length > 3 && <div className="muted">… and {lines.length - 3} more lines (all in the report)</div>}
                  </div>
                  <button className="primary" style={{ margin: 0 }} onClick={() => data.openReport(index)}>Report to the modder…</button>
                </div>
              )
            })}
            {harmless.map(({ index, lines }) => {
              const k = known(index)!
              return (
                <div key={index} className="callout small script-error harmless">
                  <div>
                    <strong>{k.mod.name}</strong> <span className="muted">– known and harmless, nothing to do</span>
                    <div className="muted">{lines[0].line}</div>
                    <div>{k.note}</div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </section>

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
