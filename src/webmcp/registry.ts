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
  /** The tool declared untrustedContentHint: its output is third-party text, shown hatched in the feed. */
  untrusted: boolean
  /** Unset for calls that came through the engine. 'hand' for the inspector, 'replay' for the recorded run. */
  via?: 'hand' | 'replay'
}

export interface ParamSpec {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description: string
  enum?: string[]
  /** For type 'array': the item type. */
  items?: { type: 'string' | 'number' | 'integer' | 'boolean' }
}

export interface ToolSpec {
  name: string
  title?: string
  description: string
  params?: Record<string, ParamSpec>
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
    properties[k] = { type: v.type, description: v.description, ...(v.enum ? { enum: v.enum } : {}), ...(v.type === 'array' ? { items: v.items ?? { type: 'string' } } : {}) }
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
  /** Number of tool executions currently in progress. */
  inFlight = 0
  /** Escape hatch (?compat=1): never unregister previous belt sets, in case an agent runtime does not re-read tools mid-conversation. */
  keepPrevious = false
  private retired: ActiveTool[] = []
  private retiredControllers: AbortController[] = []

  /** Belt tools plus the always-on tools, in registration order (plus retired sets in compat mode). */
  get tools(): readonly ActiveTool[] { return [...this.persistent, ...this.retired, ...this.active] }

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
    if (this.active.some((t) => incoming.has(t.spec.name))) { previous?.abort(); await nextTask() }
    const next = await this.registerSet(set, specs, controller)
    if (this.controller !== controller) { deferAbort(controller); return } // superseded while awaiting
    if (this.keepPrevious) { this.retired = [...this.retired, ...this.active]; if (previous) this.retiredControllers.push(previous) }
    else deferAbort(previous)
    this.active = next
    this.emit({ type: 'set-changed', set, tools: this.tools.slice() })
  }

  /** Unregister the belt set (persistent tools stay). Safe to call from inside a tool's execute. */
  clear(): void {
    if (this.keepPrevious) { this.retired = [...this.retired, ...this.active]; if (this.controller) this.retiredControllers.push(this.controller) } else deferAbort(this.controller)
    this.controller = null
    this.active = []
    this.currentSet = ''
    this.emit({ type: 'set-changed', set: '', tools: this.tools.slice() })
  }

  /** A new run: every belt set goes, retired ones included, so the same names can register again. Persistent tools stay. */
  resetAll(): void {
    for (const c of this.retiredControllers) deferAbort(c)
    this.retiredControllers = []
    this.retired = []
    deferAbort(this.controller)
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
      try {
        await mc.registerTool(descriptor, { signal: controller.signal })
      } catch (err) {
        // An already-aborted signal means this set was superseded while registering: the engine did not keep it, so neither do we.
        if (err instanceof DOMException && err.name === 'AbortError') continue
        throw err
      }
      out.push({ spec, set, descriptor })
    }
    return out
  }

  /** Execute an active tool by name through the same wrapper an engine would hit (used by the inspector). */
  async invoke(name: string, args: Record<string, unknown>, via: 'hand' | 'replay' = 'hand'): Promise<ToolResult> {
    const t = this.tools.find((a) => a.spec.name === name)
    if (!t) throw new Error(`no active tool named ${name}`)
    return this.run(t.set, t.spec, args, via)
  }

  /** `via` is set for calls that did not come through the engine: a person in the inspector, or the recorded-run replay. */
  private async run(set: string, spec: ToolSpec, args: Record<string, unknown>, via?: 'hand' | 'replay'): Promise<ToolResult> {
    const id = ++this.seq
    const startedAt = performance.now()
    const readOnly = !!spec.annotations?.readOnlyHint
    const untrusted = !!spec.annotations?.untrustedContentHint
    this.inFlight++
    try {
      const result = await spec.execute(args)
      const first = result.content?.[0]?.text ?? ''
      if (first.length > BUDGET.output) {
        result.content[0].text = first.slice(0, BUDGET.output - 1) + '…'
      }
      const ms = performance.now() - startedAt
      this.inFlight--
      this.emit({ type: 'call', record: { id, set, tool: spec.name, args, startedAt, ms, ok: !result.isError, summary: clip(result.content?.[0]?.text ?? ''), result, readOnly, untrusted, via } })
      return result
    } catch (err) {
      const ms = performance.now() - startedAt
      const message = err instanceof Error ? err.message : String(err)
      this.inFlight--
      this.emit({ type: 'call', record: { id, set, tool: spec.name, args, startedAt, ms, ok: false, summary: clip(message), error: message, readOnly, untrusted, via } })
      // Guiding errors: never throw at the engine; return a message the agent can act on.
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  }
}

/**
 * Chrome 152 destroys the result of a tool call whose tool is unregistered
 * synchronously (or in a microtask) during its own execute(), rejecting with a
 * "transient" UnknownError. Aborting on the next task is safe. Every abort in
 * this module goes through here so a belt's final tool can end the belt.
 */
function deferAbort(controller: AbortController | null | undefined): void {
  if (!controller) return
  setTimeout(() => controller.abort(), 0)
}

function nextTask(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

function clip(s: string, n = 160): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}
