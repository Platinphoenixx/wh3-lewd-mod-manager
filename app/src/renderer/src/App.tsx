import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Catalog } from '@catalog/schema'
import { DEFAULTS, type GameScan, type Settings } from '@shared/api'
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
    const h = location.hash.slice(1)
    return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'profiles'
  })
  const [openModId, setOpenModId] = useState<string | null>(null)
  const [contributing, setContributing] = useState<ContributeRequest | null>(null)
  const [blurImages, setBlurImages] = useState(() => localStorage.getItem('blurImages') === '1')

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

  const saveRules = useCallback((next: UserRule[]) => {
    setRules(next)
    void window.api.saveRules(next)
  }, [])

  // The user's own rules are merged into the catalog, so every view (profiles, options, load order) respects them.
  const effective = useMemo(() => (catalog ? withUserRules(catalog, rules) : null), [catalog, rules])
  const index = useMemo(() => (effective ? buildIndex(effective) : null), [effective])

  if (error) return <div className="fatal">Could not start: {error}</div>
  if (!effective || !index) return <div className="loading">Loading catalog…</div>

  const data: AppData = {
    catalog: effective, index, scan, rescan, openMod: setOpenModId, blurImages,
    rules, saveRules, contribute: setContributing, contribRepo: settings.contribRepo || DEFAULTS.contribRepo
  }

  return (
    <DataContext.Provider value={data}>
      <div className={`app ${blurImages ? 'blur-images' : ''}`}>
        <header className="topbar">
          <h1>WH3 Lewd Mod Manager</h1>
          <nav>
            {TABS.map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
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
      </div>
    </DataContext.Provider>
  )
}
