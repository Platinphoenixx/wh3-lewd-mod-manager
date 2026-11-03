import { useEffect, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import type { Mod, Preset } from '@catalog/schema'
import { lastMajorUpdate } from '@shared/health'
import { installSourceFor } from '@shared/install'
import { matchInstalled } from '@shared/match'
import { resolveProfile, type Profile } from '@shared/profile'
import {
  communityOf, guidedProfile, isFavourite, lateListOf, setupDiff, stepsFor, subjectsOf, suggestedFor, tiersFor, voteLine,
  type Step, type Subject, type Tier
} from '@shared/setups'
import type { PickOne, Suggestion } from '@shared/suggest'
import { useData } from './data'
import { ModCover } from './ModCover'
import { ImportDialog } from './ImportDialog'
import { guideFor } from './ProfilesView'
import { ShareDialog } from './ShareDialog'

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
  const [setup, setSetup] = useState<Preset | null>(null)
  const subject = subjects.find((s) => s.key === subjectKey)
  const home = () => { setTier(null); setSetup(null); setSubjectKey(null) }

  if (subject && tier) return <Guide subject={subject} tier={tier} onBack={() => setTier(null)} onHome={home} />
  if (subject && setup) return <SetupPage subject={subject} setup={setup} onBack={() => setSetup(null)} onHome={home} onContinue={setTier} />
  if (subject) return <SubjectPage subject={subject} onBack={home} onContinue={setTier} onOpenSetup={setSetup} />
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

/** A shared setup taken as it is: its own list is the template, nothing switched on yet; the choices come after. */
function setupTier(p: Preset): Tier {
  return { id: 'full', name: p.name, preset: p, extras: [], size: p.entries.length, lines: [], proof: '', tested: false, recommended: false }
}

function SubjectPage({ subject, onBack, onContinue, onOpenSetup }: { subject: Subject; onBack(): void; onContinue(t: Tier): void; onOpenSetup(p: Preset): void }) {
  const data = useData()
  const tiers = useMemo(() => tiersFor(data.catalog, data.index, subject), [data.catalog, data.index, subject])
  const shared = communityOf(subject)
  const favourite = shared.find((p) => isFavourite(p.votes))
  const [sharing, setSharing] = useState(false)
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
            {!t.extras.length && voteLine(t.preset.votes) && <div className="small">{voteLine(t.preset.votes)} said it worked</div>}
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
      {favourite && (
        <div className="play-fav">
          <div>
            <div className="rec">Community favourite</div>
            <h3>{favourite.name}</h3>
            <div className="small muted"><SetupFacts p={favourite} /></div>
          </div>
          <div className="right">
            <Votes p={favourite} />
            <button className="primary" onClick={() => onOpenSetup(favourite)}>Look inside →</button>
          </div>
        </div>
      )}
      <div className="play-head play-section">
        <h3>Setups from the community</h3>
        <button onClick={() => setSharing(true)}>Share your setup</button>
      </div>
      {shared.filter((p) => p !== favourite).length ? (
        <>
          <p className="small muted">Lists players shared from the app, best rated first. Votes come from players who played a setup; they are counted once a day.</p>
          <table className="play-comm">
            <tbody>
              {shared.filter((p) => p !== favourite).map((p) => (
                <tr key={p.id} onClick={() => onOpenSetup(p)}>
                  <td>
                    <b>{p.name}</b>
                    <div className="small muted"><SetupFacts p={p} /></div>
                    <SetupWarnings p={p} />
                  </td>
                  <td className="votes"><Votes p={p} /><div><a>Look inside</a></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : !favourite ? (
        <p className="small muted">No shared setups yet. Played a list that works well? Share it – other players can then install it with one click.</p>
      ) : null}
      {sharing && <ShareDialog presetIds={subject.presets.map((p) => p.id)} onClose={() => setSharing(false)} />}
    </div>
  )
}

function Votes({ p }: { p: Preset }) {
  const v = p.votes
  if (!v) return <span className="small muted">no votes yet</span>
  const n = v.up + v.down
  return (
    <span className="play-votes">▲ {v.up} worked · ▼ {v.down} didn't<span className="bar"><i style={{ width: `${Math.round((100 * v.up) / n)}%` }} /></span></span>
  )
}

/** "Full campaign + 14 − 2 · 68 mods · played to turn 160 · game 9.0.4 · shared by Velvet · 2026-10-21" */
function SetupFacts({ p }: { p: Preset }) {
  const data = useData()
  const base = data.catalog.presets.find((x) => x.id === p.community?.base)
  const d = setupDiff(p, base)
  return (
    <>
      {base ? `${base.name}${d.added.length ? ` + ${d.added.length}` : ''}${d.dropped.length ? ` − ${d.dropped.length}` : ''} · ` : ''}
      {p.entries.length} mods{p.community?.far ? ` · played to ${p.community.far}` : ''}{p.community?.game ? ` · game ${p.community.game}` : ''}
      {` · shared by ${p.source.author ?? 'anonymous'}`}{p.source.date ? ` · ${p.source.date}` : ''}
    </>
  )
}

/** Played before the last big game update, or more players saying it did not work. */
function SetupWarnings({ p }: { p: Preset }) {
  const data = useData()
  const major = lastMajorUpdate(data.catalog.gameUpdates)
  const old = !!major && !!p.source.date && Date.parse(p.source.date) < major.date
  const bad = !!p.votes && p.votes.down > p.votes.up
  return (
    <>
      {old && <div className="play-warn small">Shared before the last big game update ({major!.title}); it may not start.</div>}
      {bad && <div className="play-warn small">More players say it did not work than that it did.</div>}
    </>
  )
}

function SetupPage({ subject, setup, onBack, onHome, onContinue }: { subject: Subject; setup: Preset; onBack(): void; onHome(): void; onContinue(t: Tier): void }) {
  const data = useData()
  const base = data.catalog.presets.find((x) => x.id === setup.community?.base)
  const d = setupDiff(setup, base)
  const chip = (key: string) => {
    const m = key.startsWith('mod:') ? data.index.mods.get(key.slice(4)) : undefined
    const name = m?.name ?? data.catalog.external.find((e) => `external:${e.id}` === key)?.name ?? key.slice(key.indexOf(':') + 1)
    return <div key={key} className="play-chip" onClick={() => m && data.openMod(m.id)}><div className="ph">{m && <ModCover mods={[m]} />}</div><span>{name}</span></div>
  }
  return (
    <div className="content play">
      <div className="play-crumbs"><a onClick={onHome}>Play</a> › <a onClick={onBack}>{subject.name}</a> › Shared setup</div>
      <div className="play-head"><h2>{setup.name}</h2><Votes p={setup} /></div>
      <p className="small muted"><SetupFacts p={setup} /></p>
      <SetupWarnings p={setup} />
      {setup.description && <p className="play-lead">“{setup.description}”</p>}
      <div className="play-diff">
        <div><h4>Added to {base?.name ?? 'the template'} · {d.added.length}</h4><div className="play-chips">{d.added.map(chip)}</div></div>
        <div>
          <h4>Left out · {d.dropped.length}</h4><div className="play-chips">{d.dropped.map(chip)}</div>
          <h4 style={{ marginTop: 14 }}>Own mods (not in the catalog) · {setup.community?.own?.length ?? 0}</h4>
          {setup.community?.own?.length
            ? <p className="small muted">{setup.community.own.join(', ')} – checked by a maintainer; you need these files yourself.</p>
            : <p className="small muted">None – everything comes from the catalog.</p>}
        </div>
      </div>
      <p className="callout small">Load order: as the player had it. The next step shows the remaining choices with pictures; what the player chose is already in the list.</p>
      <div className="play-foot">
        <button className="primary" onClick={() => onContinue(setupTier(setup))}>Use this setup →</button>
        <a className="play-advanced" onClick={() => data.openProfile({ preset: setup.id })}>Advanced: open it in the full editor</a>
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
