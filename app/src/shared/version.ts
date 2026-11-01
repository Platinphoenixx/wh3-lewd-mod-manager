/** Release versions ("v0.2.0", "0.10.1"): is `candidate` newer than `current`? Pre-releases ("-beta") never count. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => (/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim()) ?? []).slice(1).map(Number)
  const a = parse(candidate)
  const b = parse(current)
  if (a.length !== 3 || b.length !== 3) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
