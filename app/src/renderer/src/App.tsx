import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import type { Catalog } from '@catalog/schema'
import { DEFAULTS, type GameScan, type ScriptReport, type Settings } from '@shared/api'
import { withUserRules, type UserRule } from '@shared/community'
import { buildIndex } from '@shared/match'
import { DataContext, type AppData } from './data'
import { ProfilesView } from './ProfilesView'
import { CatalogView } from './CatalogView'
import { InstallView } from './InstallView'
import { SettingsView } from './SettingsView'
import { CommunityView } from './CommunityView'
import { ModDetail } from './ModDetail'
import { ContributeDialog, type ContributeRequest } from './ContributeDialog'
import { announceInstalled } from './OwnMods'
import { NoticeStack, useNotices } from './Notices'
import { ReportDialog } from './ReportDialog'
import { groupFailures } from '@shared/report'

const TABS = ['profiles', 'catalog', 'install', 'community', 'settings'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, string> = { profiles: 'Profiles', catalog: 'Catalog', install: 'Installation', community: 'Community', settings: 'Settings' }

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [scan, setScan] = useState<GameScan | null>(null)
  const [rules, setRules] = useState<UserRule[]>([])
  const [settings, setSettings] = useState<Settings>({})
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1).split('-')[0] // e.g. #profiles-order
    return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'profiles'
  })
  const [openModId, setOpenModId] = useState<string | null>(null)
  const [contributing, setContributing] = useState<ContributeRequest | null>(null)
  const [blurImages, setBlurImages] = useState(() => localStorage.getItem('blurImages') === '1')
  const { notices, notify, dismiss } = useNotices()
  const [tabCounts, setTabCounts] = useState<Partial<Record<Tab, { n: number; error?: boolean; title: string }>>>({})
  const setTabCount = useCallback<AppData['setTabCount']>((t, c) => setTabCounts((m) => {
    if (!c && !m[t]) return m
    if (c && m[t]?.n === c.n && m[t]?.error === c.error && m[t]?.title === c.title) return m
    const next = { ...m }
    if (c) next[t] = c
    else delete next[t]
    return next
  }), [])
  const [scripts, setScripts] = useState<ScriptReport | null>(null)
  const [reportFor, setReportFor] = useState<number | null>(null)

  const rescan = useCallback(() => {
    window.api.scanGame().then(setScan, (e) => setError(String(e)))
  }, [])

  useEffect(() => {
    window.api.getCatalog().then(setCatalog, (e) => setError(String(e)))
    window.api.listRules().then(setRules)
    window.api.getSettings().then(setSettings)
    rescan()
  }, [rescan])

  useEffect(() => localStorage.setItem('blurImages', blurImages ? '1' : '0'), [blurImages])

  // Script errors of the last game start: counted on the Installation tab, read again when a game the app started closes.
  useEffect(() => {
    window.api.scriptReport().then(setScripts, () => setScripts(null))
  }, [scan])
  useEffect(() => {
    const n = groupFailures(scripts?.failed ?? []).length
    setTabCount('install', n ? { n, error: true, title: `Script errors in ${n} mod${n === 1 ? '' : 's'} at the last game start` } : null)
  }, [scripts, setTabCount])
  useEffect(() => window.api.onGameExited(async ({ startedAt }) => {
    const s = await window.api.scriptReport().catch(() => null)
    setScripts(s)
    if (!s?.written || s.written < startedAt) return // the game did not get far enough to write its log
    if (!s.failed.length) {
      notify({ kind: 'done', text: 'Game closed – no script errors.' })
      return
    }
    const n = groupFailures(s.failed).length
    // Stays until closed: the player is often still away from the screen when the game closes.
    notify({
      kind: 'error',
      timeout: 0,
      text: `Game closed – script errors in ${n} mod${n === 1 ? '' : 's'} during the last session.`,
      actions: [
        { label: 'Report to the modder…', run: () => { setTab('install'); setReportFor(0) } },
        { label: 'Details', run: () => setTab('install') }
      ]
    })
  }), [notify])

  const saveRules = useCallback((next: UserRule[]) => {
    setRules(next)
    void window.api.saveRules(next)
  }, [])

  // The user's own rules are merged into the catalog, so every view (profiles, options, load order) respects them.
  const effective = useMemo(() => (catalog ? withUserRules(catalog, rules) : null), [catalog, rules])
  const index = useMemo(() => (effective ? buildIndex(effective) : null), [effective])

  // Names for Workshop items the catalog does not know, asked once per item from the Steam client.
  const [workshopDetails, setWorkshopDetails] = useState<AppData['workshopDetails']>({})
  useEffect(() => {
    if (!scan || !index) return
    const ids = [...new Set(scan.packs.filter((p) => p.steamId && !index.bySteamId.has(p.steamId)).map((p) => p.steamId!))]
    if (ids.length) window.api.workshopDetails(ids).then(setWorkshopDetails, () => {})
  }, [scan, index])

  // Files dropped anywhere are installed; an open profile switches them on (see OwnMods).
  const [dragging, setDragging] = useState(false)
  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
    if (!paths.length) return
    notify({ id: 'drop', kind: 'info', text: 'Installing…', timeout: 0 })
    const r = await window.api.installPaths(paths)
    notify({ id: 'drop', kind: r.ok ? 'done' : 'error', text: r.message })
    if (r.ok) {
      rescan()
      announceInstalled({ packs: r.packs })
    }
  }

  if (error) return <div className="fatal">Could not start: {error}</div>
  if (!effective || !index) return <div className="loading">Loading catalog…</div>

  const data: AppData = {
    catalog: effective, index, scan, rescan, openMod: setOpenModId, blurImages,
    rules, saveRules, contribute: setContributing, contribRepo: settings.contribRepo || DEFAULTS.contribRepo, relayUrl: settings.relayUrl || DEFAULTS.relayUrl, settings, workshopDetails,
    notify, setTabCount, scripts, openReport: setReportFor
  }

  return (
    <DataContext.Provider value={data}>
      <div
        className={`app ${blurImages ? 'blur-images' : ''}`}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={onDrop}
      >
        {dragging && <div className="drop-overlay" onDragLeave={() => setDragging(false)}>Drop .pack, .7z, .zip or .rar files to install them</div>}
        <header className="topbar">
          <h1>WH3 Lewd Mod Manager</h1>
          <nav>
            {TABS.map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {TAB_LABEL[t]}
                {tabCounts[t] && <span className={`tab-count${tabCounts[t].error ? ' error' : ''}`} title={tabCounts[t].title}>{tabCounts[t].n}</span>}
              </button>
            ))}
          </nav>
          <label className="toggle">
            <input type="checkbox" checked={blurImages} onChange={(e) => setBlurImages(e.target.checked)} />
            Blur images
          </label>
          <span className="meta">
            {effective.mods.length} mods · catalog {effective.generatedAt.slice(0, 10)}
          </span>
        </header>
        <main>
          {tab === 'profiles' && <ProfilesView />}
          {tab === 'catalog' && <CatalogView />}
          {tab === 'install' && <InstallView />}
          {tab === 'community' && <CommunityView />}
          {tab === 'settings' && <SettingsView onSaved={(s) => setSettings(s)} />}
        </main>
        {openModId && <ModDetail id={openModId} onClose={() => setOpenModId(null)} />}
        {contributing && <ContributeDialog req={contributing} onClose={() => setContributing(null)} />}
        {reportFor !== null && scripts?.failed[reportFor] && <ReportDialog failure={reportFor} onClose={() => setReportFor(null)} />}
        <NoticeStack notices={notices} dismiss={dismiss} />
      </div>
    </DataContext.Provider>
  )
}
