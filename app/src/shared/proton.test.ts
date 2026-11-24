import { describe, expect, it } from 'vitest'
import type { InstalledPack } from './api'
import { buildModList } from './launch'
import { peProductVersion } from './pe'
import {
  compatToolName, compatToolNames, officialProtonFolder, parseVdf, pickDefaultProton, protonLaunch, requiredToolAppId, vdfGet,
  wineDrivePath
} from './proton'
import { anonymize } from './report'

const CONFIG = `"InstallConfigStore"
{
	"Software"
	{
		"Valve"
		{
			"Steam"
			{
				"CompatToolMapping"
				{
					"0"
					{
						"name"		"proton_experimental"
						"config"		""
						"priority"		"75"
					}
					"1142710"
					{
						"name"		"GE-Proton9-20"
						"config"		""
						"priority"		"250"
					}
				}
			}
		}
	}
}`

describe('Steam files on Linux', () => {
  it('reads key-value files, keys in any case', () => {
    const v = parseVdf(CONFIG)
    expect(vdfGet(v, 'installconfigstore', 'software', 'valve', 'steam', 'compattoolmapping', '0', 'priority')).toBe('75')
    expect(parseVdf('"a" { "path" "C:\\\\Steam" "q" "say \\"hi\\"" }')).toEqual({ a: { path: 'C:\\Steam', q: 'say "hi"' } })
  })

  it("takes the game's own Proton, else Steam's default", () => {
    expect(compatToolName(CONFIG, '1142710')).toBe('GE-Proton9-20')
    expect(compatToolName(CONFIG, '999')).toBe('proton_experimental')
    expect(compatToolName('"InstallConfigStore" { }', '1142710')).toBeUndefined()
  })

  it("names the folders of Valve's Proton versions", () => {
    expect(officialProtonFolder('proton_experimental')).toBe('Proton - Experimental')
    expect(officialProtonFolder('proton_hotfix')).toBe('Proton Hotfix')
    expect(officialProtonFolder('proton_9')).toBe('Proton 9.0')
    expect(officialProtonFolder('proton_10')).toBe('Proton 10.0')
    expect(officialProtonFolder('proton_63')).toBe('Proton 6.3')
    expect(officialProtonFolder('proton_513')).toBe('Proton 5.13')
    expect(officialProtonFolder('GE-Proton9-20')).toBeUndefined()
  })

  it('picks the newest numbered Proton when Steam names none', () => {
    expect(pickDefaultProton(['Proton - Experimental', 'Proton 8.0', 'Proton 9.0 (Beta)', 'Proton 9.0'])).toBe('Proton 9.0')
    expect(pickDefaultProton(['Proton - Experimental', 'Proton Hotfix'])).toBe('Proton - Experimental')
    expect(pickDefaultProton([])).toBeUndefined()
  })

  it('reads what a tool folder declares and which runtime it needs', () => {
    expect(compatToolNames('"compatibilitytools" { "compat_tools" { "GE-Proton9-20" { "install_path" "." } } }')).toEqual(['GE-Proton9-20'])
    expect(requiredToolAppId('"manifest" { "version" "2" "commandline" "/proton %verb%" "require_tool_appid" "1628350" }')).toBe('1628350')
    expect(requiredToolAppId('"manifest" { "commandline" "/proton %verb%" }')).toBeUndefined()
  })
})

