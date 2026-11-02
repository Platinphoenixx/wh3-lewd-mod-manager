import { useMemo, useState } from 'react'
import type { Mod } from '@catalog/schema'
import { matchInstalled, targetKey } from '@shared/match'
import { KIND_LABEL, useData } from './data'
import { ModCover, withParents } from './ModCover'

type Source = 'loverslab' | 'steam' | 'nexus' | 'discord'
type Sort = 'name' | 'updated'

const SOURCE_LABEL: Record<Source, string> = { loverslab: 'LoversLab', steam: 'Steam Workshop', nexus: 'Nexus Mods', discord: 'Discord' }

function updatedOf(m: Mod): string {
  // Newest known date of any source (LoversLab update, Workshop update, Nexus upload).
  return [m.sources.loverslab?.updated, ...(m.sources.steam ?? []).map((s) => s.updated), m.sources.nexus?.uploaded]
    .filter((d): d is string => !!d).sort().pop() ?? ''
}

/** One lower-case string per mod with everything worth searching. */
function haystack(m: Mod): string {
  return [
    m.name, m.summary, m.description, m.recommendedFor, ...(m.tags ?? []), ...m.authors, ...(m.features ?? []),
    ...(m.playAs?.map((p) => p.character) ?? []), ...m.packs.map((p) => p.file)
  ].filter(Boolean).join(' \n ').toLowerCase()
}

// "Archaon / Belakor / Sigvald" style entries list several characters; "Any faction" is none.
const playAsNames = (m: Mod) =>
  (m.playAs ?? []).flatMap((p) => p.character.split(/\s*[/,]\s*/)).map((c) => c.replace(/\s*\(.*\)$/, '').trim()).filter((c) => c && !/^(any|all)\b/i.test(c))
// One key per character however it is spelled ("Bel'akor" / "Belakor", "Shen-zoo" / "Shenzoo").
const charKey = (c: string) => c.toLowerCase().replace(/[^a-z]/g, '')

/**
 * Characters for the filter: the ones a mod lets you play and the ones its tags name (reskins, add-ons), so
 * "Alarielle" finds everything for her. Each is shown in its most common spelling.
 */
function characterNames(mods: Mod[]): Map<string, string> {
  const spellings = new Map<string, Map<string, number>>()
  for (const c of mods.flatMap(playAsNames)) {
    const s = spellings.get(charKey(c)) ?? new Map<string, number>()
    spellings.set(charKey(c), s.set(c, (s.get(c) ?? 0) + 1))
  }
  // A longer name that starts with a shorter one is the same character ("Valkia the Bloody").
  const keys = [...spellings.keys()]
  const merged = new Map(keys.map((k) => [k, keys.find((o) => o !== k && k.startsWith(o) && o.length >= 5) ?? k]))
  const names = new Map<string, string>()
  for (const [k, into] of merged) {
    const all = [...spellings.get(into)!.entries()]
    names.set(k, all.sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0])
  }
  return names
}

function characters(m: Mod, names: Map<string, string>): string[] {
  const fromTags = m.tags.map(charKey).filter((k) => names.has(k))
  return [...new Set([...playAsNames(m).map(charKey), ...fromTags].map((k) => names.get(k) ?? k))]
}

function Facet<T extends string>({ title, values, selected, onToggle, label }: {
  title: string; values: [T, number][]; selected: Set<T>; onToggle(v: T): void; label(v: T): string
}) {
  const [all, setAll] = useState(false)
  const shown = all ? values : values.slice(0, 10)
  return (
    <div className="facet">
      <h4>{title}</h4>
      {shown.map(([v, n]) => (
        <label key={v} className={selected.has(v) ? 'on' : ''}>
          <input type="checkbox" checked={selected.has(v)} onChange={() => onToggle(v)} />
          <span>{label(v)}</span>
          <span className="count">{n}</span>
        </label>
      ))}
      {values.length > 10 && <button className="link" onClick={() => setAll(!all)}>{all ? 'fewer' : `all ${values.length}`}</button>}
    </div>
  )
}

function toggler<T>(set: Set<T>, setter: (s: Set<T>) => void) {
  return (v: T) => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    setter(next)
  }
}

// The catalog tags normal gameplay/UI/visual mods "general"; everything else belongs to the lewd scene.
type Content = 'lewd' | 'general'
const contentOf = (m: Mod): Content => (m.tags.includes('general') ? 'general' : 'lewd')
const CONTENT_LABEL: Record<Content, string> = { lewd: 'Lewd mods', general: 'General mods' }

