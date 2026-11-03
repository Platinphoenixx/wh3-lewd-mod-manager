import { useEffect, useState } from 'react'
import type { ExternalMod, Mod, ModTarget, Preset } from '@catalog/schema'
import { useData, type AppData } from './data'

/**
 * "Made by": everyone whose mods are in a template or profile, one line each – their mods, what those
 * do, and one ♥ Support button that opens their support pages. The makers of the template's
 * campaign / progression / framework mods come first. Links come from the mods' own pages; the
 * catalog marks links that belong to someone credited on another author's page (`owner`).
 */
type Work = Pick<Mod, 'id' | 'name' | 'support' | 'authorPages'> & { authors?: string[]; kind?: string; summary?: string; isMod: boolean }

interface Creator {
  name: string
  works: Work[]
  support: { platform: string; url: string; owner?: string }[]
  page?: { site: string; url: string }
  lead: boolean
}

export const workOfMod = (m: Mod): Work => ({ ...m, isMod: true })
export const workOfExternal = (e: ExternalMod): Work => ({ ...e, isMod: false })

/** Catalog mods and external mods behind a list of targets (template entries, profile keys). */
export function worksOf(data: AppData, targets: ModTarget[]): Work[] {
  const seen = new Set<string>()
  return targets.flatMap((t) => {
    const w = 'mod' in t ? (data.index.mods.get(t.mod) && workOfMod(data.index.mods.get(t.mod)!))
      : 'external' in t ? (() => { const e = data.catalog.external.find((x) => x.id === t.external); return e && workOfExternal(e) })() : undefined
    if (!w || seen.has(w.id)) return []
    seen.add(w.id)
    return [w]
  })
}

