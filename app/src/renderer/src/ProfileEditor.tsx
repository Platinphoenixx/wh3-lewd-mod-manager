import { useEffect, useMemo, useRef, useState } from 'react'
import type { Preset } from '@catalog/schema'
import type { InstalledPack } from '@shared/api'
import { matchInstalled, parseTargetKey } from '@shared/match'
import { activeProfile, baseKeys, candidates, dependentsOf, everythingOn, nameOf, resolveProfile, type Candidate, type CandidateGroup, type Profile } from '@shared/profile'
import { checkProfile, conflictPoint, moveAbove, oldPoint, withFlag, type CheckAction, type CheckPoint } from '@shared/check'
import { checkOwnMod, isOwnKey, ownKeyOf, placeOwnMods, type FactsReport, type OrderedEntry } from '@shared/own'
import { KIND_LABEL, useData } from './data'
import { ModCover, withParents } from './ModCover'
import { ConflictList } from './ConflictList'
import { InstallPanel, type UsedFix } from './InstallPanel'
import { AddOwnMod, CheckLines, INSTALLED_EVENT, keysForInstalled, OwnCard, ownName, type InstalledDetail } from './OwnMods'
import { pickVariants, planLaunch, variantGroups, variantLabels } from '@shared/launch'
import { missingPacks } from '@shared/install'
import { MadeBy, worksOf } from './Creators'
import { lastMajorUpdate, olderThanGame } from '@shared/health'
import type { LaunchSnapshot } from '@shared/report'
import { ideaGroups, isPickOne, suggestForProfile, type Suggestion } from '@shared/suggest'
import { DecideChoices, SuggestedMods } from './Suggestions'
import { ShareDialog } from './ShareDialog'
import { ProfileCheck, ProfileIdeas } from './ProfileCheck'
import { FlagDialog, FlagLink } from './FlagDialog'

const GROUP_TITLE: Record<CandidateGroup, string> = {
  recommended: 'Recommended by mods in this profile',
  character: 'For your character',
  translation: 'Translations',
  other: 'More lewd mods',
  general: 'General mods (gameplay, UI, visuals)'
}

const NO_FACTS: FactsReport = { packs: {}, overlaps: [] }

function OptionCard({ c, on, toggle }: { c: Candidate; on: boolean; toggle(): void }) {
  const data = useData()
  return (
    <article className={`option ${on ? 'on' : ''} ${c.conflicts.length ? 'has-conflict' : ''}`}>
      <div className="thumb" onClick={() => c.mod && data.openMod(c.mod.id)}>
        <ModCover mods={c.mod ? withParents(data.index.mods, c.mod) : []} placeholder={c.mod ? KIND_LABEL[c.mod.kind] : 'External'} />
      </div>
      <div className="body">
        <label className="option-head">
          <input type="checkbox" checked={on} onChange={toggle} />
          <strong>{c.name}</strong>
        </label>
        <div className="badges">
          {c.mod && <span className="badge">{KIND_LABEL[c.mod.kind]}</span>}
          {c.superseded && <span className="badge status-superseded">outdated</span>}
          {c.mod?.curation.confidence === 'low' && <span className="badge warn">unverified</span>}
        </div>
        <p className="small">{c.mod?.recommendedFor ?? c.mod?.summary}</p>
        {c.reasons.slice(0, 2).map((r) => <p key={r} className="small muted">{r}</p>)}
        {c.alternativeTo.length > 0 && (
          <p className="small warn-text">Alternative to {c.alternativeTo.map((k) => nameOf(data.catalog, data.index, k)).join(', ')} – use only one</p>
        )}
        {c.conflicts.length > 0 && (
          <p className="small danger">Conflicts with: {c.conflicts.map((k) => nameOf(data.catalog, data.index, k)).join(', ')}</p>
        )}
        {c.addsDependencies.length > 0 && (
          <p className="small muted">Also adds: {c.addsDependencies.map((k) => nameOf(data.catalog, data.index, k)).join(', ')}</p>
        )}
        {c.mod && <a className="small" onClick={() => data.openMod(c.mod!.id)}>Details</a>}
      </div>
    </article>
  )
}

