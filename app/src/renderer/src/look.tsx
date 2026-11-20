import { useEffect, useState } from 'react'
import { useData, type AppData } from './data'

/**
 * The app's look (mocks/g1–g8): Bronze, the default, or Slaanesh – rose and lilac, ornaments, a few headings in the
 * theme's voice and pictures from Slaanesh mods. Kept per PC in the app's own storage and set on <html data-theme>
 * before the first render (main.tsx), so the app never flashes the other look.
 */
export type Look = 'bronze' | 'slaanesh'
const KEY = 'look'
const OFFERED = 'lookOffered'
const EVENT = 'wh3lmm-look'

export function readLook(): Look {
  try {
    return localStorage.getItem(KEY) === 'slaanesh' ? 'slaanesh' : 'bronze'
  } catch {
    return 'bronze'
  }
}

/** The game's own Slaanesh mark, read from the player's ui.pack by the main process (wh3lmm://game/…). */
export const SLAANESH_ICON = 'wh3lmm://game/slaanesh-icon'
let probed = false
/** Once it has loaded, <html data-sla-icon="game"> puts it where the look has its rosette (styles.css). */
function probeIcon(): void {
  if (probed) return
  probed = true
  const img = new Image()
  img.onload = () => {
    // Set here, not in styles.css: the build would try to resolve the address as a file.
    document.documentElement.style.setProperty('--sla-icon', `url("${SLAANESH_ICON}")`)
    document.documentElement.dataset.slaIcon = 'game'
  }
  img.src = SLAANESH_ICON
}

/** The look's mark: the game's Slaanesh icon, or the rosette when the game is not found. */
export const SlaMark = () => <i className="sla-mark" aria-hidden="true" />

export function applyLook(look: Look = readLook()): void {
  probeIcon()
  if (look === 'slaanesh') document.documentElement.dataset.theme = 'slaanesh'
  else delete document.documentElement.dataset.theme
}

export function setLook(look: Look): void {
  try { localStorage.setItem(KEY, look) } catch { /* then only for this session */ }
  applyLook(look)
  window.dispatchEvent(new Event(EVENT))
}

