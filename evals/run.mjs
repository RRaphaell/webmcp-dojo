// The Dojo eval harness.
//
// Two modes, both running a real LLM agent against the live Dojo page inside
// real Google Chrome with WebMCP enabled. The agent only sees the page's WebMCP
// tools, exactly like ChatGPT's in-app browser would.
//
//   node evals/run.mjs                      ladder mode: the whole Dojo, the harness plays the human
//   node evals/run.mjs --suite evals/dojo.evals.json
//                                           suite mode: official webmcp-evals cases, scored with the
//                                           ported official matcher, printed in the official table shape,
//                                           report written to .evals/report-<ts>.json (analyze-compatible)
// Options: --models a,b  --url https://...  --belts green,blue  --seed 7  --runs 3  --headed
// Needs ANTHROPIC_API_KEY (env, or ../.secrets.env one level above the repo).

import Anthropic from '@anthropic-ai/sdk'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDist, launch } from '../tests/harness.mjs'
import { evaluateExecutionTrajectory, failureDetail, OFFICIAL_SYSTEM_PROMPT } from './matcher.mjs'

// ---------- config ----------
const argv = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean))
const MODELS = String(argv.models ?? argv.model ?? 'claude-opus-5').split(',').map((s) => s.trim()).filter(Boolean)
const BELTS = argv.belts ? String(argv.belts).split(',') : null
const HEADED = argv.headed === true
const MAX_TURNS = Number(argv.maxTurns ?? 60)
const SEED = argv.seed ? Number(argv.seed) : 7
const RUNS = Number(argv.runs ?? 1)
const OUT_DIR = 'evals/results'

await loadSecrets()
const client = new Anthropic()
await mkdir(OUT_DIR, { recursive: true })
const srv = argv.url ? null : await serveDist()
const baseUrl = argv.url ?? srv.url

try {
  if (argv.suite) await suiteMode(String(argv.suite))
  else await ladderMode()
} finally {
  await srv?.close()
}

// =====================================================================
// Ladder mode: the product experience, harness plays the human
// =====================================================================
async function ladderMode() {
  const allRuns = []
  for (const model of MODELS) {
    for (let run = 0; run < RUNS; run++) {
      console.log(`\n=== ${model} · seed ${SEED} · run ${run + 1}/${RUNS} ===`)
      const r = await runLadder(model)
      allRuns.push(r)
      await writeFile(`${OUT_DIR}/ladder-${model}-${stamp()}.json`, JSON.stringify(r, null, 2))
    }
  }
  const table = ladderTable(allRuns)
  console.log('\n' + table)
  await writeFile(`${OUT_DIR}/ladder-latest.md`, table + '\n')
}

async function runLadder(model) {
  const b = await launch({ native: true, headless: !HEADED })
  const { page } = b
  const started = Date.now()
  const usage = { input: 0, output: 0 }
  const transcript = []
  try {
    await page.goto(`${baseUrl}/?eval=1&seed=${SEED}`)
    await page.waitForFunction(() => typeof window.dojo?.state === 'function', null, { timeout: 15000 })
    const engine = await page.evaluate(() => window.dojo.engine)
    if (engine !== 'native') throw new Error('expected native WebMCP engine, got ' + engine)
    if (BELTS) await page.evaluate((belts) => window.dojo.human.limitBelts(belts), BELTS)
    await page.evaluate((m) => window.dojo.human.setAgentName(m), model)

    const humanPrompt = await page.evaluate(() => window.dojo.suggestedPrompt)
    const messages = [{ role: 'user', content: humanPrompt }]
    transcript.push({ role: 'human', text: humanPrompt })

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const tools = await pageTools(page)
      const response = await client.messages.create({ model, max_tokens: 4096, tools, messages })
      usage.input += response.usage.input_tokens
      usage.output += response.usage.output_tokens
      messages.push({ role: 'assistant', content: response.content })
      for (const block of response.content) if (block.type === 'text' && block.text.trim()) { transcript.push({ role: 'agent', text: block.text }); process.stdout.write(`  agent: ${short(block.text)}\n`) }

      const toolUses = response.content.filter((c) => c.type === 'tool_use')
      if (response.stop_reason === 'tool_use' && toolUses.length) {
        const results = []
        for (const tu of toolUses) {
          const r = await executeOnPage(page, tu.name, tu.input)
          transcript.push({ role: 'tool', name: tu.name, input: tu.input, output: r.text, ms: r.ms, error: r.error })
          process.stdout.write(`  ${r.error ? 'x' : '·'} ${tu.name}(${short(JSON.stringify(tu.input), 60)}) → ${short(r.text)} ${r.ms}ms\n`)
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.text, is_error: !!r.error })
        }
        messages.push({ role: 'user', content: results })
        // A pending human request is answered as soon as the agent has asked in words (it may keep calling tools).
        continue
      }

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
    const report = { mode: 'ladder', model, engine, url: baseUrl, seed: SEED, startedAt: new Date(started).toISOString(), ms: Date.now() - started, usage, belts: final.results, rank: final.rank, done: final.done, calls: feed.length, beltCalls: feed.filter((c) => c.set !== 'dojo').length, cardUrl: await page.evaluate(() => location.href), transcript }
    console.log(`  rank: ${final.rank ?? 'n/a'} | belts passed: ${final.results.filter((r) => r.pass).length}/${final.results.length} | belt calls: ${report.beltCalls} | ${Math.round(report.ms / 1000)}s`)
    return report
  } finally {
    await b.close()
  }
}

