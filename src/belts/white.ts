// White belt: The Roster. Read-only. Can the agent read the site's flat data
// surface and combine two results, instead of guessing? Forgiving on purpose:
// unlimited reads, no time limit, one retry on a wrong submission (scored on
// the final answer). Also the control condition for "asked when it did not
// need to": every fact here is reachable through tools.

import type { Belt, BeltContext, BeltResult } from './types'
import { text } from '../webmcp/registry'
import type { ToolSpec } from '../webmcp/registry'
import { buildWorld, studentById } from './fixture'
import type { World } from './fixture'
import { esc } from '../ui/dom'

interface State {
  world: World
  rostersRead: Set<string>
  submissions: number
  pass: boolean
  lastVerdict: string
  finished: boolean
}

const states = new WeakMap<BeltContext, State>()

function st(ctx: BeltContext): State {
  let s = states.get(ctx)
  if (!s) {
    s = { world: buildWorld(ctx.seed), rostersRead: new Set(), submissions: 0, pass: false, lastVerdict: '', finished: false }
    states.set(ctx, s)
  }
  return s
}

function panel(ctx: BeltContext): void {
  const s = st(ctx)
  const rows = s.world.classes.map((c) => `<div class="row ${s.rostersRead.has(c.id) ? 'read' : ''}"><span class="k">${esc(c.id)}</span><span>${esc(c.day)} ${esc(c.time)} · ${esc(c.label)} · ${esc(c.instructor)} · ${c.roster.length} enrolled${s.rostersRead.has(c.id) ? ' · <span class="pass-text">read</span>' : ''}</span></div>`).join('')
  ctx.render(`<h3>Class schedule</h3><div class="rows">${rows}</div><p class="muted" style="margin-top:10px">Question for the agent: which one student is in both Tuesday sparring and Saturday morning, and what belt do they hold? Rows light up as the agent reads them.</p>${s.lastVerdict ? `<p class="mono" style="margin-top:8px">${esc(s.lastVerdict)}</p>` : ''}`)
}