export function CatalogView() {
  const data = useData()
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<Set<Mod['kind']>>(new Set())
  const [chars, setChars] = useState<Set<string>>(new Set())
  const [sources, setSources] = useState<Set<Source>>(new Set())
  const [contents, setContents] = useState<Set<Content>>(new Set())
  const [showTranslations, setShowTranslations] = useState(false)
  const [showOutdated, setShowOutdated] = useState(false)
  const [onlyInstalled, setOnlyInstalled] = useState(false)
  const [sort, setSort] = useState<Sort>('updated')

  const installed = useMemo(() => (data.scan ? matchInstalled(data.index, data.scan.packs).known : new Map()), [data.scan, data.index])
  const prepared = useMemo(() => {
    const names = characterNames(data.catalog.mods)
    return data.catalog.mods
        .filter((m) => m.kind !== 'collection')
        .map((m) => ({
          m,
          text: haystack(m),
          chars: characters(m, names),
          srcs: (['loverslab', 'steam', 'nexus', 'discord'] as Source[]).filter((s) => (s === 'steam' ? m.sources.steam?.length : m.sources[s])),
          outdated: ['superseded', 'abandoned'].includes(m.status ?? ''),
          content: contentOf(m)
        }))
  }, [data.catalog])

  const q = query.trim().toLowerCase()
  const base = prepared.filter(
    (x) =>
      (showOutdated || !x.outdated) &&
      (showTranslations || x.m.kind !== 'translation' || kinds.has('translation')) &&
      (!onlyInstalled || installed.has(targetKey({ mod: x.m.id }))) &&
      (!q || q.split(/\s+/).every((w) => x.text.includes(w)))
  )
  const result = base
    .filter((x) => (!kinds.size || kinds.has(x.m.kind)) && (!chars.size || x.chars.some((c) => chars.has(c))) && (!sources.size || x.srcs.some((s) => sources.has(s))) && (!contents.size || contents.has(x.content)))
    .sort((a, b) => (sort === 'name' ? a.m.name.localeCompare(b.m.name) : updatedOf(b.m).localeCompare(updatedOf(a.m)) || a.m.name.localeCompare(b.m.name)))

  // Facet counts reflect the other active filters, so you can see where a click will lead.
  const count = <T extends string>(get: (x: (typeof base)[number]) => T[]) => {
    const n = new Map<T, number>()
    for (const x of base) for (const v of get(x)) n.set(v, (n.get(v) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1])
  }
  const kindCounts = count((x) => [x.m.kind])
  const charCounts = count((x) => x.chars)
  const sourceCounts = count((x) => x.srcs)
  const contentCounts = count((x) => [x.content])
  const active = kinds.size + chars.size + sources.size + contents.size

  return (
    <div className="catalog2">
      <aside className="facets">
        <div className="facet">
          <h4>Show</h4>
          <label><input type="checkbox" checked={showTranslations} onChange={(e) => setShowTranslations(e.target.checked)} /><span>Translations</span></label>
          <label><input type="checkbox" checked={showOutdated} onChange={(e) => setShowOutdated(e.target.checked)} /><span>Outdated / removed</span></label>
          <label><input type="checkbox" checked={onlyInstalled} onChange={(e) => setOnlyInstalled(e.target.checked)} /><span>Installed only</span></label>
        </div>
        <Facet title="Content" values={contentCounts} selected={contents} onToggle={toggler(contents, setContents)} label={(c) => CONTENT_LABEL[c]} />
        <Facet title="Kind" values={kindCounts} selected={kinds} onToggle={toggler(kinds, setKinds)} label={(k) => KIND_LABEL[k]} />
        <Facet title="Character" values={charCounts} selected={chars} onToggle={toggler(chars, setChars)} label={(c) => c} />
        <Facet title="Source" values={sourceCounts} selected={sources} onToggle={toggler(sources, setSources)} label={(s) => SOURCE_LABEL[s]} />
        {active > 0 && <button onClick={() => { setKinds(new Set()); setChars(new Set()); setSources(new Set()); setContents(new Set()) }}>Clear filters ({active})</button>}
      </aside>
      <section className="results">
        <div className="toolbar">
          <input className="search" type="search" placeholder="Search names, descriptions, authors, characters, pack files…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
          </select>
          <span className="muted small">{result.length} of {prepared.length} mods</span>
          <button className="suggest" onClick={() => data.contribute({ type: 'new-mod' })}>Missing a mod? Suggest it</button>
        </div>
        <div className="grid">
          {result.map(({ m, chars: cs }) => {
            const isInstalled = installed.has(targetKey({ mod: m.id }))
            return (
              <article key={m.id} className="mod-card" onClick={() => data.openMod(m.id)}>
                <div className="cover">
                  <ModCover mods={withParents(data.index.mods, m)} placeholder={KIND_LABEL[m.kind]} />
                  <span className="kind-chip">{KIND_LABEL[m.kind]}</span>
                  {isInstalled && <span className="installed-chip">installed</span>}
                </div>
                <div className="info">
                  <h3 title={m.name}>{m.name}</h3>
                  <div className="byline">
                    {m.authors.length > 0 && <span>{m.authors.slice(0, 2).join(', ')}</span>}
                    {updatedOf(m) && <span className="muted"> · {updatedOf(m).slice(0, 10)}</span>}
                  </div>
                  <p>{m.summary}</p>
                  <div className="chips">
                    {cs.slice(0, 3).map((c) => <span key={c} className="chip">{c}</span>)}
                    {m.status && m.status !== 'stable' && <span className={`chip status-${m.status}`}>{m.status}</span>}
                    {m.curation.confidence === 'low' && <span className="chip warn">unverified</span>}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
        {result.length === 0 && <p className="muted pad">No mods match. Try fewer filters or another search.</p>}
      </section>
    </div>
  )
}
