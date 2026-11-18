import { useState } from 'react'
import { OTHER_APPS } from '@shared/api'
import stellarisIcon from './assets/stellaris-icon.png'

const ICONS: Record<string, string> = { stellaris: stellarisIcon }
const KEY = 'otherAppsHidden'

/**
 * The maintainer's other apps (2026-11-18: the Stellaris Lewd Playset Builder, linked to its LoversLab page), on Play
 * below the Continue cards. × puts one away for good (localStorage); an app added to the list later shows again.
 */
export function OtherApps() {
  const [hidden, setHidden] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
  })
  const shown = OTHER_APPS.filter((a) => !hidden.includes(a.id))
  if (!shown.length) return null
  const hide = (id: string) => {
    const h = [...hidden, id]
    setHidden(h)
    try { localStorage.setItem(KEY, JSON.stringify(h)) } catch { /* shown again next time */ }
  }
  return (
    <div className="other-apps">
      {shown.map((a) => (
        <aside key={a.id} className="other-app" aria-label={`Also by the same maker: ${a.name}`}>
          {ICONS[a.id] && <img src={ICONS[a.id]} alt="" width={40} height={40} />}
          <div className="other-app-text">
            <div className="small muted">Also by the same maker</div>
            <b>{a.name}</b>
            <div className="small muted">{a.pitch}</div>
            <a className="small" onClick={() => window.api.openExternal(a.url)}>See it on LoversLab ↗</a>
          </div>
          <button className="link other-app-close" title="Hide" aria-label={`Hide ${a.name}`} onClick={() => hide(a.id)}>×</button>
        </aside>
      ))}
    </div>
  )
}
