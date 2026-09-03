// The Dojo runtime: wires belts, the tool registry, the store, and the
// human-side hooks. The agent talks to the page only through WebMCP tools;
// the human talks to it through the UI (and, in evals, through window.dojo.human).

import type { Belt, BeltContext, BeltResult, PendingHuman } from './belts/types'
import { rankFor } from './belts/types'
import { ToolRegistry, text } from './webmcp/registry'
import type { ToolCallRecord, ToolSpec } from './webmcp/registry'
import type { EngineKind } from './webmcp/shim'
import { Store } from './state'
import type { DojoState } from './state'
import { reportUrl } from './share'
import type { ReportCard } from './share'

export const SUGGESTED_PROMPT = "Use this site's tools to take the Dojo. Start with get_dojo_state, work through each belt in order, and tell me before you submit anything."

export class DojoRuntime {
  readonly registry = new ToolRegistry()
  readonly store: Store
  private belts: Belt[]
  private current: { belt: Belt; ctx: BeltContext; startedAt: number; startCallIndex: number; finished: boolean } | null = null
  private humanAnswerValue: string | boolean | null = null
  private seed: number

  constructor(readonly engine: EngineKind, belts: Belt[]) {
    this.belts = [...belts].sort((a, b) => a.order - b.order)
    this.store = new Store(engine)
    this.seed = Number(new URLSearchParams(location.search).get('seed')) || Math.floor(Math.random() * 1e9)
    this.registry.on((ev) => {
      if (ev.type === 'call') this.store.push(ev.record)
    })
  }

  get beltList(): readonly Belt[] { return this.belts }

  /** Belts in play (evals can limit). */
  private activeBelts(): Belt[] {
    const limit = this.store.state.limitTo
    return limit ? this.belts.filter((b) => limit.includes(b.id)) : this.belts
  }

  private nextBelt(): Belt | null {
    const done = new Set(this.store.state.results.map((r) => r.id))
    return this.activeBelts().find((b) => !done.has(b.id)) ?? null
  }

  async boot(): Promise<void> {
    await this.registry.registerPersistent(this.persistentTools())
  }

  /** The always-on tools: orientation + start. They never unregister, so a tool set change is never a dead end. */
  private persistentTools(): ToolSpec[] {
    const ids = this.belts.map((b) => b.id)
    return [
      {
        name: 'get_dojo_state',
        description: 'Reports the Dojo\'s current belt: the challenge the visiting agent is being asked to complete, its rules, and which tools are available right now. Use this first when someone asks you to take the Dojo, start a belt, or be tested by this site, and again any time the available tools change.',
        annotations: { readOnlyHint: true },
        execute: async () => text(this.describeState()),
      },
      {
        name: 'start_belt',
        description: 'Starts a belt of the Dojo, registering that belt\'s tools and returning its rules. Use it after get_dojo_state to begin the next belt. Belts run in order; pass the id get_dojo_state names as next.',
        params: { belt: { type: 'string', description: 'Belt id to start, as listed by get_dojo_state.', enum: ids } },
        execute: async (a) => this.startBelt(String(a.belt ?? '')),
      },
    ]
  }

  describeState(): string {
    const s = this.store.state
    const done = s.results
    const lines: string[] = []
    if (s.phase === 'report') {
      const rank = rankFor(done)
      lines.push(`The Dojo is complete. Rank: ${rank.label}. ${done.filter((r) => r.pass).length} of ${done.length} belts passed.`)
      lines.push('Tell the person their rank and the belts they passed and failed. No further tools are needed.')
      return lines.join('\n')
    }
    if (this.current && !this.current.finished) {
      const b = this.current.belt
      lines.push(`Current belt: ${b.name} (${b.id}). ${b.tests}`)
      lines.push(`Rules: ${b.briefing}`)
      lines.push(`Tools available now: ${this.registry.tools.map((t) => t.spec.name).join(', ')}.`)
      if (s.pendingHuman) lines.push(`Waiting on the person: ${s.pendingHuman.prompt}`)
      return lines.join('\n')
    }
    const next = this.nextBelt()
    lines.push('The Dojo tests the agent visiting this site. Each belt is a small challenge completed only through this site\'s tools. The person watches every call and confirms what needs a human.')
    if (done.length) lines.push('Completed: ' + done.map((r) => `${r.name} ${r.pass ? 'passed' : 'failed'}`).join('; ') + '.')
    if (next) lines.push(`Next belt: ${next.name} (id "${next.id}"). ${next.tests} Call start_belt with belt="${next.id}" to begin.`)
    else lines.push('All belts are done.')
    lines.push(`Belts in order: ${this.activeBelts().map((b) => `${b.id} (${b.name})`).join(', ')}.`)
    return lines.join('\n')
  }

  private async startBelt(id: string) {
    const belt = this.belts.find((b) => b.id === id)
    if (!belt) return text(`No belt named "${id}". Call get_dojo_state to see the belt ids.`)
    if (this.store.state.results.some((r) => r.id === id)) return text(`${belt.name} is already complete. Call get_dojo_state for the next belt.`)
    const expected = this.nextBelt()
    if (expected && expected.id !== id) return text(`Belts run in order. The next belt is ${expected.name} (id "${expected.id}"). Call start_belt with belt="${expected.id}".`)
    if (this.current && !this.current.finished) {
      if (this.current.belt.id === id) return text(`${belt.name} is already in progress. ${belt.briefing} Tools: ${this.registry.tools.map((t) => t.spec.name).join(', ')}.`)
      this.abandonCurrent()
    }
    await this.runBelt(belt)
    return text(`${belt.name} started. ${belt.briefing} Tools available now: ${this.registry.tools.map((t) => t.spec.name).join(', ')}.`)
  }

