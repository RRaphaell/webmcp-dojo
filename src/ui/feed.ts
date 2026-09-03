// The live feed: every tool call the agent makes, as it happens.
// Latency shown is page-side execution time (our execute()), not the agent's round trip.

import type { ToolCallRecord } from '../webmcp/registry'
import { esc, fmtArgs, fmtMs } from './dom'

export function renderFeed(container: HTMLElement, feed: ToolCallRecord[], attached: boolean, currentBelt: string | null): void {
  const rows = feed.slice(-60).map((c) => {
    const state = c.ok ? 'ok' : 'err'
    return `<li class="call ${state}${c.set === currentBelt ? ' current' : ''}">
      <div class="call-head">
        <span class="badge ${c.readOnly ? 'read' : 'write'}">${c.readOnly ? 'read' : 'write'}</span>
        <code class="tool">${esc(c.tool)}</code>
        <span class="ms" title="page-side execution time">${fmtMs(c.ms)}</span>
      </div>
      ${fmtArgs(c.args) ? `<div class="args"><code>${esc(fmtArgs(c.args))}</code></div>` : ''}
      <div class="out">${esc(c.summary)}</div>
    </li>`
  })
  container.innerHTML = `
    <div class="feed-head">
      <span class="dot ${attached ? 'on' : ''}"></span>
      <span class="feed-title">${attached ? 'Agent attached' : 'Waiting for an agent'}</span>
      <span class="feed-count mono">${feed.length} call${feed.length === 1 ? '' : 's'}</span>
    </div>
    ${rows.length ? `<ol class="calls">${rows.join('')}</ol>` : `<p class="feed-empty">Every tool call your agent makes shows up here, with its arguments, its result and how long the page took to answer.</p>`}`
  const list = container.querySelector('.calls')
  if (list) list.scrollTop = list.scrollHeight
}
