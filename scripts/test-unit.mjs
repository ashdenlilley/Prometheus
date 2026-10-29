// Compiles src/shared and tests/shared to .unittest (CommonJS) and runs the tests with node:test.
// Optional args filter by file name, e.g. `node scripts/test-unit.mjs filter` runs tests/shared/filter.test.ts.
import { execSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'

const only = process.argv.slice(2)
const out = only.length ? `.unittest-${only.join('-')}` : '.unittest'
rmSync(out, { recursive: true, force: true })
const tests = readdirSync('tests/shared')
  .filter(f => f.endsWith('.test.ts') && (!only.length || only.some(o => f.startsWith(`${o}.`))))
  .map(f => `tests/shared/${f}`)
if (!tests.length) throw new Error('No test files matched')
execSync(
  `npx tsc --outDir ${out} --rootDir . --module commonjs --target es2022 --skipLibCheck --types node --strict --esModuleInterop ` +
    tests.join(' '),
  { stdio: 'inherit' }
)
execSync(`node --test ${tests.map(t => `${out}/${t.replace(/\.ts$/, '.js')}`).join(' ')}`, { stdio: 'inherit' })
