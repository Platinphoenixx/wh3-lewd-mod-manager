import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '@catalog/schema'
import { buildIndex, targetKey } from '@shared/match'
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
  it('campaign guides carry the fields the app reads', () => {
    // Community setups once rode along here without dlc/notes and blanked the Play page of Greenskins.
    const bad = catalog.campaignGuides.filter((g) => !Array.isArray(g.dlc) || !Array.isArray(g.notes) || !Array.isArray(g.entries))
    expect(bad.map((g) => g.character)).toEqual([])
  })

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
  it('looks by stage name real mods and a character someone plays or meets', () => {
    const bad: string[] = []
    for (const m of catalog.mods) {
      for (const s of m.stageLooks ?? []) {
        for (const id of [...(s.exempt ?? []), ...(s.partly ?? [])]) if (!catalog.mods.some((x) => x.id === id)) bad.push(`${m.id}: ${id} is no mod`)
        const c = s.character.toLowerCase()
        if (!catalog.mods.some((x) => x.kind === 'reskin' && ((x.playAs ?? []).some((p) => p.character.toLowerCase() === c) || x.tags.some((t) => t.toLowerCase() === c)))) bad.push(`${m.id}: no look for ${s.character}`)
      }
    }
    expect(bad).toEqual([])
    expect(catalog.mods.filter((m) => m.stageLooks?.length).length).toBeGreaterThan(0)
  })

  it("every lord in the game's own campaign needs no mod and gets a choice of looks", () => {
    const bad: string[] = []
    for (const s of subjectsOf(catalog, index).filter((x) => x.vanilla)) {
      const p = s.presets.find((x) => x.origin === 'vanilla')!
      if (p.entries.length) bad.push(`${s.name}: the template has mods`)
      if (!p.factions?.length || !p.dlc) bad.push(`${s.name}: no faction or DLC`)
      const steps = stepsFor(s, suggestedFor(catalog, index, p).picks, false, true)
      if (!steps.some((x) => x.kind === 'pick')) bad.push(`${s.name}: no look to choose`)
    }
    expect(bad).toEqual([])
    expect(subjectsOf(catalog, index).some((x) => x.vanilla && x.name === 'Sisters of Twilight')).toBe(true)
  })

  it('every character and theme has a recommended size, and no size brings a conflict', () => {
    const bad: string[] = []
    for (const s of subjectsOf(catalog, index)) {
      const tiers = tiersFor(catalog, index, s)
      if (!tiers.some((t) => t.recommended)) bad.push(`${s.name}: no recommended size`)
      for (const t of tiers) {
        const r = resolveProfile(catalog, index, t.preset, { extras: t.extras, removed: [] })
        for (const c of r.conflicts) bad.push(`${s.name} ${t.id}: ${c.a} x ${c.b}`)
        // What the setup's community says runs against its point never gets in, not even through a dependency.
        const avoid = new Set((t.preset.avoid ?? []).map((x) => targetKey(x.target)))
        for (const e of r.entries) if (avoid.has(e.key)) bad.push(`${s.name} ${t.id}: ${e.key} is not for this setup`)
        const steps = stepsFor(s, suggestedFor(catalog, index, t.preset, { extras: t.extras, removed: [] }).picks, true)
        if (steps[steps.length - 1].kind !== 'review') bad.push(`${s.name} ${t.id}: no review step`)
      }
    }
    expect(bad).toEqual([])
  })
})
