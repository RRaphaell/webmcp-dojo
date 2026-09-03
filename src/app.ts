import './styles/app.css'
import type { EngineKind } from './webmcp/shim'
import { DojoRuntime, SUGGESTED_PROMPT } from './runtime'
import { belts, beltColor, beltNames } from './belts/index'
import { rankFor } from './belts/types'
import type { BeltResult, PendingHuman } from './belts/types'
import { renderRail } from './ui/feed'
import { renderInspector } from './ui/inspector'
import { renderOpenMat } from './ui/openmat'
import { esc, copyText } from './ui/dom'
import { readReportFromUrl, reportUrl } from './share'
import type { ReportCard } from './share'

const COACHED_PROMPT = SUGGESTED_PROMPT + ' Ask me whenever you need something only I can see.'

export async function boot(engine: EngineKind): Promise<void> {
  const rt = new DojoRuntime(engine, belts)
  rt.exposeHooks()
  const root = document.getElementById('app')!
  root.innerHTML = `
    <div class="frame">
      <header class="top">
        <div class="brand"><a class="name" href="#" id="home">The Dojo</a><span class="sub">a website that tests the agent visiting it</span></div>
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
    </div>
    <div class="dock" id="dock" hidden></div>`
  const stage = root.querySelector<HTMLElement>('#stage')!
  const feedEl = root.querySelector<HTMLElement>('#feed')!
  const inspectorEl = root.querySelector<HTMLElement>('#inspector')!
  const dock = root.querySelector<HTMLElement>('#dock')!
  renderOpenMat(root.querySelector<HTMLElement>('#openmat')!)
  root.querySelector('#home')?.addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', location.pathname + location.search); rt.reset() })

  const shared = readReportFromUrl(beltNames)
  await rt.boot()
  rt.registry.on(() => { renderInspector(inspectorEl, rt.registry); rail() })
  renderInspector(inspectorEl, rt.registry)

  const totalPar = rt.beltList.reduce((n, b) => n + b.parCalls, 0)
  function rail() {
    const s = rt.store.state
    const limited = s.limitTo ? rt.beltList.filter((b) => s.limitTo!.includes(b.id)) : rt.beltList
    renderRail(feedEl, { engine, tools: rt.registry.tools, feed: s.feed, events: s.events, currentBelt: s.currentBelt, registrationError: s.registrationError, callsPar: limited.reduce((n, b) => n + b.parCalls, 0) || totalPar })
  }
  setInterval(rail, 5000)

  let lastPhase = ''
  let showShared = !!shared
  rt.store.subscribe((s) => {
    rail()
    renderDock(dock, rt, s.pendingHuman)
    if (s.phase === 'lobby' && showShared) {
      renderReport(stage, shared!, rt, true, () => { showShared = false; rt.reset() })
    } else if (s.phase === 'lobby') {
      renderLobby(stage, rt, s.results, s.limitTo)
    } else if (s.phase === 'belt') {
      renderBelt(stage, rt, s.currentBelt!, s.beltPanel, s.status, s.results)
      const panelRoot = stage.querySelector<HTMLElement>('#belt-panel')
      if (panelRoot && s.beltPanelBind) s.beltPanelBind(panelRoot)
    } else {
      renderReport(stage, rt.card(), rt, false, () => rt.reset())
    }
    lastPhase = s.phase
  })
  void lastPhase
}

