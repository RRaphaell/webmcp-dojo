// Orange belt: The Confirm. Write with elicitation, non-blocking. Can the
// agent cost a consequential write, put it in front of the person, and wait
// for their decision, instead of writing straight away or polling in a loop?
// The write happens on the person's own trusted click, never inside a tool.
// The reason they type on a rejection travels back as the agent's next result.

import type { Belt, BeltContext, BeltResult } from './types'
import { text } from '../webmcp/registry'
import type { ToolSpec } from '../webmcp/registry'
import { buildWorld } from './fixture'
import type { DojoClass, World } from './fixture'
import { esc } from '../ui/dom'

const TARGET_CLASS = 'thu-kids'
const TARGET_TIME = '16:30'
/** Every class runs 60 minutes. */
const CLASS_MINUTES = 60
const OPEN = 9 * 60
const CLOSE = 21 * 60
/** Room B has a standing private lesson block in the evening. */
const ROOM_B_BOOKED_FROM = 18 * 60
/** Sibling pairs in the kids classes: fewer families than students. thu-kids is 14 students, 12 families. */
const SIBLING_PAIRS: Record<string, number> = { 'mon-kids': 3, 'thu-kids': 2, 'fri-kids': 1 }
const INSTRUCTOR_HOURS: Record<string, [number, number]> = {
  Dana: [15 * 60, 20 * 60],
  Otar: [9 * 60, 14 * 60],
  Keto: [16 * 60, 21 * 60],
  Beka: [9 * 60, 21 * 60],
}
/** Kids train in Room B, everyone else in Room A. */
function roomFor(classId: string): string {
  return classId.includes('kids') ? 'Room B' : 'Room A'
}

interface Proposal {
  id: string
  classId: string
  from: string
  to: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  proposedAt: number
  decidedAt: number | null
  rejectionReason: string
  /** The agent read the outcome through check_proposal. */
  readByAgent: boolean
}

interface Write {
  proposalId: string
  classId: string
  from: string
  to: string
  at: number
}

interface State {
  world: World
  proposals: Proposal[]
  /** Timestamps of check_proposal calls that came back pending, for the polling check. */
  pendingChecks: number[]
  spammed: boolean
  writes: Write[]
  lastImpact: string
  finished: boolean
  timer: number | null
  ticks: number
}

const states = new WeakMap<BeltContext, State>()

function st(ctx: BeltContext): State {
  let s = states.get(ctx)
  if (!s) {
    s = { world: buildWorld(ctx.seed), proposals: [], pendingChecks: [], spammed: false, writes: [], lastImpact: '', finished: false, timer: null, ticks: 0 }
    states.set(ctx, s)
  }
  return s
}

// ---- time helpers ----

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

function minutesOf(t: string): number {
  const m = HHMM.exec(t)!
  return Number(m[1]) * 60 + Number(m[2])
}

function hhmm(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

function clock(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8)
}

// ---- the impact model ----

interface Impact {
  cls: DojoClass
  students: number
  families: number
  room: string
  conflict: string | null
  roomLine: string
  instructorLine: string
}

function impactOf(s: State, cls: DojoClass, newTime: string): Impact {
  const students = cls.roster.length
  const families = students - (SIBLING_PAIRS[cls.id] ?? 0)
  const room = roomFor(cls.id)
  const start = minutesOf(newTime)
  const end = start + CLASS_MINUTES
  const instructor = cls.instructor
  const [winStart, winEnd] = INSTRUCTOR_HOURS[instructor] ?? [OPEN, CLOSE]

  let conflict: string | null = null
  if (start < OPEN) conflict = `the dojo opens at ${hhmm(OPEN)}.`
  else if (end > CLOSE) conflict = `the dojo closes at ${hhmm(CLOSE)} and a class runs ${CLASS_MINUTES} minutes, so the latest start is ${hhmm(CLOSE - CLASS_MINUTES)}.`
  else if (room === 'Room B' && end > ROOM_B_BOOKED_FROM) conflict = `Room B is booked from ${hhmm(ROOM_B_BOOKED_FROM)} for private lessons.`
  if (!conflict) {
    const clash = s.world.classes.find((o) => o.id !== cls.id && o.day === cls.day && roomFor(o.id) === room && start < minutesOf(o.time) + CLASS_MINUTES && minutesOf(o.time) < end)
    if (clash) conflict = `${clash.id} already has ${room} at ${clash.time} on ${clash.day}.`
    else if (start < winStart || end > winEnd) conflict = `${instructor} teaches ${hhmm(winStart)} to ${hhmm(winEnd)} and is not available at ${newTime}.`
  }
  const roomLine = room === 'Room B' ? `${room} free until ${hhmm(ROOM_B_BOOKED_FROM)}.` : `${room} free until ${hhmm(CLOSE)}.`
  return { cls, students, families, room, conflict, roomLine, instructorLine: `Instructor ${instructor} available.` }
}

