// Turns a ladder run (evals/results/ladder-<model>-<time>.json, written by evals/run.mjs) into the
// transcript the lobby's "Watch a recorded run" button replays: public/recorded-run.json.
// The replay executes every tool call for real against the live page; agent prose is shown in the feed.
// Usage: node scripts/record-run.mjs evals/results/ladder-claude-opus-5-....json
import { readFile, writeFile } from 'node:fs/promises'

const src = process.argv[2]
if (!src) { console.error('usage: node scripts/record-run.mjs <ladder json>'); process.exit(1) }
const run = JSON.parse(await readFile(src, 'utf8'))
if (!run.done || !run.rank) { console.error(`refusing: that run did not finish (done=${run.done}, rank=${run.rank})`); process.exit(1) }

const steps = []
for (const t of run.transcript) {
  if (t.role === 'agent' && t.text.trim()) steps.push({ kind: 'agent', text: t.text.trim() })
  else if (t.role === 'tool') steps.push({ kind: 'tool', name: t.name, input: t.input ?? {} })
  else if (t.role === 'human') steps.push({ kind: 'human', text: t.text })
  // notes (empty responses) are not part of what the agent did on the page
}
const out = { model: run.model, seed: run.seed, date: run.startedAt.slice(0, 10), rank: run.rank, ms: run.ms, beltCalls: run.beltCalls, steps }
await writeFile('public/recorded-run.json', JSON.stringify(out) + '\n')
console.log(`public/recorded-run.json: ${run.model}, seed ${run.seed}, ${run.rank}, ${steps.filter((s) => s.kind === 'tool').length} tool calls, ${steps.length} steps`)
