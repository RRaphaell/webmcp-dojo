// Takes the README screenshots from a real run: the lobby, then the recorded run replaying against the
// page (every call executes for real), captured at the moments that matter, then the card and Open Mat.
// Usage: node scripts/screenshots.mjs [--url https://webmcp-dojo.billowing-frost-066e.workers.dev]
import { mkdir } from 'node:fs/promises'
import { serveDist, launch } from '../tests/harness.mjs'

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : null
const srv = url ? null : await serveDist()
const base = url ?? srv.url
const dir = 'docs/screenshots'
await mkdir(dir, { recursive: true })
const b = await launch({ native: true })
const page = b.page
await page.setViewportSize({ width: 1280, height: 800 })
const shot = async (name, opts = {}) => { await page.screenshot({ path: `${dir}/${name}.png`, ...opts }); console.log('wrote', `${dir}/${name}.png`) }
const state = () => page.evaluate(() => window.dojo.state())
const feed = () => page.evaluate(() => window.dojo.feed())

try {
  await page.goto(`${base}/?seed=7`)
  await page.waitForFunction(() => typeof window.dojo?.state === 'function', null, { timeout: 15000 })
  await page.waitForTimeout(400)
  await shot('01-lobby')

  // The recorded run, on its own seed. Capture each moment the first time it appears.
  await page.goto(`${base}/?seed=7&watch=1`)
  await page.waitForFunction(() => typeof window.dojo?.state === 'function', null, { timeout: 15000 })
  const taken = new Set()
  const want = {
    'belt-white': (s) => s.currentBelt === 'white' && s.phase === 'belt',
    'belt-yellow': (s, f) => s.currentBelt === 'yellow' && f.some((c) => c.tool === 'read_mat_log'),
    'belt-orange': (s) => s.currentBelt === 'orange' && s.pendingHuman?.kind === 'confirm',
    'belt-green': (s) => s.currentBelt === 'green' && s.pendingHuman?.kind === 'answer',
    'belt-blue': (s, f) => s.currentBelt === 'blue' && f.some((c) => c.untrusted),
    'belt-brown': (s) => s.currentBelt === 'brown' && s.pendingHuman?.kind === 'clue',
    'belt-black': (s, f) => s.currentBelt === 'black' && f.some((c) => c.tool === 'list_waitlist'),
    '06-recorded-run': (s, f) => s.currentBelt === 'blue' && f.some((c) => c.tool === 'report_suspicious_text'),
  }
  const t0 = Date.now()
  while (Date.now() - t0 < 120_000) {
    const s = await state()
    const f = await feed()
    for (const [name, cond] of Object.entries(want)) {
      if (taken.has(name) || !cond(s, f)) continue
      taken.add(name)
      await page.waitForTimeout(name === 'belt-brown' ? 250 : 150)
      await shot(name)
    }
    if (s.phase === 'report') break
    await page.waitForTimeout(150)
  }
  const final = await state()
  if (final.phase !== 'report') throw new Error('the replay did not reach the card: ' + JSON.stringify(final).slice(0, 200))
  await page.waitForTimeout(500)
  await shot('05-report-card-black')
  await shot('03-report-card', { fullPage: true })
  await shot('07-recorded-run-card')

  // Open Mat with a deliberately over-budget definition pasted in.
  await page.goto(`${base}/?seed=7`)
  await page.waitForFunction(() => typeof window.dojo?.state === 'function', null, { timeout: 15000 })
  await page.evaluate(() => { const d = document.querySelector('#openmat-section'); if (d) d.open = true })
  const sample = JSON.stringify({ name: 'search_member_messages_and_summarise_everything', description: 'x'.repeat(520), inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'y'.repeat(160) } } } }, null, 2)
  await page.fill('#om-input', sample)
  await page.click('#om-run')
  await page.waitForTimeout(300)
  const om = await page.locator('#openmat-section').boundingBox()
  if (om) await page.evaluate((y) => window.scrollTo(0, y - 24), om.y)
  await page.waitForTimeout(200)
  await shot('04-open-mat')
  console.log('missing moments:', Object.keys(want).filter((k) => !taken.has(k)).join(', ') || 'none')
} finally {
  await b.close()
  await srv?.close()
}
