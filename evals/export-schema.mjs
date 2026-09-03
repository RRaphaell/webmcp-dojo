// Exports every tool the Dojo registers (always-on + each belt) in the schema
// shape Google's webmcp-evals CLI reads in `local` mode:
//   { "tools": [ { name, description, inputSchema, annotations } ] }
// Walks the live page in real Chrome by calling start_belt like an agent would,
// so the file cannot drift from the code. Writes evals/dojo.schema.json.
// Usage: node evals/export-schema.mjs [--url https://...]

import { writeFile } from 'node:fs/promises'
import { serveDist, launch, listTools, callTool } from '../tests/harness.mjs'

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : null
const srv = url ? null : await serveDist()
const b = await launch({ native: true })
const tools = new Map()
const perBelt = {}
try {
  await b.page.goto((url ?? srv.url) + '/?eval=1')
  await b.page.waitForFunction(() => typeof window.dojo?.belts === 'function', null, { timeout: 15000 })
  const belts = await b.page.evaluate(() => window.dojo.belts())
  const grab = async (set) => {
    const list = await listTools(b.page)
    perBelt[set] = list.map((t) => t.name).sort()
    for (const t of list) if (!tools.has(t.name)) tools.set(t.name, { name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, registeredBy: set })
  }
  await grab('always-on')
  for (const belt of belts) {
    await b.page.evaluate((id) => window.dojo.human.limitBelts([id]), belt.id)
    await b.page.evaluate(() => window.dojo.human.reset())
    await callTool(b.page, 'start_belt', { belt: belt.id })
    await grab(belt.id)
  }
} finally {
  await b.close()
  await srv?.close()
}
const out = { generatedAt: new Date().toISOString(), tools: [...tools.values()], toolsByState: perBelt }
await writeFile('evals/dojo.schema.json', JSON.stringify(out, null, 2) + '\n')
console.log(`wrote evals/dojo.schema.json: ${out.tools.length} tools across ${Object.keys(perBelt).length} states`)
