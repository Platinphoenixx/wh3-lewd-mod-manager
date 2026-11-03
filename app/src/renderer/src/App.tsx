import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { Catalog } from '@catalog/schema'
import { DEFAULTS, SUPPORT_URL, type GameScan, type ScriptReport, type Settings } from '@shared/api'
import { withUserRules, type UserRule } from '@shared/community'
import { buildIndex } from '@shared/match'
import { DataContext, type AppData } from './data'
import { ProfilesView } from './ProfilesView'
import { PlayView } from './PlayView'
import { PageGuard } from './PageGuard'
import { ReviewView } from './ReviewView'
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
import { harmlessNote } from '@shared/health'

const TABS = ['play', 'profiles', 'catalog', 'install', 'community', 'settings', 'review'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, string> = { play: 'Play', profiles: 'Profiles', catalog: 'Catalog', install: 'Installation', community: 'Community', settings: 'Settings', review: 'Review' }

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [scan, setScan] = useState<GameScan | null>(null)
  const [rules, setRules] = useState<UserRule[]>([])
  const [settings, setSettings] = useState<Settings>({})
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1).split('-')[0] // e.g. #profiles-order
    return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'play'
  })
  const [focus, setFocus] = useState<AppData['focus']>(null)
  // Maintainers (a working GitHub token in Settings) get the Review tab with what waits for a decision.
  const [maintainer, setMaintainer] = useState(false)
  const openProfile = useCallback<AppData['openProfile']>((target, view) => {
    // The editor opens at the step named in the address (#profiles-install).
    location.hash = view ? `profiles-${view}` : 'profiles'
    setFocus({ ...target, at: Date.now() })
    setTab('profiles')
  }, [])
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

  useEffect(() => {
    const check = () => window.api.maintainerStatus().then((s) => {
      setMaintainer(s.ok)
      if (s.ok) window.api.reviewList().then((l) => setTabCount('review', l.length ? { n: l.length, title: `${l.length} waiting for review` } : null), () => {})
      else setTabCount('review', null)
    }, () => setMaintainer(false))
    void check()
    window.addEventListener('maintainer-changed', check)
    return () => window.removeEventListener('maintainer-changed', check)
  }, [setTabCount])

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
  // Errors the catalog knows as harmless are shown on the Installation tab but not counted.
  const catalogRef = useRef<Catalog | null>(null)
  catalogRef.current = catalog
  const realFailures = (failed: ScriptReport['failed']) => failed.filter((f) => !catalogRef.current || !harmlessNote(catalogRef.current, f))
  useEffect(() => {
    const n = groupFailures(realFailures(scripts?.failed ?? [])).length
    setTabCount('install', n ? { n, error: true, title: `Script errors in ${n} mod${n === 1 ? '' : 's'} at the last game start` } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts, catalog, setTabCount])
  // A newer app release (asked at most daily): one card with the download page; nothing installs by itself.
  useEffect(() => {
    window.api.appUpdate().then((u) => u && notify({
      kind: 'info',
      timeout: 0,
      text: `Version ${u.version} of WH3 Lewd Mod Manager is available.`,
      actions: [{ label: 'Open download page', run: () => void window.api.openExternal(u.url) }]
    }), () => {})
  }, [notify])
  useEffect(() => window.api.onGameExited(async ({ startedAt }) => {
    const s = await window.api.scriptReport().catch(() => null)
    setScripts(s)
    if (!s?.written || s.written < startedAt) return // the game did not get far enough to write its log
    const real = realFailures(s.failed)
    if (!real.length) {
      const known = s.failed.length - real.length
      notify({ kind: 'done', text: `Game closed – no script errors${known ? ` (only ${known === 1 ? 'a known, harmless message' : `${known} known, harmless messages`})` : ''}.` })
      return
    }
    const n = groupFailures(real).length
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

  // After a real session (20 minutes or more), one question per profile and day: did it work? The answer counts for
  // the template or shared setup the profile is based on (relay /vote; shown on the Play page after the daily update).
  useEffect(() => window.api.onGameExited(async ({ ranMs }) => {
    if (ranMs < 20 * 60 * 1000) return
    const snap = await window.api.lastLaunch().catch(() => null)
    if (!snap?.template?.id) return
    const asked = `asked:${snap.profile.id}:${new Date().toISOString().slice(0, 10)}`
    try {
      if (localStorage.getItem(asked)) return
      localStorage.setItem(asked, '1')
    } catch { /* without storage it may ask twice a day */ }
    // Community fixes the profile uses get the same answer (shown with the fix on the mod's Play page).
    const fixes = Object.values((await window.api.listProfiles().catch(() => [])).find((p) => p.id === snap.profile.id)?.fixes ?? {})
    const vote = (worked: boolean, reason?: 'start' | 'campaign' | 'content' | 'other') => {
      for (const f of fixes) void window.api.sendVote({ setup: f, worked, reason })
      return window.api.sendVote({ setup: snap.template.id, worked, reason }).then((r) => notify({ kind: r.ok ? 'done' : 'error', text: r.message }))
    }
    const why = () => notify({
      kind: 'info', timeout: 0, text: 'What went wrong?',
      actions: [
        { label: 'Crash at start', run: () => void vote(false, 'start') },
        { label: 'Crash in the campaign', run: () => void vote(false, 'campaign') },
        { label: 'Content missing or broken', run: () => void vote(false, 'content') },
        { label: 'Other', run: () => void vote(false, 'other') }
      ]
    })
    notify({
      kind: 'info', timeout: 0,
      text: `Did “${snap.profile.name}” work for you? Your answer counts for “${snap.template.name}” on the Play page.`,
      actions: [
        { label: '▲ It worked', run: () => void vote(true) },
        { label: '▼ It didn’t', run: why },
        { label: 'Not now', run: () => {} }
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
    notify, setTabCount, scripts, openReport: setReportFor, openProfile, focus, goTab: setTab
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
            {TABS.filter((t) => t !== 'review' || maintainer).map((t) => (
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
            {effective.mods.filter((m) => m.kind !== 'collection').length} mods · catalog {effective.generatedAt.slice(0, 10)}
          </span>
          <a className="support" title="Support this app on Ko-fi" onClick={() => window.api.openExternal(SUPPORT_URL)}>♥ Support this app</a>
        </header>
        <main>
          <PageGuard key={tab} onReset={() => setTab('play')}>
          {tab === 'play' && <PlayView />}
          {tab === 'profiles' && <ProfilesView />}
          {tab === 'catalog' && <CatalogView />}
          {tab === 'install' && <InstallView />}
          {tab === 'community' && <CommunityView />}
          {tab === 'settings' && <SettingsView onSaved={(s) => setSettings(s)} />}
          {tab === 'review' && maintainer && <ReviewView onCount={(n) => setTabCount('review', n ? { n, title: `${n} waiting for review` } : null)} />}
          </PageGuard>
        </main>
        {openModId && <ModDetail id={openModId} onClose={() => setOpenModId(null)} />}
        {contributing && <ContributeDialog req={contributing} onClose={() => setContributing(null)} />}
        {reportFor !== null && scripts?.failed[reportFor] && <ReportDialog failure={reportFor} onClose={() => setReportFor(null)} />}
        <NoticeStack notices={notices} dismiss={dismiss} />
      </div>
    </DataContext.Provider>
  )
}
