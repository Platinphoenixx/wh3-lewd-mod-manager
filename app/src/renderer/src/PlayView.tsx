import { useEffect, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import type { Mod } from '@catalog/schema'
import { installSourceFor } from '@shared/install'
import { matchInstalled } from '@shared/match'
import { resolveProfile, type Profile } from '@shared/profile'
import { guidedProfile, lateListOf, stepsFor, subjectsOf, suggestedFor, tiersFor, type Step, type Subject, type Tier } from '@shared/setups'
import type { PickOne, Suggestion } from '@shared/suggest'
import { useData } from './data'
import { ModCover } from './ModCover'
import { ImportDialog } from './ImportDialog'
import { guideFor } from './ProfilesView'

/** Where a mod comes from, as the player meets it (the order the installer uses: Steam > LoversLab > Discord > Nexus). */
function sourceLabel(m: Mod): string {
  if (m.sources.steam?.length) return 'Steam Workshop · one click'
  if (m.sources.loverslab) return 'LoversLab · account needed'
  if (m.sources.discord) return 'Discord · download by hand'
  if (m.sources.nexus) return 'Nexus Mods · account needed'
  return 'Download by hand'
}

/**
 * "Play": the guided way to a profile. Pick a character or a theme, how much content, then the choices with pictures;
 * the result is an ordinary profile that installs and starts from the Profiles tab. Every page links to the full editor.
 */
export function PlayView() {
  const data = useData()
  const subjects = useMemo(() => subjectsOf(data.catalog, data.index), [data.catalog, data.index])
  const [subjectKey, setSubjectKey] = useState<string | null>(null)
  const [tier, setTier] = useState<Tier | null>(null)
  const subject = subjects.find((s) => s.key === subjectKey)

  if (subject && tier) return <Guide subject={subject} tier={tier} onBack={() => setTier(null)} onHome={() => { setTier(null); setSubjectKey(null) }} />
  if (subject) return <SubjectPage subject={subject} onBack={() => setSubjectKey(null)} onContinue={setTier} />
  return <Home subjects={subjects} onOpen={setSubjectKey} />
}

function Home({ subjects, onOpen }: { subjects: Subject[]; onOpen(key: string): void }) {
  const data = useData()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [importing, setImporting] = useState(false)
  useEffect(() => { window.api.listProfiles().then(setProfiles) }, [])
  const recent = [...profiles].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3)
  const card = (s: Subject) => (
    <div key={s.key} className="play-card" onClick={() => onOpen(s.key)}>
      <div className="ph"><ModCover mods={s.coverMods.map((id) => data.index.mods.get(id))} placeholder={s.name} /></div>
      <div className="body">
        <div className="name">{s.name}</div>
        {s.kind === 'theme' && <div className="small muted">{s.characters.slice(0, 4).join(', ')}{s.characters.length > 4 ? ' …' : ''}</div>}
        <div className="small muted">
          {s.presets.length} ready-made list{s.presets.length === 1 ? '' : 's'}
          {s.presets.some((p) => p.launchTest?.result === 'main menu') ? ' · launch-tested' : ''}
        </div>
      </div>
    </div>
  )
  const characters = subjects.filter((s) => s.kind === 'character')
  const themes = subjects.filter((s) => s.kind === 'theme')
  return (
    <div className="content play">
      <div className="play-head">
        <h2>Who do you want to play?</h2>
        <a className="play-advanced" onClick={() => data.goTab('profiles')}>Advanced: all templates and the full editor</a>
      </div>
      <p className="play-lead">Pick a character or a theme. You choose how much content you want, the app walks you through the choices (looks, add-ons, heroes) and installs everything.</p>
      <div className="play-mine">
        {recent.map((p) => (
          <div key={p.id} className="play-small" onClick={() => data.openProfile({ profile: p.id })}>
            <div className="small muted">Continue</div><b>{p.name}</b>
            <div className="small muted">{data.catalog.presets.find((x) => x.id === p.presetId)?.name ?? 'template missing'} · {p.extras.length} extras</div>
          </div>
        ))}
        <div className="play-small" onClick={() => setImporting(true)}>
          <div className="small muted">Already have a list that works?</div><b>Bring it from another launcher</b>
          <div className="small muted">CA launcher, WH3 Mod Manager or a .twmods file</div>
        </div>
      </div>
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onCreate={(p) => {
            setImporting(false)
            void window.api.saveProfile(p).then(() => data.openProfile({ profile: p.id }, 'install'))
          }}
        />
      )}
      <h3 className="play-section">Play as</h3>
      <div className="play-grid">{characters.map(card)}</div>
      {themes.length > 0 && (
        <>
          <h3 className="play-section">Themes</h3>
          <p className="small muted">Lists about a group or a story rather than one character.</p>
          <div className="play-grid">{themes.map(card)}</div>
        </>
      )}
    </div>
  )
}

