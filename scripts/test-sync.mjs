// Compiles the sync modules to .synctest (CommonJS) and runs tests/sync-integration.js against them.
import { execSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'

rmSync('.synctest', { recursive: true, force: true })
execSync(
  'npx tsc --outDir .synctest --module commonjs --target es2022 --skipLibCheck --types node --strict --esModuleInterop ' +
    'src/main/sync.ts src/main/db.ts src/main/crypto.ts src/shared/sync.ts src/shared/seed.ts',
  { stdio: 'inherit' }
)
cpSync('tests/sync-integration.js', '.synctest/test.js')
execSync('node .synctest/test.js', { stdio: 'inherit' })
