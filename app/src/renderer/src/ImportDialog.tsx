import { useEffect, useState } from 'react'
import { keyForImported, profileFromImport, type ImportSource } from '@shared/importlist'
import type { Profile } from '@shared/profile'
import { isOwnKey } from '@shared/own'
import { useData } from './data'

/** Turns a mod list of another launcher into a profile (closest template + extras + own mods). */
export function ImportDialog({ onClose, onCreate }: { onClose(): void; onCreate(p: Profile): void }) {
  const data = useData()
  const [sources, setSources] = useState<ImportSource[] | null>(null)
  const [chosen, setChosen] = useState<ImportSource | null>(null)

  useEffect(() => {
    window.api.importSources().then(setSources, () => setSources([]))
  }, [])

  const pickFile = async () => {
    const s = await window.api.importTwmods()
    if (s) {
      setSources((list) => [...(list ?? []), s])
      setChosen(s)
    }
  }

  const plan = chosen ? profileFromImport(data.catalog, data.index, chosen.mods) : null
  const keys = chosen ? chosen.mods.map((m) => keyForImported(data.index, m)) : []
  const own = keys.filter(isOwnKey).length
  const template = plan && data.catalog.presets.find((p) => p.id === plan.presetId)

  const create = () => {
    if (!chosen || !plan) return
    const now = new Date().toISOString()
    onCreate({ id: crypto.randomUUID(), name: `Imported: ${chosen.label}`, ...plan, createdAt: now, updatedAt: now })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <h2>Import a mod list</h2>
        <p className="small muted">
          Takes the active mods of another launcher and makes a profile of them. Nothing in the other launcher is changed. The load
          order is rebuilt from the catalog's rules and the packs' contents, so check it once afterwards.
        </p>
        {sources === null && <p className="small">Looking for mod lists on this PC…</p>}
        {sources?.length === 0 && <p className="small">No CA launcher or WH3 Mod Manager lists found on this PC.</p>}
        <ul className="import-sources">
          {sources?.map((s) => (
            <li key={s.id} className={chosen?.id === s.id ? 'active' : ''} onClick={() => setChosen(s)}>
              <strong>{s.label}</strong> <span className="muted small">{s.mods.length} mods</span>
            </li>
          ))}
        </ul>
        <button onClick={pickFile}>Choose a .twmods file…</button>
        {chosen && plan && (
          <div className="callout small">
            <p>
              {chosen.mods.length} mods: {keys.length - own} known to the catalog, {own} of your own. Closest template:{' '}
              <strong>{template?.name ?? plan.presetId}</strong> ({plan.removed.length} of its mods switched off, {plan.extras.length} added).
            </p>
            <button className="primary" onClick={create}>Create profile</button>
          </div>
        )}
      </div>
    </div>
  )
}
