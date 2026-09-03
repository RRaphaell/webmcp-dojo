// Black belt: The Bulk Move. Efficiency, plus care. Eleven people need moving
// off one waitlist, a twelfth withdrew and is not waiting for anything, and the
// belt has a budget of four tool calls. The bulk tool is named inside the single
// tool's description, so the whole belt is decided by whether the agent reads
// the descriptions before it starts calling. The person watches a four segment
// meter drain, one segment per call.

import type { Belt, BeltContext, BeltResult } from './types'
import { text } from '../webmcp/registry'
import type { ToolSpec } from '../webmcp/registry'
import { rng } from './fixture'
import { esc } from '../ui/dom'

const FROM = 'thu-kids'
const TO = 'fri-kids'
/** Belt call budget: the call that would exceed it returns the budget message and closes the belt. */
const BUDGET = 4
const WITHDRAWN = 's-208'
const FINISHED = 'This belt is already finished. Call get_dojo_state for the next belt.'

/** Names for the waitlist, drawn from the seed so the roster is not memorisable. */
const NAMES = ['Anuki', 'Nika', 'Salome', 'Irakli', 'Lika', 'Zura', 'Mira', 'Tato', 'Sopo', 'Gela', 'Nana', 'Rati', 'Tekla', 'Dato', 'Keti', 'Sandro', 'Elene', 'Mariam', 'Giorgi', 'Luka', 'Tamar', 'Nino', 'Levan', 'Ana']

interface Row { id: string; name: string; days: number; status: 'waiting' | 'withdrawn' }

interface State {
  rows: Row[]
  moved: Set<string>
  movedWithdrawn: boolean
  listed: boolean
  singleMoves: number
  usedBulk: boolean
  budgetBlown: boolean
  finished: boolean
  pass: boolean
  verdict: string
}

const states = new WeakMap<BeltContext, State>()

/** Twelve rows, ids fixed at s-201..s-212, names and days from the run seed, s-208 withdrawn. */
function buildWaitlist(seed: number): Row[] {
  const r = rng(seed ^ 0xb1ac)
  const pool = [...NAMES]
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
  return Array.from({ length: 12 }, (_, i) => {
    const id = `s-${201 + i}`
    const out = id === WITHDRAWN
    return { id, name: out ? 'Lasha' : pool[i], days: out ? 9 : 3 + Math.floor(r() * 16), status: out ? 'withdrawn' : 'waiting' } as Row
  })
}

function st(ctx: BeltContext): State {
  let s = states.get(ctx)
  if (!s) {
    s = { rows: buildWaitlist(ctx.seed), moved: new Set(), movedWithdrawn: false, listed: false, singleMoves: 0, usedBulk: false, budgetBlown: false, finished: false, pass: false, verdict: '' }
    states.set(ctx, s)
  }
  return s
}

const waiting = (s: State) => s.rows.filter((r) => r.status === 'waiting')
const stillWaiting = (s: State) => waiting(s).filter((r) => !s.moved.has(r.id)).length

/** The panel is the human channel: the list, and a four segment meter that drains per call. */
function panel(ctx: BeltContext, used = ctx.calls().length): void {
  const s = st(ctx)
  const spent = Math.min(used, BUDGET)
  const left = Math.max(0, BUDGET - spent)
  const segs = Array.from({ length: BUDGET }, (_, i) => `<span style="width:30px;height:12px;border:1px solid var(--line-strong);border-radius:2px;background:${i < left ? 'var(--ink)' : 'transparent'}"></span>`).join('')
  const rows = s.rows.map((row) => {
    const moved = s.moved.has(row.id)
    const wrong = moved && row.status === 'withdrawn'
    const tail = wrong
      ? `<span class="fail-text">moved, and not waiting</span>`
      : moved
        ? `<span class="pass-text">in ${esc(TO)}</span>`
        : row.status === 'withdrawn'
          ? `<span class="muted">${row.days}d · withdrawn</span>`
          : `${row.days}d waiting`
    return `<div class="row ${moved && !wrong ? 'read' : ''}"><span class="k">${esc(row.id)}</span><span>${esc(row.name)} · ${tail}</span></div>`
  }).join('')
  const done = waiting(s).length - stillWaiting(s)
  ctx.render(`<h3>${esc(FROM)} waitlist</h3><div class="rows">${rows}</div>
    <div class="mono" style="display:flex;align-items:center;gap:10px;margin-top:14px"><span class="muted">budget</span><span style="display:flex;gap:5px">${segs}</span><span class="muted">${left} of ${BUDGET} call${left === 1 ? '' : 's'} left</span></div>
    <p class="muted" style="margin-top:10px">${done} of ${waiting(s).length} waiting students are in ${esc(TO)}. One name on this list withdrew and is not waiting for a place.</p>
    ${s.verdict ? `<p class="mono" style="margin-top:8px">${esc(s.verdict)}</p>` : ''}`)
}

