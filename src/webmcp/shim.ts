// Dev shim: installs a document.modelContext that mirrors Chrome 152's observed
// semantics when no engine provides one (plain browsers, Playwright without the
// flag). Lets the built-in inspector, the tests and the eval harness drive tools
// through the same calls a real agent runtime uses. Never overrides a real engine.

import type { ModelContextLike, RegisteredTool, ToolDescriptor } from './types'

class ShimModelContext extends EventTarget implements ModelContextLike {
  private tools = new Map<string, ToolDescriptor>()
  ontoolchange: ((ev: Event) => void) | null = null

  registerTool(desc: ToolDescriptor, options?: { signal?: AbortSignal }): Promise<void> {
    if (!desc || typeof desc.name !== 'string' || typeof desc.execute !== 'function') {
      return Promise.reject(new TypeError("Failed to execute 'registerTool' on 'ModelContext': invalid tool"))
    }
    if (desc.inputSchema !== undefined && (typeof desc.inputSchema !== 'object' || desc.inputSchema === null)) {
      return Promise.reject(new TypeError("Failed to execute 'registerTool' on 'ModelContext': Failed to convert value to 'object'."))
    }
    if (this.tools.has(desc.name)) {
      return Promise.reject(new DOMException('Duplicate tool name', 'InvalidStateError'))
    }
    if (options?.signal?.aborted) return Promise.resolve()
    this.tools.set(desc.name, desc)
    options?.signal?.addEventListener('abort', () => {
      if (this.tools.get(desc.name) === desc) {
        this.tools.delete(desc.name)
        this.emitChange()
      }
    }, { once: true })
    this.emitChange()
    return Promise.resolve()
  }

  getTools(): Promise<RegisteredTool[]> {
    const out: RegisteredTool[] = [...this.tools.values()].map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: JSON.stringify(t.inputSchema ?? { type: 'object', properties: {} }),
      annotations: {
        readOnlyHint: t.annotations?.readOnlyHint ?? false,
        untrustedContentHint: t.annotations?.untrustedContentHint ?? false,
      },
      origin: location.origin,
    }))
    return Promise.resolve(out)
  }

  async executeTool(tool: RegisteredTool, argsJson: string): Promise<string> {
    const desc = this.tools.get(tool?.name)
    if (!desc) throw new TypeError("Failed to execute 'executeTool' on 'ModelContext': The provided value is not of type 'RegisteredTool'.")
    let args: Record<string, unknown>
    try {
      args = typeof argsJson === 'string' ? JSON.parse(argsJson) : (() => { throw new Error('not a string') })()
    } catch {
      throw new DOMException('Failed to parse input arguments', 'UnknownError')
    }
    try {
      const res = await desc.execute(args)
      return typeof res === 'string' ? res : JSON.stringify(res)
    } catch {
      throw new DOMException('Tool was executed but the invocation failed. For example, the script function threw an error', 'UnknownError')
    }
  }

  private emitChange() {
    const ev = new Event('toolchange')
    this.dispatchEvent(ev)
    this.ontoolchange?.(ev)
  }
}

export type EngineKind = 'native' | 'shim'

/** Installs the shim if no engine is present. Returns which engine the page ended up with. */
export function ensureModelContext(): EngineKind {
  if (typeof document.modelContext?.registerTool === 'function') return 'native'
  const shim = new ShimModelContext()
  Object.defineProperty(document, 'modelContext', { value: shim, configurable: true, enumerable: false, writable: false })
  return 'shim'
}
