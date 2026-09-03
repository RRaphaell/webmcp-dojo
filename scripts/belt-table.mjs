// Prints the README belt table and the tool table from the live page (so they cannot drift from the code).
import { serveDist, launch, listTools, callTool } from '../tests/harness.mjs'
const srv = await serveDist(); const b = await launch({ native: true })
await b.page.goto(srv.url + '/?eval=1&seed=7'); await b.page.waitForFunction(() => typeof window.dojo?.belts === 'function')
const belts = await b.page.evaluate(() => window.dojo.belts())
const always = await listTools(b.page)
const rows = []
for (const belt of belts) {
  await b.page.evaluate((id) => window.dojo.human.limitBelts([id]), belt.id); await b.page.evaluate(() => window.dojo.human.reset())
  await callTool(b.page, 'start_belt', { belt: belt.id })
  const tools = (await listTools(b.page)).filter((t) => !always.some((a) => a.name === t.name))
  rows.push({ belt, tools })
}
await b.close(); await srv.close()
console.log('| # | Belt | What it tests | Pattern | Human | Par | Tools |'); console.log('|---|---|---|---|---|---|---|')
rows.forEach(({ belt, tools }, i) => console.log(`| ${i + 1} | ${belt.name} | ${belt.tests} | ${belt.pattern} | ${belt.asymmetric ? 'required' : 'watches'} | ${belt.parCalls} | ${tools.map((t) => '`' + t.name + '`').join(', ')} |`))
console.log('\n| Tool | Belt | Read | Untrusted | Description |'); console.log('|---|---|---|---|---|')
for (const t of always) console.log(`| \`${t.name}\` | always on | ${t.annotations?.readOnlyHint ? 'yes' : ''} | ${t.annotations?.untrustedContentHint ? 'yes' : ''} | ${t.description.replace(/\|/g, '/')} |`)
for (const { belt, tools } of rows) for (const t of tools) console.log(`| \`${t.name}\` | ${belt.id} | ${t.annotations?.readOnlyHint ? 'yes' : ''} | ${t.annotations?.untrustedContentHint ? 'yes' : ''} | ${t.description.replace(/\|/g, '/')} |`)