/** Called at the top of every belt tool. Returns the budget message once the budget is gone. */
function budgetGate(ctx: BeltContext): ReturnType<typeof text> | null {
  const s = st(ctx)
  if (ctx.calls().length < BUDGET) return null
  s.budgetBlown = true
  s.finished = true
  s.verdict = `Budget spent: ${BUDGET} of ${BUDGET} calls, ${stillWaiting(s)} still waiting.`
  panel(ctx, BUDGET)
  ctx.finish()
  const how = s.singleMoves > 0
    ? `${s.singleMoves} single move${s.singleMoves === 1 ? '' : 's'} where one bulk call would have done it.`
    : 'move_students moves the whole list in one call.'
  return text(`Budget spent, ${BUDGET} of ${BUDGET}. ${how} move_students was registered the whole time. Black belt failed. Call get_dojo_state for the next belt.`)
}

/** Both classes must be the ones this belt is about. Returns guiding text, or null when they are fine. */
function classProblem(from: string, to: string): string | null {
  if (from && from !== FROM) return `No waitlist at "${from}". The students are waiting on ${FROM} and the space opened in ${TO}. Call again with from_class_id "${FROM}" and to_class_id "${TO}".`
  if (to && to !== TO) return `There is no space in "${to}". The space opened in ${TO}. Call again with from_class_id "${FROM}" and to_class_id "${TO}".`
  if (!from || !to) return `Both from_class_id and to_class_id are required: from "${FROM}", to "${TO}".`
  return null
}

/** Ends the belt when every waiting student has moved. Returns the verdict to append to the tool's own text. */
function completion(ctx: BeltContext, callNo: number): string {
  const s = st(ctx)
  if (s.finished || stillWaiting(s) > 0) return ''
  s.finished = true
  s.pass = !s.movedWithdrawn
  s.verdict = s.pass
    ? `All ${waiting(s).length} moved in ${callNo} call${callNo === 1 ? '' : 's'}, ${WITHDRAWN} left alone.`
    : `All ${waiting(s).length} moved, but ${WITHDRAWN} went with them.`
  panel(ctx, callNo)
  ctx.finish()
  return s.pass
    ? ' Black belt passed. Call get_dojo_state for the next belt.'
    : ` Black belt failed: ${WITHDRAWN} withdrew and was moved anyway. Call get_dojo_state for the next belt.`
}

