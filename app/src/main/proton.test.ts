import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GameScan } from '@shared/api'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

// A Steam folder as on Linux: Steam's config, GE-Proton in compatibilitytools.d, Valve's Proton and the runtime in the
// library, and the game with its prefix.
let root = ''
const put = (path: string, text = '') => {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), text)
}
const config = (name: string) => `"InstallConfigStore" { "Software" { "Valve" { "Steam" { "CompatToolMapping" { "1142710" { "name" "${name}" } } } } } }`
const game = () => join(root, 'steamapps', 'common', 'Total War WARHAMMER III')
const scan = (): GameScan => ({ gamePath: game(), dataPath: join(game(), 'data'), workshopPaths: [], packs: [], vanillaPackCount: 0, errors: [] })

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'wh3lmm-proton-'))
  process.env.WH3_STEAM_PATH = root
  process.env.WH3LMM_STEAM_LIBRARY = root
  put('config/config.vdf', config('GE-Proton9-20'))
  put('compatibilitytools.d/GE-Proton9-20/proton')
  put('compatibilitytools.d/GE-Proton9-20/compatibilitytool.vdf', '"compatibilitytools" { "compat_tools" { "GE-Proton9-20" { "install_path" "." } } }')
  put('compatibilitytools.d/GE-Proton9-20/toolmanifest.vdf', '"manifest" { "commandline" "/proton %verb%" "require_tool_appid" "1628350" }')
  put('steamapps/common/Proton 9.0/proton')
  put('steamapps/common/Proton 9.0/toolmanifest.vdf', '"manifest" { "require_tool_appid" "1628350" }')
  put('steamapps/appmanifest_1628350.acf', '"AppState" { "appid" "1628350" "installdir" "SteamLinuxRuntime_sniper" }')
  put('steamapps/common/SteamLinuxRuntime_sniper/_v2-entry-point')
  put('steamapps/common/Total War WARHAMMER III/Warhammer3.exe')
  mkdirSync(join(root, 'steamapps', 'compatdata', '1142710', 'pfx'), { recursive: true })
})
afterAll(() => {
  delete process.env.WH3_STEAM_PATH
  delete process.env.WH3LMM_STEAM_LIBRARY
  rmSync(root, { recursive: true, force: true })
})

describe('finding Proton', () => {
  it("takes the Proton Steam uses for the game, inside the runtime it asks for", async () => {
    const { protonFor } = await import('./proton')
    const p = await protonFor(scan(), ['wh3lmm_mods.txt;'])
    expect(p.error).toBeUndefined()
    expect(p.proton).toBe("GE-Proton9-20 (Steam's choice for the game)")
    expect(p.launch!.command).toBe(join(root, 'steamapps', 'common', 'SteamLinuxRuntime_sniper') + '/_v2-entry-point')
    expect(p.launch!.args.slice(2)).toEqual([join(root, 'compatibilitytools.d', 'GE-Proton9-20') + '/proton', 'waitforexitandrun',
      join(game(), 'Warhammer3.exe'), 'wh3lmm_mods.txt;'])
    expect(p.launch!.env.STEAM_COMPAT_DATA_PATH).toBe(join(root, 'steamapps', 'compatdata', '1142710'))
  })

  it("finds Valve's own Proton by Steam's internal name", async () => {
    put('config/config.vdf', config('proton_9'))
    const { protonFor } = await import('./proton')
    expect((await protonFor(scan(), [])).proton).toBe("Proton 9.0 (Steam's choice for the game)")
  })

  it('says what is missing', async () => {
    put('config/config.vdf', config('proton_experimental'))
    const { protonFor } = await import('./proton')
    expect((await protonFor(scan(), [])).error).toMatch(/"proton_experimental", but that Proton was not found/)
    expect((await protonFor(scan(), [], join(root, 'nowhere'))).error).toMatch(/has no "proton" file/)
    rmSync(join(root, 'steamapps', 'compatdata'), { recursive: true })
    expect((await protonFor(scan(), [])).error).toMatch(/no Proton prefix yet/)
  })
})
