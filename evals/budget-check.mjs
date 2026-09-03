// Budget check: asserts every tool the Dojo ever registers against Chrome's
// secure-tools limits (developer.chrome.com/docs/ai/webmcp/secure-tools):
//   tool name <= 30 chars, parameter name <= 30 chars,
//   tool description <= 500 chars, parameter description <= 150 chars,
//   individual tool output <= 1500 chars (checked on real calls by the registry).
// Walks every belt on the live page in real Chrome by calling start_belt the
// way an agent would, and reads the registered tools through getTools().
// Usage: node evals/budget-check.mjs [--url https://...]

import { serveDist, launch, listTools, callTool } from '../tests/harness.mjs'

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : null
const LIMITS = { name: 30, description: 500, paramDescription: 150, output: 1500 }
const srv = url ? null : await serveDist()
const b = await launch({ native: true })
const rows = []
let violations = 0
try {
  await b.page.goto((url ?? srv.url) + '/?eval=1')
  await b.page.waitForFunction(() => typeof window.dojo?.belts === 'function', null, { timeout: 15000 })
  const belts = await b.page.evaluate(() => window.dojo.belts())
  const seen = new Map()
  const record = (set, t) => {
    if (seen.has(t.name)) return
    seen.set(t.name, set)
    const params = Object.entries(t.inputSchema?.properties ?? {})
    const problems = []
    if (t.name.length > LIMITS.name) problems.push(`name ${t.name.length}>${LIMITS.name}`)
    if (!/^[A-Za-z0-9_.-]+$/.test(t.name)) problems.push('name charset')
    if ((t.description ?? '').length > LIMITS.description) problems.push(`description ${t.description.length}>${LIMITS.description}`)
    for (const [k, v] of params) {
      if (k.length > LIMITS.name) problems.push(`param ${k} name ${k.length}>${LIMITS.name}`)
      if ((v.description ?? '').length > LIMITS.paramDescription) problems.push(`param ${k} description ${v.description.length}>${LIMITS.paramDescription}`)
      if (!v.description) problems.push(`param ${k} has no description`)
    }
    if (problems.length) violations++
    rows.push({ set, tool: t.name, nameLen: t.name.length, descLen: (t.description ?? '').length, params: params.length, maxParamDesc: Math.max(0, ...params.map(([, v]) => (v.description ?? '').length)), readOnly: !!t.annotations?.readOnlyHint, untrusted: !!t.annotations?.untrustedContentHint, problems: problems.join('; ') || 'ok' })
  }
  let outputs = 0, longest = 0
  const measure = (name, r) => { outputs++; longest = Math.max(longest, r.text.length); if (r.text.length > LIMITS.output) { violations++; rows.push({ set: 'output', tool: name, nameLen: 0, descLen: 0, params: 0, maxParamDesc: 0, readOnly: false, untrusted: false, problems: `output ${r.text.length}>${LIMITS.output}` }) } }
  for (const t of await listTools(b.page)) record('always on', t)
  measure('get_dojo_state', await callTool(b.page, 'get_dojo_state', {}))
  for (const belt of belts) {
    await b.page.evaluate((id) => window.dojo.human.limitBelts([id]), belt.id)
    await b.page.evaluate(() => window.dojo.human.reset())
    measure('start_belt', await callTool(b.page, 'start_belt', { belt: belt.id }))
    measure('get_dojo_state', await callTool(b.page, 'get_dojo_state', {}))
    for (const t of await listTools(b.page)) record(belt.id, t)
  }
  console.error(`${outputs} tool outputs measured, longest ${longest}/${LIMITS.output} chars`)
} finally {
  await b.close()
  await srv?.close()
}

const head = '| Set | Tool | Name | Description | Params | Max param desc | readOnly | untrusted | Budget |'
const sep = '|---|---|---|---|---|---|---|---|---|'
const body = rows.map((r) => `| ${r.set} | \`${r.tool}\` | ${r.nameLen}/30 | ${r.descLen}/500 | ${r.params} | ${r.maxParamDesc}/150 | ${r.readOnly ? 'yes' : ''} | ${r.untrusted ? 'yes' : ''} | ${r.problems} |`)
console.log([head, sep, ...body].join('\n'))
console.log(`\n${rows.length} tools checked, ${violations} over budget.`)
process.exit(violations ? 1 : 0)