function SubjectPage({ subject, onBack, onContinue }: { subject: Subject; onBack(): void; onContinue(t: Tier): void }) {
  const data = useData()
  const tiers = useMemo(() => tiersFor(data.catalog, data.index, subject), [data.catalog, data.index, subject])
  const [chosen, setChosen] = useState<Tier | undefined>(() => tiers.find((t) => t.recommended) ?? tiers[0])
  const main = tiers.find((t) => t.recommended) ?? tiers[0]
  const guide = main && guideFor(data.catalog.campaignGuides, main.preset)
  const late = lateListOf(subject)
  return (
    <div className="content play">
      <div className="play-crumbs"><a onClick={onBack}>Play</a> › {subject.name}</div>
      <div className="play-hero">
        <div className="ph"><ModCover mods={subject.coverMods.map((id) => data.index.mods.get(id))} placeholder={subject.name} /></div>
        <div>
          <div className="play-head">
            <h2>{subject.name}</h2>
            {main && <a className="play-advanced" onClick={() => data.openProfile({ preset: main.preset.id })}>Advanced: open the template in the full editor</a>}
          </div>
          {subject.kind === 'theme' && <p className="small muted">{subject.characters.join(', ')}</p>}
          <div className="markdown play-lead"><Markdown>{main?.preset.description ?? ''}</Markdown></div>
          {guide && guide.dlc.length > 0 && <p className="small muted">Needs the DLC {guide.dlc.map((d) => d.name).join(', ')}.</p>}
        </div>
      </div>
      <h3>How much do you want?</h3>
      <div className="play-tiers">
        {tiers.map((t) => (
          <div key={t.id} className={`play-tier${chosen?.id === t.id ? ' sel' : ''}`} onClick={() => setChosen(t)}>
            <div className="rec">{t.recommended ? 'Recommended' : ' '}</div>
            <h3>{t.name}</h3>
            <div><span className="size">{t.size}</span> <span className="muted">mods</span></div>
            <ul>{t.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            <div className="spacer" />
            <div className={`proof${t.tested ? '' : ' no'}`}>{t.tested ? '✓ ' : ''}{t.proof}</div>
          </div>
        ))}
      </div>
      {late && (
        <p className="callout">
          This campaign has a late-game list for the later corruption stages ({late.name}, {late.entries.length} mods).{' '}
          <a onClick={() => data.openProfile({ preset: late.id })}>Open it in the full editor</a>
        </p>
      )}
      <div className="play-foot">
        {chosen && <button className="primary" onClick={() => onContinue(chosen)}>Continue with {chosen.name} →</button>}
        <span className="small muted">Next: a few choices with pictures, then the download.</span>
      </div>
    </div>
  )
}

function OptionCard({ s, selected, onClick, preselected }: { s: Suggestion | null; selected: boolean; onClick(): void; preselected?: boolean }) {
  const data = useData()
  if (!s) return null
  return (
    <div className={`play-opt${selected ? ' sel' : ''}`} onClick={onClick}>
      <div className="ph"><ModCover mods={[s.mod]} placeholder={s.mod.name} /></div>
      <div className="body">
        {preselected && <div className="tag">Most players</div>}
        <div className="t">{s.mod.name}</div>
        {s.replaces && <div className="rep">Replaces {s.replaces.join(', ')}</div>}
        <div className="why">{s.reasons.filter((r) => !r.startsWith('Replaces')).join(' · ')}</div>
        <div className="src">{sourceLabel(s.mod)} · <a onClick={(e) => { e.stopPropagation(); data.openMod(s.mod.id) }}>details</a></div>
      </div>
    </div>
  )
}

function NoneCard({ label, selected, onClick }: { label: string; selected: boolean; onClick(): void }) {
  return (
    <div className={`play-opt none${selected ? ' sel' : ''}`} onClick={onClick}>
      <div className="ph"><span className="placeholder">{label}</span></div>
      <div className="body"><div className="t">{label}</div><div className="why">Nothing extra to download</div></div>
    </div>
  )
}

const NONE = 'none'

function Guide({ subject, tier, onBack, onHome }: { subject: Subject; tier: Tier; onBack(): void; onHome(): void }) {
  const data = useData()
  // The choices are worked out once for the chosen size; picking an option does not reshuffle the questions.
  const picks = useMemo(() => suggestedFor(data.catalog, data.index, tier.preset, { extras: tier.extras, removed: [] }).picks, [data.catalog, data.index, tier])
  const base = useMemo(() => resolveProfile(data.catalog, data.index, tier.preset, { extras: tier.extras, removed: [] }), [data.catalog, data.index, tier])
  const qol = useMemo(() => base.entries.flatMap((e) => {
    const m = e.key.startsWith('mod:') ? data.index.mods.get(e.key.slice(4)) : undefined
    return m?.tags.includes('general') ? [{ key: e.key, mod: m }] : []
  }), [base, data.index])
  const steps = useMemo(() => stepsFor(subject, picks, qol.length > 0), [subject, picks, qol])
  const [at, setAt] = useState(0)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [dropped, setDropped] = useState<Set<string>>(new Set())
  const step = steps[Math.min(at, steps.length - 1)]
  const choice = (g: PickOne) => chosen[g.pick[0].key] ?? g.preselect ?? NONE
  const pick = (g: PickOne, key: string) => setChosen((c) => ({ ...c, [g.pick[0].key]: key }))

  const group = (g: PickOne, keep: string) => (
    <div className="play-opts">
      <NoneCard label={keep} selected={choice(g) === NONE} onClick={() => pick(g, NONE)} />
      {g.pick.slice(0, 11).map((s) => <OptionCard key={s.key} s={s} preselected={s.key === g.preselect} selected={choice(g) === s.key} onClick={() => pick(g, s.key)} />)}
    </div>
  )
  const keepLabel = (st: Step) => (st.subtitle === 'Already in your list' ? "Keep the list's look" : st.title.endsWith("'s look") ? "Keep the game's look" : 'None of these')

  return (
    <div className="content play">
      <div className="play-crumbs"><a onClick={onHome}>Play</a> › <a onClick={onBack}>{subject.name}</a> › {tier.name}</div>
      <div className="play-wizard">
        <ul className="play-steps">
          {steps.map((s, i) => (
            <li key={s.id} className={i === at ? 'on' : i < at ? 'done' : ''} onClick={() => setAt(i)}>
              {s.title}{s.subtitle && <span className="sub">{s.subtitle}</span>}
            </li>
          ))}
          <li className="adv"><a className="play-advanced" onClick={() => save('choices')}>Advanced: full editor</a></li>
        </ul>
        <div>
          {step.kind === 'review' ? <Review /> : (
            <>
              <h2>{step.question}</h2>
              {step.kind === 'pick' && group(step.groups[0], keepLabel(step))}
              {step.kind === 'others' && (
                <>
                  <p className="play-lead">Optional. Each changes how one character looks; nothing is added unless you pick it.</p>
                  {step.groups.map((g) => (
                    <div key={g.pick[0].key}>
                      <h3 className="play-section">{/^They all change how (.+) looks$/.exec(g.note)?.[1] ?? g.note}</h3>
                      {group(g, "Keep the game's look")}
                    </div>
                  ))}
                </>
              )}
              {step.kind === 'qol' && (
                <>
                  <p className="play-lead">These come with the list and change no lewd content. Untick what you don't want.</p>
                  <div className="play-toggles">
                    {qol.map(({ key, mod }) => (
                      <label key={key} className="play-toggle">
                        <input type="checkbox" checked={!dropped.has(key)} onChange={(e) => setDropped((d) => { const n = new Set(d); if (e.target.checked) n.delete(key); else n.add(key); return n })} />
                        <div className="ph"><ModCover mods={[mod]} /></div>
                        <div><b>{mod.name}</b><div className="small muted">{mod.summary}</div></div>
                      </label>
                    ))}
                  </div>
                </>
              )}
              <div className="play-foot">
                <button disabled={at === 0} onClick={() => setAt(at - 1)}>← Back</button>
                <button className="primary" onClick={() => setAt(at + 1)}>Next →</button>
                <span className="small muted">Step {at + 1} of {steps.length} · every choice can be changed later in the profile</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )

  function profile(): Profile {
    return guidedProfile(tier, chosen, picks, dropped, `${subject.name} – ${tier.name}`)
  }

  function save(view: 'choices' | 'install') {
    const p = profile()
    void window.api.saveProfile(p).then(() => data.openProfile({ profile: p.id }, view))
  }

  function Review() {
    const p = profile()
    const r = resolveProfile(data.catalog, data.index, tier.preset, p)
    const installed = data.scan ? matchInstalled(data.index, data.scan.packs).known : new Map()
    const mods = r.entries.flatMap((e) => (e.key.startsWith('mod:') && data.index.mods.get(e.key.slice(4)) ? [{ e, m: data.index.mods.get(e.key.slice(4))! }] : []))
    const GROUPS: [string, (m: Mod) => boolean][] = [
      ['Story and corruption', (m) => ['campaign', 'progression', 'framework'].includes(m.kind)],
      ['Characters, units and buildings', (m) => ['units', 'submod'].includes(m.kind)],
      ['Looks', (m) => ['reskin', 'assets'].includes(m.kind)],
      ['Fixes and translations', (m) => ['patch', 'translation', 'utility'].includes(m.kind)]
    ]
    const lewd = mods.filter(({ m }) => !m.tags.includes('general'))
    const general = mods.filter(({ m }) => m.tags.includes('general'))
    // Counted as the install step counts them: per Workshop item, and tools like MCT included.
    const sources = r.entries.filter((e) => !installed.has(e.key)).map((e) => installSourceFor(data.catalog, data.index, e))
    const steam = new Set(sources.flatMap((s) => (s.kind === 'steam' ? [s.id] : []))).size
    const ll = sources.filter((s) => s.kind === 'loverslab').length
    const other = sources.filter((s) => s.kind !== 'steam' && s.kind !== 'loverslab').length
    const missing = sources
    const n = (k: number) => `${k} mod${k === 1 ? '' : 's'}`
    const chip = ({ m }: { m: Mod }) => <div key={m.id} className="play-chip" onClick={() => data.openMod(m.id)}><div className="ph"><ModCover mods={[m]} /></div><span>{m.name}</span></div>
    const used = new Set<string>()
    return (
      <>
        <h2>What you get</h2>
        <p className="play-lead">{r.entries.length} mods for {subject.name} – {tier.name}. Nothing is installed until you start it below.</p>
        <div className="play-review">
          <div>
            {GROUPS.map(([title, f]) => {
              const ms = lewd.filter(({ m }) => !used.has(m.id) && f(m))
              ms.forEach(({ m }) => used.add(m.id))
              return ms.length ? <div key={title} className="play-group"><h4>{title} · {ms.length}</h4><div className="play-chips">{ms.map(chip)}</div></div> : null
            })}
            {(() => { const rest = lewd.filter(({ m }) => !used.has(m.id)); return rest.length ? <div className="play-group"><h4>More · {rest.length}</h4><div className="play-chips">{rest.map(chip)}</div></div> : null })()}
            {general.length > 0 && <div className="play-group"><h4>Quality of life · {general.length}</h4><div className="play-chips">{general.map(chip)}</div></div>}
          </div>
          <div>
            <div className="play-box">
              <h3>Download</h3>
              <div className="line"><span>Steam Workshop</span><span>{n(steam)} · one click, Steam downloads them</span></div>
              <div className="line"><span>LoversLab</span><span>{n(ll)} · one window, your LoversLab account</span></div>
              {other > 0 && <div className="line"><span>Other sources</span><span>{n(other)} · Discord / Nexus, the app shows the files</span></div>}
              {r.entries.length - missing.length > 0 && <div className="line"><span>Already installed</span><span>{r.entries.length - missing.length}</span></div>}
              <button className="primary wide-button" onClick={() => save('install')}>Save as profile and install</button>
              <p className="small muted">Saved as your profile “{subject.name} – {tier.name}”. The next page installs the missing mods in the list's load order; ▶ Play starts the game.</p>
            </div>
            <p className="callout small">Want to change the load order, add your own mods or browse everything that fits? <a onClick={() => save('choices')}>Open it in the full editor</a> – your choices stay.</p>
          </div>
        </div>
      </>
    )
  }
}