export function ProfileEditor({ profile, preset, onChange, onDelete }: {
  profile: Profile; preset: Preset; onChange(p: Profile): void; onDelete(): void
}) {
  const data = useData()
  // Steps: 1 choices, 2 install, 3 load order & play; "credits" is the Made by list. Without a choice the
  // profile opens where there is something to do: install while mods are missing, else load order & play.
  // An imported list also has Check (what the catalog would warn about) and Ideas (what fits it).
  type View = 'choices' | 'install' | 'order' | 'credits' | 'check' | 'ideas'
  const [chosenView, setView] = useState<View | null>(() => {
    const m = location.hash.match(/-(choices|options|install|order|credits|check|ideas)$/)
    return m ? (m[1] === 'options' ? 'choices' : (m[1] as View)) : null
  })
  const [browsing, setBrowsing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [flagging, setFlagging] = useState<CheckPoint | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<CandidateGroup>>(new Set())
  const [hideConflicts, setHideConflicts] = useState(true)

  const options = useMemo(() => candidates(data.catalog, data.index, preset, profile), [data.catalog, data.index, preset, profile])
  // What is loaded (mods switched off in the load order left out), and the whole list the load order view shows.
  const active = useMemo(() => activeProfile(profile), [profile])
  const resolved = useMemo(() => resolveProfile(data.catalog, data.index, preset, active), [data.catalog, data.index, preset, active])
  const resolvedAll = useMemo(() => resolveProfile(data.catalog, data.index, preset, everythingOn(profile)), [data.catalog, data.index, preset, profile])
  const suggestions = useMemo(() => suggestForProfile(data.catalog, data.index, preset, profile, options), [data.catalog, data.index, preset, profile, options])
  // Choices the player turned down stay away; pick-one choices go to "Decide", single suggestions to "Add more".
  const declined = new Set(profile.declined ?? [])
  const entries = [...suggestions.lewd, ...suggestions.general]
  const picks = entries.filter(isPickOne).filter((p) => !p.pick.some((s) => declined.has(s.key)))
  // A look choice where the list already changes the look by stage has its answer selected: nothing to decide.
  const toDecide = picks.filter((p) => !p.stage)
  const singles = (list: typeof suggestions.lewd) => list.filter((e): e is Suggestion => !isPickOne(e) && !declined.has(e.key))

  // Installed packs by profile key: catalog mods, and the player's own mods (packs the catalog does not know).
  const matched = useMemo(
    () => (data.scan ? matchInstalled(data.index, data.scan.packs) : { known: new Map<string, InstalledPack[]>(), unknown: [] as InstalledPack[] }),
    [data.scan, data.index]
  )
  const ownGroups = useMemo(() => {
    const m = new Map<string, InstalledPack[]>()
    for (const p of matched.unknown) m.set(ownKeyOf(p), [...(m.get(ownKeyOf(p)) ?? []), p])
    return m
  }, [matched])
  const installed = useMemo(() => new Map([...matched.known, ...ownGroups]), [matched, ownGroups])
  // Not installed, or installed only in part: the first missing pack decides what to fetch (its Workshop item); every
  // other Workshop item the mod still lacks is fetched in the same go (a mod made of four items needs no four rounds).
  const missingEntries = resolved.entries.flatMap((e) => {
    const t = parseTargetKey(e.key)
    const lack = missingPacks('mod' in t ? data.index.mods.get(t.mod) : undefined, e.packs ?? e.pack, installed.get(e.key) ?? [])
    const downloads = lack.filter((p) => !(p.from === 'steam' && p.steamId)).map((p) => p.file)
    const first = !installed.has(e.key) ? { ...e, need: downloads }
      : lack.length ? { ...e, pack: lack[0].file, steamId: lack[0].steamId ?? (lack[0].from === 'steam' ? e.steamId : undefined), from: lack[0].from, need: downloads }
      : null
    if (!first) return []
    const items = [...new Set(lack.filter((p) => p.from === 'steam' && p.steamId && p.steamId !== first.steamId).map((p) => p.steamId!))]
    return [first, ...items.map((id) => ({ ...e, pack: lack.find((p) => p.steamId === id)!.file, steamId: id, from: 'steam' as const }))]
  })
  const incomplete = new Set(missingEntries.map((e) => e.key))
  // Community fixes the profile uses (Play with a mod that does not start as published).
  const usedFixes: UsedFix[] = Object.entries(profile.fixes ?? {}).flatMap(([modId, fixId]) => {
    const mod = data.index.mods.get(modId)
    const fix = mod?.fixes?.find((f) => f.id === fixId)
    return mod && fix ? [{ mod, fix, installed: (installed.get(`mod:${modId}`) ?? []).some((p) => p.fix === fixId) }] : []
  })
  // A fresh profile (nothing installed yet) starts with its choices, since they change what gets installed.
  const fresh = incomplete.size === resolved.entries.length
  const goTo = (v: View) => {
    setView(v)
    document.querySelector('.content')?.scrollTo({ top: 0 })
  }
  const installedKeys = useMemo(() => {
    const m = new Map<string, string>()
    for (const [k, packs] of installed) for (const p of packs) m.set(p.file.toLowerCase(), k)
    return m
  }, [installed])

  // What the packs contain (dependencies, shared files), read by the main process and cached there.
  const [facts, setFacts] = useState<FactsReport | null>(null)
  const factKey = useMemo(
    () => [...new Set([...resolved.entries.flatMap((e) => installed.get(e.key) ?? []), ...matched.unknown].map((p) => p.path))].sort().join('\n'),
    [resolved, installed, matched]
  )
  useEffect(() => {
    let live = true
    window.api.packFacts(factKey ? factKey.split('\n') : []).then((f) => live && setFacts(f), () => {})
    return () => { live = false }
  }, [factKey])

  const ownAll = useMemo(
    () => profile.extras.filter(isOwnKey).map((k) => ({ key: k, name: ownName(data, k, installed.get(k) ?? []), paths: (installed.get(k) ?? []).map((p) => p.path) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile.extras, installed, data.workshopDetails]
  )
  const ownOn = useMemo(() => ownAll.filter((o) => !profile.off?.includes(o.key)), [ownAll, profile.off])
  const orderOf = (r: typeof resolved, own: typeof ownAll): OrderedEntry[] => placeOwnMods(
    r.entries.map((e) => ({ key: e.key, name: e.name, paths: (installed.get(e.key) ?? []).map((p) => p.path) })), own, facts ?? NO_FACTS, profile.pins ?? {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const order = useMemo(() => orderOf(resolved, ownOn), [resolved, ownOn, installed, facts, profile.pins])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const orderAll = useMemo(() => orderOf(resolvedAll, ownAll), [resolvedAll, ownAll, installed, facts, profile.pins])
  const byKey = new Map(resolved.entries.map((e) => [e.key, e]))
  const byKeyAll = new Map(resolvedAll.entries.map((e) => [e.key, e]))

  // An imported list: what the catalog would warn about, in the list's own order.
  const imported = !!profile.imported
  const orderKeys = order.map((o) => o.key)
  const kept = profile.keptPoints ?? []
  const points = useMemo(
    () => (imported ? checkProfile(data.catalog, data.index, preset, active, resolved, orderKeys, (k) => byKey.get(k)?.packs) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imported, data.catalog, data.index, preset, active, profile.fixes, resolved, orderKeys.join('\n')]
  )
  const openPoints = points.filter((p) => !kept.includes(p.rule) && !profile.flagged?.[p.rule])
  const ideaCount = imported ? ideaGroups(entries, declined).reduce((n, g) => n + g.ideas.length, 0) : 0
  const view: View = chosenView ?? (imported
    ? (openPoints.length ? 'check' : missingEntries.length ? 'install' : 'order')
    : toDecide.length && fresh ? 'choices' : missingEntries.length ? 'install' : 'order')
  const doAction = (a: CheckAction) => {
    if (a.type === 'fix') return data.contribute({ type: 'fix', modId: a.key.replace(/^mod:/, '') })
    if (a.type === 'add') return addExtras([a.key])
    if (a.type === 'move' && a.above && profile.imported) return onChange({ ...profile, imported: { ...profile.imported, order: moveAbove(orderKeys, a.key, a.above) } })
    if (a.type === 'remove') {
      onChange({
        ...profile,
        extras: profile.extras.filter((k) => k !== a.key),
        removed: baseKeys(preset).includes(a.key) && !profile.removed.includes(a.key) ? [...profile.removed, a.key] : profile.removed
      })
    }
  }
  const flagSent = (rule: string) => {
    setFlagging(null)
    onChange({ ...profile, flagged: { ...profile.flagged, [rule]: new Date().toISOString().slice(0, 10) } })
  }
  const unflag = async (rule: string) => {
    const r = await window.api.sendFlag({ rule, withdraw: true })
    data.notify({ kind: r.ok ? 'done' : 'error', text: r.message })
    if (!r.ok) return
    const flagged = { ...profile.flagged }
    delete flagged[rule]
    onChange({ ...profile, flagged })
  }
  const flagLink = (p: CheckPoint) => <FlagLink rule={p.rule} flagged={profile.flagged} onFlag={() => setFlagging(p)} onUnflag={() => void unflag(p.rule)} />

  // Last update of a mod. Steam mods: the Workshop date, else (unlisted items have none) the time Steam
  // last wrote the installed pack, which is never earlier than the update. LoversLab dates only count
  // for mods that live on LoversLab alone (moved mods keep an old page). Packs in data: their file date
  // (archives keep the author's date).
  const updatedOf = (o: OrderedEntry): number | undefined => {
    const t = parseTargetKey(o.key)
    const mod = 'mod' in t ? data.index.mods.get(t.mod) : undefined
    const packs = installed.get(o.key) ?? []
    const steamDates = (mod?.sources.steam ?? []).map((s) => s.updated).filter(Boolean).map((d) => Date.parse(d!))
    if (steamDates.length) return Math.max(...steamDates)
    if ('steamId' in t && data.workshopDetails[t.steamId]) return data.workshopDetails[t.steamId].updated * 1000
    const workshop = packs.filter((p) => p.source === 'workshop')
    if (workshop.length) return Math.max(...workshop.map((p) => p.mtime))
    if (mod?.sources.steam?.length) return undefined
    if (mod?.sources.loverslab?.updated) return Date.parse(mod.sources.loverslab.updated)
    return packs.length ? Math.max(...packs.map((p) => p.mtime)) : undefined
  }
  const changesData = (o: OrderedEntry) => o.paths.some((p) => (facts?.packs[p]?.tables.length ?? 0) > 0)
  // Compared with the last major game update (not hotfixes) the player has installed.
  const major = lastMajorUpdate(data.catalog.gameUpdates, data.scan?.gameUpdated)
  const stale = new Set(orderAll.filter((o) => olderThanGame(updatedOf(o), major?.date, changesData(o))).map((o) => o.key))
  const gameDate = major ? `${new Date(major.date).toISOString().slice(0, 10)} (“${major.title}”)` : ''

  // Switch on what was just installed (dropped files, file picker, Workshop link).
  const latest = useRef(profile)
  latest.current = profile
  useEffect(() => {
    const onInstalled = (e: Event) => {
      const p = latest.current
      const add = keysForInstalled(data.index, (e as CustomEvent<InstalledDetail>).detail).filter((k) => !p.extras.includes(k))
      if (add.length) onChange({ ...p, extras: [...p.extras, ...add], removed: p.removed.filter((k) => !add.includes(k)) })
    }
    window.addEventListener(INSTALLED_EVENT, onInstalled)
    return () => window.removeEventListener(INSTALLED_EVENT, onInstalled)
  }, [data.index, onChange])

  const extras = new Set(profile.extras)
  const toggleExtra = (key: string) =>
    onChange({ ...profile, extras: extras.has(key) ? profile.extras.filter((k) => k !== key) : [...profile.extras, key], off: profile.off?.filter((k) => k !== key) })
  const addExtra = (key: string) => !extras.has(key) && onChange({ ...profile, extras: [...profile.extras, key] })
  const addExtras = (keys: string[]) => {
    const add = keys.filter((k) => !extras.has(k))
    if (add.length) onChange({ ...profile, extras: [...profile.extras, ...add], removed: profile.removed.filter((k) => !add.includes(k)) })
  }
  const toggleBase = (key: string) =>
    onChange({ ...profile, removed: profile.removed.includes(key) ? profile.removed.filter((k) => k !== key) : [...profile.removed, key] })

  // Switches in the load order: a template mod switched off goes to `removed`, an added or own mod to `off`; a mod that
  // only comes along as a requirement is switched with the mods that need it. Switching off what others need asks first.
  const loadedKeys = order.map((o) => o.key)
  const isOn = (key: string) => loadedKeys.includes(key)
  const [asking, setAsking] = useState<{ key: string; dependents: string[] } | null>(null)
  const switchKeys = (keys: string[], on: boolean) => {
    const base = new Set(baseKeys(preset))
    let removed = profile.removed
    let off = profile.off ?? []
    for (const k of keys) {
      if (base.has(k)) removed = on ? removed.filter((x) => x !== k) : removed.includes(k) ? removed : [...removed, k]
      else if (profile.extras.includes(k)) off = on ? off.filter((x) => x !== k) : off.includes(k) ? off : [...off, k]
    }
    setAsking(null)
    onChange({ ...profile, removed, off })
  }
  const switchOne = (key: string) => {
    if (isOn(key)) {
      const dependents = dependentsOf(data.index, loadedKeys, key)
      if (dependents.length) return setAsking({ key, dependents })
      return switchKeys([key], false)
    }
    // A requirement switched off together with what needs it comes back with that mod.
    if (byKeyAll.get(key)?.origin === 'dependency') {
      const all = orderAll.map((o) => o.key)
      const needers = dependentsOf(data.index, all, key).filter((k) => !isOn(k))
      return switchKeys(needers.length ? needers : [key], true)
    }
    switchKeys([key], true)
  }
  const offCount = orderAll.filter((o) => !isOn(o.key)).length

  // Moving an own mod pins it directly above its new lower neighbour; "auto" drops the pin again.
  const move = (key: string, dir: -1 | 1) => {
    const i = order.findIndex((e) => e.key === key)
    if (dir < 0 && i <= 0) return
    if (dir > 0 && i >= order.length - 1) return
    const target = dir < 0 ? order[i - 1].key : order[i + 2]?.key ?? null
    onChange({ ...profile, pins: { ...profile.pins, [key]: target } })
  }
  const unpin = (key: string) => {
    const pins = { ...profile.pins }
    delete pins[key]
    onChange({ ...profile, pins })
  }
  const share = (o: OrderedEntry) => {
    const check = checkOwnMod(order, o.key, facts ?? NO_FACTS, installedKeys)
    const i = order.findIndex((e) => e.key === o.key)
    const neighbours = [order[i - 1] && `loads below ${order[i - 1].name}`, order[i + 1] && `loads above ${order[i + 1].name}`].filter(Boolean)
    const steamId = o.key.startsWith('steamId:') ? o.key.slice(8) : ''
    data.contribute({
      type: 'new-mod',
      prefill: {
        name: o.name,
        links: steamId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${steamId}` : '',
        requirements: [
          `Pack: ${(installed.get(o.key) ?? []).map((p) => p.file).join(', ')}`,
          `In my load order it ${neighbours.join(' and ')}.`,
          ...check.overlaps.slice(0, 5).map((v) => (v.wins ? `Overrides ${v.count} files of ${v.name}.` : `${v.name} overrides ${v.count} of its files.`)),
          ...check.missing.map((m) => `Needs ${m}.`)
        ].join('\n')
      }
    })
  }

  const q = query.trim().toLowerCase()
  const visible = options.filter(
    (c) =>
      (!hideConflicts || !c.conflicts.length || extras.has(c.key)) &&
      (!q || [c.name, c.mod?.summary, ...c.reasons].some((s) => s?.toLowerCase().includes(q)))
  )
  // Switched-on extras stay visible in their group even though they are now part of the profile.
  const onCards = profile.extras
    .filter((k) => !isOwnKey(k) && !options.some((c) => c.key === k))
    .map((k): Candidate => {
      const t = parseTargetKey(k)
      const mod = 'mod' in t ? data.index.mods.get(t.mod) : undefined
      const superseded = ['superseded', 'abandoned'].includes(mod?.status ?? '')
      return { key: k, mod, name: nameOf(data.catalog, data.index, k), group: 'recommended', reasons: ['Switched on'], conflicts: [], alternativeTo: [], addsDependencies: [], superseded }
    })
  const ownKeys = [...new Set([...ownGroups.keys(), ...profile.extras.filter(isOwnKey)])]
    .map((k) => ({ k, name: ownName(data, k, installed.get(k) ?? []) }))
    .filter((o) => !q || o.name.toLowerCase().includes(q))
    .sort((a, b) => Number(extras.has(b.k)) - Number(extras.has(a.k)) || a.name.localeCompare(b.name))
  const groups: CandidateGroup[] = ['recommended', 'character', 'translation', 'other', 'general']
  const baseCount = resolved.entries.filter((e) => e.origin === 'base').length
  const groupsOf = (key: string) => {
    const t = parseTargetKey(key)
    return variantGroups('mod' in t ? data.index.mods.get(t.mod) : undefined)
  }
  const launch = useMemo(
    () => planLaunch(
      order.map((o) => ({ key: o.key, name: o.name, pack: byKey.get(o.key)?.pack, packs: byKey.get(o.key)?.packs, groups: groupsOf(o.key), chosen: profile.variants?.[o.key] })),
      (k) => installed.get(k) ?? []
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, installed, profile.variants]
  )
  // What ▶ Play warns about: mods without any installed pack and mods that miss a required one.
  const notReady = [...new Set([...missingEntries.map((e) => e.name), ...launch.missing, ...usedFixes.filter((u) => !u.installed).map((u) => `${u.mod.name} (community fix)`)])]
  // Installed pick-one variants of one entry (two or more of a group), for the version choice in the load order.
  const variantChoices = (key: string) => {
    const all = installed.get(key) ?? []
    const loaded = new Set(pickVariants(all, groupsOf(key), profile.variants?.[key]).map((p) => p.file))
    const mod = (() => { const t = parseTargetKey(key); return 'mod' in t ? data.index.mods.get(t.mod) : undefined })()
    return [...groupsOf(key)].flatMap(([group, files]) => {
      const present = files.filter((f) => all.some((p) => p.file.toLowerCase() === f.toLowerCase()))
      if (present.length < 2) return []
      const { caption, label } = variantLabels(mod, files)
      return [{ group, caption, options: present.map((f) => ({ file: f, label: label(f) })), loaded: present.find((f) => loaded.has(f)) ?? present[0] }]
    })
  }
  const chooseVariant = (key: string, group: string, file: string) =>
    onChange({ ...profile, variants: { ...profile.variants, [key]: { ...profile.variants?.[key], [group]: file } } })

  const play = async () => {
    if (notReady.length) {
      const list = notReady.slice(0, 15).join('\n')
      const more = notReady.length > 15 ? `\n…and ${notReady.length - 15} more` : ''
      if (!confirm(`${notReady.length} mods of this profile are not (completely) installed:\n\n${list}${more}\n\nStart the game with the ${launch.packs.length} installed packs anyway?`)) return
    }
    const started = new Set(launch.packs.map((p) => p.path))
    const baseIndex = new Map(resolved.entries.filter((e) => e.origin === 'base').map((e, i) => [e.key, i]))
    // What is started, kept by the app for problem reports (differences from the template, outdated mods).
    const snapshot: LaunchSnapshot = {
      at: Date.now(),
      profile: { id: profile.id, name: profile.name },
      template: { id: preset.id, name: preset.name, author: preset.source.author },
      game: { version: data.scan?.gameVersion, build: data.scan?.gameBuild, lastMajor: major },
      entries: order.map((o) => ({
        key: o.key,
        name: o.name,
        origin: o.own ? 'own' : byKey.get(o.key)?.origin === 'base' ? 'base' : 'extra',
        source: sourceOf(o.key),
        updated: updatedOf(o),
        changesData: changesData(o),
        stale: stale.has(o.key),
        templateIndex: baseIndex.get(o.key),
        paths: o.paths.filter((p) => started.has(p))
      })),
      removed: profile.removed.map((k) => nameOf(data.catalog, data.index, k))
    }
    const r = await window.api.launchGame(launch.packs.map((p) => p.path), snapshot)
    data.notify({ id: 'launch', kind: r.ok ? 'done' : 'error', text: r.message })
  }
  const sourceOf = (key: string): string | undefined => {
    const t = parseTargetKey(key)
    if ('steamId' in t) return `Workshop ${t.steamId}`
    if ('pack' in t) return 'data folder'
    const mod = 'mod' in t ? data.index.mods.get(t.mod) : undefined
    if (mod?.sources.steam?.length) return `Workshop ${mod.sources.steam[0].id}`
    if (mod?.sources.loverslab) return `LoversLab ${mod.sources.loverslab.fileId}`
    if (mod?.sources.nexus) return `Nexus ${mod.sources.nexus.modId}`
    return undefined
  }

  // Missing mods of the open profile as a counter on the Profiles tab.
  const missing = notReady.length
  useEffect(() => {
    data.setTabCount('profiles', missing ? { n: missing, title: `${missing} mod${missing === 1 ? '' : 's'} of this profile not installed` } : null)
    return () => data.setTabCount('profiles', null)
  }, [missing, data.setTabCount])

  return (
    <div className="profile-editor">
      <div className="profile-head">
        <input className="profile-name" size={Math.min(64, Math.max(24, profile.name.length + 2))} value={profile.name} onChange={(e) => onChange({ ...profile, name: e.target.value })} />
        <span className="muted small">based on “{preset.name}”</span>
        <span className="badge">{baseCount} from template</span>
        <span className="badge ok">{active.extras.length} switched on</span>
        <span className="badge">{order.length} mods total</span>
        {offCount > 0 && <span className="badge">{offCount} switched off</span>}
        <div className="profile-actions">
          <button className="primary play" onClick={play} disabled={!data.scan?.gamePath}>
            ▶ Play{notReady.length ? ` (${notReady.length} missing)` : ''}
          </button>
          <button title="Other players can install it from the Play page" onClick={() => setSharing(true)}>Share…</button>
          <button className="danger-btn" onClick={() => confirm(`Delete profile “${profile.name}”?`) && onDelete()}>Delete</button>
        </div>
      </div>
      {sharing && <ShareDialog profile={active} onClose={() => setSharing(false)} />}
      {flagging && <FlagDialog point={flagging} order={orderKeys} onClose={() => setFlagging(null)} onSent={flagSent} />}
      {profile.imported && <p className="small muted">Imported from {profile.imported.source} on {profile.imported.at.slice(0, 10)}, with its load order and packs. Closest template: {preset.name}.</p>}
      <nav className="subtabs steps">
        <button className={view === 'choices' ? 'active' : ''} onClick={() => goTo('choices')}>
          1 · Choices{!imported && toDecide.length > 0 && <span className="muted"> ({toDecide.length} to decide)</span>}
        </button>
        <button className={view === 'install' ? 'active' : ''} onClick={() => goTo('install')}>
          2 · Install{incomplete.size > 0 && <span className="muted"> ({incomplete.size} missing)</span>}
        </button>
        <button className={view === 'order' ? 'active' : ''} onClick={() => goTo('order')}>3 · Load order &amp; play</button>
        {imported && <button className={view === 'check' ? 'active' : ''} onClick={() => goTo('check')}>Check ({openPoints.length})</button>}
        {imported && <button className={view === 'ideas' ? 'active' : ''} onClick={() => goTo('ideas')}>Ideas ({ideaCount})</button>}
        <span className="spacer" />
        <button className={view === 'credits' ? 'active' : ''} onClick={() => goTo('credits')}>Made by</button>
      </nav>
      <p className="small muted">
        {imported ? 'Your list stays as it is until you change something; every step can be revisited, and the profile is saved as you go.' : 'Three steps: decide the optional parts, install what is missing, then press Play. Every step can be revisited; the profile is saved as you go.'}
      </p>
      {!imported && preset.phaseNote && <p className="callout">{preset.phaseNote}</p>}
      {!imported && resolved.notes.length > 0 && (
        <details className="callout small">
          <summary>{resolved.notes.length} special case{resolved.notes.length === 1 ? '' : 's'} to keep in mind (the template uses these mods together)</summary>
          <ul>
            {resolved.notes.map((c) => {
              const p = withFlag(conflictPoint(data.catalog, data.index, c, true), data.catalog.ruleFlags)
              return p && <li key={c.a + c.b}>{nameOf(data.catalog, data.index, c.a)} ↔ {nameOf(data.catalog, data.index, c.b)} – {p.why} {flagLink(p)}{p.status && <div className="doubt-status">{p.status}</div>}</li>
            })}
          </ul>
        </details>
      )}
      {!imported && resolved.conflicts.length > 0 && (
        <div className="callout warn">
          <strong>Conflicts in this profile</strong>
          <ul>
            {resolved.conflicts.map((c) => {
              const p = withFlag(conflictPoint(data.catalog, data.index, c), data.catalog.ruleFlags)
              return p && <li key={c.a + c.b}>{nameOf(data.catalog, data.index, c.a)} ↔ {nameOf(data.catalog, data.index, c.b)} – {p.why} {flagLink(p)}{p.status && <div className="doubt-status">{p.status}</div>}</li>
            })}
          </ul>
        </div>
      )}
      {view === 'check' && (
        <ProfileCheck
          points={points} kept={kept} flagged={profile.flagged} onAction={doAction} onFlag={setFlagging} onUnflag={(r) => void unflag(r)}
          onKeep={(r) => onChange({ ...profile, keptPoints: [...kept, r] })}
          onShowAgain={(r) => onChange({ ...profile, keptPoints: kept.filter((x) => x !== r) })}
        />
      )}
      {view === 'ideas' && <ProfileIdeas entries={entries} declined={declined} onAdd={addExtras} />}
      {view === 'choices' && (
        <>
          {imported && <p className="small muted">Ideas for this list are under <a onClick={() => goTo('ideas')}>Ideas</a>; everything else that works with it is here.</p>}
          {!imported && <DecideChoices
            picks={picks}
            flagged={profile.flagged}
            onFlag={setFlagging}
            onUnflag={(r) => void unflag(r)}
            onApply={(add, no) => {
              const keep = add.filter((k) => !extras.has(k))
              onChange({
                ...profile,
                extras: [...profile.extras, ...keep],
                removed: profile.removed.filter((k) => !keep.includes(k)),
                declined: [...new Set([...(profile.declined ?? []), ...no])]
              })
            }}
          />}
          {imported ? <p><button onClick={() => setBrowsing(!browsing)}>{browsing ? 'Hide the full list' : `Browse all ${options.length}`}</button></p> : <SuggestedMods
            lewd={singles(suggestions.lewd)}
            general={singles(suggestions.general)}
            character={suggestions.character}
            total={options.length}
            browsing={browsing}
            onAdd={addExtras}
            onBrowse={() => setBrowsing(!browsing)}
          />}
          {onCards.length > 0 && (
            <section>
              <h3>Switched on ({onCards.length})</h3>
              <div className="options">{onCards.map((c) => <OptionCard key={c.key} c={c} on toggle={() => toggleExtra(c.key)} />)}</div>
            </section>
          )}
          <section>
            <h3>Your mods ({ownKeys.length})</h3>
            <AddOwnMod />
            {ownKeys.length > 0 && (
              <div className="options">
                {ownKeys.map(({ k }) => {
                  const on = extras.has(k)
                  const packs = installed.get(k) ?? []
                  const preview = on ? order : placeOwnMods(order, [{ key: k, name: ownName(data, k, packs), paths: packs.map((p) => p.path) }], facts ?? NO_FACTS)
                  return (
                    <OwnCard key={k} k={k} packs={packs} on={on} toggle={() => toggleExtra(k)} order={facts ? preview : null}
                      facts={facts} installedKeys={installedKeys} onAdd={addExtra} />
                  )
                })}
              </div>
            )}
          </section>
          {browsing && (
            <div className="filters inline">
              <input placeholder="Search options…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <label className="toggle"><input type="checkbox" checked={hideConflicts} onChange={(e) => setHideConflicts(e.target.checked)} /> Hide conflicting</label>
            </div>
          )}
          {browsing && groups.map((g) => {
            const list = visible.filter((c) => c.group === g)
            if (!list.length) return null
            const collapsible = g === 'other' || g === 'translation' || g === 'general'
            const collapsed = collapsible && !expanded.has(g) && !q
            return (
              <section key={g}>
                <h3>
                  {GROUP_TITLE[g]} ({list.length})
                  {collapsible && !q && (
                    <button className="link" onClick={() => setExpanded((s) => new Set(s.has(g) ? [...s].filter((x) => x !== g) : [...s, g]))}>
                      {collapsed ? 'show' : 'hide'}
                    </button>
                  )}
                </h3>
                {!collapsed && <div className="options">{list.map((c) => <OptionCard key={c.key} c={c} on={extras.has(c.key)} toggle={() => toggleExtra(c.key)} />)}</div>}
              </section>
            )
          })}
          <p className="step-next"><button onClick={() => goTo('install')}>Next: 2 · Install →</button></p>
        </>
      )}

      {view === 'install' && (
        <section>
          <InstallPanel missing={missingEntries} characters={preset.playAs} fixes={usedFixes} />
          <p className="step-next"><button onClick={() => goTo('order')}>Next: 3 · Load order &amp; play →</button></p>
        </section>
      )}

      {view === 'credits' && <MadeBy preset={preset} works={worksOf(data, order.map((o) => parseTargetKey(o.key)))} />}

      {view === 'order' && (
        <section>
          {missingEntries.length > 0 && (
            <p className="callout warn small">
              {incomplete.size} mod{incomplete.size === 1 ? ' is' : 's are'} not installed yet.{' '}
              <button className="link" onClick={() => goTo('install')}>Install {incomplete.size === 1 ? 'it' : 'them'}</button>
            </p>
          )}
          {stale.size > 0 && (
            <p className="callout warn small">
              {stale.size} mod{stale.size === 1 ? '' : 's'} of this profile change game data and were not updated since the last major game update, {gameDate}.
              Many still work; if the game crashes, check these first (marked below).
            </p>
          )}
          <p className="small muted">
            Top = highest priority (its files win over the mods below). {imported
              ? 'Your list keeps its order; mods you add later are placed by their load-order rules.'
              : 'Template mods keep the tested community order; switched-on mods are placed by their load-order rules; your own mods by what their packs contain – move them with ↑ ↓ if you know better.'}
          </p>
          <p className="small order-summary">
            <span><b>{order.length}</b> of {orderAll.length} mods on</span>
            {offCount > 0 && <>
              <span className="muted">{offCount} switched off – they stay in the list and are not loaded or installed</span>
              <button className="link" onClick={() => onChange({ ...profile, removed: [], off: [] })}>Switch all on</button>
            </>}
          </p>
          <table className="entries">
            <tbody>
              {orderAll.map((o) => {
                const on = isOn(o.key)
                const e = byKeyAll.get(o.key)
                const isInstalled = installed.has(o.key) && !incomplete.has(o.key)
                const ask = asking?.key === o.key ? asking : null
                return (
                  <tr key={o.key} className={`${!on ? 'off' : isInstalled ? 'state-installed' : 'state-missing'}${ask ? ' ask' : ''}`}>
                    <td className="sw">
                      <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on}
                        title={on ? 'Loaded – switch off to leave it out of the game' : e?.origin === 'dependency' ? `Comes with ${e.requiredBy} – switch on with it` : 'Switched off – not loaded'}
                        onClick={() => switchOne(o.key)} />
                    </td>
                    <td className="num">{on ? loadedKeys.indexOf(o.key) + 1 : ''}</td>
                    <td>
                      {'mod' in parseTargetKey(o.key) ? <a onClick={() => data.openMod((parseTargetKey(o.key) as { mod: string }).mod)}>{o.name}</a> : o.name}
                      {e?.pack && <div className="small muted">{e.pack}</div>}
                      {!e?.pack && variantChoices(o.key).map((v) => (
                        <div key={v.group} className="small variant-choice">
                          {v.caption}{' '}
                          <select value={v.loaded} onChange={(ev) => chooseVariant(o.key, v.group, ev.target.value)} title="Several versions of this mod are installed; only the chosen one is loaded">
                            {v.options.map((x) => <option key={x.file} value={x.file}>{x.label}</option>)}
                          </select>
                        </div>
                      ))}
                      {stale.has(o.key) && (
                        <div className="small warn-text">
                          Older than the last major game update; changes game data.{' '}
                          {major && o.key.startsWith('mod:') && (() => {
                            const p = withFlag(oldPoint(data.catalog, data.index, o.key, data.index.mods.get(o.key.slice(4))?.updated, { date: new Date(major.date).toISOString().slice(0, 10), title: major.title }), data.catalog.ruleFlags)
                            return p && flagLink(p)
                          })()}
                        </div>
                      )}
                      {o.own && (
                        <>
                          <div className="small muted">{(installed.get(o.key) ?? []).map((p) => p.file).join(', ')}</div>
                          <div className="small">{o.own.reason}</div>
                          {on && facts && <CheckLines check={checkOwnMod(order, o.key, facts, installedKeys)} onAdd={addExtra} />}
                        </>
                      )}
                      {ask && (
                        <div className="small ask-line">
                          {ask.dependents.map((k) => nameOf(data.catalog, data.index, k)).join(', ')} {ask.dependents.length === 1 ? 'needs' : 'need'} this mod
                          and would not work without it.
                          <button className="primary" onClick={() => switchKeys([ask.key, ...ask.dependents], false)}>Switch {ask.dependents.length === 1 ? 'both' : 'all'} off</button>
                          <button onClick={() => setAsking(null)}>Keep it on</button>
                        </div>
                      )}
                    </td>
                    <td>
                      {o.own ? (
                        <span className="badge own">your mod{o.own.pinned ? ', placed by you' : ''}</span>
                      ) : (
                        <span className={`badge origin-${e?.origin}`}>{e?.origin === 'base' ? 'template' : e?.origin === 'extra' ? 'switched on' : `needed by ${e?.requiredBy}`}</span>
                      )}
                    </td>
                    <td className="state">{!on ? 'off – not loaded' : isInstalled ? 'installed' : 'not installed'}</td>
                    <td className="row-actions">
                      {o.own && (
                        <>
                          <button className="link" title="Load earlier (higher priority)" onClick={() => move(o.key, -1)}>↑</button>
                          <button className="link" title="Load later (lower priority)" onClick={() => move(o.key, 1)}>↓</button>
                          {o.own.pinned && <button className="link" title="Let the app place it again" onClick={() => unpin(o.key)}>auto</button>}
                          <button className="link" title="Suggest this mod and its place for the catalog" onClick={() => share(o)}>share</button>
                        </>
                      )}
                      {(e?.origin === 'extra' || o.own) && <button className="link" title="Take it out of this profile" onClick={() => toggleExtra(o.key)}>remove</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <h3>Overlaps in this load order</h3>
          <ConflictList
            paths={[...new Set(order.flatMap((o) => o.paths))]}
            orderNote="Installed mods of this profile, compared in the order above: the higher mod's files are the ones the game uses."
          />
          <p className="step-next">
            <button className="primary" onClick={play} disabled={!data.scan?.gamePath}>▶ Play with this load order</button>
          </p>
        </section>
      )}
    </div>
  )
}
