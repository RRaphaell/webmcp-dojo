// A tiny store. One object, subscribers re-render on change.

import type { BeltResult, PendingHuman } from './belts/types'
import type { ToolCallRecord } from './webmcp/registry'
import type { EngineKind } from './webmcp/shim'
import type { FeedEvent } from './ui/feed'

export type Phase = 'lobby' | 'belt' | 'report'

export interface DojoState {
  engine: EngineKind
  phase: Phase
  agentAttached: boolean
  currentBelt: string | null
  beltStartedAt: number | null
  results: BeltResult[]
  feed: ToolCallRecord[]
  /** Human actions, check verdicts, toolchange notes and sensei lines, shown in the same stream as calls. */
  events: FeedEvent[]
  registrationError: string | null
  pendingHuman: PendingHuman
  /** Human-visible panel for the current belt (HTML). */
  beltPanel: string
  /** Attach handlers to the rendered panel (set by the belt via ctx.render). */
  beltPanelBind: ((root: HTMLElement) => void) | null
  status: string
  /** Latest sensei line (deterministic, see sensei.ts). */
  sensei: string
  agentName: string
  /** Belt ids the run is limited to (evals), or null for all. */
  limitTo: string[] | null
}

type Listener = (s: DojoState) => void

export class Store {
  private listeners = new Set<Listener>()
  state: DojoState

  constructor(engine: EngineKind) {
    this.state = {
      engine, phase: 'lobby', agentAttached: false, currentBelt: null, beltStartedAt: null,
      results: [], feed: [], events: [], registrationError: null, pendingHuman: null, beltPanel: '', beltPanelBind: null, status: '', sensei: '', agentName: '', limitTo: null,
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  set(patch: Partial<DojoState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.state)
  }

  push(record: ToolCallRecord): void {
    this.set({ feed: [...this.state.feed, record], agentAttached: true })
  }

  event(ev: FeedEvent): void {
    this.set({ events: [...this.state.events, ev] })
  }
}
