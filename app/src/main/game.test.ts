import { describe, expect, it } from 'vitest'
import { parseLibraryFolders, parseManifest } from './game'

describe('game', () => {
  it('reads library paths from libraryfolders.vdf', () => {
    const vdf = `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"E:\\\\Games\\\\Steam"\n\t}\n}`
    expect(parseLibraryFolders(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'E:\\Games\\Steam'])
  })

  it('collects top-level pack names from the manifest', () => {
    const manifest = 'campaigns/wh3_main_chaos/startpos.esf\t5258707\t1\ndata.pack\t123\t1\nDB.pack\t9\t1\r\n'
    expect([...parseManifest(manifest)]).toEqual(['data.pack', 'db.pack'])
  })
})
