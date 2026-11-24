import { execFile } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'wh3lmm-7z-'))
vi.mock('electron', () => ({ app: { getPath: () => home } }))

describe('7-Zip', () => {
  // On Linux the npm package's 7za has no "executable" mark: archives (most Nexus and many LoversLab files) could not
  // be unpacked in the AppImage.
  it('can be run on this system', async () => {
    const { sevenZip } = await import('./sevenzip')
    const { stdout } = await promisify(execFile)(await sevenZip(), ['i'])
    expect(stdout).toMatch(/7-Zip/)
  })
})
