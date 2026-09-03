// Runs every *.test.mjs against real Chrome (native WebMCP) and against the shim.
// Usage: npm test            (all)     node tests/run.mjs registry   (one)
import { readdir } from 'node:fs/promises'

const only = process.argv[2]
const files = (await readdir('tests')).filter((f) => f.endsWith('.test.mjs') && (!only || f.startsWith(only)))
let failed = 0
for (const f of files) {
  const mod = await import('./' + f)
  for (const native of [true, false]) {
    const label = `${f} [${native ? 'native chrome' : 'shim'}]`
    const t0 = Date.now()
    try {
      const out = await mod.run({ native })
      console.log(`PASS ${label} ${Date.now() - t0}ms ${out ? JSON.stringify(out) : ''}`)
    } catch (e) {
      failed++
      console.log(`FAIL ${label}\n  ${e.stack?.split('\n').slice(0, 4).join('\n  ')}`)
    }
  }
}
console.log(failed ? `\n${failed} failing` : '\nall green')
process.exit(failed ? 1 : 0)
