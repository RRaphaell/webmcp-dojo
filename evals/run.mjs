// The Dojo eval harness.
//
// Runs a real LLM agent against the live Dojo page inside real Google Chrome
// (WebMCP enabled) - the agent only sees the page's WebMCP tools, exactly like
// ChatGPT's in-app browser would. The harness also plays the human: when a belt
// needs a confirmation, an answer, or a visual clue, it acts through the same
// human-side hooks the page's buttons call. Everything the Dojo records (pass /
// fail, calls, latency, injection resistance) comes from the page itself.
//
// Usage:
//   node evals/run.mjs                       # claude-opus-5, all belts, local dist/
//   node evals/run.mjs --models claude-opus-5,claude-sonnet-5,claude-haiku-4-5
//   node evals/run.mjs --url https://webmcp-dojo.billowing-frost-066e.workers.dev
//   node evals/run.mjs --belts white,yellow  --headed
// Needs ANTHROPIC_API_KEY (env, or ../.secrets.env one level above the repo).

import Anthropic from '@anthropic-ai/sdk'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDist, launch } from '../tests/harness.mjs'

// ---------- config ----------
const argv = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean))
const MODELS = String(argv.models ?? argv.model ?? 'claude-opus-5').split(',').map((s) => s.trim()).filter(Boolean)
const BELTS = argv.belts ? String(argv.belts).split(',') : null
const HEADED = argv.headed === true
const MAX_TURNS = Number(argv.maxTurns ?? 60)
const OUT_DIR = 'evals/results'

await loadSecrets()
const client = new Anthropic()

// ---------- run ----------
await mkdir(OUT_DIR, { recursive: true })
const srv = argv.url ? null : await serveDist()
const baseUrl = argv.url ?? srv.url
const allRuns = []
try {
  for (const model of MODELS) {
    console.log(`\n=== ${model} ===`)
    const run = await runModel(model)
    allRuns.push(run)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await writeFile(`${OUT_DIR}/${model}-${stamp}.json`, JSON.stringify(run, null, 2))
  }
  const table = renderTable(allRuns)
  console.log('\n' + table)
  await writeFile(`${OUT_DIR}/latest.md`, table + '\n')
} finally {
  await srv?.close()
}

// ---------- the agent loop ----------
async function runModel(model) {
  const b = await launch({ native: true, headless: !HEADED })
  const { page } = b
  const started = Date.now()
  const usage = { input: 0, output: 0 }
  const transcript = []
  try {
    await page.goto(baseUrl + '/?eval=1')
    await page.waitForFunction(() => typeof window.dojo?.state === 'function', null, { timeout: 15000 })
    const engine = await page.evaluate(() => window.dojo.engine)
    if (engine !== 'native') throw new Error('expected native WebMCP engine, got ' + engine)
    if (BELTS) await page.evaluate((belts) => window.dojo.human.limitBelts(belts), BELTS)

    const system = await page.evaluate(() => window.dojo.evalSystemPrompt ?? '')
    const humanPrompt = await page.evaluate(() => window.dojo.suggestedPrompt)
    const messages = [{ role: 'user', content: humanPrompt }]
    transcript.push({ role: 'human', text: humanPrompt })

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const tools = await pageTools(page)
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: system || undefined,
        tools,
        messages,
      })
      usage.input += response.usage.input_tokens
      usage.output += response.usage.output_tokens
      messages.push({ role: 'assistant', content: response.content })
      for (const block of response.content) if (block.type === 'text' && block.text.trim()) transcript.push({ role: 'agent', text: block.text })

      const toolUses = response.content.filter((c) => c.type === 'tool_use')
      if (response.stop_reason === 'tool_use' && toolUses.length) {
        const results = []
        for (const tu of toolUses) {
          const r = await executeOnPage(page, tu.name, tu.input)
          transcript.push({ role: 'tool', name: tu.name, input: tu.input, output: r.text, ms: r.ms, error: r.error })
          process.stdout.write(`  ${r.error ? 'x' : '·'} ${tu.name}(${short(JSON.stringify(tu.input))}) → ${short(r.text)} ${r.ms}ms\n`)
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.text, is_error: !!r.error })
        }
        messages.push({ role: 'user', content: results })
        continue
      }

      // The agent stopped talking to tools. Let the page's state decide what the human does next.
      const state = await page.evaluate(() => window.dojo.state())
      if (state.done) break
      const humanReply = await playHuman(page, state, response)
      if (!humanReply) break
      transcript.push({ role: 'human', text: humanReply })
      process.stdout.write(`  human: ${short(humanReply)}\n`)
      messages.push({ role: 'user', content: humanReply })
    }

    const final = await page.evaluate(() => window.dojo.state())
    const feed = await page.evaluate(() => window.dojo.feed())
    const report = { model, engine, url: baseUrl, startedAt: new Date(started).toISOString(), ms: Date.now() - started, usage, belts: final.results, rank: final.rank, done: final.done, calls: feed.length, transcript }
    console.log(`  rank: ${final.rank ?? 'n/a'} | belts passed: ${final.results.filter((r) => r.pass).length}/${final.results.length} | calls: ${feed.length} | ${Math.round(report.ms / 1000)}s`)
    return report
  } finally {
    await b.close()
  }
}

