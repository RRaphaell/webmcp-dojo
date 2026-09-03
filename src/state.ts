// A tiny store. One object, subscribers re-render on change.

import type { BeltResult, PendingHuman } from './belts/types'
import type { ToolCallRecord } from './webmcp/registry'
import type { EngineKind } from './webmcp/shim'

export type Phase = 'lobby' | 'belt' | 'report'

export interface DojoState {
  engine: EngineKind
  phase: Phase
  agentAttached: boolean
  currentBelt: string | null
  beltStartedAt: number | null
  results: BeltResult[]
  feed: ToolCallRecord[]
  pendingHuman: PendingHuman
  /** Human-visible panel for the current belt (HTML). */
  beltPanel: string
  status: string
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
      results: [], feed: [], pendingHuman: null, beltPanel: '', status: '', agentName: '', limitTo: null,
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
}