export function useLook(): Look {
  const [look, set] = useState(readLook)
  useEffect(() => {
    const on = () => set(readLook())
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return look
}

/** Asked once per PC, at the first start of a version that has the looks. */
export function lookOffered(): boolean {
  try {
    return !!localStorage.getItem(OFFERED)
  } catch {
    return true // without storage it would ask at every start
  }
}
export function markLookOffered(): void {
  try { localStorage.setItem(OFFERED, new Date().toISOString().slice(0, 10)) } catch { /* see lookOffered */ }
}

/**
 * Pictures of the Slaanesh look, picked by the maintainer from Slaanesh mods' own pages: the mod and a piece of the
 * picture's address (so a re-ordered gallery does not swap it). They load from the mod's page like every mod picture;
 * none is stored in the repository. The corner picture changes with every start.
 */
const BANNERS = [{ mod: 'dc-more-lustful-daemonettes-varieties-standalone', match: '4694CDE6E007567B799DD7B97B63C0DC2293B041' }]
const CORNERS = [
  { mod: 'steam-3698854498', match: '5C61CB9043213AE8F78E726662AE43BE1DB6FBBA' },
  { mod: 'll-42028', match: 'Alarielle_placeholder_1' }
]
const cornerPick = Math.floor(Math.random() * CORNERS.length)

export interface LookPicture { url: string; modId: string; name: string }

function resolve(data: Pick<AppData, 'index'>, p: { mod: string; match: string }): LookPicture | null {
  const mod = data.index.mods.get(p.mod)
  const img = mod?.images?.find((i) => i.url.includes(p.match))
  return mod && img ? { url: img.url, modId: mod.id, name: mod.name } : null
}

export const lookBanner = (data: Pick<AppData, 'index'>) => resolve(data, BANNERS[0])
export const lookCorner = (data: Pick<AppData, 'index'>) => resolve(data, CORNERS[cornerPick]) ?? CORNERS.map((c) => resolve(data, c)).find(Boolean) ?? null
export const lookPictures = (data: Pick<AppData, 'index'>) => [...BANNERS, ...CORNERS].map((p) => resolve(data, p)).filter((p): p is LookPicture => !!p)

/** The faint picture in the bottom right corner (App.tsx); nothing in the Bronze look. */
export function LookCorner() {
  const data = useData()
  const look = useLook()
  const pic = look === 'slaanesh' ? lookCorner(data) : null
  return pic ? <div className="look-corner" aria-hidden="true" style={{ backgroundImage: `url("${pic.url}")` }} /> : null
}

/** The banner behind Play's heading, with its credit (PlayView). */
export function LookBanner() {
  const data = useData()
  const look = useLook()
  const pic = look === 'slaanesh' ? lookBanner(data) : null
  if (!pic) return null
  return (
    <>
      <div className="look-banner" aria-hidden="true" style={{ backgroundImage: `url("${pic.url}")` }} />
      <div className="look-banner-tint" aria-hidden="true" />
      <div className="look-credit small"><SlaMark /> Picture: <a onClick={() => data.openMod(pic.modId)}>{pic.name}</a></div>
    </>
  )
}

/** Small drawn previews of both looks for the settings and the one-time question (no screenshots, no pictures). */
export function LookPreview({ look }: { look: Look }) {
  const s = look === 'slaanesh'
  return (
    <div className={`look-preview ${look}`}>
      <div className="lp-bar"><span className="lp-title">{s && <><SlaMark />{' '}</>}<span className="lp-name">WH3 Lewd Mod Manager</span></span><span className="lp-play">▶ Play</span></div>
      <div className="lp-line" />
      <div className="lp-body">
        <div className="lp-head">{s ? <><SlaMark /> Who will you indulge as?</> : 'Who do you want to play?'}</div>
        <div className="lp-cards"><i /><i className="hot" /><i /></div>
      </div>
    </div>
  )
}

/** Asked once at the first start of 0.2.0 (and at a fresh install): try the new look? */
export function LookOffer({ onClose }: { onClose(): void }) {
  const done = (look?: Look) => {
    markLookOffered()
    if (look) setLook(look)
    onClose()
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') done() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return (
    <div className="modal-backdrop">
      <div className="modal look-offer" role="dialog" aria-label="A new look">
        <h2>New in 0.2.0: a Slaanesh look</h2>
        <p className="look-offer-lead">A second look for the app – rose and lilac, silken ornaments, pictures from Slaanesh mods and a few words in the
          Dark Prince's voice. Only colours, decorations and headings change; everything works as before.</p>
        <div className="look-choices">
          <div><LookPreview look="bronze" /><div className="small muted look-cap">Bronze – as now</div></div>
          <div><LookPreview look="slaanesh" /><div className="small look-cap slaanesh">Slaanesh</div></div>
        </div>
        <div className="look-offer-actions">
          <button className="primary look-try" onClick={() => done('slaanesh')}><SlaMark /> Try the Slaanesh look</button>
          <button onClick={() => done('bronze')}>Keep Bronze</button>
          <span className="small muted">Switch any time in Settings → Look of the app</span>
        </div>
      </div>
    </div>
  )
}

/** Settings → Look of the app. */
export function LookSetting() {
  const data = useData()
  const look = useLook()
  const pics = lookPictures(data)
  return (
    <section>
      <h2>Look of the app</h2>
      <div className="look-choices settings">
        {(['bronze', 'slaanesh'] as const).map((l) => (
          <label key={l} className={`look-choice${look === l ? ' on' : ''}`}>
            <input type="radio" name="look" checked={look === l} onChange={() => setLook(l)} />
            <LookPreview look={l} />
            <span>{l === 'bronze' ? <>Bronze <span className="muted small">(default)</span></> : 'Slaanesh'}</span>
          </label>
        ))}
      </div>
      <p className="small muted">Only changes colours, ornaments, a few headings and pictures; everything else stays the same. Switches right away.</p>
      {pics.length > 0 && (
        <p className="small muted">
          Pictures in the Slaanesh look, from the mods' own pages:{' '}
          {pics.map((p, i) => <span key={p.url}>{i ? ', ' : ''}<a onClick={() => data.openMod(p.modId)}>{p.name}</a></span>)}
        </p>
      )}
    </section>
  )
}