/** The human side. Acts through the page's human-only hooks and real pointer input; never through tools. */
async function playHuman(page, state, response) {
  const pending = state.pendingHuman
  const lastText = response.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ')
  const asked = /\?/.test(lastText)
  if (pending?.kind === 'confirm') {
    await page.evaluate(() => window.dojo.human.confirm(true))
    return 'Approved on screen.'
  }
  if (pending?.kind === 'answer') {
    if (!asked) return 'I am here. Ask me if you need something only I can see.'
    const hint = await page.evaluate(() => window.dojo.human.answerHint())
    if (pending.control) { await page.click(pending.control).catch(() => {}) } else { await page.evaluate((a) => window.dojo.human.answer(a), hint) }
    return `${hint}`
  }
  if (pending?.kind === 'clue') {
    if (!asked) return 'I am here. Ask me if you need something only I can see.'
    if (pending.control) {
      const box = await page.locator(pending.control).boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down(); await page.waitForTimeout((pending.holdMs ?? 1200) + 250); await page.mouse.up()
      }
    }
    const clue = await page.evaluate(() => window.dojo.human.readClue())
    return clue ? `It says ${clue}.` : 'I pressed it but nothing appeared.'
  }
  if (state.phase === 'report') return null
  return asked ? 'Use the site tools and your judgment. I will answer when a belt needs me.' : 'Keep going with the site tools.'
}

// =====================================================================
// Suite mode: official webmcp-evals cases, official scoring
// =====================================================================
async function suiteMode(path) {
  const cases = JSON.parse(await readFile(path, 'utf8'))
  const results = []
  for (const model of MODELS) {
    for (const [ci, tc] of cases.entries()) {
      for (let run = 0; run < RUNS; run++) {
        const label = tc.name ?? `case ${ci + 1}`
        process.stdout.write(`\n[${model}] ${label} (run ${run + 1})\n`)
        const out = await runCase(model, tc)
        const rows = evaluateExecutionTrajectory(tc.expectedCall, out.executions)
        for (const [si, row] of rows.entries()) results.push({ test: tc, response: row.actual, outcome: out.error ? 'error' : row.outcome, trajectory: out.trajectory, browserConsoleErrors: out.consoleErrors, runIndex: run, stepIndex: si, model, expected: row.expected, detail: failureDetail(row) })
        if (out.error) console.log('  ERROR ' + out.error)
        for (const row of rows) console.log(`  ${row.outcome === 'pass' ? 'PASS' : 'FAIL'} expected ${row.expected?.functionName ?? '-'} · actual ${row.actual?.functionName ?? '-'} · ${failureDetail(row)}`)
      }
    }
  }
  const passCount = results.filter((r) => r.outcome === 'pass').length
  const failCount = results.filter((r) => r.outcome === 'fail').length
  const errorCount = results.filter((r) => r.outcome === 'error').length
  const total = results.length
  console.log('\nEvaluation summary\n')
  console.log('Step | Status | Expected Function | Actual Function | Details')
  for (const r of results) console.log(`${r.stepIndex + 1} | ${r.outcome.toUpperCase()} | ${r.expected?.functionName ?? '-'} | ${r.response?.functionName ?? '-'} | ${r.detail}`)
  console.log(`\nPass count (steps): ${passCount}/${total} (${total ? ((passCount / total) * 100).toFixed(1) : '0.0'}%)`)
  await mkdir('.evals', { recursive: true })
  const report = { config: { url: baseUrl, models: MODELS, runs: RUNS, seed: SEED, evals: path, chromeChannel: 'chrome', backend: 'anthropic-sdk-direct' }, results: { results, testCount: total, passCount, failCount, errorCount } }
  const file = `.evals/report-${Date.now()}.json`
  await writeFile(file, JSON.stringify(report, null, 2))
  const md = suiteTable(cases, results, MODELS)
  await writeFile(`${OUT_DIR}/suite-latest.md`, md + '\n')
  console.log(`\nReport: ${file}\n${md}`)
}