const LEAD_KINDS = ['campaign', 'framework', 'progression']
const leadRank = (c: Creator) => Math.min(...c.works.map((w) => (LEAD_KINDS.includes(w.kind ?? '') ? LEAD_KINDS.indexOf(w.kind!) : 9)))
const firstSentence = (s?: string) => (s ?? '').split(/(?<=[.!?])\s/)[0].replace(/\.$/, '')
/** Short mod name for the list: without bracketed notes and the author's own prefix. */
const shortName = (w: Work, all: Work[]) => {
  const s = w.name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+-\s+.*$/, '').replace(/^(Readman|Lazy's)\s+/, '').trim()
  // Two mods that shorten to the same name keep their full names.
  return all.filter((x) => x !== w).some((x) => x.name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+-\s+.*$/, '').replace(/^(Readman|Lazy's)\s+/, '').trim() === s)
    ? w.name.replace(/\s*\(.*?\)\s*/g, ' ').trim() : s || w.name
}

export function creatorsOf(works: Work[], mainIds = new Set<string>()): Creator[] {
  const byName = new Map<string, Creator>()
  const get = (name: string) => {
    const key = name.toLowerCase()
    if (!byName.has(key)) byName.set(key, { name, works: [], support: [], lead: false })
    return byName.get(key)!
  }
  for (const w of works) {
    const name = w.authors?.[0] ?? w.authorPages?.[0]?.name
    if (!name) continue
    const c = get(name)
    c.works.push(w)
    if (mainIds.has(w.id) && LEAD_KINDS.includes(w.kind ?? '')) c.lead = true
    c.page ??= w.authorPages?.find((p) => p.site === 'loverslab') ?? w.authorPages?.[0]
    for (const s of w.support ?? []) {
      // A link that belongs to someone else in the list goes to them; otherwise it stays here, named.
      const target = s.owner && works.some((x) => x.authors?.[0] === s.owner) ? get(s.owner) : c
      if (!target.support.some((x) => x.url.toLowerCase() === s.url.toLowerCase())) target.support.push(target === c ? s : { ...s, owner: undefined })
    }
  }
  const list = [...byName.values()].filter((c) => c.works.length)
  for (const c of list) c.works.sort((a, b) => Number(LEAD_KINDS.includes(b.kind ?? '')) - Number(LEAD_KINDS.includes(a.kind ?? '')))
  return list.sort((a, b) => Number(b.lead) - Number(a.lead) || (a.lead ? leadRank(a) - leadRank(b) : 0) || b.works.length - a.works.length || a.name.localeCompare(b.name))
}

/**
 * The creator of a mod with the support links found on any of their mods' pages (a link is often only on the main
 * mod's page); links that name someone else as their owner stay with that person.
 */
export function creatorOfMod(data: AppData, mod: Mod): Creator | undefined {
  const name = mod.authors[0]
  if (!name) return creatorsOf([workOfMod(mod)])[0]
  const theirs = data.catalog.mods.filter((m) => m.authors[0]?.toLowerCase() === name.toLowerCase())
    .map((m) => workOfMod({ ...m, support: (m.support ?? []).filter((s) => !s.owner || s.owner.toLowerCase() === name.toLowerCase()) }))
  const c = creatorsOf(theirs).find((x) => x.name.toLowerCase() === name.toLowerCase())
  return c && { ...c, works: c.works.filter((w) => w.id === mod.id) }
}

/** ♥ Support: the creator's support pages as a small menu. */
export function SupportButton({ c }: { c: Creator }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])
  if (!c.support.length) return null
  return (
    <span className="support-menu">
      <button className="support-link" onClick={(e) => { e.stopPropagation(); setOpen(!open) }}>♥ Support</button>
      {open && (
        <span className="support-pop" onClick={(e) => e.stopPropagation()}>
          {c.support.map((s) => (
            <a key={s.url} onClick={() => { window.api.openExternal(s.url); setOpen(false) }}>
              {s.platform}{s.owner ? ` · ${s.owner}` : ''}
              <span className="muted">{s.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
            </a>
          ))}
        </span>
      )}
    </span>
  )
}

function CreatorName({ c }: { c: Creator }) {
  const label = c.page ? (c.page.site === 'loverslab' ? 'LoversLab profile' : 'Workshop files') : undefined
  return c.page ? <a title={label} onClick={() => window.api.openExternal(c.page!.url)}>{c.name}</a> : <span>{c.name}</span>
}

/** Made by: one line per creator with their mods and what those do. */
export function MadeBy({ works, preset, title = 'Made by' }: { works: Work[]; preset: Preset; title?: string }) {
  const data = useData()
  const [all, setAll] = useState(false)
  const mainIds = new Set(preset.entries.flatMap((e) => (e.target && 'mod' in e.target ? [e.target.mod] : [])))
  // A creator's support links may be on a mod of theirs that is not in this list: they count too.
  const creators = creatorsOf(works, mainIds).map((c) => {
    const more = creatorOfMod(data, { ...(c.works.find((w) => w.isMod) as Mod | undefined ?? ({ authors: [c.name] } as Mod)), authors: [c.name] })?.support ?? []
    return { ...c, support: [...c.support, ...more.filter((s) => !c.support.some((x) => x.url.toLowerCase() === s.url.toLowerCase()))] }
  })
  if (!creators.length) return null
  const shown = all ? creators : creators.slice(0, 12)
  return (
    <section className="made-by callout">
      <h3>{title}</h3>
      <div className="muted small">
        {creators.length} creator{creators.length === 1 ? '' : 's'} made the mods in this list
        {preset.source.author ? ` (put together by ${preset.source.author})` : ''}. Click a name for their mod page; ♥ shows how to support them.
      </div>
      <table className="made-by-list">
        <tbody>
          {shown.map((c) => {
            const visible = c.works.slice(0, 3)
            const what = visible.map((w) => firstSentence(w.summary)).filter(Boolean)
            return (
              <tr key={c.name} className={c.lead ? 'lead' : ''}>
                <td className="who"><CreatorName c={c} />{c.lead && <span className="main">main mods</span>}</td>
                <td>
                  <div>
                    {visible.map((w, i) => (
                      <span key={w.id}>{i ? ' · ' : ''}{w.isMod ? <a className="plain" title={w.summary} onClick={() => data.openMod(w.id)}>{shortName(w, c.works)}</a> : <span title={w.summary}>{shortName(w, c.works)}</span>}</span>
                    ))}
                    {c.works.length > 3 && <span className="muted"> +{c.works.length - 3} more</span>}
                  </div>
                  {what.length > 0 && <div className="what muted small">{what.join(' · ')}</div>}
                </td>
                <td className="support"><SupportButton c={c} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {creators.length > 12 && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          <a onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${creators.length}`}</a>
        </p>
      )}
    </section>
  )
}

/** Creator line in a mod's detail view: name, support, and more mods by them. */
export function CreatorSection({ mod }: { mod: Mod }) {
  const data = useData()
  const c = creatorOfMod(data, mod)
  const more = mod.authors.length
    ? data.catalog.mods.filter((m) => m.id !== mod.id && m.authors.some((a) => mod.authors.includes(a)) && !['superseded', 'abandoned'].includes(m.status ?? ''))
    : []
  if (!c && !more.length) return null
  return (
    <section className="creators">
      <h3>Creator</h3>
      {c && <p><strong><CreatorName c={c} /></strong> <SupportButton c={c} /></p>}
      {more.length > 0 && (
        <p className="small">
          More by {mod.authors[0]} in the catalog:{' '}
          {more.slice(0, 12).map((m, i) => <span key={m.id}>{i ? ', ' : ''}<a onClick={() => data.openMod(m.id)}>{m.name}</a></span>)}
          {more.length > 12 ? ` and ${more.length - 12} more` : ''}
        </p>
      )}
    </section>
  )
}
