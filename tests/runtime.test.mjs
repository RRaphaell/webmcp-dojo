// End-to-end runtime lifecycle with fixture belts, driven agent-style through the engine.
import { serveDist, launch, listTools, callTool, assert } from './harness.mjs'

export async function run({ native }) {
  const srv = await serveDist()
  const b = await launch({ native })
  try {
    await b.page.goto(srv.url + '/?test=runtime')
    await b.page.waitForFunction(() => window.__dojoTest?.ready === true && typeof window.dojo?.state === 'function', null, { timeout: 15000 })

    let names = (await listTools(b.page)).map((t) => t.name).sort().join()
    assert(names === 'get_dojo_state,start_belt', 'lobby exposes only the always-on tools: ' + names)

    const s0 = await callTool(b.page, 'get_dojo_state')
    assert(/Next belt: Fixture one/.test(s0.text) && /start_belt/.test(s0.text), 'state names the next belt and how to start: ' + s0.text)

    const wrong = await callTool(b.page, 'start_belt', { belt: 'fx-two' })
    assert(/Belts run in order/.test(wrong.text), 'out-of-order start is a guiding message: ' + wrong.text)

    const st = await callTool(b.page, 'start_belt', { belt: 'fx-one' })
    assert(/Fixture one started/.test(st.text), 'belt one started: ' + st.text)
    names = (await listTools(b.page)).map((t) => t.name).sort().join()
    assert(names === 'get_dojo_state,read_number,start_belt,submit_number', 'belt tools added, always-on kept: ' + names)

    const early = await callTool(b.page, 'submit_number', { number: 42 })
    assert(/Call read_number first/.test(early.text), 'guiding error before read: ' + early.text)
    await callTool(b.page, 'read_number')
    const ok = await callTool(b.page, 'submit_number', { number: 42 })
    assert(/Belt passed/.test(ok.text), 'belt one passes: ' + ok.text)
    let state = await b.page.evaluate(() => window.dojo.state())
    assert(state.results.length === 1 && state.results[0].pass === true, 'result recorded: ' + JSON.stringify(state.results))

    const s1 = await callTool(b.page, 'get_dojo_state')
    assert(/Next belt: Fixture two/.test(s1.text), 'state advances to belt two: ' + s1.text)
    await callTool(b.page, 'start_belt', { belt: 'fx-two' })
    names = (await listTools(b.page)).map((t) => t.name).sort().join()
    assert(names === 'commit,get_dojo_state,propose,start_belt', 'belt one tools unregistered, belt two registered: ' + names)

    const pr = await callTool(b.page, 'propose', { what: 'submit the form' })
    assert(/Pending/.test(pr.text), 'propose returns immediately (non-blocking): ' + pr.text)
    state = await b.page.evaluate(() => window.dojo.state())
    assert(state.pendingHuman?.kind === 'confirm', 'human box pending: ' + JSON.stringify(state.pendingHuman))
    const notYet = await callTool(b.page, 'commit')
    assert(/Not yet approved/.test(notYet.text), 'commit before approval guides: ' + notYet.text)
    await b.page.evaluate(() => window.dojo.human.confirm(true))
    const done = await callTool(b.page, 'commit')
    assert(/Committed/.test(done.text), 'commit after approval passes: ' + done.text)

    state = await b.page.evaluate(() => window.dojo.state())
    assert(state.done === true && state.rank && state.results.filter((r) => r.pass).length === 2, 'dojo complete with rank: ' + JSON.stringify({ done: state.done, rank: state.rank }))
    const s2 = await callTool(b.page, 'get_dojo_state')
    assert(/complete/.test(s2.text) && /Rank/.test(s2.text), 'final state reports rank: ' + s2.text)
    names = (await listTools(b.page)).map((t) => t.name).sort().join()
    assert(names === 'get_dojo_state,start_belt', 'belt tools cleared at the end: ' + names)

    const hash = await b.page.evaluate(() => location.hash)
    assert(/^#card=/.test(hash), 'report encoded into the URL: ' + hash)
    const feed = await b.page.evaluate(() => window.dojo.feed())
    assert(feed.length >= 9 && feed.every((c) => typeof c.ms === 'number'), 'feed has every call with page-side ms: ' + feed.length)
    assert(b.consoleErrors.length === 0, 'no console errors: ' + b.consoleErrors.join(' | '))
    return { engine: state.engine, rank: state.rank, calls: feed.length }
  } finally {
    await b.close()
    await srv.close()
  }
}
