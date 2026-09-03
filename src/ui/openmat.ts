// Open Mat: paste your own WebMCP tool definitions and get the checks the
// Dojo applies to its own tools. Lint only. Nothing is registered, nothing is
// executed. For site owners shipping tools who want the Chrome budgets and the
// description rules checked before an agent ever sees them.

import { esc } from './dom'

const LIMITS = { name: 30, description: 500, paramDescription: 150 }
const NAME_RE = /^[A-Za-z0-9_.-]+$/

interface Finding { level: 'fail' | 'warn' | 'ok'; text: string }

export function lintTools(input: unknown): { name: string; findings: Finding[] }[] {
  const list: unknown[] = Array.isArray(input) ? input : (input && typeof input === 'object' && Array.isArray((input as { tools?: unknown[] }).tools)) ? (input as { tools: unknown[] }).tools : [input]
  return list.map((raw) => {
    const t = (raw ?? {}) as Record<string, unknown>
    const name = String(t.name ?? '(no name)')
    const f: Finding[] = []
    const desc = typeof t.description === 'string' ? t.description : ''
    if (!t.name) f.push({ level: 'fail', text: 'no name' })
    else if (!NAME_RE.test(name)) f.push({ level: 'fail', text: 'name has characters outside A-Z a-z 0-9 _ . -' })
    else if (name.length > LIMITS.name) f.push({ level: 'fail', text: `name is ${name.length} chars; Chrome asks for at most ${LIMITS.name}` })
    else f.push({ level: 'ok', text: `name ${name.length}/${LIMITS.name}` })
    if (!desc) f.push({ level: 'fail', text: 'no description; agents pick tools by description' })
    else {
      if (desc.length > LIMITS.description) f.push({ level: 'fail', text: `description is ${desc.length} chars; over ${LIMITS.description} it is silently truncated` })
      else f.push({ level: 'ok', text: `description ${desc.length}/${LIMITS.description}` })
      if (!/\b(use|when|after|before|to )\b/i.test(desc)) f.push({ level: 'warn', text: 'description says what it does but not when to use it' })
      if (/\b(don't|do not|never)\b/i.test(desc)) f.push({ level: 'warn', text: 'negative phrasing; Chrome recommends positive language' })
      if (/^[a-z]/.test(desc) === false && /^[A-Z]/.test(desc) === false) f.push({ level: 'warn', text: 'description does not start with a word' })
    }
    const schema = (t.inputSchema ?? t.input_schema) as { properties?: Record<string, { description?: string; type?: string; enum?: unknown[] }>; required?: string[] } | undefined
    const props = Object.entries(schema?.properties ?? {})
    for (const [k, v] of props) {
      if (k.length > LIMITS.name || !NAME_RE.test(k)) f.push({ level: 'fail', text: `parameter "${k}": name over ${LIMITS.name} chars or bad characters` })
      if (!v?.description) f.push({ level: 'fail', text: `parameter "${k}" has no description` })
      else if (v.description.length > LIMITS.paramDescription) f.push({ level: 'fail', text: `parameter "${k}" description is ${v.description.length} chars; max ${LIMITS.paramDescription}` })
      if (!v?.type) f.push({ level: 'warn', text: `parameter "${k}" has no type; declare string, number, boolean or enum` })
    }
    if (props.length && !schema?.required) f.push({ level: 'warn', text: 'no required list; agents will omit parameters you needed' })
    const ann = (t.annotations ?? {}) as Record<string, unknown>
    if (ann.readOnlyHint === undefined) f.push({ level: 'warn', text: 'no readOnlyHint; agents assume tools mutate state unless told otherwise' })
    for (const k of Object.keys(ann)) if (!['readOnlyHint', 'untrustedContentHint'].includes(k)) f.push({ level: 'warn', text: `annotation "${k}" is not in the spec; Chrome drops it silently` })
    if (/\b(reviews?|comments?|messages?|posts?|notes?|search)\b/i.test(name + ' ' + desc) && !ann.untrustedContentHint) f.push({ level: 'warn', text: 'returns content others wrote? set untrustedContentHint so agents treat it as data, not instructions' })
    return { name, findings: f }
  })
}

const SAMPLE = `[
  {
    "name": "getAvailability",
    "description": "Get bookable consultation times within a date range.",
    "inputSchema": { "type": "object", "properties": { "from": { "type": "string" }, "to": { "type": "string", "description": "End date, YYYY-MM-DD" } }, "required": ["from", "to"] },
    "annotations": { "readOnlyHint": true }
  },
  {
    "name": "bookSlot",
    "description": "Reserve a 30 minute consultation slot. Don't use for cancellations.",
    "inputSchema": { "type": "object", "properties": { "date": { "type": "string", "description": "YYYY-MM-DD" }, "time": { "type": "string", "description": "HH:MM" }, "name": { "type": "string", "description": "Name" }, "email": { "type": "string", "description": "Email" } } }
  }
]`

export function renderOpenMat(container: HTMLElement): void {
  container.innerHTML = `
    <p class="muted">Paste your own tool definitions (one, an array, or <code>{ "tools": [...] }</code>). Nothing is registered or executed. You get the same checks the Dojo applies to itself: Chrome's budgets, description rules, annotations.</p>
    <textarea id="om-input" rows="10" spellcheck="false" style="width:100%;font-family:var(--mono);font-size:12.5px;padding:10px;border:1px solid var(--line-strong);border-radius:6px;background:var(--surface);color:var(--ink)"></textarea>
    <div class="actions" style="display:flex;gap:8px;margin:8px 0 12px"><button class="btn small" id="om-run">Check</button><button class="btn ghost small" id="om-sample">Load a sample</button></div>
    <div id="om-out"></div>`
  const input = container.querySelector<HTMLTextAreaElement>('#om-input')!
  const out = container.querySelector<HTMLElement>('#om-out')!
  const run = () => {
    let parsed: unknown
    try { parsed = JSON.parse(input.value) } catch (e) { out.innerHTML = `<p class="fail-text">Not valid JSON: ${esc((e as Error).message)}</p>`; return }
    const results = lintTools(parsed)
    out.innerHTML = results.map((r) => `<div class="tool-card"><div><code>${esc(r.name)}</code></div><ul style="margin:6px 0 0;padding-left:18px">${r.findings.map((f) => `<li class="${f.level === 'fail' ? 'fail-text' : f.level === 'warn' ? '' : 'muted'}">${esc(f.text)}</li>`).join('')}</ul></div>`).join('') +
      `<p class="muted mono" style="margin-top:8px">${results.length} tool${results.length === 1 ? '' : 's'} · ${results.reduce((n, r) => n + r.findings.filter((f) => f.level === 'fail').length, 0)} fail · ${results.reduce((n, r) => n + r.findings.filter((f) => f.level === 'warn').length, 0)} warn</p>`
  }
  container.querySelector('#om-run')!.addEventListener('click', run)
  container.querySelector('#om-sample')!.addEventListener('click', () => { input.value = SAMPLE; run() })
}
