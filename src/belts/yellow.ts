// Yellow belt: The Wrong Room. Navigation plus error recovery. The belt opens
// in Records, and today's mat log only opens in the Mat room, so the obvious
// first call returns a guiding error that names the room and the fix. What is
// measured is whether the agent reads that sentence and does what it says.
// Both room tools stay registered the whole time on purpose: a wrong-room call
// has to come back as guidance, not as a missing tool.

import type { Belt, BeltContext, BeltResult } from './types'
import { text } from '../webmcp/registry'
import type { ToolSpec } from '../webmcp/registry'
import { buildWorld, rng } from './fixture'
import { esc } from '../ui/dom'

type Room = 'mat' | 'records'
const ROOMS: Room[] = ['mat', 'records']
const ROOM_NAME: Record<Room, string> = { mat: 'Mat', records: 'Records' }
const WORKS_IN: Record<Room, string> = { mat: 'read_mat_log', records: 'file_incident' }
const PAR = 4
const BUDGET = 8
const NEXT = 'Call get_dojo_state for the next belt.'
const NOTE_MAX = 120

interface MatLog {
  mat: string
  session: string
  time: string
  label: string
  note: string
  mats: string[]
  incidentId: string
}

/** What the next call has to be for a guiding error to count as recovered. */
type Fix = (tool: string, args: Record<string, unknown>) => boolean

interface State {
  log: MatLog
  room: Room
  gotoCalls: number
  logReads: number
  filed: { id: string; mat: string; session: string; note: string } | null
  /** Ids submitted to file_incident that no tool ever printed. */
  fabricated: string[]
  wroteBeforeRead: boolean
  sawError: boolean
  recovered: boolean
  ignoredError: boolean
  lastErrorCode: string | null
  pendingFix: { code: string; accepts: Fix } | null
  finished: boolean
  outOfBudget: boolean
  lastVerdict: string
  lastRoomRendered: Room | null
}

const states = new WeakMap<BeltContext, State>()

function buildLog(seed: number): MatLog {
  const r = rng((seed ^ 0x7e110) >>> 0)
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]
  const mats = ['mat-a', 'mat-b']
  const world = buildWorld(seed)
  const injuries = [
    'turned an ankle in round three, walked off unaided',
    'took a knee to the ribs and sat out the last round',
    'split a lip during drilling, cleaned up at the desk',
    'jammed a thumb on a block, iced it and stayed to watch',
  ]
  const student = pick(world.students)
  return {
    mats,
    mat: pick(mats),
    session: `sess-${2100 + Math.floor(r() * 800)}`,
    time: pick(['18:00', '19:00', '20:00']),
    label: pick(['sparring', 'forms', 'open mat']),
    note: `${student.name} ${pick(injuries)}`,
    incidentId: `inc-${String(20 + Math.floor(r() * 79)).padStart(4, '0')}`,
  }
}

function st(ctx: BeltContext): State {
  let s = states.get(ctx)
  if (!s) {
    s = {
      log: buildLog(ctx.seed),
      room: 'records',
      gotoCalls: 0,
      logReads: 0,
      filed: null,
      fabricated: [],
      wroteBeforeRead: false,
      sawError: false,
      recovered: true,
      ignoredError: false,
      lastErrorCode: null,
      pendingFix: null,
      finished: false,
      outOfBudget: false,
      lastVerdict: '',
      lastRoomRendered: null,
    }
    states.set(ctx, s)
  }
  return s
}

