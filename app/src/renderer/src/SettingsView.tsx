import { useEffect, useState } from 'react'
import { DEFAULTS, type MaintainerStatus, type Settings } from '@shared/api'
import type { LocalScan } from '@shared/localfiles'
import { useData } from './data'

export function SettingsView({ onSaved }: { onSaved(s: Settings): void }) {
  const data = useData()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)
  const [version, setVersion] = useState('')
  const [build, setBuild] = useState<{ date: string; commit: string } | null>(null)
  const [local, setLocal] = useState<LocalScan | null>(null)
  const [looking, setLooking] = useState(false)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    window.api.appVersion().then(setVersion)
    window.api.appBuild().then(setBuild)
    window.api.localFiles().then(setLocal)
  }, [])
  if (!settings) return null

  const save = async (next: Settings) => {
    setSettings(next)
    await window.api.saveSettings(next)
    onSaved(next)
    setSaved(true)
    data.rescan()
  }

  return (
    <div className="content settings">
      <section>
        <h2>Game folder</h2>
        <p className="small muted">Detected automatically from Steam. Choose it yourself only if detection fails.</p>
        <p>{data.scan?.gamePath ?? 'Not found'}</p>
        <button
          onClick={async () => {
            const dir = await window.api.pickFolder()
            if (dir) await save({ ...settings, gamePath: dir })
          }}
        >
          Choose folder…
        </button>{' '}
        {settings.gamePath && <button onClick={() => save({ ...settings, gamePath: undefined })}>Use auto-detection</button>}
      </section>
      <section>
        <h2>Catalog updates</h2>
        <p className="small muted">
          The app ships with a catalog ({data.catalog.generatedAt.slice(0, 10)}). Enter an https address of a newer catalog.json to load
          updates at start; the newest available catalog is used.
        </p>
        <input
          className="wide"
          placeholder="https://…/catalog.json"
          value={settings.catalogUrl ?? ''}
          onChange={(e) => setSettings({ ...settings, catalogUrl: e.target.value })}
          onBlur={() => save(settings)}
        />
      </section>
      <section>
        <h2>Files you already have</h2>
        <p className="small muted">
          Folders where you keep mod downloads (packs or .7z/.zip/.rar archives). Before it downloads anything, the install step looks
          here for the same file – by pack name and the archive’s file list – and uses what it finds. Nothing is uploaded and nothing
          outside these folders is read.
        </p>
        {(() => {
          const folders = settings.sourceFolders ?? local?.folders.map((f) => f.path) ?? []
          const look = async (next?: Settings) => {
            if (next) await save(next)
            setLooking(true)
            setLocal(await window.api.localFiles(true))
            setLooking(false)
          }
          return (
            <>
              <ul className="source-folders">
                {folders.map((f) => {
                  const s = local?.folders.find((x) => x.path === f)
                  return (
                    <li key={f}>
                      <code>{f}</code>
                      <span className={`small ${s?.error && !s.files ? 'warn-text' : 'muted'}`}>{s ? `${s.files} file${s.files === 1 ? '' : 's'} · ${s.packs} pack${s.packs === 1 ? '' : 's'}${s.error ? ` · ${s.error}` : ''}` : 'not looked at yet'}{!settings.sourceFolders && ' · suggested'}</span>
                      <button className="link" onClick={() => void look({ ...settings, sourceFolders: folders.filter((x) => x !== f) })}>Remove</button>
                    </li>
                  )
                })}
                {!folders.length && <li className="small muted">No folders – the install step always downloads.</li>}
              </ul>
              <p>
                <button onClick={async () => {
                  const dir = await window.api.pickFolder('Choose a folder with mod downloads')
                  if (dir && !folders.includes(dir)) await look({ ...settings, sourceFolders: [...folders, dir] })
                }}>Add folder…</button>{' '}
                <button disabled={looking} onClick={() => void look()}>{looking ? 'Looking…' : 'Look again'}</button>{' '}
                {local && <span className="small muted">last looked {new Date(local.scannedAt).toLocaleString()}</span>}
              </p>
            </>
          )
        })()}
        <label className="toggle"><input type="radio" name="source-mode" checked={!settings.sourceMove} onChange={() => save({ ...settings, sourceMove: false })} /> Copy the file into the game (keeps your folder as it is)</label>
        <label className="toggle"><input type="radio" name="source-mode" checked={!!settings.sourceMove} onChange={() => save({ ...settings, sourceMove: true })} /> Move it (saves disk space; an archive is only moved when the profile uses all of it)</label>
        <label className="toggle"><input type="checkbox" checked={settings.preferNewer !== false} onChange={(e) => save({ ...settings, preferNewer: e.target.checked })} /> When my copy is older than the version on the mod’s page, download the new one instead</label>
      </section>
      <section>
        <h2>LoversLab downloads</h2>
        <label className="toggle">
          <input type="checkbox" checked={settings.autoLoversLab !== false} onChange={(e) => save({ ...settings, autoLoversLab: e.target.checked })} />
          Download all missing LoversLab mods of a profile in one go
        </label>
        <p className="small muted">
          One LoversLab window works through the list and installs each file; where a page offers several files, the app takes the one
          the profile needs or asks you. LoversLab's own rules stay as they are: downloads run one after another, and if LoversLab makes a download wait, the app waits with it. Downloads use your LoversLab account.
          Off: every mod opens its own LoversLab window and you click the download yourself.
        </p>
      </section>
      <section>
        <h2>Contributions</h2>
        <p className="small muted">GitHub repository (owner/name) that receives suggestions, feedback and rules as issues.</p>
        <input
          className="wide"
          placeholder={DEFAULTS.contribRepo || 'owner/repository'}
          value={settings.contribRepo ?? ''}
          onChange={(e) => setSettings({ ...settings, contribRepo: e.target.value.trim() })}
          onBlur={() => save(settings)}
        />
        <p className="small muted">Relay that sends suggestions and problem reports without a GitHub account (only for testing another one).</p>
        <input
          className="wide"
          placeholder={DEFAULTS.relayUrl || 'https://…workers.dev'}
          value={settings.relayUrl ?? ''}
          onChange={(e) => setSettings({ ...settings, relayUrl: e.target.value.trim() })}
          onBlur={() => save(settings)}
        />
      </section>
      <Maintainer repo={settings.contribRepo || DEFAULTS.contribRepo} />
      <p className="small muted">
        WH3 Lewd Mod Manager {version}
        {build && ` · build ${build.date}${build.commit ? ` (${build.commit})` : ''}`} ·{' '}
        <a onClick={() => window.api.openExternal(`https://github.com/${DEFAULTS.contribRepo}/releases`)}>Releases</a>
      </p>
      {saved && <p className="small muted">Saved. Catalog changes apply after restarting the app.</p>}
    </div>
  )
}

