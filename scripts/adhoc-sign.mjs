// electron-builder afterPack hook. Seals the macOS app bundle with an ad-hoc signature so the DMG
// is not reported as "damaged". Runs before the DMG is built. Skipped when a real identity is set.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export default function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.CSC_LINK) return

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
