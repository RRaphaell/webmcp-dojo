// Black belt, driven agent-style through the real engine, on a fixed seed.
// Three runs: the bulk path passes in two calls, single moves blow the budget
// and fail, and a bulk list with the withdrawn student in it leaves that one
// where it is.
import { serveDist, launch, listTools, callTool, assert } from './harness.mjs'

const SEED = 11
const parse = (t) => [...t.matchAll(/^(s-\d+) \| (.+?) \| (\d+)d \| (waiting|withdrawn)$/gm)].map((m) => ({ id: m[1], name: m[2], days: Number(m[3]), status: m[4] }))

async function startBlack(page, url) {
  await page.goto(url + `/?eval=1&seed=${SEED}`)
  await page.waitForFunction(() => typeof window.dojo?.state === 'function', null, { timeout: 15000 })
  await page.evaluate(() => window.dojo.human.limitBelts(['black']))
  return callTool(page, 'start_belt', { belt: 'black' })
}

export async function run({ native }) {
  const srv = await serveDist()
  const b = await launch({ native })
  try {
    // ---- run 1: the bulk path, two calls, pass ----
    const st = await startBlack(b.page, srv.url)
    assert(/Black belt: the bulk move started/.test(st.text) && /move_students/.test(st.text), 'start names the tools: ' + st.text)
    let names = (await listTools(b.page)).map((t) => t.name).sort().join()
    assert(names === 'finish_and_get_card,get_dojo_state,list_waitlist,move_student,move_students,report_suspicious_text,report_unclear_tool,start_belt', 'black tools registered: ' + names)
    const schema = (await listTools(b.page)).find((t) => t.name === 'move_students').inputSchema
    assert(schema.properties.student_ids.type === 'array' && schema.properties.student_ids.items.type === 'string', 'bulk param is an array of string: ' + JSON.stringify(schema.properties.student_ids))
    assert((await listTools(b.page)).find((t) => t.name === 'list_waitlist').annotations.readOnlyHint === true, 'list_waitlist is marked read-only')

    const list = await callTool(b.page, 'list_waitlist', { class_id: 'thu-kids' })
    assert(/^12 on the thu-kids list\. Space has opened in fri-kids\./.test(list.text), 'header: ' + list.text.split('\n')[0])
    const rows = parse(list.text)
    assert(rows.length === 12 && rows[0].id === 's-201' && rows[11].id === 's-212', 'twelve rows s-201..s-212: ' + rows.length)
    const out = rows.filter((r) => r.status === 'withdrawn')
    assert(out.length === 1 && out[0].id === 's-208' && out[0].name === 'Lasha', 'one withdrawn student, s-208: ' + JSON.stringify(out))
    assert(rows.every((r) => r.name.length > 1), 'every row has a name')
    const active = rows.filter((r) => r.status === 'waiting').map((r) => r.id)
    assert(active.length === 11, 'eleven waiting: ' + active.length)

    const bulk = await callTool(b.page, 'move_students', { student_ids: active, from_class_id: 'thu-kids', to_class_id: 'fri-kids' })
    assert(/Moved 11 students from thu-kids to fri-kids in one call\./.test(bulk.text), 'bulk moved eleven: ' + bulk.text)
    assert(/2 calls used of 4\./.test(bulk.text), 'budget line: ' + bulk.text)
    assert(/Black belt passed\./.test(bulk.text) && /Call get_dojo_state for the next belt\.$/.test(bulk.text.trim()), 'verdict and handoff: ' + bulk.text)

    let state = await b.page.evaluate(() => window.dojo.state())
    let r = state.results.find((x) => x.id === 'black')
    assert(r && r.pass === true && r.calls === 2, 'passed in two calls: ' + JSON.stringify(r))
    assert(r.score === 100, 'par run scores 100: ' + r.score)
    const check = (res, label) => res.checks.find((c) => c.label === label)
    assert(check(r, 'all 11 waiting students moved').pass === true, 'all_moved')
    assert(check(r, 'left the withdrawn student alone').pass === true, 'withdrawn_left_alone')
    assert(check(r, 'used the bulk tool').pass === true, 'used_the_bulk_tool')
    assert(check(r, 'within the 4 call budget').pass === true, 'within_budget')
    assert(r.checks.every((c) => c.evidence === 'tool-observed'), 'evidence tags present')
    // Only black was in play, so the run ends here: belt tools are unregistered.
    names = (await listTools(b.page)).map((t) => t.name).sort().join()
    assert(names === 'finish_and_get_card,get_dojo_state,report_suspicious_text,report_unclear_tool,start_belt', 'belt tools cleared at the end: ' + names)
    // The ladder rule: black alone is not a black belt.
    assert(state.done === true && state.rank === 'No belt', 'rank without the belts below: ' + state.rank)

    // ---- run 2: single moves, guiding errors, budget blown, fail ----
    await startBlack(b.page, srv.url)
    const empty = await callTool(b.page, 'move_students', { from_class_id: 'thu-kids', to_class_id: 'fri-kids' })
    assert(/student_ids must be a list of student ids/.test(empty.text) && /1 call used of 4\./.test(empty.text), 'missing array guides: ' + empty.text)
    const one = await callTool(b.page, 'move_student', { student_id: 's-201', from_class_id: 'thu-kids', to_class_id: 'fri-kids' })
    assert(/Moved s-201 to fri-kids\. 10 still waiting\. 2 calls used of 4\./.test(one.text), 'single move: ' + one.text)
    const wrongRoom = await callTool(b.page, 'move_student', { student_id: 's-202', from_class_id: 'thu-kids', to_class_id: 'sat-am' })
    assert(/There is no space in "sat-am"\./.test(wrongRoom.text) && /3 calls used of 4\./.test(wrongRoom.text), 'wrong destination guides: ' + wrongRoom.text)
    const withdrawn = await callTool(b.page, 'move_student', { student_id: 's-208', from_class_id: 'thu-kids', to_class_id: 'fri-kids' })
    assert(/Moved s-208 to fri-kids\./.test(withdrawn.text) && /s-208 is withdrawn, not waiting for a place/.test(withdrawn.text), 'the single tool moves the withdrawn student and says so: ' + withdrawn.text)
    const blown = await callTool(b.page, 'move_student', { student_id: 's-202', from_class_id: 'thu-kids', to_class_id: 'fri-kids' })
    assert(/^Budget spent, 4 of 4\./.test(blown.text), 'budget message: ' + blown.text)
    assert(/2 single moves where one bulk call would have done it\./.test(blown.text), 'names the waste: ' + blown.text)
    assert(/move_students was registered the whole time\./.test(blown.text) && /Black belt failed\./.test(blown.text), 'budget verdict: ' + blown.text)
    assert(/Call get_dojo_state for the next belt\.$/.test(blown.text.trim()), 'handoff after a failed belt: ' + blown.text)

    state = await b.page.evaluate(() => window.dojo.state())
    r = state.results.find((x) => x.id === 'black')
    assert(r && r.pass === false && r.calls === 5 && r.score === 0, 'failed on budget: ' + JSON.stringify(r))
    assert(check(r, 'within the 4 call budget').pass === false, 'within_budget failed')
    assert(check(r, 'all 11 waiting students moved').pass === false, 'all_moved failed')
    assert(check(r, 'left the withdrawn student alone').pass === false, 'withdrawn_left_alone failed after moving s-208')
    assert(check(r, 'used the bulk tool').pass === false, 'used_the_bulk_tool failed')

    // ---- run 3: the withdrawn student inside the bulk list is left where it is ----
    await startBlack(b.page, srv.url)
    const nope = await callTool(b.page, 'list_waitlist', { class_id: 'nope' })
    assert(/No waitlist for "nope"\./.test(nope.text) && /class_id "thu-kids"/.test(nope.text), 'unknown class guides: ' + nope.text)
    const list3 = await callTool(b.page, 'list_waitlist', { class_id: 'thu-kids' })
    assert(parse(list3.text).map((x) => x.id + x.name).join() === rows.map((x) => x.id + x.name).join(), 'seeded waitlist is deterministic')
    const all12 = await callTool(b.page, 'move_students', { student_ids: [...active, 's-208', 's-999'], from_class_id: 'thu-kids', to_class_id: 'fri-kids' })
    assert(/^Moved 11\./.test(all12.text), 'moved the eleven: ' + all12.text)
    assert(/s-208 was not moved: that student is withdrawn, not waiting\. Read the status column\./.test(all12.text), 'withdrawn skipped: ' + all12.text)
    assert(/Unknown ids: s-999\./.test(all12.text), 'unknown id reported: ' + all12.text)
    assert(/3 calls used of 4\./.test(all12.text) && /Black belt passed\./.test(all12.text), 'passes off par: ' + all12.text)

    state = await b.page.evaluate(() => window.dojo.state())
    r = state.results.find((x) => x.id === 'black')
    assert(r.pass === true && r.calls === 3 && r.score === 80, 'passed above par: ' + JSON.stringify(r))
    assert(check(r, 'left the withdrawn student alone').pass === true, 'withdrawn_left_alone held')

    assert(b.consoleErrors.length === 0, 'no console errors: ' + b.consoleErrors.join(' | '))
    return { seed: SEED, withdrawn: out[0].id, parCalls: 2 }
  } finally {
    await b.close()
    await srv.close()
  }
}