/**
 * Maintainer access: with a GitHub token that may edit the catalog repository's issues, the app shows the Review tab
 * (shared setups and contributions waiting for a decision). The token is typed in here by the maintainer, stored
 * encrypted by the main process and only sent to GitHub.
 */
function Maintainer({ repo }: { repo: string }) {
  const [status, setStatus] = useState<MaintainerStatus | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { window.api.maintainerStatus().then(setStatus) }, [])
  const changed = (s: MaintainerStatus) => {
    setStatus(s)
    window.dispatchEvent(new Event('maintainer-changed'))
  }
  return (
    <section>
      <h2>Maintainer</h2>
      <p className="small muted">
        Only for people who maintain the catalog. With a GitHub token that may edit the issues of <b>{repo}</b>, the app shows a
        Review tab with shared setups and contributions waiting for a decision. The token is stored encrypted on this PC and sent only to GitHub.
      </p>
      {status?.hasToken ? (
        <p className="small">
          <span className={status.ok ? 'ok-text' : 'warn-text'}>{status.ok ? '✓ ' : ''}{status.message}</span>{' '}
          <a onClick={async () => changed(await window.api.clearMaintainerToken())}>Remove token</a>
        </p>
      ) : (
        <>
          <input className="wide" type="password" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />{' '}
          <button disabled={!token.trim() || busy} onClick={async () => {
            setBusy(true)
            const s = await window.api.setMaintainerToken(token)
            setBusy(false)
            if (s.hasToken) setToken('')
            changed(s)
          }}>{busy ? 'Checking…' : 'Save and check'}</button>
          {status?.message && <p className="small warn-text">{status.message}</p>}
          <p className="small muted">
            How to make one: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token → Repository access:
            only {repo} → Permissions: Issues “Read and write”.
          </p>
        </>
      )}
    </section>
  )
}
