// Post-deploy assertion. Run after every deploy (npm run deploy does).
//   - HTTP 200 on the live URL
//   - no `Origin-Agent-Cluster: ?0` header (WebMCP is disabled on non-origin-isolated documents)
//   - real Chrome with WebMCP detects the native engine on the page and sees the always-on tools
//   - no console errors
// Usage: node scripts/check-live.mjs [url]

import { chromium } from 'playwright'

const url = process.argv[2] ?? 'https://webmcp-dojo.billowing-frost-066e.workers.dev/'
const res = await fetch(url, { redirect: 'manual' })
const oac = res.headers.get('origin-agent-cluster')
const problems = []
if (res.status !== 200) problems.push(`status ${res.status}`)
if (oac && oac.trim() === '?0') problems.push('Origin-Agent-Cluster: ?0 present (WebMCP would be disabled)')

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-features=WebMCP'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
// A fresh deploy can take up to a minute to propagate; poll before declaring it broken.
let booted = false
for (let attempt = 0; attempt < 8 && !booted; attempt++) {
  await page.goto(url, { waitUntil: 'networkidle' })
  booted = await page.waitForFunction(() => typeof window.dojo?.state === 'function', null, { timeout: 8000 }).then(() => true).catch(() => false)
  if (!booted) await new Promise((r) => setTimeout(r, 8000))
}
if (!booted) problems.push('window.dojo never appeared after 8 attempts')
const engine = await page.evaluate(() => window.dojo?.engine ?? 'none')
const tools = await page.evaluate(async () => (await document.modelContext?.getTools?.())?.map((t) => t.name) ?? [])
if (engine !== 'native') problems.push(`engine ${engine}, expected native`)
if (!tools.includes('get_dojo_state')) problems.push('get_dojo_state not registered: ' + tools.join(','))
if (errors.length) problems.push('console errors: ' + errors.join(' | '))
await browser.close()

console.log(`live check ${url}\n  status ${res.status} | origin-agent-cluster: ${oac ?? 'absent'} | engine: ${engine} | tools: ${tools.join(', ')}`)
if (problems.length) { console.log('  PROBLEMS: ' + problems.join('; ')); process.exit(1) }
console.log('  ok')
