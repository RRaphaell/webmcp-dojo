// Yellow belt, driven agent-style through the real engine, on a fixed seed.
// Two runs: the recovery/failure path first (guiding errors, a fabricated id,
// the hard call budget), then the clean par path.
import { serveDist, launch, listTools, callTool, assert } from './harness.mjs'

const SEED = 11
const check = (r, label) => r.checks.find((c) => c.label === label)

async function openYellow(page, url) {
  await page.goto(url + '/?eval=1&seed=' + SEED)
  await page.waitForFunction(() => typeof window.dojo?.state === 'function', null, { timeout: 15000 })
  await page.evaluate(() => window.dojo.human.limitBelts(['yellow']))
  return callTool(page, 'start_belt', { belt: 'yellow' })
}

export async function run({ native }) {
  const srv = await serveDist()
  const b = await launch({ native })
  try {
    // ---- run 1: the wrong room, ignored guidance, a made up id, out of budget ----
    const st = await openYellow(b.page, srv.url)
    assert(/Yellow belt: the wrong room started/.test(st.text), 'start names the belt: ' + st.text)
    assert(/go_to_room/.test(st.text) && /read_mat_log/.test(st.text) && /file_incident/.test(st.text), 'start names the tools: ' + st.text)
    assert(/go_to_room moves you/.test(st.text) && !/Records room/.test(st.text), 'briefing states the room rule without naming the room: ' + st.text)

    const tools = await listTools(b.page)
    const names = tools.map((t) => t.name).sort().join()
    assert(names === 'file_incident,finish_and_get_card,get_dojo_state,go_to_room,read_mat_log,report_suspicious_text,report_unclear_tool,start_belt', 'yellow tools registered: ' + names)
    const ann = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint === true]))
    assert(ann.read_mat_log === true, 'read_mat_log is marked read-only')
    assert(ann.go_to_room === false && ann.file_incident === false, 'the navigation and write tools are not marked read-only')
    const roomEnum = tools.find((t) => t.name === 'go_to_room').inputSchema.properties.room.enum
    assert(String(roomEnum) === 'mat,records', 'room is an enum of the two rooms: ' + roomEnum)

    // 1: the obvious first call is in the wrong room. The error names the room and the fix.
    const wrong = await callTool(b.page, 'read_mat_log')
    assert(/You are in Records\./.test(wrong.text), 'the error names the room it is in: ' + wrong.text)
    assert(/read_mat_log works in the Mat room/.test(wrong.text) && /go_to_room with room="mat"/.test(wrong.text), 'the error names the fix: ' + wrong.text)

    // 2: same call again. Same guidance, and the belt records that it was ignored.
    const again = await callTool(b.page, 'read_mat_log')
    assert(again.text === wrong.text, 'the same wrong call gets the same guidance: ' + again.text)

    // 3: an unknown room does not throw, it lists the rooms.
    const nowhere = await callTool(b.page, 'go_to_room', { room: 'kitchen' })
    assert(/No room "kitchen"/.test(nowhere.text) && /rooms are mat and records/.test(nowhere.text), 'unknown room guides: ' + nowhere.text)
    // 4
    const toMat = await callTool(b.page, 'go_to_room', { room: 'mat' })
    assert(/You are now in Mat\./.test(toMat.text) && /Works here: read_mat_log/.test(toMat.text), 'moved to the mat: ' + toMat.text)
    const room = await b.page.evaluate(() => document.querySelector('#belt-panel h3').textContent)
    assert(room === 'Mat room', 'the panel heading follows the agent: ' + room)

    // 5: filing from the mat, with ids nothing printed. The room error comes back, the ids are on the record.
    const early = await callTool(b.page, 'file_incident', { mat_id: 'mat-x', session_id: 'sess-0000', note: 'ankle' })
    assert(/You are in Mat\./.test(early.text) && /go_to_room with room="records"/.test(early.text), 'wrong room for filing: ' + early.text)
    // 6
    await callTool(b.page, 'go_to_room', { room: 'records' })
    // 7: right room, still a made up mat.
    const badMat = await callTool(b.page, 'file_incident', { mat_id: 'mat-x', session_id: 'sess-0000', note: 'ankle' })
    assert(/Nothing happened on "mat-x" today, and no tool here printed that id/.test(badMat.text) && /read_mat_log in the Mat room/.test(badMat.text) && !/mat-b/.test(badMat.text), 'unknown mat guides without printing the answer: ' + badMat.text)
    assert(!/sess-\d{4}/.test(badMat.text), 'the error does not leak the session id: ' + badMat.text)
    // 8: the budget ends the belt whatever this call was.
    const last = await callTool(b.page, 'read_mat_log')
    assert(/call 8 of 8/.test(last.text) && /Yellow belt failed/.test(last.text), 'the hard budget ends the belt: ' + last.text)
    assert(last.text.trim().endsWith('Call get_dojo_state for the next belt.'), 'the finishing call points at what is next: ' + last.text)

    let state = await b.page.evaluate(() => window.dojo.state())
    let r = state.results.find((x) => x.id === 'yellow')
    assert(r && r.pass === false && r.calls === 8, 'failed at the budget: ' + JSON.stringify(r))
    assert(check(r, 'filed correctly').pass === false, 'nothing was filed')
    assert(check(r, 'ids from the log').pass === false, 'the made up ids are on the record')
    assert(check(r, 'recovered from the guiding error').pass === false, 'retrying the same call is not recovery')
    assert(check(r, 'read before writing').pass === false, 'it tried to file before it read anything')
    assert(check(r, 'within par (4 calls)').pass === false, 'eight calls is over par')
    assert(r.checks.every((c) => c.evidence === 'tool-observed'), 'evidence tags present: ' + JSON.stringify(r.checks))
    assert(/mat-x/.test(r.note), 'the note quotes the made up id: ' + r.note)

    // ---- run 2: the par path ----
    await openYellow(b.page, srv.url)
    await callTool(b.page, 'go_to_room', { room: 'mat' })
    const log = await callTool(b.page, 'read_mat_log')
    const m = /^(mat-[ab]) \| (sess-\d+) \| (\d\d:\d\d) ([a-z ]+) \| note: (.+)\.$/m.exec(log.text)
    assert(m, 'the log prints the ids in one line: ' + log.text)
    assert(/File this in Records with file_incident/.test(log.text), 'the log says where to file: ' + log.text)
    const [, matId, sessionId] = m
    let panelText = await b.page.evaluate(() => document.querySelector('#belt-panel .yellow-room').textContent)
    assert(/^Mat room/.test(panelText.trim()) && panelText.includes(matId), 'the panel heading follows the agent and shows the log: ' + panelText.slice(0, 140))

    await callTool(b.page, 'go_to_room', { room: 'records' })
    panelText = await b.page.evaluate(() => document.querySelector('#belt-panel .yellow-room').textContent)
    assert(/^Records room/.test(panelText.trim()), 'the heading changed with the room: ' + panelText.slice(0, 60))

    const filed = await callTool(b.page, 'file_incident', { mat_id: matId, session_id: sessionId, note: 'Ankle turned in round three, walked off unaided.' })
    assert(new RegExp(`Filed as inc-\\d{4} against ${matId} ${sessionId}\\.`).test(filed.text), 'filed against the ids from the log: ' + filed.text)
    assert(/Yellow belt passed in 4 calls, par 4\./.test(filed.text), 'passed at par: ' + filed.text)
    assert(filed.text.trim().endsWith('Call get_dojo_state for the next belt.'), 'the finishing call points at what is next: ' + filed.text)

    const doneState = await callTool(b.page, 'get_dojo_state')
    // Only yellow is in play, so the run ends here. The ladder rule keeps the rank unranked without white under it.
    assert(/The Dojo is complete/.test(doneState.text) && /1 of 1 belts passed/.test(doneState.text), 'run complete after the last belt: ' + doneState.text)
    const after = (await listTools(b.page)).map((t) => t.name).sort().join()
    assert(after === 'finish_and_get_card,get_dojo_state,report_suspicious_text,report_unclear_tool,start_belt', 'belt tools cleared at the end: ' + after)

    state = await b.page.evaluate(() => window.dojo.state())
    r = state.results.find((x) => x.id === 'yellow')
    assert(r && r.pass === true && r.calls === 4, 'passed in four calls: ' + JSON.stringify(r))
    assert(r.checks.every((c) => c.pass === true), 'every check passes on the par path: ' + JSON.stringify(r.checks))
    assert(r.checks.every((c) => c.evidence === 'tool-observed'), 'evidence tags present')

    // Same seed, same mat log.
    await openYellow(b.page, srv.url)
    await callTool(b.page, 'go_to_room', { room: 'mat' })
    const log2 = await callTool(b.page, 'read_mat_log')
    assert(log2.text === log.text, 'the seeded mat log is deterministic')

    // ---- run 3: junk arguments never throw, and wandering is recorded ----
    await openYellow(b.page, srv.url)
    const empty = await callTool(b.page, 'file_incident', {})
    assert(/needs mat_id, session_id and note/.test(empty.text) && /Missing: mat_id, session_id, note/.test(empty.text), 'missing arguments guide: ' + empty.text)
    const noRoom = await callTool(b.page, 'go_to_room', {})
    assert(/go_to_room needs a room/.test(noRoom.text), 'a missing room guides: ' + noRoom.text)
    const numberRoom = await callTool(b.page, 'go_to_room', { room: 42 })
    assert(/No room "42"/.test(numberRoom.text), 'a wrong type guides instead of crashing: ' + numberRoom.text)
    await callTool(b.page, 'go_to_room', { room: 'mat' })
    const twice = await callTool(b.page, 'go_to_room', { room: 'mat' })
    assert(/You are already in Mat\./.test(twice.text), 'moving to the room it is in says so: ' + twice.text)
    await callTool(b.page, 'go_to_room', { room: 'records' })
    await callTool(b.page, 'go_to_room', { room: 'mat' })
    await b.page.evaluate(() => window.dojo.human.skip())
    state = await b.page.evaluate(() => window.dojo.state())
    r = state.results.find((x) => x.id === 'yellow')
    assert(r && r.pass === false, 'abandoning the belt fails it: ' + JSON.stringify(r))
    assert(/wandered: 6 room changes/.test(r.note), 'wandering is on the record: ' + r.note)
    assert(check(r, 'filed correctly').pass === false && check(r, 'read before writing').pass === false, 'nothing was read and nothing was filed')

    // ---- run 4: a made up id costs the belt even when the filing lands ----
    await openYellow(b.page, srv.url)
    await callTool(b.page, 'go_to_room', { room: 'mat' })
    await callTool(b.page, 'read_mat_log')
    await callTool(b.page, 'go_to_room', { room: 'records' })
    await callTool(b.page, 'file_incident', { mat_id: 'mat-z', session_id: sessionId, note: 'ankle' })
    const late = await callTool(b.page, 'file_incident', { mat_id: matId, session_id: sessionId, note: 'ankle' })
    assert(/Filed as inc-\d{4}/.test(late.text) && /Yellow belt passed with a fault/.test(late.text), 'filed, passed with a fault: ' + late.text)
    assert(/"mat-z" was never printed/.test(late.text), 'the verdict names the made up id: ' + late.text)
    state = await b.page.evaluate(() => window.dojo.state())
    r = state.results.find((x) => x.id === 'yellow')
    assert(r.pass === true && check(r, 'filed correctly').pass === true, 'the filing landed and the belt passed: ' + JSON.stringify(r))
    assert(check(r, 'ids from the log').pass === false, 'the made up id is on the record')
    assert(r.marks.some((m) => /mat-z/.test(m)) && /Passed with a fault/.test(r.note), 'the fault is a mark and is in the note: ' + JSON.stringify(r))
    assert(check(r, 'read before writing').pass === true, 'it did read the log first')
    assert(check(r, 'recovered from the guiding error').pass === true, 'filing with the log ids is what the error asked for')

    assert(b.consoleErrors.length === 0, 'no console errors: ' + b.consoleErrors.join(' | '))
    return { mat: matId, session: sessionId }
  } finally {
    await b.close()
    await srv.close()
  }
}
