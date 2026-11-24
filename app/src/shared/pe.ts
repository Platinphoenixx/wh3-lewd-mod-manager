/**
 * The product version of a Windows program ("9.0.4"), read from the file itself: the PE header's resource directory
 * says where the resources are (the game's exe calls that section ".debug$P", not ".rsrc", so the name is not used),
 * and they hold the version block (VS_FIXEDFILEINFO, found by its signature). Works the same on Windows and Linux,
 * without asking the system. `read(offset, length)` returns the bytes there (fewer at the end of the file).
 */
export async function peProductVersion(read: (offset: number, length: number) => Promise<Uint8Array>): Promise<string | undefined> {
  const head = view(await read(0, 4096))
  if (head.byteLength < 64 || head.getUint16(0, true) !== 0x5a4d) return undefined // "MZ"
  const pe = head.getUint32(0x3c, true)
  if (pe + 512 > head.byteLength || head.getUint32(pe, true) !== 0x00004550) return undefined // "PE\0\0"
  const sections = head.getUint16(pe + 6, true)
  const opt = pe + 24
  const optSize = head.getUint16(pe + 20, true)
  // Data directory 2 = resources; it starts at 112 bytes into the optional header of a 64-bit program, 96 of a 32-bit one.
  const dirs = opt + (head.getUint16(opt, true) === 0x20b ? 112 : 96)
  const rva = head.getUint32(dirs + 16, true)
  const size = head.getUint32(dirs + 20, true)
  if (!rva || !size) return undefined
  for (let i = 0; i < sections; i++) {
    const at = opt + optSize + i * 40
    if (at + 40 > head.byteLength) break
    const virtualSize = head.getUint32(at + 8, true)
    const virtualAddress = head.getUint32(at + 12, true)
    const rawSize = head.getUint32(at + 16, true)
    const rawOffset = head.getUint32(at + 20, true)
    if (rva < virtualAddress || rva >= virtualAddress + Math.max(virtualSize, rawSize)) continue
    return fixedProductVersion(await read(rawOffset + rva - virtualAddress, size))
  }
  return undefined
}

/** The product version of the first VS_FIXEDFILEINFO in `bytes` (signature 0xFEEF04BD), as "major.minor.build". */
export function fixedProductVersion(bytes: Uint8Array): string | undefined {
  const v = view(bytes)
  for (let i = 0; i + 24 <= bytes.length; i += 4) {
    if (bytes[i] !== 0xbd || bytes[i + 1] !== 0x04 || bytes[i + 2] !== 0xef || bytes[i + 3] !== 0xfe) continue
    const ms = v.getUint32(i + 16, true)
    const ls = v.getUint32(i + 20, true)
    return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}`
  }
  return undefined
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)
