// Tool registry: the one place the Dojo registers tools. It wraps every tool's
// execute() so each call is timed and logged (the live feed reads this), keeps
// its own list of active tools (so the inspector never depends on getTools()),
// and switches whole tool sets atomically with AbortController - dynamic
// registration is how belts change what the agent can do.

import type { JsonSchema, ToolAnnotations, ToolDescriptor, ToolResult } from './types'

export interface ToolCallRecord {
  id: number
  set: string
  tool: string
  args: Record<string, unknown>
  startedAt: number
  ms: number
  ok: boolean
  /** First text content of the result, or the error message. Truncated for display. */
  summary: string
  result?: ToolResult
  error?: string
  readOnly: boolean
}

export interface ToolSpec {
  name: string
  title?: string
  description: string
  params?: Record<string, { type: 'string' | 'number' | 'integer' | 'boolean'; description: string; enum?: string[] }>
  required?: string[]
  annotations?: ToolAnnotations
  execute: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult
}

export interface ActiveTool {
  spec: ToolSpec
  set: string
  descriptor: ToolDescriptor
}

type Listener = (ev: RegistryEvent) => void
export type RegistryEvent =
  | { type: 'call'; record: ToolCallRecord }
  | { type: 'set-changed'; set: string; tools: ActiveTool[] }

/** Chrome's secure-tools budgets. We enforce them at registration so a violation is a build error, not a judge's finding. */
export const BUDGET = { name: 30, description: 500, paramDescription: 150, output: 1500 } as const
const NAME_RE = /^[A-Za-z0-9_.-]{1,30}$/

export function text(t: string): ToolResult {
  return { content: [{ type: 'text', text: t }] }
}

export function toSchema(spec: ToolSpec): JsonSchema {
  const properties: JsonSchema['properties'] = {}
  for (const [k, v] of Object.entries(spec.params ?? {})) {
    if (!NAME_RE.test(k)) throw new Error(`param name ${spec.name}.${k} must be 1-30 chars of [A-Za-z0-9_.-]`)
    if (v.description.length > BUDGET.paramDescription) throw new Error(`param ${spec.name}.${k} description over ${BUDGET.paramDescription} chars`)
    properties[k] = { type: v.type, description: v.description, ...(v.enum ? { enum: v.enum } : {}) }
  }
  return { type: 'object', properties, required: spec.required ?? Object.keys(properties), additionalProperties: false }
}

export class ToolRegistry {
  private controller: AbortController | null = null
  private persistentController: AbortController | null = null
  private active: ActiveTool[] = []
  private persistent: ActiveTool[] = []
  private listeners = new Set<Listener>()
  private seq = 0
  currentSet = ''

  /** Belt tools plus the always-on tools, in registration order. */
  get tools(): readonly ActiveTool[] { return [...this.persistent, ...this.active] }

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(ev: RegistryEvent) { for (const l of this.listeners) l(ev) }

  /** Tools that stay registered for the life of the page (the orientation tool). Registered once. */
  async registerPersistent(specs: ToolSpec[]): Promise<void> {
    if (this.persistentController) return
    const controller = new AbortController()
    this.persistentController = controller
    this.persistent = await this.registerSet('dojo', specs, controller)
    this.emit({ type: 'set-changed', set: this.currentSet, tools: this.tools.slice() })
  }

  /**
   * Replace the belt tool set. The new set is registered BEFORE the old one is
   * aborted, so the agent never observes an empty tool surface (a removed tool
   * carries no explanation; see docs/research/agent-behavior.md, bug #3).
   * Names must not collide across consecutive sets (Chrome rejects duplicates).
   */
  async activate(set: string, specs: ToolSpec[]): Promise<void> {
    const previous = this.controller
    const controller = new AbortController()
    this.controller = controller
    this.currentSet = set
    // A name shared with the outgoing set would be rejected as a duplicate; retire the old set first in that case.
    const incoming = new Set(specs.map((s) => s.name))
    if (this.active.some((t) => incoming.has(t.spec.name))) previous?.abort()
    const next = await this.registerSet(set, specs, controller)
    if (this.controller !== controller) { controller.abort(); return } // superseded while awaiting
    previous?.abort()
    this.active = next
    this.emit({ type: 'set-changed', set, tools: this.tools.slice() })
  }

  /** Unregister the belt set (persistent tools stay). */
  clear(): void {
    this.controller?.abort()
    this.controller = null
    this.active = []
    this.currentSet = ''
    this.emit({ type: 'set-changed', set: '', tools: this.tools.slice() })
  }

  private async registerSet(set: string, specs: ToolSpec[], controller: AbortController): Promise<ActiveTool[]> {
    const mc = document.modelContext
    if (!mc) throw new Error('document.modelContext is not available')
    const out: ActiveTool[] = []
    for (const spec of specs) {
      if (!NAME_RE.test(spec.name)) throw new Error(`tool name ${spec.name} must be 1-30 chars of [A-Za-z0-9_.-]`)
      if (spec.description.length > BUDGET.description) throw new Error(`tool ${spec.name} description over ${BUDGET.description} chars`)
      const descriptor: ToolDescriptor = {
        name: spec.name,
        title: spec.title,
        description: spec.description,
        inputSchema: toSchema(spec),
        annotations: { readOnlyHint: !!spec.annotations?.readOnlyHint, untrustedContentHint: !!spec.annotations?.untrustedContentHint },
        execute: (args) => this.run(set, spec, args ?? {}),
      }
      await mc.registerTool(descriptor, { signal: controller.signal })
      out.push({ spec, set, descriptor })
    }
    return out
  }

  /** Execute an active tool by name through the same wrapper an engine would hit (used by the inspector). */
  async invoke(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const t = this.tools.find((a) => a.spec.name === name)
    if (!t) throw new Error(`no active tool named ${name}`)
    return this.run(t.set, t.spec, args)
  }

  private async run(set: string, spec: ToolSpec, args: Record<string, unknown>): Promise<ToolResult> {
    const id = ++this.seq
    const startedAt = performance.now()
    const readOnly = !!spec.annotations?.readOnlyHint
    try {
      const result = await spec.execute(args)
      const first = result.content?.[0]?.text ?? ''
      if (first.length > BUDGET.output) {
        result.content[0].text = first.slice(0, BUDGET.output - 1) + '…'
      }
      const ms = performance.now() - startedAt
      this.emit({ type: 'call', record: { id, set, tool: spec.name, args, startedAt, ms, ok: !result.isError, summary: clip(result.content?.[0]?.text ?? ''), result, readOnly } })
      return result
    } catch (err) {
      const ms = performance.now() - startedAt
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ type: 'call', record: { id, set, tool: spec.name, args, startedAt, ms, ok: false, summary: clip(message), error: message, readOnly } })
      // Guiding errors: never throw at the engine; return a message the agent can act on.
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  }
}

function clip(s: string, n = 160): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}
