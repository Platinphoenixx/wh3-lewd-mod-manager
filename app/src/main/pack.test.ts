import { describe, expect, it } from 'vitest'
import { parsePackIndex, parseRpfmDependencies } from './pack'

/** Builds a minimal PFH5 mod pack index in memory. */
function buildPack(deps: string[], files: [string, number][]): Buffer {
  const depBuf = Buffer.concat(deps.map((d) => Buffer.from(d + '\0', 'utf8')))
  const fileBuf = Buffer.concat(
    files.map(([p, size]) => {
      const head = Buffer.alloc(5)
      head.writeUInt32LE(size, 0) // size, then compressed flag 0
      return Buffer.concat([head, Buffer.from(p + '\0', 'utf8')])
    })
  )
  const header = Buffer.alloc(28)
  header.write('PFH5', 0, 'latin1')
  header.writeUInt32LE(3, 4) // mod pack, no flags
  header.writeUInt32LE(deps.length, 8)
  header.writeUInt32LE(depBuf.length, 12)
  header.writeUInt32LE(files.length, 16)
  header.writeUInt32LE(fileBuf.length, 20)
  return Buffer.concat([header, depBuf, fileBuf])
}

describe('parsePackIndex', () => {
  it('reads type, dependencies and normalised file paths', () => {
    const buf = buildPack(['base.pack'], [['db\\units_tables\\My_Mod', 120], ['script\\a.lua', 7]])
    const { index, dataStart } = parsePackIndex(buf)
    expect(index.type).toBe('mod')
    expect(index.dependencies).toEqual(['base.pack'])
    expect(index.files).toEqual([{ path: 'db/units_tables/my_mod', size: 120 }, { path: 'script/a.lua', size: 7 }])
    expect(dataStart).toBe(buf.length)
  })

  it('rejects other formats', () => {
    expect(() => parsePackIndex(Buffer.from('PFH4' + '\0'.repeat(40)))).toThrow(/unsupported/)
  })
})

describe('parseRpfmDependencies', () => {
  it('collects pack names from the JSON note and tolerates empty or broken notes', () => {
    expect(parseRpfmDependencies('[{"name":"!!li_progression_framework.pack","hard":true}]')).toEqual(['!!li_progression_framework.pack'])
    expect(parseRpfmDependencies('[]')).toEqual([])
    expect(parseRpfmDependencies('not json')).toEqual([])
  })
})
