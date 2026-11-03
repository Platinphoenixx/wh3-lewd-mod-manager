import { useEffect, useMemo, useState } from 'react'
import type { Profile } from '@shared/profile'
import { setupFromProfile } from '@shared/setups'
import { useData } from './data'

/**
 * Shares a profile as a setup other players can install from Play (relay /setup). Only the mod list with its load
 * order, the template it builds on, the game version and what the player writes here are sent. A list of catalog
 * mods appears after the next daily catalog update; one with own mods waits for a maintainer.
 */
export function ShareDialog({ profile: given, presetIds, onClose }: { profile?: Profile; presetIds?: string[]; onClose(): void }) {
  const data = useData()
  const [profiles, setProfiles] = useState<Profile[]>(given ? [given] : [])
  const [id, setId] = useState(given?.id ?? '')
  const [shownAs, setShownAs] = useState('')
  const [far, setFar] = useState('')
  const [notes, setNotes] = useState('')
  const [name, setName] = useState(given?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  // Opened from a character's page: the player's profiles for that character.
  useEffect(() => {
    if (given) return
    window.api.listProfiles().then((list) => {
      const mine = list.filter((p) => !presetIds || presetIds.includes(p.presetId))
      setProfiles(mine)
      if (mine[0]) { setId(mine[0].id); setName(mine[0].name) }
    })
  }, [given, presetIds])

  const profile = profiles.find((p) => p.id === id)
  const preset = profile && data.catalog.presets.find((p) => p.id === profile.presetId)
  const setup = useMemo(() => (profile && preset
    ? setupFromProfile(data.catalog, data.index, preset, profile, {
      name: name.trim(), shownAs: shownAs.trim() || undefined, far: far.trim() || undefined, notes: notes.trim() || undefined,
      game: data.scan?.gameVersion, catalog: data.catalog.generatedAt.slice(0, 10)
    })
    : null), [profile, preset, name, shownAs, far, notes, data])
  // Compared by mod (or external) id with the template: what the player added and left out.
  const diff = useMemo(() => {
    if (!setup || !preset) return null
    const mine = new Set(setup.entries.map((e) => e.mod))
    const base = new Set(preset.entries.map((e) => (e.target ? Object.values(e.target)[0] : e.pack)))
    return { added: [...mine].filter((x) => !base.has(x!)).length, dropped: [...base].filter((x) => !mine.has(x)).length }
  }, [setup, preset])

  const send = async () => {
    if (!setup) return
    setBusy(true)
    const r = await window.api.sendSetup(setup)
    setBusy(false)
    setDone(r.message)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>×</button>
        <h2>Share this setup</h2>
        {done ? (
          <>
            <p className="callout">{done}</p>
            <button onClick={onClose}>Close</button>
          </>
        ) : !profiles.length ? (
          <>
            <p>You have no profile for this yet. Make one (or bring your list from another launcher on the Play page), play it, then share it from here or from the profile.</p>
            <button onClick={onClose}>Close</button>
          </>
        ) : (
          <div className="form">
            <p className="small muted">Other players see it on the character's page and can install it with one click. Votes from players who played it decide its place.</p>
            {!given && profiles.length > 1 && (
              <label>Profile
                <select value={id} onChange={(e) => { setId(e.target.value); setName(profiles.find((p) => p.id === e.target.value)?.name ?? '') }}>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            {setup && preset && (
              <p className="share-sum">
                based on <b>{preset.name}</b> · <b>+ {diff?.added ?? 0}</b> mods · <b>− {diff?.dropped ?? 0}</b> left out
                · <b>{setup.own.length}</b> own mods{setup.game ? <> · game <b>{setup.game}</b></> : null}
              </p>
            )}
            <label>Name<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
            <label>Shown as<input value={shownAs} maxLength={40} placeholder="Anonymous (or a nickname)" onChange={(e) => setShownAs(e.target.value)} /></label>
            <label>How far did you play?<input value={far} maxLength={120} placeholder="e.g. turn 160, corruption stage 7" onChange={(e) => setFar(e.target.value)} /></label>
            <label>Notes for players<textarea rows={3} value={notes} maxLength={1000} placeholder="What it is good for, what you changed and why (no links)" onChange={(e) => setNotes(e.target.value)} /></label>
            <p className="small muted">
              Sent: the mod list in its load order, the template it is based on, the game version and what you wrote. Not sent: your name,
              file paths, your other profiles. {setup?.own.length ? 'Your own mods go by pack name only, and a maintainer checks them before the setup is shown.' : 'It appears in the app within a day.'}
            </p>
            <div className="form-actions">
              <button className="primary" disabled={!setup || !name.trim() || busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Share'}</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