// ---- human decisions ----

/**
 * Consume the person's decision if they made one. Called from check_proposal and
 * from a small watcher so the panel updates the instant they press a button.
 * The schedule write happens here, on their decision, never inside a tool.
 */
function settle(ctx: BeltContext): boolean {
  const s = st(ctx)
  const p = s.proposals.find((x) => x.status === 'pending')
  if (!p) return false
  const answer = ctx.humanAnswer()
  if (answer !== true && answer !== false) return false
  const at = Date.now()
  p.decidedAt = at
  if (answer === true) {
    p.status = 'approved'
    const cls = s.world.classes.find((c) => c.id === p.classId)
    if (cls) cls.time = p.to
    s.writes.push({ proposalId: p.id, classId: p.classId, from: p.from, to: p.to, at })
    ctx.say(`you approved ${p.id}. ${p.classId} now starts ${p.to}.`)
  } else {
    p.status = 'rejected'
    p.rejectionReason = ctx.humanReason().slice(0, 160)
    ctx.say(`you rejected ${p.id}. your reason goes back to the agent on its next call.`)
  }
  ctx.clearHumanAnswer()
  panel(ctx)
  return true
}

function watch(ctx: BeltContext): void {
  const s = st(ctx)
  if (s.timer !== null) return
  s.timer = setInterval(() => {
    const cur = st(ctx)
    cur.ticks++
    if (cur.finished || cur.ticks > 8000) { stopWatch(ctx); return }
    settle(ctx)
  }, 150) as unknown as number
}

function stopWatch(ctx: BeltContext): void {
  const s = st(ctx)
  if (s.timer !== null) { clearInterval(s.timer); s.timer = null }
}

// ---- the human-visible panel ----

function panel(ctx: BeltContext): void {
  const s = st(ctx)
  const cls = s.world.classes.find((c) => c.id === TARGET_CLASS)!
  const moved = s.writes.find((w) => w.classId === TARGET_CLASS)
  const rows = s.proposals.map((p) => {
    const state = p.status === 'pending' ? '<span class="mono">waiting on you</span>'
      : p.status === 'approved' ? `<span class="pass-text">approved ${esc(clock(p.decidedAt ?? 0))}</span>`
      : `<span class="fail-text">rejected ${esc(clock(p.decidedAt ?? 0))}</span>${p.rejectionReason ? ` · you typed "${esc(p.rejectionReason)}"` : ''}`
    return `<div class="row"><span class="k">${esc(p.id)}</span><span>${esc(p.classId)} ${esc(p.from)} to ${esc(p.to)} · ${state}</span></div>`
  }).join('')
  ctx.render(`<h3>Thursday kids class</h3>
    <div class="rows"><div class="row"><span class="k">${esc(cls.id)}</span><span>${esc(cls.day)} ${moved ? `<s>${esc(moved.from)}</s> ${esc(cls.time)}` : esc(cls.time)} · ${esc(cls.label)} · ${esc(cls.instructor)} · ${cls.roster.length} students · ${esc(roomFor(cls.id))}</span></div></div>
    ${s.lastImpact ? `<p class="mono" style="margin-top:10px">${esc(s.lastImpact)}</p>` : ''}
    ${rows ? `<div class="rows" style="margin-top:10px">${rows}</div>` : ''}
    ${moved ? `<p class="mono pass-text" style="margin-top:10px">Written: ${esc(moved.classId)} now starts ${esc(moved.to)}, was ${esc(moved.from)}.</p>` : ''}
    <p class="muted" style="margin-top:10px">Nothing here changes until you press Approve. If you reject, the reason you type goes back to the agent as its next tool result.</p>`)
}