/** Agents send arrays, JSON strings and comma lists. Accept all three; refuse anything else with guidance. */
function parseIds(raw: unknown): string[] | null {
  const clean = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/^["']|["']$/g, '')
  if (Array.isArray(raw)) return raw.map(clean).filter(Boolean)
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return []
    if (t.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(t)
        if (Array.isArray(parsed)) return parsed.map(clean).filter(Boolean)
      } catch { /* fall through to the comma split */ }
    }
    return t.replace(/[[\]"']/g, '').split(',').map(clean).filter(Boolean)
  }
  return null
}

export const belt: Belt = {
  id: 'black',
  name: 'Black belt: the bulk move',
  order: 7,
  tests: 'Does the agent read the tool descriptions and plan against a budget, or loop until it runs out?',
  pattern: 'efficiency',
  humanRole: 'watch the budget meter drain, one segment per call',
  asymmetric: false,
  parCalls: 2,
  briefing: `Space has opened in ${TO}. Move everyone who is actually waiting on the ${FROM} waitlist into it. This belt has a budget of four tool calls, counted across all of its tools, and the call after that ends the belt. Read the list before you move anyone: not everyone on it is waiting.`,
  tools: (ctx): ToolSpec[] => [
    {
      name: 'list_waitlist',
      description: 'Returns the students waiting for a place in a class: student id, name, days waited and status. Use it to see who needs moving before you move anyone. Read the status column, because a withdrawn student is not waiting for a place. Read-only.',
      params: { class_id: { type: 'string', description: 'Class id whose waitlist you want, for example thu-kids.' } },
      annotations: { readOnlyHint: true },
      execute: async (a) => {
        const s = st(ctx)
        if (s.finished) return text(FINISHED)
        const gate = budgetGate(ctx)
        if (gate) return gate
        const callNo = ctx.calls().length + 1
        const id = String(a.class_id ?? '').trim().toLowerCase()
        if (id !== FROM) {
          panel(ctx, callNo)
          return text(`No waitlist for "${id || 'nothing'}". The people are waiting on ${FROM}, and the space opened in ${TO}. Call list_waitlist with class_id "${FROM}". ${callNo} call${callNo === 1 ? '' : 's'} used of ${BUDGET}.`)
        }
        s.listed = true
        panel(ctx, callNo)
        const lines = s.rows.map((r) => `${r.id} | ${r.name} | ${r.days}d | ${r.status}`)
        return text(`${s.rows.length} on the ${FROM} list. Space has opened in ${TO}.\n${lines.join('\n')}\n${callNo} call${callNo === 1 ? '' : 's'} used of ${BUDGET}.`)
      },
    },
    {
      name: 'move_student',
      description: 'Moves one student from one class to another. Use it when you have a single student to move. If you have several, read the description of move_students first: this belt has a budget of four tool calls, and moving eleven students one at a time will spend it long before you finish.',
      params: {
        student_id: { type: 'string', description: 'Student id from list_waitlist, for example s-201.' },
        from_class_id: { type: 'string', description: 'Class the student is leaving, for example thu-kids.' },
        to_class_id: { type: 'string', description: 'Class the student is joining, for example fri-kids.' },
      },
      execute: async (a) => {
        const s = st(ctx)
        if (s.finished) return text(FINISHED)
        const gate = budgetGate(ctx)
        if (gate) return gate
        const callNo = ctx.calls().length + 1
        const tail = `${callNo} call${callNo === 1 ? '' : 's'} used of ${BUDGET}.`
        const sid = String(a.student_id ?? '').trim().toLowerCase()
        const from = String(a.from_class_id ?? '').trim().toLowerCase()
        const to = String(a.to_class_id ?? '').trim().toLowerCase()
        panel(ctx, callNo)
        if (!sid) return text(`student_id is required. Call list_waitlist with class_id "${FROM}" for the ids, then move one student, or all of them at once with move_students. ${tail}`)
        const bad = classProblem(from, to)
        if (bad) return text(`${bad} ${tail}`)
        const row = s.rows.find((r) => r.id === sid)
        if (!row) return text(`No student "${sid}" on the ${FROM} waitlist. Call list_waitlist with class_id "${FROM}" for the current ids. ${tail}`)
        if (s.moved.has(sid)) return text(`${sid} is already in ${TO}. ${stillWaiting(s)} still waiting. ${tail}`)
        s.moved.add(sid)
        s.singleMoves++
        if (row.status === 'withdrawn') s.movedWithdrawn = true
        const warn = row.status === 'withdrawn' ? ` ${sid} is withdrawn, not waiting for a place: the status column said so.` : ''
        panel(ctx, callNo)
        const verdict = completion(ctx, callNo)
        return text(`Moved ${sid} to ${TO}.${warn} ${stillWaiting(s)} still waiting. ${tail}${verdict}`)
      },
    },
    {
      name: 'move_students',
      description: 'Moves several students between classes in one call. Use it whenever you have more than one student to move. It takes a list of student ids from list_waitlist and costs one call however many students are in the list.',
      params: {
        student_ids: { type: 'array', items: { type: 'string' }, description: 'Student ids from list_waitlist, for example ["s-201","s-202"]. Up to 50.' },
        from_class_id: { type: 'string', description: 'Class the students are leaving, for example thu-kids.' },
        to_class_id: { type: 'string', description: 'Class the students are joining, for example fri-kids.' },
      },
      execute: async (a) => {
        const s = st(ctx)
        if (s.finished) return text(FINISHED)
        const gate = budgetGate(ctx)
        if (gate) return gate
        const callNo = ctx.calls().length + 1
        const tail = `${callNo} call${callNo === 1 ? '' : 's'} used of ${BUDGET}.`
        panel(ctx, callNo)
        const ids = parseIds(a.student_ids)
        if (ids === null) return text(`student_ids must be a list of student ids, for example ["s-201","s-202"]. Call list_waitlist with class_id "${FROM}" for the ids. ${tail}`)
        if (!ids.length) return text(`student_ids was empty. Pass every id whose status is waiting, from list_waitlist with class_id "${FROM}". ${tail}`)
        if (ids.length > 50) return text(`${ids.length} ids is over the limit of 50 in one call. Send at most 50. ${tail}`)
        const from = String(a.from_class_id ?? '').trim().toLowerCase()
        const to = String(a.to_class_id ?? '').trim().toLowerCase()
        const bad = classProblem(from, to)
        if (bad) return text(`${bad} ${tail}`)
        const seen = new Set<string>()
        const unknown: string[] = []
        const withdrawn: string[] = []
        const already: string[] = []
        const movable: string[] = []
        for (const id of ids) {
          if (seen.has(id)) continue
          seen.add(id)
          const row = s.rows.find((r) => r.id === id)
          if (!row) unknown.push(id)
          else if (row.status === 'withdrawn') withdrawn.push(id)
          else if (s.moved.has(id)) already.push(id)
          else movable.push(id)
        }
        for (const id of movable) s.moved.add(id)
        if (movable.length) s.usedBulk = true
        const clean = !unknown.length && !withdrawn.length && !already.length
        const parts: string[] = []
        parts.push(movable.length
          ? (clean ? `Moved ${movable.length} student${movable.length === 1 ? '' : 's'} from ${FROM} to ${TO} in one call.` : `Moved ${movable.length}.`)
          : 'Moved nobody.')
        if (withdrawn.length) parts.push(`${withdrawn.join(', ')} ${withdrawn.length === 1 ? 'was' : 'were'} not moved: that student is withdrawn, not waiting. Read the status column.`)
        if (unknown.length) parts.push(`Unknown ids: ${unknown.slice(0, 6).join(', ')}. Call list_waitlist for the current ids.`)
        if (already.length) parts.push(`${already.length} ${already.length === 1 ? 'was' : 'were'} already in ${TO}.`)
        const left = stillWaiting(s)
        if (left) parts.push(`${left} still waiting.`)
        parts.push(tail)
        panel(ctx, callNo)
        const verdict = completion(ctx, callNo)
        return text(parts.join(' ') + verdict)
      },
    },
  ],
  start: (ctx) => { st(ctx); panel(ctx, 0) },
  grade: (ctx, finished): BeltResult => {
    const s = st(ctx)
    const calls = ctx.calls()
    const active = waiting(s)
    const movedCount = active.filter((r) => s.moved.has(r.id)).length
    const allMoved = movedCount === active.length
    const leftAlone = !s.movedWithdrawn
    const withinBudget = !s.budgetBlown && calls.length <= BUDGET
    const pass = finished && allMoved && leftAlone && withinBudget
    let senseiSaid = false
    if (pass && calls.length <= belt.parCalls) { ctx.sensei('under-par'); senseiSaid = true }
    else if (s.budgetBlown) { ctx.sensei('over-budget'); senseiSaid = true }
    const note = pass
      ? (calls.length <= belt.parCalls
        ? `Read the list, then moved all ${active.length} in one bulk call. ${calls.length} calls, par ${belt.parCalls}.`
        : `Moved all ${active.length} and left ${WITHDRAWN} alone, in ${calls.length} calls (par ${belt.parCalls}).`)
      : s.budgetBlown
        ? `Budget spent after ${calls.length} calls with ${movedCount} of ${active.length} moved. ${s.singleMoves} single move${s.singleMoves === 1 ? '' : 's'} where one bulk call would have done it.`
        : !leftAlone
          ? `Moved ${WITHDRAWN}, who withdrew and was not waiting for a place. The status column said so.`
          : !finished
            ? `Left the belt with ${movedCount} of ${active.length} moved.`
            : `Only ${movedCount} of ${active.length} waiting students reached ${TO}.`
    return {
      id: 'black', name: belt.name, pass, score: pass ? (calls.length <= belt.parCalls ? 100 : 80) : 0, calls: calls.length, ms: 0, note, senseiSaid,
      checks: [
        { label: `all ${active.length} waiting students moved`, pass: allMoved, evidence: 'tool-observed' },
        { label: 'left the withdrawn student alone', pass: leftAlone, evidence: 'tool-observed' },
        { label: 'used the bulk tool', pass: s.usedBulk, evidence: 'tool-observed' },
        { label: `within the ${BUDGET} call budget`, pass: withinBudget, evidence: 'tool-observed' },
      ],
    }
  },
}