describe('starting the game through Proton', () => {
  const base = {
    proton: '/home/p/.steam/steam/compatibilitytools.d/GE-Proton9-20', exe: '/games/steamapps/common/Total War WARHAMMER III/Warhammer3.exe',
    args: ['wh3lmm_mods.txt;'], appId: '1142710', compatData: '/games/steamapps/compatdata/1142710', steamRoot: '/home/p/.steam/steam',
    gamePath: '/games/steamapps/common/Total War WARHAMMER III', libraries: ['/games', '/home/p/.steam/steam', '/games']
  }

  it('runs Proton inside the runtime it asks for, like Steam', () => {
    const l = protonLaunch({ ...base, runtime: '/home/p/.steam/steam/steamapps/common/SteamLinuxRuntime_sniper' })
    expect(l.command).toBe('/home/p/.steam/steam/steamapps/common/SteamLinuxRuntime_sniper/_v2-entry-point')
    expect(l.args).toEqual(['--verb=waitforexitandrun', '--', `${base.proton}/proton`, 'waitforexitandrun', base.exe, 'wh3lmm_mods.txt;'])
    expect(l.env).toMatchObject({
      SteamAppId: '1142710', SteamGameId: '1142710', STEAM_COMPAT_APP_ID: '1142710', STEAM_COMPAT_DATA_PATH: base.compatData,
      STEAM_COMPAT_CLIENT_INSTALL_PATH: base.steamRoot, STEAM_COMPAT_LIBRARY_PATHS: '/games:/home/p/.steam/steam'
    })
  })

  it('runs an old Proton without a runtime directly', () => {
    const l = protonLaunch(base)
    expect(l.command).toBe(`${base.proton}/proton`)
    expect(l.args).toEqual(['waitforexitandrun', base.exe, 'wh3lmm_mods.txt;'])
  })

  it('writes Workshop folders as the game sees them (drive Z:)', () => {
    const pack = (path: string, source: InstalledPack['source']): InstalledPack =>
      ({ file: path.split('/').pop()!, path, source, size: 1, mtime: 0 })
    const text = buildModList([
      pack('/games/steamapps/workshop/content/1142710/123/a.pack', 'workshop'),
      pack('/games/steamapps/common/Total War WARHAMMER III/data/b.pack', 'data')
    ], wineDrivePath)
    expect(text).toBe('add_working_directory "Z:/games/steamapps/workshop/content/1142710/123";\nmod "a.pack";\nmod "b.pack";\n')
    expect(wineDrivePath('C:/x')).toBe('C:/x')
  })

  it('hides Linux home folders in reports', () => {
    expect(anonymize('/home/jane/.local/share/Steam/x and Z:/home/jane/y and Z:\\home\\jane\\z', {}))
      .toBe('/home/<user>/.local/share/Steam/x and Z:/home/<user>/y and Z:\\home\\<user>\\z')
  })
})

describe('the version of a Windows program', () => {
  it('reads the product version from the resource directory, whatever the section is called', async () => {
    const file = new Uint8Array(0x1000 + 0x200)
    const v = new DataView(file.buffer)
    v.setUint16(0, 0x5a4d, true)
    const pe = 0x80
    v.setUint32(0x3c, pe, true)
    v.setUint32(pe, 0x00004550, true)
    v.setUint16(pe + 6, 1, true) // one section
    v.setUint16(pe + 20, 240, true) // optional header size of a 64-bit program
    const opt = pe + 24
    v.setUint16(opt, 0x20b, true)
    v.setUint32(opt + 112 + 16, 0x5000 + 0x10, true) // resources: RVA
    v.setUint32(opt + 112 + 20, 0x100, true) // and size
    const sec = opt + 240
    file.set([...'.debug$P'].map((c) => c.charCodeAt(0)), sec)
    v.setUint32(sec + 8, 0x200, true) // virtual size
    v.setUint32(sec + 12, 0x5000, true) // virtual address
    v.setUint32(sec + 16, 0x200, true) // raw size
    v.setUint32(sec + 20, 0x1000, true) // raw offset
    const sig = 0x1000 + 0x10 + 0x28
    file.set([0xbd, 0x04, 0xef, 0xfe], sig)
    v.setUint32(sig + 16, (9 << 16) | 0, true)
    v.setUint32(sig + 20, (5 << 16) | 0, true)
    const read = async (o: number, l: number) => file.subarray(o, o + l)
    expect(await peProductVersion(read)).toBe('9.0.5')
    expect(await peProductVersion(async () => new Uint8Array(10))).toBeUndefined()
  })
})
