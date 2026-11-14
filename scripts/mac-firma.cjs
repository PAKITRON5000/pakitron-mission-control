// electron-builder afterPack: on a Mac, the app is signed "ad hoc" (with no Apple certificate). macOS will not open an
// Apple Silicon app with no signature at all ("está dañada"); with this one it opens after the first right click › Abrir
// (or Ajustes del Sistema › Privacidad y seguridad › Abrir igualmente). Does nothing when building for Windows.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function adHocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--verbose=2', app], { stdio: 'inherit' })
}