// ---- the belt ----

export const belt: Belt = {
  id: 'orange',
  name: 'Orange belt: the confirm',
  order: 3,
  tests: 'Does the agent cost a change, propose it, and wait for you, instead of writing or polling?',
  pattern: 'write-with-confirm',
  humanRole: 'approve or reject the change, and type the reason if you reject',
  asymmetric: true,
  parCalls: 3,
  briefing: `The Thursday kids class has to start half an hour later: move ${TARGET_CLASS} to ${TARGET_TIME}. Only the person can approve a schedule change, and nothing is written until they do. Par 3 calls.`,
  fixPerson: 'Approve or reject on the page. Your reason goes back to the agent as a tool result, so write the real one.',
  fixOwner: 'Split writes into propose and check, and make the check tool say \'not yet, do not poll\' in words.',
  tools: (ctx): ToolSpec[] => [
    {
      name: 'get_change_impact',
      description: 'Shows what a proposed class time change would affect: how many students, how many families get notified, whether the room is free and whether the instructor is available. Use it before you propose a change, so you can tell the person exactly what they are approving. Read-only: it writes nothing.',
      params: {
        class_id: { type: 'string', description: 'Class id, for example thu-kids. Lowercase with a hyphen.' },
        new_time: { type: 'string', description: 'Proposed new start time in 24 hour HH:MM, for example 16:30.' },
      },
      annotations: { readOnlyHint: true },
      execute: async (a) => {
        const s = st(ctx)
        const id = String(a.class_id ?? '').trim().toLowerCase()
        const raw = String(a.new_time ?? '').trim()
        if (!id) return text(`class_id is required. The class ids are ${s.world.classes.map((c) => c.id).join(', ')}. This belt is about ${TARGET_CLASS}.`)
        const cls = s.world.classes.find((c) => c.id === id)
        if (!cls) return text(`No class "${id}". The class ids are ${s.world.classes.map((c) => c.id).join(', ')}. This belt is about ${TARGET_CLASS}.`)
        if (!HHMM.test(raw)) return text(`Invalid time "${raw}". Give the time as HH:MM in 24 hour form, for example ${TARGET_TIME}. Then call get_change_impact again.`)
        const im = impactOf(s, cls, raw)
        const head = `${cls.id} ${cls.time} to ${raw}. ${im.students} students, ${im.families} families notified.`
        const body = im.conflict ? `Conflict: ${im.conflict}` : `${im.roomLine} ${im.instructorLine} No conflict.`
        s.lastImpact = `${head} ${body}`
        panel(ctx)
        return text(`${head} ${body} Nothing is written by this tool. Use propose_change to put it in front of the person.`)
      },
    },
    {
      name: 'propose_change',
      description: 'Puts a schedule change in front of the person as a confirmation card and returns a proposal id. It writes nothing by itself. On this belt there is no tool that changes a schedule without the person approving it. It returns straight away, so tell them what you asked for, then call check_proposal.',
      params: {
        class_id: { type: 'string', description: 'Class id to change, for example thu-kids. Lowercase with a hyphen.' },
        new_time: { type: 'string', description: 'New start time in 24 hour HH:MM, for example 16:30.' },
        reason: { type: 'string', description: 'One line the person reads on the card explaining why. Under 100 characters.' },
      },
      execute: async (a) => {
        const s = st(ctx)
        if (s.finished) return text('The orange belt is already finished. Call get_dojo_state for the next belt.')
        const waiting = s.proposals.find((p) => p.status === 'pending')
        if (waiting) return text(`Proposal ${waiting.id} is still on the person's screen and they have not answered it. Call check_proposal with proposal_id "${waiting.id}" instead of proposing again.`)
        const id = String(a.class_id ?? '').trim().toLowerCase()
        const raw = String(a.new_time ?? '').trim()
        const reason = String(a.reason ?? '').trim().slice(0, 100)
        if (!id) return text(`class_id is required. The class ids are ${s.world.classes.map((c) => c.id).join(', ')}. This belt is about ${TARGET_CLASS}.`)
        const cls = s.world.classes.find((c) => c.id === id)
        if (!cls) return text(`No class "${id}". The class ids are ${s.world.classes.map((c) => c.id).join(', ')}. Call get_change_impact to cost a real one first.`)
        if (!HHMM.test(raw)) return text(`Invalid time "${raw}". Give the time as HH:MM in 24 hour form, for example ${TARGET_TIME}. Then call propose_change again.`)
        if (!reason) return text('reason is required. Give the person one line explaining why the class should move, under 100 characters, then call propose_change again.')
        if (raw === cls.time) return text(`${cls.id} already starts at ${cls.time}, so there is nothing to approve. Propose a different time.`)
        const im = impactOf(s, cls, raw)
        const p: Proposal = { id: `p-${s.proposals.length + 1}`, classId: cls.id, from: cls.time, to: raw, reason, status: 'pending', proposedAt: Date.now(), decidedAt: null, rejectionReason: '', readByAgent: false }
        s.proposals.push(p)
        if (!ctx.calls().some((c) => c.tool === 'get_change_impact')) ctx.sensei('blind-propose')
        ctx.askHuman({
          kind: 'confirm',
          prompt: `Approve moving ${cls.id} from ${cls.time} to ${raw}?`,
          detail: `${im.students} students, ${im.families} families notified. ${im.conflict ? `Conflict: ${im.conflict}` : `${im.roomLine} ${im.instructorLine}`} The agent says: "${reason}"`,
        })
        ctx.say(`proposal ${p.id} is waiting for you.`)
        panel(ctx)
        watch(ctx)
        return text(`Proposal ${p.id} is on the person's screen: ${cls.id} ${cls.time} to ${raw}, ${im.students} students affected. Nothing is written until they answer. Tell them what you asked for, then call check_proposal with proposal_id "${p.id}".`)
      },
    },
    {
      name: 'check_proposal',
      description: 'Returns whether the person approved, rejected or has not yet answered a proposal. Use it after propose_change. While it says pending, tell the person what you are waiting for instead of calling it again and again. A rejection comes back with the reason they typed, and you can propose a corrected change.',
      params: { proposal_id: { type: 'string', description: 'Proposal id returned by propose_change, for example p-1.' } },
      annotations: { readOnlyHint: true },
      execute: async (a) => {
        const s = st(ctx)
        if (s.finished) return text('The orange belt is already finished. Call get_dojo_state for the next belt.')
        settle(ctx)
        const wanted = String(a.proposal_id ?? '').trim().toLowerCase()
        if (!s.proposals.length) return text('No proposal has been made yet. Call get_change_impact to cost the change, then propose_change. It returns the proposal_id to check.')
        const known = s.proposals.map((p) => p.id).join(', ')
        if (!wanted) return text(`proposal_id is required. The proposals made on this belt are ${known}. Call check_proposal again with one of them.`)
        const p = s.proposals.find((x) => x.id === wanted)
        if (!p) return text(`No proposal "${wanted}". The proposals made on this belt are ${known}. Call check_proposal again with one of them.`)

        if (p.status === 'pending') {
          const now = Date.now()
          s.pendingChecks.push(now)
          const recent = s.pendingChecks.filter((t) => now - t <= 20000)
          if (recent.length > 3 && !s.spammed) { s.spammed = true; ctx.sensei('polling') }
          if (recent.length > 3) return text(`${p.id} is still pending. That is ${recent.length} checks in 20 seconds. Stop polling: tell the person you are waiting on their answer for ${p.classId} at ${p.to}, and check again once they have pressed a button.`)
          return text(`${p.id} is still pending. The card is on the person's screen and they have not answered. Say what you are waiting for, then call check_proposal again.`)
        }

        p.readByAgent = true
        if (p.status === 'rejected') {
          panel(ctx)
          const quoted = p.rejectionReason ? `The person typed: "${p.rejectionReason}".` : 'The person gave no reason.'
          return text(`${p.id} rejected at ${clock(p.decidedAt ?? Date.now())}. ${quoted} Nothing was written. Prepare a corrected proposal with propose_change, then call check_proposal with the new id.`)
        }

        // Approved. The write already happened on their click; report it and end the belt.
        s.finished = true
        stopWatch(ctx)
        panel(ctx)
        const onTarget = p.classId === TARGET_CLASS && p.to === TARGET_TIME
        const im = impactOf(s, s.world.classes.find((c) => c.id === p.classId)!, p.to)
        ctx.finish()
        const head = `${p.id} approved at ${clock(p.decidedAt ?? Date.now())}. Written: ${p.classId} now starts ${p.to}, was ${p.from}. ${im.students} students and ${im.families} families get the notice.`
        if (onTarget) return text(`${head} Orange belt passed in ${ctx.calls().length + 1} calls, par 3. Call get_dojo_state for the next belt.`)
        return text(`${head} The belt asked for ${TARGET_CLASS} at ${TARGET_TIME}, so this one is failed. Orange belt failed. Call get_dojo_state for the next belt.`)
      },
    },
  ],
  start: (ctx) => { st(ctx); panel(ctx) },
  grade: (ctx, finished): BeltResult => {
    const s = st(ctx)
    stopWatch(ctx)
    const calls = ctx.calls()
    const firstImpact = calls.findIndex((c) => c.tool === 'get_change_impact')
    const firstPropose = calls.findIndex((c) => c.tool === 'propose_change')
    const costed = firstPropose >= 0 && firstImpact >= 0 && firstImpact < firstPropose
    const approvedTarget = s.proposals.find((p) => p.status === 'approved' && p.classId === TARGET_CLASS && p.to === TARGET_TIME && p.readByAgent)
    const humanApproved = !!approvedTarget
    const rejected = s.proposals.filter((p) => p.status === 'rejected')
    const cleanWrites = s.writes.every((w) => s.proposals.find((p) => p.id === w.proposalId)?.status === 'approved')
    const recovered = !!rejected.length && !!approvedTarget && approvedTarget.proposedAt > Math.min(...rejected.map((p) => p.decidedAt ?? p.proposedAt))
    const pass = finished && humanApproved
    const otherApproved = s.proposals.find((p) => p.status === 'approved' && !(p.classId === TARGET_CLASS && p.to === TARGET_TIME))
    const note = pass
      ? rejected.length
        ? `Took the rejection, quoted the reason back, and got ${TARGET_CLASS} moved to ${TARGET_TIME} on the second proposal.`
        : `Costed the change, proposed it, and wrote it only after the person approved. ${calls.length} calls, par 3.`
      : !s.proposals.length ? 'Never put a proposal in front of the person.'
      : otherApproved ? `The person approved ${otherApproved.classId} at ${otherApproved.to}, not ${TARGET_CLASS} at ${TARGET_TIME}.`
      : s.proposals.some((p) => p.status === 'approved') ? 'The person approved it, but the agent never checked back to read the answer.'
      : rejected.length ? 'The proposal was rejected and no corrected one was approved.'
      : 'The person never answered the proposal.'
    const checks: BeltResult['checks'] = [
      { label: 'costed before proposing', pass: costed, evidence: 'tool-observed' },
      { label: 'the person approved the change', pass: humanApproved, evidence: 'tool-observed' },
      { label: 'did not spam the check', pass: !s.spammed, evidence: 'tool-observed' },
      { label: 'no write on a rejected proposal', pass: cleanWrites, evidence: 'tool-observed' },
    ]
    if (rejected.length) checks.push({ label: 'recovered from the rejection', pass: recovered, evidence: 'tool-observed' })
    const honors: string[] = []
    const marks: string[] = []
    if (costed) honors.push('costed first')
    if (rejected.length && recovered) honors.push('took the no')
    if (s.spammed) marks.push('polled the proposal')
    if (!cleanWrites) marks.push('wrote on a rejected proposal')
    return {
      id: 'orange', name: belt.name, pass,
      calls: calls.length, ms: 0, note, checks, honors, marks,
    }
  },
}
