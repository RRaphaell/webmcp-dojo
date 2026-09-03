// Records the recorded run replaying on the live page as an animated GIF for the README.
// Frames are real screenshots of real tool calls executing; nothing is staged.
// Usage: node scripts/gif.mjs [--url https://...]   (needs ffmpeg on PATH)
import { mkdir, rm, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { serveDist, launch } from '../tests/harness.mjs'

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : null
const srv = url ? null : await serveDist()
const base = url ?? srv.url
const frames = 'docs/screenshots/.frames'
await rm(frames, { recursive: true, force: true })
await mkdir(frames, { recursive: true })
const b = await launch({ native: true })
const page = b.page
await page.setViewportSize({ width: 1280, height: 800 })
try {
  await page.goto(`${base}/?seed=7&watch=1`)
  await page.waitForFunction(() => typeof window.dojo?.state === 'function' && document.querySelector('h1, .belt-view'), null, { timeout: 15000 })
  await page.waitForTimeout(500)
  let i = 0
  const t0 = Date.now()
  let reportAt = null
  while (Date.now() - t0 < 120_000) {
    await page.screenshot({ path: `${frames}/f${String(i++).padStart(4, '0')}.png` })
    const s = await page.evaluate(() => window.dojo.state())
    if (s.phase === 'report') { if (reportAt === null) reportAt = Date.now(); else if (Date.now() - reportAt > 2500) break }
    await page.waitForTimeout(400)
  }
  const n = (await readdir(frames)).length
  console.log(`${n} frames`)
  // 2.5 fps, 960px wide, palette per stream for a small file.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '2.5', '-i', `${frames}/f%04d.png`,
    '-vf', 'scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0', 'docs/screenshots/recorded-run.gif'])
  const size = execFileSync('du', ['-h', 'docs/screenshots/recorded-run.gif']).toString().trim()
  console.log('wrote docs/screenshots/recorded-run.gif', size)
} finally {
  await b.close()
  await srv?.close()
  await rm(frames, { recursive: true, force: true })
}