async function runCase(model, tc) {
  const b = await launch({ native: true, headless: !HEADED })
  const { page } = b
  const executions = []
  const trajectory = []
  let error = null
  try {
    await page.goto(`${baseUrl}/?eval=1&seed=${SEED}`)
    await page.waitForFunction(() => typeof window.dojo?.state === 'function', null, { timeout: 15000 })
    if (tc.belts) await page.evaluate((belts) => window.dojo.human.limitBelts(belts), tc.belts)
    // Convert official messages to Anthropic messages (replaying pre-seeded calls for real on the page).
    const messages = []
    for (const m of tc.messages) {
      if (m.type === 'message') messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.content })
      else if (m.type === 'functioncall') messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: `seed-${messages.length}`, name: m.name, input: m.arguments ?? {} }] })
      else if (m.type === 'functionresponse') {
        // Execute the seeded call for real so page state matches, but return the seeded response text if given.
        await executeOnPage(page, m.name, tc.messages.find((x) => x.type === 'functioncall' && x.name === m.name)?.arguments ?? {})
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `seed-${messages.length - 1}`, content: typeof m.response === 'string' ? m.response : JSON.stringify(m.response) }] })
      }
    }
    for (let turn = 0; turn < (tc.maxSteps ?? 12); turn++) {
      const tools = await pageTools(page)
      const response = await client.messages.create({ model, max_tokens: 2048, system: OFFICIAL_SYSTEM_PROMPT, tools, messages })
      messages.push({ role: 'assistant', content: response.content })
      const step = { text: response.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), toolCalls: [], toolResults: [], availableTools: tools.map((t) => t.name) }
      const toolUses = response.content.filter((c) => c.type === 'tool_use')
      if (response.stop_reason !== 'tool_use' || !toolUses.length) { trajectory.push(step); break }
      const results = []
      for (const tu of toolUses) {
        const r = await executeOnPage(page, tu.name, tu.input)
        executions.push({ functionName: tu.name, args: tu.input ?? {}, result: r.text })
        step.toolCalls.push({ name: tu.name, args: tu.input }); step.toolResults.push(r.text)
        process.stdout.write(`  · ${tu.name}(${short(JSON.stringify(tu.input), 60)}) → ${short(r.text, 70)}\n`)
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.text, is_error: !!r.error })
      }
      trajectory.push(step)
      messages.push({ role: 'user', content: results })
    }
  } catch (e) {
    error = String(e.message ?? e)
  } finally {
    await b.close()
  }
  return { executions, trajectory, error, consoleErrors: b.consoleErrors }
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
  for (let attempt = 0; ; attempt++) {
    const r = await executeOnPageOnce(page, name, input)
    if (!(r.error && /unknown transient reason/i.test(r.text)) || attempt >= 3) return r
    await new Promise((res) => setTimeout(res, 60 * (attempt + 1)))
  }
}

async function executeOnPageOnce(page, name, input) {
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
function ladderTable(runs) {
  const beltIds = [...new Set(runs.flatMap((r) => r.belts.map((b) => b.id)))]
  const head = `| Model | Seed | Rank | ${beltIds.join(' | ')} | Belt calls | Time | Tokens in/out |`
  const sep = `|---|---|---|${beltIds.map(() => '---').join('|')}|---|---|---|`
  const rows = runs.map((r) => `| ${r.model} | ${r.seed} | ${r.rank ?? '-'} | ${beltIds.map((id) => { const b = r.belts.find((x) => x.id === id); return b ? (b.pass ? 'pass' : 'fail') + ` (${b.calls})` : '-' }).join(' | ')} | ${r.beltCalls} | ${Math.round(r.ms / 1000)}s | ${r.usage.input}/${r.usage.output} |`)
  return [head, sep, ...rows].join('\n')
}

function suiteTable(cases, results, models) {
  const head = '| Model | Case | Steps | Pass | Fail | Error |'
  const sep = '|---|---|---|---|---|---|'
  const rows = []
  for (const model of models) for (const tc of cases) {
    const rs = results.filter((r) => r.model === model && r.test === tc)
    rows.push(`| ${model} | ${tc.name ?? '-'} | ${rs.length} | ${rs.filter((r) => r.outcome === 'pass').length} | ${rs.filter((r) => r.outcome === 'fail').length} | ${rs.filter((r) => r.outcome === 'error').length} |`)
  }
  const pass = results.filter((r) => r.outcome === 'pass').length
  return [head, sep, ...rows, '', `Pass count (steps): ${pass}/${results.length} (${results.length ? ((pass / results.length) * 100).toFixed(1) : '0.0'}%)`].join('\n')
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

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-') }
function short(s, n = 90) { s = String(s ?? '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s }
