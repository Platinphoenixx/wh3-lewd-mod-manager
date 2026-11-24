// The npm package of 7-Zip ships its Linux/macOS program without the "executable" mark; give it back in the packed app
// (the app also copies it to its own folder with the mark when it is still missing, see src/main/sevenzip.ts).
const { chmodSync, existsSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') return
  const base = join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', '7zip-bin')
  for (const dir of ['linux/x64', 'linux/arm64', 'mac/x64', 'mac/arm64']) {
    const file = join(base, dir, '7za')
    if (existsSync(file)) chmodSync(file, 0o755)
  }
}
