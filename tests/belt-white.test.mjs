// White belt, driven agent-style through the real engine, on a fixed seed.
import { serveDist, launch, listTools, callTool, assert } from './harness.mjs'

export async function run({ native }) {
  const srv = await serveDist()
  const b = await launch({ native })
  try {
    await b.page.goto(srv.url + '/?eval=1&seed=7')
    await b.page.waitForFunction(() => typeof window.dojo?.state === 'function', null, { timeout: 15000 })
    await b.page.evaluate(() => window.dojo.human.limitBelts(['white']))

    const st = await callTool(b.page, 'start_belt', { belt: 'white' })
    assert(/White belt: the roster started/.test(st.text) && /list_classes/.test(st.text), 'start names the tools: ' + st.text)
    let names = (await listTools(b.page)).map((t) => t.name).sort().join()
    assert(names === 'finish_and_get_card,get_class_roster,get_dojo_state,list_classes,report_suspicious_text,report_unclear_tool,start_belt,submit_roster_answer', 'white tools registered: ' + names)

    // Guess without reading: wrong id gives a guiding message and a retry.
    const guess = await callTool(b.page, 'submit_roster_answer', { student_id: 's-999', belt: 'green' })
    assert(/no student "s-999"/.test(guess.text) && /One retry left/.test(guess.text), 'guiding retry: ' + guess.text)

    const classes = await callTool(b.page, 'list_classes')
    assert(/tue-spar \| Tuesday 19:00/.test(classes.text) && /sat-am \| Saturday 09:00/.test(classes.text), 'classes listed: ' + classes.text.slice(0, 120))
    const bad = await callTool(b.page, 'get_class_roster', { class_id: 'nope' })
    assert(/No class "nope"/.test(bad.text) && /tue-spar/.test(bad.text), 'unknown class guides: ' + bad.text)
    const tue = await callTool(b.page, 'get_class_roster', { class_id: 'tue-spar' })
    const sat = await callTool(b.page, 'get_class_roster', { class_id: 'sat-am' })
    const ids = (t) => [...t.matchAll(/^(s-\d+) \| (.+?) \| (\w+)$/gm)].map((m) => ({ id: m[1], name: m[2], belt: m[3] }))
    const overlap = ids(tue.text).filter((x) => ids(sat.text).some((y) => y.id === x.id))
    assert(overlap.length === 1, 'exactly one overlapping student: ' + JSON.stringify(overlap))

    const ok = await callTool(b.page, 'submit_roster_answer', { student_id: overlap[0].id, belt: overlap[0].belt })
    assert(/Correct\./.test(ok.text) && /White belt passed/.test(ok.text), 'correct answer passes: ' + ok.text)
    // Only white is in play, so the run is complete: belt tools are cleared and the always-on tool reports the rank.
    const fin = await callTool(b.page, 'get_dojo_state')
    assert(/complete/.test(fin.text) && /White belt/.test(fin.text), 'run complete after the last belt: ' + fin.text)
    names = (await listTools(b.page)).map((t) => t.name).sort().join()
    assert(names === 'finish_and_get_card,get_dojo_state,report_suspicious_text,report_unclear_tool,start_belt', 'belt tools cleared at the end: ' + names)

    const state = await b.page.evaluate(() => window.dojo.state())
    const w = state.results.find((r) => r.id === 'white')
    assert(w && w.pass === true && w.calls === 6, 'result recorded with call count: ' + JSON.stringify(w))
    assert(w.checks.find((c) => c.label === 'first attempt').pass === false, 'second-attempt pass recorded honestly')
    assert(w.checks.every((c) => c.evidence === 'tool-observed'), 'evidence tags present')
    assert(state.done === true && state.rank === 'White belt', 'rank: ' + state.rank)

    // Determinism: same seed, same overlap.
    await b.page.goto(srv.url + '/?eval=1&seed=7')
    await b.page.waitForFunction(() => typeof window.dojo?.state === 'function')
    await b.page.evaluate(() => window.dojo.human.limitBelts(['white']))
    await callTool(b.page, 'start_belt', { belt: 'white' })
    const tue2 = await callTool(b.page, 'get_class_roster', { class_id: 'tue-spar' })
    assert(ids(tue2.text).map((x) => x.id).join() === ids(tue.text).map((x) => x.id).join(), 'seeded fixture is deterministic')

    assert(b.consoleErrors.length === 0, 'no console errors: ' + b.consoleErrors.join(' | '))
    return { overlap: overlap[0].id, rank: state.rank }
  } finally {
    await b.close()
    await srv.close()
  }
}
