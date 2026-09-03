// Foundation test: the registry + shim behave identically on the native engine
// and on the shim, and dynamic set switching unregisters old tools.
import { serveDist, launch, listTools, callTool, assert } from './harness.mjs'

export async function run({ native }) {
  const srv = await serveDist()
  const b = await launch({ native })
  try {
    await b.page.goto(srv.url + '/?test=registry')
    await b.page.waitForFunction(() => window.__dojoTest?.ready === true, null, { timeout: 15000 })
    const engine = await b.page.evaluate(() => window.__dojoTest.engine)
    assert(engine === (native ? 'native' : 'shim'), `engine should be ${native ? 'native' : 'shim'}, got ${engine}`)

    await b.page.evaluate(() => window.__dojoTest.registerPersistent())
    await b.page.evaluate(() => window.__dojoTest.activateA())
    let tools = await listTools(b.page)
    assert(tools.map((t) => t.name).sort().join() === 'a_read,a_write,always_on', 'set A + persistent registered: ' + tools.map((t) => t.name))
    assert(tools.find((t) => t.name === 'a_read').annotations.readOnlyHint === true, 'readOnlyHint preserved')
    assert(tools.find((t) => t.name === 'a_read').inputSchema.properties.q.description.length > 0, 'param description present')

    const r = await callTool(b.page, 'a_read', { q: 'ping' })
    assert(r.text === 'read:ping', 'a_read result: ' + r.text)
    const feed = await b.page.evaluate(() => window.__dojoTest.calls())
    assert(feed.length === 1 && feed[0].tool === 'a_read' && feed[0].ok && feed[0].ms >= 0, 'call logged to feed: ' + JSON.stringify(feed))

    const e = await callTool(b.page, 'a_write', {})
    assert(/missing/i.test(e.text), 'guiding error returned, not thrown: ' + e.text)

    await b.page.evaluate(() => window.__dojoTest.activateB())
    tools = await listTools(b.page)
    assert(tools.map((t) => t.name).sort().join() === 'always_on,b_only', 'set B replaced set A, always_on survived: ' + tools.map((t) => t.name))
    const on = await callTool(b.page, 'always_on', {})
    assert(on.text === 'on', 'persistent tool still callable after switch')
    const changes = await b.page.evaluate(() => window.__dojoTest.toolchanges)
    assert(changes >= 2, 'toolchange fired on register and abort: ' + changes)

    assert(b.consoleErrors.length === 0, 'no console errors: ' + b.consoleErrors.join(' | '))
    return { engine, changes, feedCalls: feed.length }
  } finally {
    await b.close()
    await srv.close()
  }
}