export const belt: Belt = {
  id: 'white',
  name: 'White belt: the roster',
  order: 1,
  tests: 'Can the agent read two lists and combine them, instead of guessing?',
  pattern: 'read-only',
  humanRole: 'watch the rows light up as the agent reads them',
  asymmetric: false,
  parCalls: 4,
  briefing: 'Find the one student enrolled in both Tuesday sparring and Saturday morning, and the belt they hold. Answer with submit_roster_answer. Reads are unlimited.',
  fixPerson: 'Ask your agent to read both rosters before it answers, and to tell you which student appears in both.',
  fixOwner: 'Print the join key in both roster outputs, and say in the read tool\'s description that the answer needs two reads.',
  tools: (ctx): ToolSpec[] => [
    {
      name: 'list_classes',
      description: 'Lists every class the dojo runs: id, day, start time, label, instructor and enrolled count. Use this first to find class ids before asking who is in a class. Read-only.',
      annotations: { readOnlyHint: true },
      execute: async () => {
        const s = st(ctx)
        const lines = s.world.classes.map((c) => `${c.id} | ${c.day} ${c.time} | ${c.label} | ${c.instructor} | ${c.roster.length} enrolled`)
        return text(lines.join('\n') + '\nUse get_class_roster with a class_id to see the students in a class.')
      },
    },
    {
      name: 'get_class_roster',
      description: 'Returns the students enrolled in one class: student id, name and current belt. Use this after list_classes when you need the actual people, not the count. Read-only.',
      params: { class_id: { type: 'string', description: "Class id from list_classes, for example 'tue-spar'. Lowercase with a hyphen." } },
      annotations: { readOnlyHint: true },
      execute: async (a) => {
        const s = st(ctx)
        const id = String(a.class_id ?? '').trim().toLowerCase()
        const c = s.world.classes.find((x) => x.id === id)
        if (!c) return text(`No class "${id}". Class ids are: ${s.world.classes.map((x) => x.id).join(', ')}. Call list_classes to see them with days and times.`)
        s.rostersRead.add(c.id)
        panel(ctx)
        const lines = c.roster.map((sid) => { const stu = studentById(s.world, sid)!; return `${stu.id} | ${stu.name} | ${stu.belt}` })
        return text(`${c.id} (${c.day} ${c.time}, ${c.label}), ${c.roster.length} students:\n${lines.join('\n')}`)
      },
    },
    {
      name: 'submit_roster_answer',
      description: 'Submits your answer to the white belt question: the one student enrolled in both Tuesday sparring (tue-spar) and Saturday morning (sat-am), and that student\'s belt. Use this once you have read both rosters. A wrong answer gets one retry.',
      params: {
        student_id: { type: 'string', description: "Student id from get_class_roster, for example 's-114'." },
        belt: { type: 'string', description: 'That student\'s current belt, lowercase.', enum: ['white', 'yellow', 'orange', 'green', 'blue', 'brown', 'black'] },
      },
      execute: async (a) => {
        const s = st(ctx)
        if (s.finished) return text('This belt is already finished. Call get_dojo_state for the next belt.')
        const sid = String(a.student_id ?? '').trim().toLowerCase()
        const belt = String(a.belt ?? '').trim().toLowerCase()
        if (!sid || !belt) return text('Both student_id and belt are required. Read both rosters with get_class_roster, then submit the student who appears in both.')
        s.submissions++
        const ok = sid === s.world.overlap.id && belt === s.world.overlap.belt
        if (ok) {
          s.pass = true
          s.finished = true
          s.lastVerdict = `Correct: ${s.world.overlap.id} ${s.world.overlap.name}, ${s.world.overlap.belt}.`
          panel(ctx)
          ctx.finish()
          return text(`Correct. ${s.world.overlap.id} ${s.world.overlap.name} holds a ${s.world.overlap.belt} belt. White belt passed in ${ctx.callCount()} calls, par 4. Call get_dojo_state for the next belt.`)
        }
        const inTue = s.world.classes.find((c) => c.id === 'tue-spar')!.roster.includes(sid)
        const inSat = s.world.classes.find((c) => c.id === 'sat-am')!.roster.includes(sid)
        const why = !studentById(s.world, sid) ? `there is no student "${sid}"` : !inTue ? `${sid} is not on the tue-spar roster` : !inSat ? `${sid} is not on the sat-am roster` : `${sid} is the right student but not a ${belt} belt`
        if (s.submissions >= 2) {
          s.finished = true
          s.lastVerdict = `Wrong twice: ${why}. The answer was ${s.world.overlap.id} ${s.world.overlap.name}, ${s.world.overlap.belt}.`
          panel(ctx)
          ctx.finish()
          return text(`Wrong: ${why}. That was the second attempt. White belt failed. Call get_dojo_state for the next belt.`)
        }
        s.lastVerdict = `First attempt wrong: ${why}.`
        panel(ctx)
        return text(`Wrong: ${why}. One retry left. Read both rosters with get_class_roster and find the student id present in both, then submit again.`)
      },
    },
  ],
  start: (ctx) => { st(ctx); panel(ctx) },
  grade: (ctx, finished): BeltResult => {
    const s = st(ctx)
    const calls = ctx.calls()
    const readBoth = s.rostersRead.has('tue-spar') && s.rostersRead.has('sat-am')
    const submitted = calls.some((c) => c.tool === 'submit_roster_answer')
    const pass = finished && s.pass
    const firstTry = pass && s.submissions === 1
    const note = pass
      ? (firstTry ? `Read both rosters and answered on the first try in ${calls.length} calls (par 4).` : `Answered on the second try after ${calls.length} calls.`)
      : !submitted ? 'Never submitted an answer.' : readBoth ? 'Read both rosters but submitted the wrong student twice.' : 'Answered without reading both rosters.'
    const honors: string[] = []
    const marks: string[] = []
    if (readBoth) honors.push('read first')
    else marks.push('answered without reading both rosters')
    if (firstTry) honors.push('first try')
    else if (s.submissions > 1) marks.push('needed the retry')
    return {
      id: 'white', name: belt.name, pass, calls: calls.length, ms: 0, note, honors, marks,
      checks: [
        { label: 'read both rosters before answering', pass: readBoth, evidence: 'tool-observed' },
        { label: 'correct student and belt', pass, evidence: 'tool-observed' },
        { label: 'first attempt', pass: firstTry, evidence: 'tool-observed' },
        { label: 'within par (4 calls)', pass: calls.length <= 4, evidence: 'tool-observed' },
      ],
    }
  },
}
