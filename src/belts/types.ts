// The belt contract. A belt is one self-contained challenge: it owns a tool
// set (registered dynamically when the belt starts, unregistered when it
// ends), a verifier, and a description of the human's role. The page is the
// examiner: it knows the right answer, watches the calls, and grades.

import type { ToolSpec } from '../webmcp/registry'
import type { ToolCallRecord } from '../webmcp/registry'

export type Pattern =
  | 'read-only'
  | 'navigation'
  | 'write-with-confirm'
  | 'injection-trap'
  | 'ambiguity'
  | 'error-recovery'
  | 'efficiency'
  | 'asymmetric-human-clue'

export type PendingHuman =
  | { kind: 'confirm'; prompt: string; detail?: string }
  | { kind: 'answer'; prompt: string; hint: string }
  | { kind: 'clue'; prompt: string }
  | null

export interface BeltResult {
  id: string
  name: string
  pass: boolean
  /** 0-100, the belt's own scale. */
  score: number
  calls: number
  ms: number
  /** Short, concrete, human-readable verdict line. */
  note: string
  /** Named checks with pass/fail, shown on the report card. */
  checks: { label: string; pass: boolean }[]
}

/** Everything a belt may touch. Created fresh per run. */
export interface BeltContext {
  /** Calls made so far in this belt (the feed, filtered). */
  calls: () => ToolCallRecord[]
  /** Ask the human for something the agent cannot get through tools. Resolves when the human acts. */
  askHuman: (req: Exclude<PendingHuman, null>) => Promise<string | boolean>
  /** Current pending human request, if any. */
  pending: () => PendingHuman
  /** Mark the belt finished; the runtime computes the result via belt.grade(). */
  finish: () => void
  /** Deterministic seed for the run (from URL or random), so evals can replay. */
  seed: number
  /** Update the human-visible belt panel (HTML string, already escaped by the belt). */
  render: (html: string) => void
  /** Show a transient status line to the human. */
  say: (line: string) => void
}

export interface Belt {
  id: string
  /** e.g. "White belt". */
  name: string
  /** Rank order, 1 = first. */
  order: number
  /** One line: what this belt tests, in plain words. */
  tests: string
  pattern: Pattern
  /** What the human does during this belt (shown on screen). */
  humanRole: string
  /** True if the agent cannot finish without the human contributing something outside the tools. */
  asymmetric: boolean
  /** Minimum number of calls a competent agent needs. Used for the efficiency check. */
  parCalls: number
  /** Build the belt's tools. Called on start; tools are registered until the belt ends. */
  tools: (ctx: BeltContext) => ToolSpec[]
  /** Called right after the tools are registered. Sets up state and the human-visible panel. */
  start: (ctx: BeltContext) => void
  /** Produce the result. Called once the belt reports finished (or on abandon). */
  grade: (ctx: BeltContext, finished: boolean) => BeltResult
  /** Human-facing instructions the belt wants shown before the agent starts. */
  briefing: string
}

export type Rank = 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'brown' | 'black'

export function rankFor(results: BeltResult[]): { rank: Rank; label: string } {
  const passed = results.filter((r) => r.pass).length
  const table: [number, Rank, string][] = [
    [0, 'white', 'White belt'],
    [1, 'yellow', 'Yellow belt'],
    [2, 'orange', 'Orange belt'],
    [3, 'green', 'Green belt'],
    [4, 'blue', 'Blue belt'],
    [6, 'brown', 'Brown belt'],
    [8, 'black', 'Black belt'],
  ]
  let out = table[0]
  for (const row of table) if (passed >= row[0]) out = row
  return { rank: out[1], label: out[2] }
}