/** The human side. Acts through the page's human-only hooks; never through tools. */
async function playHuman(page, state, response) {
  const pending = state.pendingHuman
  if (pending?.kind === 'confirm') {
    await page.evaluate(() => window.dojo.human.confirm(true))
    return 'I approved it on screen. Keep going.'
  }
  if (pending?.kind === 'answer') {
    // The page tells the human what to say (the harness cannot invent facts the agent should have asked for).
    const answer = await page.evaluate(() => window.dojo.human.answerHint())
    await page.evaluate((a) => window.dojo.human.answer(a), answer)
    return answer
  }
  if (pending?.kind === 'clue') {
    const clue = await page.evaluate(() => window.dojo.human.readClue())
    return `The code on my screen says: ${clue}`
  }
  // Nothing pending: the agent just talked. If it asked something, answer from the page's hint; else nudge once.
  const lastText = response.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ')
  const hint = await page.evaluate(() => window.dojo.human.answerHint?.() ?? null)
  if (hint) return hint
  if (/\?\s*$/.test(lastText.trim())) return 'Use your judgment and continue with the site tools.'
  return state.phase === 'report' ? null : 'Please continue the Dojo using the site tools.'
}

// ---------- page glue ----------
async function pageTools(page) {
  const tools = await page.evaluate(async () => {
    const list = await document.modelContext.getTools()
    return list.map((t) => ({ name: t.name, description: t.description, input_schema: typeof t.inputSchema === 'string' ? JSON.parse(t.inputSchema) : t.inputSchema }))
  })
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema ?? { type: 'object', properties: {} } }))
}

async function executeOnPage(page, name, input) {
  return page.evaluate(async ({ name, input }) => {
    const list = await document.modelContext.getTools()
    const tool = list.find((t) => t.name === name)
    const t0 = performance.now()
    if (!tool) return { text: `Tool "${name}" is not available right now. Available: ${list.map((t) => t.name).join(', ')}`, ms: 0, error: true }
    try {
      const raw = await document.modelContext.executeTool(tool, JSON.stringify(input ?? {}))
      let parsed; try { parsed = JSON.parse(raw) } catch { parsed = raw }
      const text = parsed?.content?.[0]?.text ?? (typeof parsed === 'string' ? parsed : JSON.stringify(parsed))
      return { text, ms: Math.round(performance.now() - t0), error: !!parsed?.isError }
    } catch (e) {
      return { text: String(e), ms: Math.round(performance.now() - t0), error: true }
    }
  }, { name, input })
}

// ---------- output ----------
function renderTable(runs) {
  const beltIds = [...new Set(runs.flatMap((r) => r.belts.map((b) => b.id)))]
  const head = `| Model | Rank | ${beltIds.map((id) => runs[0].belts.find((b) => b.id === id)?.name ?? id).join(' | ')} | Calls | Time | Tokens in/out |`
  const sep = `|---|---|${beltIds.map(() => '---').join('|')}|---|---|---|`
  const rows = runs.map((r) => {
    const cells = beltIds.map((id) => { const b = r.belts.find((x) => x.id === id); return b ? (b.pass ? 'pass' : 'fail') + (b.note ? ` (${b.note})` : '') : '-' })
    return `| ${r.model} | ${r.rank ?? '-'} | ${cells.join(' | ')} | ${r.calls} | ${Math.round(r.ms / 1000)}s | ${r.usage.input}/${r.usage.output} |`
  })
  return [head, sep, ...rows].join('\n')
}

async function loadSecrets() {
  if (process.env.ANTHROPIC_API_KEY) return
  const p = resolve('..', '.secrets.env')
  if (!existsSync(p)) return
  for (const line of (await readFile(p, 'utf8')).split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

function short(s, n = 90) { s = String(s ?? '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s }
