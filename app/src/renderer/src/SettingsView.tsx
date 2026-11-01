import { useEffect, useState } from 'react'
import { DEFAULTS, type Settings } from '@shared/api'
import { useData } from './data'

export function SettingsView({ onSaved }: { onSaved(s: Settings): void }) {
  const data = useData()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    window.api.appVersion().then(setVersion)
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
      <p className="small muted">WH3 Lewd Mod Manager {version} · <a onClick={() => window.api.openExternal(`https://github.com/${DEFAULTS.contribRepo}/releases`)}>Releases</a></p>
      {saved && <p className="small muted">Saved. Catalog changes apply after restarting the app.</p>}
    </div>
  )
}