function panel(ctx: BeltContext): void {
  const s = st(ctx)
  const moved = s.lastRoomRendered !== null && s.lastRoomRendered !== s.room
  s.lastRoomRendered = s.room
  const rows = ROOMS.map(
    (r) =>
      `<div class="row ${r === s.room ? 'read' : ''}"><span class="k">${r}</span><span>${WORKS_IN[r]} works here${r === s.room ? ' · <span class="pass-text">you are here</span>' : ''}</span></div>`,
  ).join('')
  const log = s.logReads
    ? `<p class="mono" style="margin-top:10px">${esc(`${s.log.mat} | ${s.log.session} | ${s.log.time} ${s.log.label}`)}<br><span class="muted">note: ${esc(s.log.note)}</span></p>`
    : `<p class="muted" style="margin-top:10px">Today's mat log has not been read. It only opens in the Mat room.</p>`
  const filed = s.filed
    ? `<p class="mono" style="margin-top:6px"><span class="pass-text">${esc(s.filed.id)}</span> filed against ${esc(s.filed.mat)} ${esc(s.filed.session)}.</p>`
    : ''
  const html =
    `<div class="yellow-room">` +
    `<h3>${ROOM_NAME[s.room]} room</h3>` +
    `<div class="rows" style="margin-top:8px">${rows}</div>` +
    log +
    filed +
    `<p class="muted" style="margin-top:10px">The agent moves the page with go_to_room. ${s.gotoCalls} call${s.gotoCalls === 1 ? '' : 's'} so far.</p>` +
    (s.lastVerdict ? `<p class="mono" style="margin-top:8px">${esc(s.lastVerdict)}</p>` : '') +
    `</div>`
  // The room slides when the agent navigated. Web Animations, so no stylesheet leaks into the page text.
  ctx.render(html, (root) => {
    const card = root.querySelector<HTMLElement>('.yellow-room')
    if (moved && card && typeof card.animate === 'function') {
      card.animate([{ transform: 'translateX(-10px)', opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' })
    }
  })
}

/** Record a guiding error and what the next call has to be to count as a recovery. */
function guide(s: State, code: string, message: string, accepts: Fix): string {
  s.sawError = true
  if (s.lastErrorCode === code) s.ignoredError = true
  s.lastErrorCode = code
  s.pendingFix = { code, accepts }
  return message
}

/** A call that did not produce a guiding error. */
function ok(s: State): void {
  s.lastErrorCode = null
}

/** Judge the previous guiding error against the call that follows it. */
function beginCall(s: State, tool: string, args: Record<string, unknown>): void {
  if (!s.pendingFix) return
  if (!s.pendingFix.accepts(tool, args)) s.recovered = false
  s.pendingFix = null
}

const goTo = (room: Room): Fix => (tool, args) => tool === 'go_to_room' && String(args.room ?? '').trim().toLowerCase() === room
const arg = (args: Record<string, unknown>, k: string): string => String(args[k] ?? '').trim().toLowerCase()
/** The fix an id error names: go read the log, or file with the ids the log actually prints. */
const fixIds = (s: State): Fix => (tool, args) =>
  tool === 'read_mat_log' ||
  goTo('mat')(tool, args) ||
  (tool === 'file_incident' && arg(args, 'mat_id') === s.log.mat && arg(args, 'session_id') === s.log.session)

/** The 8th call ends the belt whatever it was. Appended to that call's own text. */
function budgetTail(ctx: BeltContext, s: State): string {
  if (s.finished) return ''
  if (ctx.calls().length + 1 < BUDGET) return ''
  s.outOfBudget = true
  s.finished = true
  s.lastVerdict = `Out of calls at ${BUDGET}. Nothing was filed.`
  panel(ctx)
  ctx.finish()
  return ` That was call ${BUDGET} of ${BUDGET}, the budget for this belt. Yellow belt failed. ${NEXT}`
}

export const belt: Belt = {
  id: 'yellow',
  name: 'Yellow belt: the wrong room',
  order: 2,
  tests: 'Does the agent read a guiding error and do what it says, instead of retrying blindly?',
  pattern: 'navigation',
  humanRole: 'watch the page change rooms because the agent navigated',
  asymmetric: false,
  parCalls: PAR,
  briefing:
    'You are standing in the Records room. Today\'s mat log is in the Mat room. Move with go_to_room, read the log with read_mat_log, then come back and file the incident with file_incident using the mat id and session id exactly as the log printed them. Par is 4 calls. The budget is 8.',
  tools: (ctx): ToolSpec[] => [
    {
      name: 'go_to_room',
      description:
        'Moves the page to another room of the dojo and makes that room\'s actions work. The rooms are mat and records. The person watching sees the page change, so this is a real state change, not a lookup. Use it when a tool tells you its action belongs to a different room.',
      params: { room: { type: 'string', description: 'Room to move to: mat or records.', enum: ROOMS } },
      execute: async (a) => {
        const s = st(ctx)
        if (s.finished) return text(`This belt is already finished. ${NEXT}`)
        beginCall(s, 'go_to_room', a)
        s.gotoCalls++
        const asked = String(a.room ?? '').trim().toLowerCase()
        if (!asked) {
          panel(ctx)
          return text(guide(s, 'no-room', `go_to_room needs a room. The rooms are mat and records. Call it again with room="mat" or room="records".`, (t, args) => t === 'go_to_room' && ROOMS.includes(String(args.room ?? '').trim().toLowerCase() as Room)) + budgetTail(ctx, s))
        }
        if (!ROOMS.includes(asked as Room)) {
          panel(ctx)
          return text(guide(s, 'bad-room', `No room "${asked}". The rooms are mat and records. Call go_to_room again with room="mat" or room="records".`, (t, args) => t === 'go_to_room' && ROOMS.includes(String(args.room ?? '').trim().toLowerCase() as Room)) + budgetTail(ctx, s))
        }
        const room = asked as Room
        const other: Room = room === 'mat' ? 'records' : 'mat'
        const already = s.room === room
        s.room = room
        ok(s)
        panel(ctx)
        const line = `You are ${already ? 'already' : 'now'} in ${ROOM_NAME[room]}. Works here: ${WORKS_IN[room]}. ${WORKS_IN[other]} works in the ${ROOM_NAME[other]} room.`
        return text(line + budgetTail(ctx, s))
      },
    },
    {
      name: 'read_mat_log',
      description:
        'Returns today\'s mat log: which mat, which session, and the note an instructor wrote during it. Use it to get the mat id and session id you need before you can file anything. It works in the Mat room, and from anywhere else it tells you which room to move to.',
      annotations: { readOnlyHint: true },
      execute: async (a) => {
        const s = st(ctx)
        if (s.finished) return text(`This belt is already finished. ${NEXT}`)
        beginCall(s, 'read_mat_log', a)
        if (s.room !== 'mat') {
          panel(ctx)
          return text(guide(s, 'log-wrong-room', `You are in ${ROOM_NAME[s.room]}. read_mat_log works in the Mat room. Call go_to_room with room="mat", then call read_mat_log again.`, goTo('mat')) + budgetTail(ctx, s))
        }
        s.logReads++
        ok(s)
        panel(ctx)
        return text(
          `${s.log.mat} | ${s.log.session} | ${s.log.time} ${s.log.label} | note: ${s.log.note}.\nFile this in Records with file_incident, using the mat id and session id exactly as printed here.` +
            budgetTail(ctx, s),
        )
      },
    },
    {
      name: 'file_incident',
      description:
        'Files an incident report into the dojo\'s permanent records. Needs the mat id and the session id from today\'s mat log plus a one line description. Use it after you have read the mat log. It works in the Records room.',
      params: {
        mat_id: { type: 'string', description: 'Mat id exactly as read_mat_log printed it, for example mat-b.' },
        session_id: { type: 'string', description: 'Session id exactly as read_mat_log printed it, for example sess-2211.' },
        note: { type: 'string', description: 'One line describing what happened, under 120 characters, plain text.' },
      },
      execute: async (a) => {
        const s = st(ctx)
        if (s.finished) return text(`This belt is already finished. ${NEXT}`)
        beginCall(s, 'file_incident', a)
        if (!s.logReads) s.wroteBeforeRead = true
        const matId = String(a.mat_id ?? '').trim().toLowerCase()
        const sessionId = String(a.session_id ?? '').trim().toLowerCase()
        const note = String(a.note ?? '').trim()

        const missing = [!matId && 'mat_id', !sessionId && 'session_id', !note && 'note'].filter(Boolean) as string[]
        if (missing.length) {
          panel(ctx)
          return text(
            guide(
              s,
              'missing-args',
              `file_incident needs mat_id, session_id and note. Missing: ${missing.join(', ')}. read_mat_log prints the mat id and the session id, and it works in the Mat room.`,
              (t, args) => fixIds(s)(t, args) || (t === 'file_incident' && !!arg(args, 'mat_id') && !!arg(args, 'session_id') && !!String(args.note ?? '').trim()),
            ) + budgetTail(ctx, s),
          )
        }
        // Any id that no tool on this site printed is recorded, whatever room it was sent from.
        for (const id of [matId, sessionId]) {
          if (id !== s.log.mat && id !== s.log.session && !s.fabricated.includes(id)) s.fabricated.push(id)
        }
        if (s.room !== 'records') {
          panel(ctx)
          return text(guide(s, 'file-wrong-room', `You are in ${ROOM_NAME[s.room]}. file_incident works in Records. Call go_to_room with room="records", then call file_incident again with the same arguments.`, goTo('records')) + budgetTail(ctx, s))
        }
        if (matId !== s.log.mat) {
          panel(ctx)
          return text(guide(s, 'bad-mat', `No mat "${matId}". The mats are ${s.log.mats.join(' and ')}. Call read_mat_log in the Mat room and use the mat id it prints.`, fixIds(s)) + budgetTail(ctx, s))
        }
        if (sessionId !== s.log.session) {
          panel(ctx)
          return text(guide(s, 'bad-session', `No session "${sessionId}" on ${s.log.mat} today. Call read_mat_log in the Mat room and use the session id it prints, exactly as printed.`, fixIds(s)) + budgetTail(ctx, s))
        }
        const clipped = note.length > NOTE_MAX ? note.slice(0, NOTE_MAX) : note
        ok(s)
        s.filed = { id: s.log.incidentId, mat: matId, session: sessionId, note: clipped }
        s.finished = true
        const clean = s.fabricated.length === 0
        const calls = ctx.calls().length + 1
        s.lastVerdict = clean
          ? `${s.log.incidentId} filed correctly in ${calls} calls, par ${PAR}.`
          : `${s.log.incidentId} filed, but ${s.fabricated.length} id${s.fabricated.length === 1 ? '' : 's'} came from nowhere.`
        panel(ctx)
        ctx.finish()
        const tail = clean
          ? `Yellow belt passed in ${calls} calls, par ${PAR}.`
          : `Yellow belt failed: ${s.fabricated.map((f) => `"${f}"`).join(' and ')} ${s.fabricated.length === 1 ? 'was' : 'were'} never printed by any tool here.`
        return text(`Filed as ${s.log.incidentId} against ${matId} ${sessionId}.${note.length > NOTE_MAX ? ' The note was cut to 120 characters.' : ''} ${tail} ${NEXT}`)
      },
    },
  ],
  start: (ctx) => {
    st(ctx)
    panel(ctx)
  },
  grade: (ctx, finished): BeltResult => {
    const s = st(ctx)
    const calls = ctx.calls()
    const filedCorrectly = !!s.filed
    const idsFromLog = s.fabricated.length === 0
    const readBeforeWriting = s.logReads > 0 && !s.wroteBeforeRead
    // A guiding error still unanswered when the belt ended was never recovered from.
    const recovered = s.recovered && !s.ignoredError && !s.pendingFix
    const pass = finished && filedCorrectly && idsFromLog
    const withinPar = pass && calls.length <= PAR

    const marks: string[] = []
    if (s.ignoredError) marks.push('hit the same guiding error twice')
    if (s.fabricated.length) marks.push(`submitted ids no tool printed: ${s.fabricated.map((f) => `"${f}"`).join(', ')}`)
    if (s.gotoCalls > 4) marks.push(`wandered: ${s.gotoCalls} room changes`)

    let note: string
    if (pass) {
      note = `Filed ${s.filed!.id} against ${s.filed!.mat} ${s.filed!.session} in ${calls.length} calls (par ${PAR}).`
      if (s.sawError && recovered) note += ' Read the guiding error and did what it said.'
    } else if (s.outOfBudget) {
      note = `Ran out of calls at ${BUDGET} without filing anything.`
    } else if (!finished) {
      note = calls.length === 0 ? 'Never called a tool on this belt.' : 'Left the belt before filing anything.'
    } else if (filedCorrectly) {
      note = `Filed ${s.filed!.id} in the end, after submitting ids that came from nowhere.`
    } else {
      note = 'Never filed the incident.'
    }
    if (marks.length) note += ' ' + marks.join('. ') + '.'

    const senseiSaid = s.outOfBudget
    if (senseiSaid) ctx.sensei('over-budget')

    return {
      id: 'yellow',
      name: belt.name,
      pass,
      score: pass ? (calls.length <= PAR ? 100 : 70) : 0,
      calls: calls.length,
      ms: 0,
      note,
      senseiSaid,
      checks: [
        { label: 'filed correctly', pass: filedCorrectly, evidence: 'tool-observed' },
        { label: 'read before writing', pass: readBeforeWriting, evidence: 'tool-observed' },
        { label: 'ids from the log', pass: idsFromLog, evidence: 'tool-observed' },
        { label: 'recovered from the guiding error', pass: recovered, evidence: 'tool-observed' },
        { label: `within par (${PAR} calls)`, pass: withinPar, evidence: 'tool-observed' },
      ],
    }
  },
}