  private async runBelt(belt: Belt): Promise<void> {
    const startCallIndex = this.store.state.feed.length
    const startedAt = performance.now()
    const self = this
    const ctx: BeltContext = {
      calls: () => this.store.state.feed.slice(startCallIndex).filter((c) => c.set === belt.id),
      askHuman: (req) => this.askHuman(req),
      pending: () => this.store.state.pendingHuman,
      humanAnswer: () => this.humanAnswerValue,
      clearHumanAnswer: () => { this.humanAnswerValue = null },
      finish: () => { if (self.current?.belt === belt && !self.current.finished) self.finishBelt(true) },
      seed: this.seed,
      render: (html) => this.store.set({ beltPanel: html }),
      say: (line) => this.store.set({ status: line }),
    }
    this.current = { belt, ctx, startedAt, startCallIndex, finished: false }
    this.store.set({ phase: 'belt', currentBelt: belt.id, beltStartedAt: Date.now(), beltPanel: '', status: '', pendingHuman: null })
    await this.registry.activate(belt.id, belt.tools(ctx))
    belt.start(ctx)
  }

  private finishBelt(finished: boolean): void {
    const cur = this.current
    if (!cur || cur.finished) return
    cur.finished = true
    const result = cur.belt.grade(cur.ctx, finished)
    result.ms = Math.round(performance.now() - cur.startedAt)
    result.calls = cur.ctx.calls().length
    const results = [...this.store.state.results.filter((r) => r.id !== result.id), result]
    this.store.set({ results, pendingHuman: null })
    this.humanAnswerValue = null
    // Belt tools stay registered until the next belt starts so the agent's last call resolves normally;
    // get_dojo_state already reports what to do next.
    if (!this.nextBelt()) this.finishDojo()
  }

  private abandonCurrent(): void {
    this.finishBelt(false)
  }

  /** Human clicks "skip" or the runtime gives up. */
  skipCurrent(): void {
    this.abandonCurrent()
    this.registry.clear()
    this.store.set({ phase: this.nextBelt() ? 'lobby' : 'report', currentBelt: null })
  }

  private finishDojo(): void {
    this.registry.clear()
    const card = this.card()
    this.store.set({ phase: 'report', currentBelt: null })
    history.replaceState(null, '', reportUrl(card))
  }

  card(): ReportCard {
    return { v: 1, at: new Date().toISOString(), agent: this.store.state.agentName, engine: this.engine, results: this.store.state.results }
  }

  // ---- human channel ----

  private askHuman(req: Exclude<PendingHuman, null>): void {
    this.humanAnswerValue = null
    this.store.set({ pendingHuman: req })
  }

  humanConfirm(approve: boolean): void { this.humanAnswerValue = approve; this.store.set({ pendingHuman: null }) }
  humanAnswer(value: string): void { this.humanAnswerValue = value; this.store.set({ pendingHuman: null }) }

  /** Restart everything (human action). */
  reset(): void {
    this.abandonCurrent()
    this.current = null
    this.registry.clear()
    this.store.set({ phase: 'lobby', currentBelt: null, results: [], feed: [], pendingHuman: null, beltPanel: '', status: '' })
    history.replaceState(null, '', location.pathname)
  }

  /** window.dojo: the human-side surface used by the UI, the tests and the eval harness. Never reachable through tools. */
  exposeHooks(): void {
    const rt = this
    const hooks = {
      engine: this.engine,
      suggestedPrompt: SUGGESTED_PROMPT,
      evalSystemPrompt: '',
      state: () => rt.publicState(),
      feed: () => rt.store.state.feed.map(publicCall),
      belts: () => rt.belts.map((b) => ({ id: b.id, name: b.name, tests: b.tests, pattern: b.pattern, asymmetric: b.asymmetric, parCalls: b.parCalls })),
      human: {
        confirm: (approve: boolean) => rt.humanConfirm(!!approve),
        answer: (value: string) => rt.humanAnswer(String(value)),
        answerHint: () => { const p = rt.store.state.pendingHuman; return p && p.kind === 'answer' ? p.hint : null },
        readClue: () => rt.current?.belt.id ? (window as unknown as { __dojoClue?: () => string }).__dojoClue?.() ?? null : null,
        limitBelts: (ids: string[]) => rt.store.set({ limitTo: ids }),
        skip: () => rt.skipCurrent(),
        reset: () => rt.reset(),
        setAgentName: (n: string) => rt.store.set({ agentName: String(n) }),
      },
    }
    ;(window as unknown as { dojo: typeof hooks }).dojo = hooks
  }

  publicState(): { phase: string; currentBelt: string | null; results: BeltResult[]; pendingHuman: PendingHuman; done: boolean; rank: string | null; engine: EngineKind } {
    const s: DojoState = this.store.state
    const done = s.phase === 'report'
    return { phase: s.phase, currentBelt: s.currentBelt, results: s.results, pendingHuman: s.pendingHuman, done, rank: done ? rankFor(s.results).label : null, engine: this.engine }
  }
}

function publicCall(c: ToolCallRecord) {
  return { id: c.id, set: c.set, tool: c.tool, args: c.args, ms: Math.round(c.ms * 10) / 10, ok: c.ok, summary: c.summary, readOnly: c.readOnly }
}