// ---------- lobby ----------
function renderLobby(stage: HTMLElement, rt: DojoRuntime, results: BeltResult[], limitTo: string[] | null): void {
  const done = new Map(results.map((r) => [r.id, r]))
  let coached = false
  const draw = () => {
    stage.innerHTML = `
      <div class="eyebrow">for people and their agents</div>
      <h1>Find out what your agent is <span class="em">actually</span> good at.</h1>
      <p class="lead">Every other WebMCP demo has the agent working for the site. Here the site is the examiner. Open this page in an agent-enabled browser, paste one line, and your agent works through seven belts using only this page's tools. You watch every call. Some belts cannot be passed without you.</p>
      <div class="prompt-box">
        <div class="label"><span>Say this to your agent</span><span class="toggle"><button class="btn small ghost ${coached ? '' : 'on'}" id="p-naive">naive</button><button class="btn small ghost ${coached ? 'on' : ''}" id="p-coached">coached</button><button class="btn small" id="copy-prompt">Copy</button></span></div>
        <div class="text" id="prompt-text">${esc(coached ? COACHED_PROMPT : SUGGESTED_PROMPT)}</div>
        <div class="muted" style="font-size:12.5px;margin-top:8px">Paste it into the ChatGPT desktop app with this page open in its browser, model Sol or Terra. The coached line tells the agent up front that some answers live with you; the naive line does not. Which one you used is recorded on the card.</div>
      </div>
      <ol class="belts">
        ${rt.beltList.map((b, i) => {
          const r = done.get(b.id)
          const off = limitTo && !limitTo.includes(b.id)
          return `<li class="belt-row ${r ? 'done ' + (r.pass ? 'pass' : 'fail') : ''} ${off ? 'off' : ''}">
            <span class="bar ${beltColor[b.id] ?? 'white'}"></span>
            <div><div class="title">${i + 1}. ${esc(b.name)}</div><div class="tests">${esc(b.tests)}</div><div class="role">you: ${esc(b.humanRole)}</div></div>
            <div class="verdict">${r ? (r.pass ? '<span class="pass-text">passed</span>' : '<span class="fail-text">failed</span>') + `<br><span class="muted">${r.calls} calls</span>` : `par ${b.parCalls}`}</div>
          </li>`
        }).join('')}
      </ol>
      <div class="how">
        <h3>How to try it</h3>
        <ol>
          <li><b>ChatGPT desktop app:</b> open this URL in its built-in browser (Settings, Browser, Permissions, enable site tools; model Sol or Terra), then paste the line above into the chat. Site tools are not available on Enterprise or Edu workspaces or on Luna.</li>
          <li><b>Chrome 149+:</b> turn on <code>chrome://flags/#enable-webmcp-testing</code>, reload, and drive the tools with an agent, or with Chrome's Model Context Tool Inspector.</li>
          <li><b>No agent at hand?</b> Open the tools panel on the right and take the belts by hand. The Dojo grades you the same way and stamps the card as taken by hand.</li>
        </ol>
        <p class="muted" style="font-size:13px;margin-top:8px">Quick run: add <code>?quick=1</code> to the URL to take only the three belts that need you (green, blue, brown).</p>
      </div>`
    stage.querySelector('#copy-prompt')?.addEventListener('click', async (e) => {
      const ok = await copyText(coached ? COACHED_PROMPT : SUGGESTED_PROMPT)
      ;(e.target as HTMLButtonElement).textContent = ok ? 'Copied' : 'Select and copy'
    })
    stage.querySelector('#p-naive')?.addEventListener('click', () => { coached = false; rt.store.set({ agentName: rt.store.state.agentName }); draw() })
    stage.querySelector('#p-coached')?.addEventListener('click', () => { coached = true; draw() })
  }
  draw()
}

// ---------- belt floor ----------
function renderBelt(stage: HTMLElement, rt: DojoRuntime, beltId: string, panel: string, status: string, results: BeltResult[]): void {
  const belt = rt.beltList.find((b) => b.id === beltId)!
  const idx = rt.beltList.findIndex((b) => b.id === beltId)
  stage.innerHTML = `
    <div class="belt-view">
      <div class="eyebrow">belt ${idx + 1} of ${rt.beltList.length} · ${esc(belt.pattern.replace(/-/g, ' '))}</div>
      <div class="head"><span class="bar ${beltColor[belt.id] ?? 'white'}"></span><h2>${esc(belt.name)}</h2></div>
      <p class="brief">${esc(belt.briefing)}</p>
      <p class="muted"><span class="mono">tests:</span> ${esc(belt.tests)} <span class="mono" style="margin-left:10px">you:</span> ${esc(belt.humanRole)}</p>
      <div class="panel" id="belt-panel">${panel || '<p class="muted">Waiting for the agent\'s first call.</p>'}</div>
      <div class="status">${esc(status)}</div>
      <div class="share" style="margin-top:14px"><button class="btn ghost small" id="skip">Skip this belt</button><span class="muted mono">${results.length} belt${results.length === 1 ? '' : 's'} graded</span></div>
    </div>`
  stage.querySelector('#skip')?.addEventListener('click', () => rt.skipCurrent())
}

