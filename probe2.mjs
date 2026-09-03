import { chromium } from 'playwright'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'
const root = process.argv[2]
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png' }
const server = http.createServer((req,res)=>{ const u=new URL(req.url,'http://x'); let p=path.join(root,u.pathname==='/'?'index.html':u.pathname); if(!fs.existsSync(p)) p=path.join(root,'index.html'); res.setHeader('Content-Type',types[path.extname(p)]||'application/octet-stream'); res.end(fs.readFileSync(p)) })
await new Promise(r=>server.listen(4322,r))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport:{width:1400,height:950} })
await page.goto('http://localhost:4322/',{waitUntil:'networkidle'})
console.log('start url', page.url())
const t0=Date.now()
await page.click('#watch')
for(let i=0;i<120;i++){
  await page.waitForTimeout(500)
  const t = await page.evaluate(()=>document.body.innerText)
  if(/BLACK BELT|black belt/i.test(t) && /every belt passed|7 of 7/i.test(t)){ console.log('CARD REACHED in', ((Date.now()-t0)/1000).toFixed(1),'s; url', page.url()); break }
}
const t = await page.evaluate(()=>document.body.innerText)
console.log('final url', page.url())
console.log(t.slice(0,300))
await browser.close(); server.close()
