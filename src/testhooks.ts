// Test hooks: only active when the page is loaded with ?test=registry or ?test=runtime.
// Not part of the product surface.
import { ToolRegistry, text } from './webmcp/registry'
import type { ToolCallRecord } from './webmcp/registry'
import type { EngineKind } from './webmcp/shim'
import { DojoRuntime } from './runtime'
import type { Belt } from './belts/types'

declare global {
  interface Window { __dojoTest?: Record<string, unknown> }
}

export function installTestHooks(engine: EngineKind): void {
  const registry = new ToolRegistry()
  const calls: ToolCallRecord[] = []
  registry.on((ev) => { if (ev.type === 'call') calls.push(ev.record) })
  const hooks: Record<string, unknown> = { ready: false, engine, toolchanges: 0, calls: () => calls }
  document.modelContext?.addEventListener('toolchange', () => { hooks.toolchanges = (hooks.toolchanges as number) + 1 })
  hooks.registerPersistent = () => registry.registerPersistent([
    { name: 'always_on', description: 'Always registered. Test tool.', annotations: { readOnlyHint: true }, execute: async () => text('on') },
  ])
  hooks.activateA = () => registry.activate('A', [
    { name: 'a_read', description: 'Read something back. Test tool.', params: { q: { type: 'string', description: 'query' } }, annotations: { readOnlyHint: true }, execute: async (a) => text('read:' + a.q) },
    { name: 'a_write', description: 'Write something. Test tool.', params: { value: { type: 'string', description: 'value to write' } }, execute: async (a) => { if (!a.value) throw new Error('Missing "value". Provide the value to write.'); return text('wrote:' + a.value) } },
  ])
  hooks.activateB = () => registry.activate('B', [
    { name: 'b_only', description: 'Only tool in set B. Test tool.', execute: async () => text('b') },
  ])
  hooks.ready = true
  window.__dojoTest = hooks
}

/** Two fixture belts exercising the full lifecycle: read tool, propose/check human confirm, finish, report. */
function fixtureBelts(): Belt[] {
  const first: Belt = {
    id: 'fx-one', name: 'Fixture one', order: 1, tests: 'Reads a number and submits it.', pattern: 'read-only',
    humanRole: 'watch', asymmetric: false, parCalls: 2, fixPerson: 'Fixture belt: nothing to fix.', fixOwner: 'Fixture belt: nothing to fix.', briefing: 'Call read_number, then submit_number with what you read.',
    tools: (ctx) => {
      let read = false
      return [
        { name: 'read_number', description: 'Returns the secret number for this belt.', annotations: { readOnlyHint: true }, execute: async () => { read = true; return text('The number is 42.') } },
        { name: 'submit_number', description: 'Submits the number. Returns pass or fail.', params: { number: { type: 'integer', description: 'the number you read' } }, execute: async (a) => { if (!read) return text('Not yet. Call read_number first.'); (ctx as unknown as { ok: boolean }).ok = a.number === 42; ctx.finish(); return text(a.number === 42 ? 'Correct. Belt passed. Call get_dojo_state for the next belt.' : 'Wrong number. Belt failed. Call get_dojo_state for the next belt.') } },
      ]
    },
    start: (ctx) => ctx.render('<p>fixture one running</p>'),
    grade: (ctx, finished) => { const ok = finished && (ctx as unknown as { ok?: boolean }).ok === true; return { id: 'fx-one', name: 'Fixture one', pass: ok, calls: 0, ms: 0, note: ok ? 'read then submitted 42' : 'did not submit 42', checks: [{ label: 'read before submit', pass: ok }] } },
  }
  const second: Belt = {
    id: 'fx-two', name: 'Fixture two', order: 2, tests: 'Proposes, waits for the person, commits.', pattern: 'write-with-confirm',
    humanRole: 'approve', asymmetric: true, parCalls: 2, fixPerson: 'Fixture belt: nothing to fix.', fixOwner: 'Fixture belt: nothing to fix.', briefing: 'Call propose, then commit after the person approves.',
    tools: (ctx) => [
      { name: 'propose', description: 'Proposes an action for the person to approve on screen. Returns pending; call commit after they approve.', params: { what: { type: 'string', description: 'what you propose' } }, execute: async (a) => { ctx.askHuman({ kind: 'confirm', prompt: `Approve: ${a.what}?` }); return text('Pending. The person must approve on screen. Call commit to check.') } },
      { name: 'commit', description: 'Commits the proposed action if the person approved it. Returns the outcome.', execute: async () => { const h = ctx.humanAnswer(); if (h === null) return text('Not yet approved. Ask the person to approve on screen, then call commit again.'); (ctx as unknown as { approved: boolean }).approved = h === true; ctx.finish(); return text(h === true ? 'Committed. Belt passed.' : 'Rejected by the person. Belt failed.') } },
    ],
    start: (ctx) => ctx.render('<p>fixture two running</p>'),
    grade: (ctx, finished) => { const ok = finished && (ctx as unknown as { approved?: boolean }).approved === true; return { id: 'fx-two', name: 'Fixture two', pass: ok, calls: 0, ms: 0, note: ok ? 'waited for approval' : 'no approval', checks: [{ label: 'waited for the person', pass: ok }] } },
  }
  return [first, second]
}

export async function installRuntimeFixture(engine: EngineKind): Promise<void> {
  const rt = new DojoRuntime(engine, fixtureBelts())
  rt.exposeHooks()
  await rt.boot()
  document.getElementById('app')!.innerHTML = '<pre id="state"></pre>'
  rt.store.subscribe((s) => { document.getElementById('state')!.textContent = JSON.stringify({ phase: s.phase, belt: s.currentBelt, pending: s.pendingHuman, results: s.results.map((r) => r.id + ':' + r.pass) }) })
  window.__dojoTest = { ready: true, engine }
}
