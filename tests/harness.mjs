// Test harness: real Google Chrome with WebMCP enabled, driven by Playwright.
// Tools are exercised exactly the way an agent runtime does: getTools() then
// executeTool(tool, jsonArgs). See docs/research/chrome-152-probe.md.

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' }

/** Serve dist/ (single-page fallback to index.html). Returns { url, close }. */
export async function serveDist(dir = 'dist', port = 0) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = join(dir, path === '/' ? 'index.html' : path)
    try {
      const s = await stat(file)
      if (s.isDirectory()) file = join(file, 'index.html')
    } catch {
      file = join(dir, 'index.html')
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  return { url, close: () => new Promise((r) => server.close(r)) }
}

export async function launch({ native = true, headless = true } = {}) {
  const args = native ? ['--enable-features=WebMCP'] : []
  const browser = await chromium.launch({ channel: 'chrome', headless, args })
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
  return { browser, context, page, consoleErrors, close: () => browser.close() }
}

/** Agent-style tool listing: what an agent runtime sees. */
export async function listTools(page) {
  return page.evaluate(async () => {
    const tools = await document.modelContext.getTools()
    return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: typeof t.inputSchema === 'string' ? JSON.parse(t.inputSchema) : t.inputSchema, annotations: t.annotations }))
  })
}

/** Agent-style call: executeTool(tool, jsonArgs) → parsed result. */
export async function callTool(page, name, args = {}) {
  return page.evaluate(async ({ name, args }) => {
    const tools = await document.modelContext.getTools()
    const tool = tools.find((t) => t.name === name)
    if (!tool) throw new Error(`tool not registered: ${name}. have: ${tools.map((t) => t.name).join(', ')}`)
    const t0 = performance.now()
    const raw = await document.modelContext.executeTool(tool, JSON.stringify(args))
    const ms = Math.round(performance.now() - t0)
    let parsed
    try { parsed = JSON.parse(raw) } catch { parsed = raw }
    const text = parsed?.content?.[0]?.text ?? (typeof parsed === 'string' ? parsed : JSON.stringify(parsed))
    return { text, parsed, ms }
  }, { name, args })
}

export function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg)
}
