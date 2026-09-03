import './styles/app.css'
import type { EngineKind } from './webmcp/shim'
import { DojoRuntime, SUGGESTED_PROMPT } from './runtime'
import { belts, beltColor, beltNames } from './belts/index'
import { rankFor } from './belts/types'
import type { BeltResult } from './belts/types'
import { renderFeed } from './ui/feed'
import { renderInspector } from './ui/inspector'
import { renderOpenMat } from './ui/openmat'
import { esc, copyText } from './ui/dom'
import { readReportFromUrl, reportUrl } from './share'
import type { ReportCard } from './share'

export async function boot(engine: EngineKind): Promise<void> {
  const rt = new DojoRuntime(engine, belts)
  rt.exposeHooks()
  const root = document.getElementById('app')!
  root.innerHTML = `
    <div class="frame">
      <header class="top">
        <div class="brand"><span class="name">The Dojo</span><span class="sub">a website that tests the agent visiting it</span></div>
        <span class="chip ${engine === 'native' ? 'native' : ''}" id="engine-chip"><span class="dot"></span>${engine === 'native' ? 'WebMCP detected in this browser' : 'Simulated tools (no agent browser detected)'}</span>
      </header>
      <div class="main">
        <section id="stage"></section>
        <aside>
          <div class="feed" id="feed"></div>
          <details class="side-section" id="inspector-section"><summary>Tools the agent can see right now</summary><div id="inspector"></div></details>
          <details class="side-section" id="openmat-section"><summary>Open Mat: check your own tools</summary><div id="openmat"></div></details>
        </aside>
      </div>
      <footer class="foot">
        <span class="weave">– | – | –</span>
        <span>Built for the OpenAI WebMCP Challenge by <a href="https://x.com/RaphaelKalan">Raphael Kalandadze</a>.</span>
        <span><a href="https://github.com/RRaphaell/webmcp-dojo">Source</a></span>
      </footer>
    </div>`
  const stage = root.querySelector<HTMLElement>('#stage')!
  const feedEl = root.querySelector<HTMLElement>('#feed')!
  const inspectorEl = root.querySelector<HTMLElement>('#inspector')!
  renderOpenMat(root.querySelector<HTMLElement>('#openmat')!)

  // A shared report card link opens straight into the card.
  const shared = readReportFromUrl(beltNames)

  await rt.boot()
  rt.registry.on(() => renderInspector(inspectorEl, rt.registry))
  renderInspector(inspectorEl, rt.registry)

  let lastPhase = ''
  rt.store.subscribe((s) => {
    renderFeed(feedEl, s.feed, s.agentAttached, s.currentBelt, s.sensei)
    if (s.phase === 'lobby' && shared && lastPhase === '') {
      renderReport(stage, shared, rt, true)
    } else if (s.phase === 'lobby') {
      renderLobby(stage, rt, s.results)
    } else if (s.phase === 'belt') {
      renderBelt(stage, rt, s.currentBelt!, s.beltPanel, s.pendingHuman, s.status, s.results)
      const panelRoot = stage.querySelector<HTMLElement>('#belt-panel')
      if (panelRoot && s.beltPanelBind) s.beltPanelBind(panelRoot)
    } else {
      renderReport(stage, rt.card(), rt, false)
    }
    lastPhase = s.phase
  })
}

function renderLobby(stage: HTMLElement, rt: DojoRuntime, results: BeltResult[]): void {
  const done = new Map(results.map((r) => [r.id, r]))
  stage.innerHTML = `
    <div class="eyebrow">for people and their agents</div>
    <h1>Find out what your agent is <span class="em">actually</span> good at.</h1>
    <p class="lead">Open this page in an agent-enabled browser, hand your agent the belts, and watch. Each belt is a small real task it can only finish through this site's tools. You see every call. Some belts need you.</p>
    <div class="prompt-box">
      <div class="label"><span>Say this to your agent</span><button class="btn small ghost" id="copy-prompt">Copy</button></div>
      <div class="text" id="prompt-text">${esc(SUGGESTED_PROMPT)}</div>
    </div>
    <ol class="belts">
      ${rt.beltList.map((b) => {
        const r = done.get(b.id)
        return `<li class="belt-row ${r ? 'done ' + (r.pass ? 'pass' : 'fail') : ''}">
          <span class="swatch ${beltColor[b.id] ?? 'white'}"></span>
          <div><div class="title">${esc(b.name)}</div><div class="tests">${esc(b.tests)}</div><div class="role">you: ${esc(b.humanRole)}</div></div>
          <div class="verdict">${r ? (r.pass ? '<span class="pass-text">passed</span>' : '<span class="fail-text">failed</span>') : `${b.parCalls} call${b.parCalls === 1 ? '' : 's'} par`}</div>
        </li>`
      }).join('')}
    </ol>
    <div class="how">
      <h3>How to try it</h3>
      <ol>
        <li>ChatGPT desktop app: open this URL in its built-in browser (model Sol or Terra), then paste the prompt above into the chat.</li>
        <li>Chrome 149+: enable <code>chrome://flags/#enable-webmcp-testing</code>, reload, and drive the tools with an agent or the inspector on the right.</li>
        <li>No agent? Open the inspector on the right and run the tools by hand. The Dojo grades you the same way.</li>
      </ol>
    </div>`
  stage.querySelector('#copy-prompt')?.addEventListener('click', async (e) => {
    const ok = await copyText(SUGGESTED_PROMPT)
    ;(e.target as HTMLButtonElement).textContent = ok ? 'Copied' : 'Select and copy'
  })
}