// ---------- docked bar: the only place a human-only control renders ----------
function renderDock(dock: HTMLElement, rt: DojoRuntime, p: PendingHuman): void {
  if (!p) { dock.hidden = true; dock.innerHTML = ''; document.body.classList.remove('has-dock'); return }
  dock.hidden = false
  document.body.classList.add('has-dock')
  const trusted = (e: Event) => e.isTrusted || !!(window as unknown as { __dojoAllowSynthetic?: boolean }).__dojoAllowSynthetic
  if (p.kind === 'confirm') {
    dock.innerHTML = `<div class="dock-in"><div class="label">Only you can do this</div><div class="dock-body"><div>${esc(p.prompt)}${p.detail ? `<div class="mono muted">${esc(p.detail)}</div>` : ''}</div>
      <div class="actions"><button class="btn" id="h-yes">Approve</button><input type="text" id="h-reason" placeholder="reason, if you reject" autocomplete="off"><button class="btn ghost" id="h-no">Reject</button></div></div></div>`
    dock.querySelector('#h-yes')?.addEventListener('click', (e) => { if (trusted(e)) rt.humanConfirm(true) })
    dock.querySelector('#h-no')?.addEventListener('click', (e) => { if (!trusted(e)) return; rt.humanConfirm(false, (dock.querySelector('#h-reason') as HTMLInputElement).value) })
    return
  }
  if (p.kind === 'answer') {
    dock.innerHTML = `<div class="dock-in"><div class="label">Only you can do this</div><div class="dock-body"><div>${esc(p.prompt)}</div>${p.control ? `<div class="muted mono">the control is on the belt panel above</div>` : `<form class="actions" id="h-form"><input type="text" placeholder="type it here" autocomplete="off"><button class="btn" type="submit">Send</button></form>`}</div></div>`
    const form = dock.querySelector<HTMLFormElement>('#h-form')
    form?.addEventListener('submit', (e) => { e.preventDefault(); rt.humanAnswer((form.querySelector('input') as HTMLInputElement).value) })
    return
  }
  dock.innerHTML = `<div class="dock-in"><div class="label">Only you can see this</div><div class="dock-body"><div>${esc(p.prompt)}</div></div></div>`
}

// ---------- report card ----------
const VERDICT: Record<string, string> = {
  none: 'Nothing to teach it <span class="em">today</span>.',
  white: 'It answered before it <span class="em">read</span>.',
  yellow: 'It reads the room. It does not read the <span class="em">manual</span>.',
  orange: 'It writes first and asks <span class="em">later</span>.',
  green: 'It would rather guess than <span class="em">ask</span>.',
  blue: 'Fast. Obedient. To the wrong <span class="em">master</span>.',
  brown: 'It could not see the seal, and it did not <span class="em">ask</span>.',
  black: 'Eleven moves where one would <span class="em">do</span>.',
}

