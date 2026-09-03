import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png' }
const server = http.createServer((req,res)=>{
  const u = new URL(req.url,'http://x'); let p = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname)
  if(!fs.existsSync(p)) p = path.join(root,'index.html')
  res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream')
  res.end(fs.readFileSync(p))
})
await new Promise(r=>server.listen(4321,r))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
const errs = []
page.on('console', m => { if (m.type()==='error') errs.push(m.text()) })
await page.goto('http://localhost:4321/', { waitUntil: 'networkidle' })
const seed1 = await page.evaluate(()=>window.dojo?.seed ?? null)
console.log('URL before:', page.url(), 'seed:', seed1)
// click Watch a recorded run
await page.click('#watch')
await page.waitForTimeout(3000)
console.log('URL after click:', page.url())
const t0 = Date.now()
let done = false
for (let i=0;i<90;i++){
  await page.waitForTimeout(1000)
  const phase = await page.evaluate(()=> (window.dojo?.state?.() ?? window.__dojoState ?? null))
  const txt = await page.evaluate(()=>document.querySelector('#stage')?.innerText?.slice(0,200) ?? '')
  if (/report|belt card|Report card/i.test(txt) && /Rank|rank/.test(await page.evaluate(()=>document.body.innerText))) {}
  const isReport = await page.evaluate(()=>!!document.querySelector('.card, .report, #report') && /rank/i.test(document.body.innerText))
  if (isReport) { done = true; console.log('report reached at', ((Date.now()-t0)/1000).toFixed(1),'s'); break }
}
console.log('done:', done, 'elapsed', ((Date.now()-t0)/1000).toFixed(1))
console.log('---- body head ----')
console.log((await page.evaluate(()=>document.body.innerText)).slice(0,1500))
await page.screenshot({ path: process.argv[3] || '/tmp/probe.png', fullPage: false })
console.log('console errors:', errs.slice(0,5))
await browser.close(); server.close()
