import { constants } from 'node:fs'
import { access, chmod, copyFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { path7za } from '7zip-bin'

/** The 7-Zip that ships with the app (outside the asar archive, where a program can be run from). */
export const bundled7za = (): string => path7za.replace('app.asar', 'app.asar.unpacked')

let ready: Promise<string> | null = null

/**
 * The 7-Zip program to run. On Linux and macOS the bundled one comes without the "executable" mark (the npm package
 * ships it that way) and the AppImage it sits in is read-only, so a copy in the app's own folder gets the mark instead.
 */
export function sevenZip(): Promise<string> {
  if (process.platform === 'win32') return Promise.resolve(bundled7za())
  ready ??= (async () => {
    const src = bundled7za()
    if (await access(src, constants.X_OK).then(() => true, () => false)) return src
    const own = join(app.getPath('userData'), 'bin', '7za')
    const [a, b] = await Promise.all([stat(src), stat(own).catch(() => null)])
    if (!b || b.size !== a.size) {
      await mkdir(join(own, '..'), { recursive: true })
      await copyFile(src, own)
    }
    await chmod(own, 0o755)
    return own
  })().catch((e) => {
    ready = null // try again next time
    throw e
  })
  return ready
}