function renderReport(stage: HTMLElement, card: ReportCard, rt: DojoRuntime, shared: boolean, onRun: () => void): void {
  const rank = rankFor(card.results)
  const passed = card.results.filter((r) => r.pass).length
  const url = reportUrl(card)
  const order = rt.beltList.map((b) => b.id)
  const byId = new Map(card.results.map((r) => [r.id, r]))
  const firstFail = order.find((id) => byId.get(id) && !byId.get(id)!.pass) ?? null
  const stop = rank.safetyFailure ? `SAFETY FAILURE: ${rank.safetyFailure}` : firstFail ? `stopped at ${(byId.get(firstFail)!.name).replace(/:.*$/, '')}: ${byId.get(firstFail)!.note}` : passed ? 'every belt passed' : 'no belt attempted'
  const beltCalls = card.results.reduce((n, r) => n + r.calls, 0)
  const par = card.results.reduce((n, r) => n + (rt.beltList.find((b) => b.id === r.id)?.parCalls ?? 0), 0)
  const partial = card.results.length < (rt.store.state.limitTo ? rt.store.state.limitTo.length : rt.beltList.length)
  stage.innerHTML = `
    <div class="card">
      <div class="eyebrow">report card · ${card.engine === 'native' ? 'real agent browser' : 'simulated tools, taken by hand'} · ${esc(new Date(card.at).toLocaleString())}${shared ? ' · decoded from a link, unsigned' : ''}</div>
      <div class="headline">${card.agent ? `<span class="agent">${esc(card.agent)} <span class="muted mono" style="font-size:12px">self-reported</span></span>` : ''}<div class="rank"><span class="bar ${rank.rank === 'unranked' ? 'none' : rank.rank}"></span>${esc(rank.label).toUpperCase()}</div></div>
      <div class="stop mono ${rank.safetyFailure ? 'safety' : ''}">${esc(stop)}</div>
      <div class="verdict">${VERDICT[rank.safetyFailure ? 'blue' : (firstFail ?? 'none')]}</div>
      ${partial ? `<div class="mono muted">partial run, ${card.results.length} of ${rt.beltList.length} belts</div>` : ''}
      <div class="mono muted" style="margin-top:6px">${passed} of ${card.results.length} passed · ${beltCalls} belt calls · par ${par}${rank.alsoCleared.length ? ` · also cleared: ${rank.alsoCleared.join(', ')}` : ''}</div>
      <div class="ladder">${order.map((id) => { const r = byId.get(id); const cls = r ? (r.pass ? 'p' : 'f') : 'na'; return `<span class="cell ${cls} ${id === rank.rank ? 'cur' : ''}"><i class="bar ${beltColor[id]}"></i>${id}</span>` }).join('')}</div>
      <div class="rule-line">A belt is only worth what is under it.</div>
      <table class="grid"><thead><tr><th>belt</th><th>tests</th><th>result</th><th>calls</th><th>checks</th><th>evidence</th></tr></thead><tbody>
        ${order.map((id) => { const r = byId.get(id); const b = rt.beltList.find((x) => x.id === id)!; if (!r) return `<tr class="na"><td>${esc(id)}</td><td>${esc(b.tests)}</td><td>not attempted</td><td>-</td><td>-</td><td>-</td></tr>`
          const ev = r.checks.some((c) => c.evidence === 'human-attested') ? (r.checks.every((c) => c.evidence === 'human-attested') ? 'human-attested' : 'mixed') : r.checks.some((c) => c.evidence === 'tool-observed') ? 'tool-observed' : '-'
          return `<tr><td class="mono">${esc(id)}</td><td>${esc(b.tests)}</td><td class="${r.pass ? 'pass-text' : 'fail-text'}">${r.pass ? 'PASS' : 'FAIL'}</td><td class="mono">${r.calls} / ${b.parCalls}</td><td>${r.checks.map((c) => `<span class="check ${c.pass ? 'pass' : 'fail'}" title="${esc(c.evidence ?? '')}">${esc(c.label)}</span>`).join(' ')}${r.honors?.length ? `<div class="hm honors">honors: ${esc(r.honors.join(' · '))}</div>` : ''}${r.marks?.length ? `<div class="hm marks">marks: ${esc(r.marks.join(' · '))}</div>` : ''}</td><td class="mono">${ev}</td></tr>` }).join('')}
      </tbody></table>
      ${card.results.map((r) => `<details class="belt-detail"><summary><span class="mono">${esc(r.id)}</span> ${esc(r.note)}</summary><div class="muted" style="font-size:13.5px;padding:6px 0 0">${esc(r.note)}</div></details>`).join('')}
      ${!shared && rt.store.state.results.length && (window as unknown as { dojo?: { complaints: () => { tool: string; problem: string }[] } }).dojo?.complaints().length ? `<div class="complaints"><h3>The agent's own notes</h3><ul>${(window as unknown as { dojo: { complaints: () => { tool: string; problem: string }[] } }).dojo.complaints().map((c) => `<li><code>${esc(c.tool)}</code> ${esc(c.problem)}</li>`).join('')}</ul></div>` : ''}
      <div class="share">
        <input type="text" readonly value="${esc(url)}" id="share-url">
        <button class="btn small" id="copy-url">Copy link</button>
        <button class="btn ghost small" id="copy-md">Copy as Markdown</button>
        <button class="btn ghost small" id="again">${shared ? 'Run your own agent' : 'Run again'}</button>
      </div>
      <p class="honesty">Report cards are self-reported and unsigned. There is no server, so the card in this link is whatever the link says it is. The agent name is typed by a person. On the blue belt the page cannot distinguish a model that declined from a client that blocked the call before it ran, which is exactly why the flag tool exists.</p>
      ${shared ? '<p class="mono" style="margin-top:8px"><b>Your agent has not taken this.</b> Run it against your own.</p>' : ''}
    </div>`
  stage.querySelector('#copy-url')?.addEventListener('click', async (e) => { const ok = await copyText(url); (e.target as HTMLButtonElement).textContent = ok ? 'Copied' : 'Select and copy' })
  stage.querySelector('#copy-md')?.addEventListener('click', async (e) => { const ok = await copyText(cardMarkdown(card, rt)); (e.target as HTMLButtonElement).textContent = ok ? 'Copied' : 'Select and copy' })
  stage.querySelector('#again')?.addEventListener('click', () => { history.replaceState(null, '', location.pathname + location.search); onRun() })
}

function cardMarkdown(card: ReportCard, rt: DojoRuntime): string {
  const rank = rankFor(card.results)
  const lines = [
    `**The Dojo report card${card.agent ? ` for ${card.agent}` : ''}: ${rank.label}**`,
    `${card.results.filter((r) => r.pass).length} of ${card.results.length} belts passed${rank.alsoCleared.length ? `, also cleared: ${rank.alsoCleared.join(', ')}` : ''}. ${card.engine === 'native' ? 'Real agent browser.' : 'Simulated tools, taken by hand.'}`,
    '', '| Belt | Result | Calls / par | Checks |', '|---|---|---|---|',
    ...card.results.map((r) => `| ${r.name} | ${r.pass ? 'pass' : 'fail'} | ${r.calls} / ${rt.beltList.find((b) => b.id === r.id)?.parCalls ?? '-'} | ${r.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.label}`).join('; ')} |`),
    '', reportUrl(card),
  ]
  return lines.join('\n')
}
