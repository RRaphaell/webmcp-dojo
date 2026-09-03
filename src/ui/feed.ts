// The agent rail: attach chip (five honest states), LIVE TOOLS (n) that visibly
// mutates when a belt registers its tools, and the feed of every call, human
// event and check verdict in one stream. Latency shown is page-side execution
// time (performance.now() around execute), never the agent's round trip.

import type { ToolCallRecord, ActiveTool } from '../webmcp/registry'
import type { EngineKind } from '../webmcp/shim'
import { esc, fmtArgs, fmtMs } from './dom'

export interface FeedEvent {
  kind: 'human' | 'check' | 'toolchange' | 'sensei' | 'safety'
  at: number
  text: string
  pass?: boolean
}

export type AttachState = 'no-channel' | 'simulated' | 'waiting' | 'attached' | 'failed'

export function attachState(engine: EngineKind, lastCallAt: number | null, now: number, registrationError: string | null): AttachState {
  if (registrationError) return 'failed'
  if (engine === 'shim') return 'simulated'
  if (lastCallAt === null) return 'waiting'
  return now - lastCallAt < 60_000 ? 'attached' : 'waiting'
}

const CHIP: Record<AttachState, string> = {
  'no-channel': 'NO TOOL CHANNEL',
  simulated: 'SIMULATED TOOLS',
  waiting: 'TOOLS REGISTERED, WAITING',
  attached: 'AGENT ATTACHED',
  failed: 'REGISTRATION FAILED',
}

let prevToolNames: string[] = []

export function renderRail(container: HTMLElement, opts: {
  engine: EngineKind
  tools: readonly ActiveTool[]
  feed: ToolCallRecord[]
  events: FeedEvent[]
  currentBelt: string | null
  registrationError: string | null
  callsPar: number | null
}): void {
  const { engine, tools, feed, events, currentBelt, registrationError } = opts
  const lastCallAt = feed.length ? feed[feed.length - 1].startedAt : null
  const now = performance.now()
  const state = attachState(engine, lastCallAt, now, registrationError)
  const ago = lastCallAt !== null ? Math.round((now - lastCallAt) / 1000) : null

  // LIVE TOOLS with strike-through of names that just left.
  const names = tools.map((t) => t.spec.name)
  const gone = prevToolNames.filter((n) => !names.includes(n))
  const added = names.filter((n) => !prevToolNames.includes(n))
  prevToolNames = names
  const toolRows = [
    ...tools.map((t) => `<li class="lt ${added.includes(t.spec.name) ? 'new' : ''}"><code>${esc(t.spec.name)}</code>${badges(t)}</li>`),
    ...gone.map((n) => `<li class="lt gone"><code>${esc(n)}</code></li>`),
  ].join('')

  // Merge calls and events into one stream by time.
  type Row = { at: number; html: string }
  const rows: Row[] = feed.map((c) => ({ at: c.startedAt, html: callRow(c, currentBelt) }))
  for (const e of events) rows.push({ at: e.at, html: eventRow(e) })
  rows.sort((a, b) => a.at - b.at)

  container.innerHTML = `
    <div class="feed-head">
      <span class="dot ${state === 'attached' ? 'on' : ''} ${state === 'simulated' ? 'sim' : ''}"></span>
      <span class="feed-title">${CHIP[state]}</span>
      <span class="feed-count mono">${state === 'attached' && ago !== null ? `last call ${ago}s ago` : `${feed.length} call${feed.length === 1 ? '' : 's'}`}</span>
    </div>
    ${state === 'failed' ? `<div class="feed-note fail-text">${esc(registrationError ?? '')}</div>` : ''}
    ${state === 'simulated' ? `<div class="feed-note">No agent browser detected. The page simulates the tool channel so you can run tools by hand. For a real agent: ChatGPT desktop (Sol or Terra) with site tools enabled, or Chrome 149+ with <code>chrome://flags/#enable-webmcp-testing</code>.</div>` : ''}
    <div class="livetools">
      <div class="lt-head">LIVE TOOLS (${tools.length})</div>
      <ul class="lt-list">${toolRows}</ul>
    </div>
    ${rows.length ? `<ol class="calls">${rows.slice(-80).map((r) => `<li class="frow">${r.html}</li>`).join('')}</ol>` : `<p class="feed-empty">Every tool call your agent makes shows up here: arguments, result, and how long the page took to answer. Human actions and check verdicts land in the same stream.</p>`}
    ${opts.callsPar !== null ? `<div class="feed-foot mono">belt calls ${feed.filter((c) => c.set !== 'dojo').length} · par ${opts.callsPar}</div>` : ''}`
  const list = container.querySelector('.calls')
  if (list) list.scrollTop = list.scrollHeight
}

function badges(t: ActiveTool): string {
  const b: string[] = []
  b.push(t.spec.annotations?.readOnlyHint ? '<span class="badge read">read</span>' : '<span class="badge write">write</span>')
  if (t.spec.annotations?.untrustedContentHint) b.push('<span class="badge untrusted">untrusted</span>')
  return b.join('')
}

function callRow(c: ToolCallRecord, currentBelt: string | null): string {
  const cls = ['call', c.ok ? 'ok' : 'err', c.set === currentBelt ? 'current' : '', c.untrusted ? 'untrusted' : ''].filter(Boolean).join(' ')
  return `<div class="${cls}">
    <div class="call-head">
      <span class="badge ${c.readOnly ? 'read' : 'write'}">${c.readOnly ? 'read' : 'write'}</span>${c.untrusted ? '<span class="badge untrusted">untrusted</span>' : ''}
      <code class="tool">${esc(c.tool)}</code>
      <span class="ms" title="page-side execution time">${fmtMs(c.ms)}</span>
    </div>
    ${fmtArgs(c.args) ? `<div class="args"><code>${esc(fmtArgs(c.args))}</code></div>` : ''}
    <div class="out">${esc(c.summary)}</div>
  </div>`
}

function eventRow(e: FeedEvent): string {
  if (e.kind === 'human') return `<div class="ev human"><span class="sq"></span>${esc(e.text)}</div>`
  if (e.kind === 'check') return `<div class="ev check ${e.pass ? 'pass' : 'fail'}"><span class="mono muted">check</span> ${esc(e.text)} <b>${e.pass ? 'PASS' : 'FAILED'}</b></div>`
  if (e.kind === 'toolchange') return `<div class="ev toolchange">${esc(e.text)}</div>`
  if (e.kind === 'safety') return `<div class="ev safety">${esc(e.text)}</div>`
  return `<div class="ev sensei">${esc(e.text)}</div>`
}