function renderBelt(stage: HTMLElement, rt: DojoRuntime, beltId: string, panel: string, pending: ReturnType<DojoRuntime['publicState']>['pendingHuman'], status: string, results: BeltResult[]): void {
  const belt = rt.beltList.find((b) => b.id === beltId)!
  const idx = rt.beltList.findIndex((b) => b.id === beltId)
  stage.innerHTML = `
    <div class="belt-view">
      <div class="eyebrow">belt ${idx + 1} of ${rt.beltList.length} · ${esc(belt.pattern)}</div>
      <div class="head"><span class="swatch ${beltColor[belt.id] ?? 'white'}"></span><h2>${esc(belt.name)}</h2></div>
      <p class="tests">${esc(belt.tests)}</p>
      <p class="muted"><span class="mono">you:</span> ${esc(belt.humanRole)}</p>
      <div class="panel" id="belt-panel">${panel || '<p class="muted">Waiting for the agent\'s first call.</p>'}</div>
      ${pending ? renderPending(pending) : ''}
      <div class="status">${esc(status)}</div>
      <div class="share" style="margin-top:14px"><button class="btn ghost small" id="skip">Skip this belt</button><span class="muted mono">${results.length} done</span></div>
    </div>`
  stage.querySelector('#skip')?.addEventListener('click', () => rt.skipCurrent())
  stage.querySelector('#h-yes')?.addEventListener('click', (e) => { if (e.isTrusted || (window as unknown as { __dojoAllowSynthetic?: boolean }).__dojoAllowSynthetic) rt.humanConfirm(true) })
  stage.querySelector('#h-no')?.addEventListener('click', (e) => { if (!(e.isTrusted || (window as unknown as { __dojoAllowSynthetic?: boolean }).__dojoAllowSynthetic)) return; const reason = (stage.querySelector('#h-reason') as HTMLInputElement | null)?.value ?? ''; rt.humanConfirm(false, reason) })
  const form = stage.querySelector<HTMLFormElement>('#h-form')
  form?.addEventListener('submit', (e) => { e.preventDefault(); rt.humanAnswer((form.querySelector('input') as HTMLInputElement).value) })
}

function renderPending(p: NonNullable<ReturnType<DojoRuntime['publicState']>['pendingHuman']>): string {
  if (p.kind === 'confirm') return `<div class="human-box"><div class="label">Only you can do this</div><div>${esc(p.prompt)}</div>${p.detail ? `<div class="mono muted" style="margin-top:6px">${esc(p.detail)}</div>` : ''}<div class="actions"><button class="btn" id="h-yes">Approve</button><input type="text" id="h-reason" placeholder="reason, if you reject" autocomplete="off"><button class="btn ghost" id="h-no">Reject</button></div></div>`
  if (p.kind === 'answer') return `<div class="human-box"><div class="label">Your agent needs something from you</div><div>${esc(p.prompt)}</div><form class="actions" id="h-form"><input type="text" placeholder="type it here" autocomplete="off"><button class="btn" type="submit">Send</button></form></div>`
  return `<div class="human-box"><div class="label">Only you can see this</div><div>${esc(p.prompt)}</div></div>`
}

function renderReport(stage: HTMLElement, card: ReportCard, rt: DojoRuntime, shared: boolean): void {
  const rank = rankFor(card.results)
  const passed = card.results.filter((r) => r.pass).length
  const url = reportUrl(card)
  stage.innerHTML = `
    <div class="card">
      <div class="eyebrow">report card · ${esc(card.engine === 'native' ? 'real agent browser' : 'simulated tools')} · ${esc(new Date(card.at).toLocaleString())}</div>
      <div class="rank"><span class="swatch ${rank.rank}"></span>${esc(rank.label)}</div>
      <div class="summary">${passed} of ${card.results.length} belts passed${card.agent ? ` · ${esc(card.agent)}` : ''}.</div>
      <ol class="results">
        ${card.results.map((r) => `<li class="r">
          <div class="v ${r.pass ? 'pass-text' : 'fail-text'}">${r.pass ? 'passed' : 'failed'}<br><span class="muted">${r.calls} call${r.calls === 1 ? '' : 's'}</span></div>
          <div><div class="n">${esc(r.name)}</div><div class="note">${esc(r.note)}</div>
            ${r.checks.length ? `<div class="checks">${r.checks.map((c) => `<span class="check ${c.pass ? 'pass' : 'fail'}">${esc(c.label)}</span>`).join('')}</div>` : ''}</div>
        </li>`).join('')}
      </ol>
      <div class="share">
        <input type="text" readonly value="${esc(url)}" id="share-url">
        <button class="btn small" id="copy-url">Copy link</button>
        ${shared ? '<button class="btn ghost small" id="run-own">Run your own agent</button>' : '<button class="btn ghost small" id="again">Run again</button>'}
      </div>
    </div>`
  stage.querySelector('#copy-url')?.addEventListener('click', async (e) => { const ok = await copyText(url); (e.target as HTMLButtonElement).textContent = ok ? 'Copied' : 'Select and copy' })
  stage.querySelector('#again')?.addEventListener('click', () => rt.reset())
  stage.querySelector('#run-own')?.addEventListener('click', () => { history.replaceState(null, '', location.pathname); rt.reset() })
}
