import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '@catalog/schema'
import { buildIndex } from '@shared/match'
import { baseKeys, candidates, conflictsIn, missingDependencies, resolveProfile } from '@shared/profile'
import { isPickOne, suggestForProfile } from '@shared/suggest'
import { stepsFor, subjectsOf, suggestedFor, tiersFor } from '@shared/setups'

/**
 * Sanity checks on the real catalog/catalog.json: what a player gets from a template must work as it is.
 * Run after every catalog build (curator/build_catalog.py).
 */
const catalog: Catalog = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../catalog/catalog.json'), 'utf8'))
const index = buildIndex(catalog)
const mods = new Map(catalog.mods.map((m) => [m.id, m]))
const outdated = (id: string) => ['superseded', 'abandoned'].includes(mods.get(id)?.status ?? '')
const fresh = { extras: [], removed: [] }

describe('Play coverage', () => {
  // Communities with their own setup must stay reachable from Play (curator/manual.json "playCoverage"): a whole
  // community (Beastmen, Greenskins) once fell through because none of its mods was in a template.
  const coverage: Record<string, string[] | string> = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../curator/manual.json'), 'utf8')).playCoverage ?? {}
  it('every listed community has a template with one of its mods, and a Play subject for it', () => {
    const subjects = subjectsOf(catalog, index)
    const missing = Object.entries(coverage).filter(([k]) => !k.startsWith('_')).flatMap(([name, ids]) => {
      const p = catalog.presets.find((x) => x.origin !== 'community' && x.entries.some((e) => e.target && 'mod' in e.target && (ids as string[]).includes(e.target.mod)))
      return p && subjects.some((s) => s.presets.includes(p)) ? [] : [name]
    })
    expect(missing).toEqual([])
  })
})

describe('catalog', () => {
  it('relations point at known mods, never at a collection or the mod itself', () => {
    const bad = catalog.mods.flatMap((m) => m.relations.flatMap((r) => {
      if (!('mod' in r.target)) return []
      const t = mods.get(r.target.mod)
      return !t || t.kind === 'collection' || t.id === m.id ? [`${m.id} ${r.kind} ${r.target.mod}`] : []
    }))
    expect(bad).toEqual([])
  })

  it('templates name current mods and their packs, each pack once', () => {
    const bad: string[] = []
    for (const p of catalog.presets) {
      const packs = p.entries.map((e) => e.pack.toLowerCase())
      for (const [i, e] of p.entries.entries()) {
        if (packs.indexOf(packs[i]) !== i) bad.push(`${p.id}: ${e.pack} twice`)
        if (!e.target || !('mod' in e.target)) continue
        const m = mods.get(e.target.mod)
        if (!m) { bad.push(`${p.id}: unknown mod ${e.target.mod}`); continue }
        if (outdated(m.id)) bad.push(`${p.id}: ${m.id} is ${m.status}`)
        // A mod made only of pick-one packs keeps one entry without an exact pack (the player's choice applies).
        const onlyChoices = m.packs.length > 0 && m.packs.every((x) => x.optional || x.exclusiveGroup)
        if (!m.packs.some((x) => x.file.toLowerCase() === packs[i]) && !(onlyChoices && e.pack === m.name)) bad.push(`${p.id}: ${e.pack} is no pack of ${m.id}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('templates contain everything their mods strictly need and nothing that conflicts', () => {
    const bad: string[] = []
    // Setups players shared are as they played them; only our own templates must be complete.
    for (const p of catalog.presets.filter((x) => x.origin !== 'community')) {
      const keys = baseKeys(p)
      for (const [k, by] of missingDependencies(index, keys, new Set(keys))) bad.push(`${p.id}: ${by} needs ${k}`)
      for (const c of resolveProfile(catalog, index, p, fresh).conflicts) bad.push(`${p.id}: ${c.a} conflicts with ${c.b}`)
    }
    expect(bad).toEqual([])
  })

  it('a choice selected at first replaces nothing in the template and conflicts with nothing', () => {
    const bad: string[] = []
    for (const p of catalog.presets) {
      const s = suggestForProfile(catalog, index, p, fresh, candidates(catalog, index, p, fresh))
      for (const g of [...s.lewd, ...s.general].filter(isPickOne)) {
        const pre = g.pick.find((x) => x.key === g.preselect)
        if (!pre) continue
        if (pre.replaces) bad.push(`${p.id}: ${pre.key} replaces ${pre.replaces.join(', ')}`)
        if (conflictsIn(index, [...baseKeys(p), pre.key]).length) bad.push(`${p.id}: ${pre.key} conflicts`)
      }
    }
    expect(bad).toEqual([])
  })
  it('every character and theme has a recommended size, and no size brings a conflict', () => {
    const bad: string[] = []
    for (const s of subjectsOf(catalog, index)) {
      const tiers = tiersFor(catalog, index, s)
      if (!tiers.some((t) => t.recommended)) bad.push(`${s.name}: no recommended size`)
      for (const t of tiers) {
        for (const c of resolveProfile(catalog, index, t.preset, { extras: t.extras, removed: [] }).conflicts) bad.push(`${s.name} ${t.id}: ${c.a} x ${c.b}`)
        const steps = stepsFor(s, suggestedFor(catalog, index, t.preset, { extras: t.extras, removed: [] }).picks, true)
        if (steps[steps.length - 1].kind !== 'review') bad.push(`${s.name} ${t.id}: no review step`)
      }
    }
    expect(bad).toEqual([])
  })
})
