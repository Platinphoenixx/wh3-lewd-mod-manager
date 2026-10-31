import { useState } from 'react'
import type { Mod } from '@catalog/schema'

/** Candidate image URLs for a mod's cover: the cover first, then every other image. */
export function coverCandidates(mod: Mod): string[] {
  const imgs = [...(mod.images ?? [])].sort((a, b) => Number(b.kind === 'cover') - Number(a.kind === 'cover'))
  return [...new Set(imgs.filter((i) => i.kind !== 'loadorder').flatMap((i) => [i.thumb, i.url]).filter((u): u is string => !!u))]
}

/**
 * The mod followed by the mods it extends or requires: patches, fixes and translations rarely have
 * pictures of their own, so their card falls back to the picture of the mod they belong to.
 */
export function withParents(mods: Map<string, Mod>, mod: Mod): Mod[] {
  const parents = mod.relations
    .filter((r) => r.kind === 'extends' || r.kind === 'requires')
    .map((r) => ('mod' in r.target ? mods.get(r.target.mod) : undefined))
    .filter((m): m is Mod => !!m)
  return [mod, ...parents]
}

/**
 * A mod's cover image that never shows a broken icon: when an image fails to load it tries the
 * mod's next image, and shows the placeholder only when none works.
 */
export function ModCover({ mods, placeholder, onClick }: { mods: (Mod | undefined)[]; placeholder?: string; onClick?(): void }) {
  const urls = mods.flatMap((m) => (m ? coverCandidates(m) : []))
  const [i, setI] = useState(0)
  if (i >= urls.length) return <span className="placeholder" onClick={onClick}>{placeholder ?? ''}</span>
  return <img src={urls[i]} loading="lazy" referrerPolicy="no-referrer" onError={() => setI(i + 1)} onClick={onClick} />
}
