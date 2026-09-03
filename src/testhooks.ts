// Test hooks: only active when the page is loaded with ?test=registry.
// Exposes a tiny fixture so tests/registry.test.mjs can drive the registry
// through the real engine. Not part of the product surface.
import { ToolRegistry, text } from './webmcp/registry'
import type { ToolCallRecord } from './webmcp/registry'
import type { EngineKind } from './webmcp/shim'

declare global {
  interface Window { __dojoTest?: Record<string, unknown> }
}

export function installTestHooks(engine: EngineKind): void {
  const registry = new ToolRegistry()
  const calls: ToolCallRecord[] = []
  registry.on((ev) => { if (ev.type === 'call') calls.push(ev.record) })
  const hooks: Record<string, unknown> = { ready: false, engine, toolchanges: 0, calls: () => calls }
  document.modelContext?.addEventListener('toolchange', () => { hooks.toolchanges = (hooks.toolchanges as number) + 1 })
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
