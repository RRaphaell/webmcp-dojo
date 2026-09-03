// Watch a recorded run: a real transcript (a Claude model driving the page in
// real Chrome, seed 7) is replayed against the live page. Every tool call is
// executed for real through the same registry the agent hit, so the feed, the
// page-side times, the human events and the final card are genuine, not
// staged. The human's actions are performed through the same hooks the
// buttons call. Always labelled as a recording.

import type { DojoRuntime } from './runtime'

interface Recorded {
  model: string
  seed: number
  date: string
  rank: string
  steps: ({ kind: 'tool'; name: string; input: Record<string, unknown> } | { kind: 'agent'; text: string } | { kind: 'human'; text: string })[]
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function loadRecording(): Promise<Recorded | null> {
  try {
    const res = await fetch('/recorded-run.json')
    if (!res.ok) return null
    const rec = (await res.json()) as Recorded
    // Agent prose is shown in the feed. Markdown marks and dashes are not part of the site's voice.
    rec.steps = rec.steps
      .filter((s) => !(s.kind === 'agent' && /\|---/.test(s.text)))
      .map((s) => (s.kind === 'agent' ? { ...s, text: s.text.replace(/\*\*/g, '').replace(/\s+[\u2014\u2013]\s+/g, ', ').replace(/[\u2014\u2013]/g, ', ').replace(/^#+\s*/gm, '').replace(/\|/g, ' ') } : s))
    return rec
  } catch {
    return null
  }
}

/** Replays the recording. Returns when the run reaches the report card or the steps run out. */
let token = 0

/** Stops a running replay at its next step (a person pressed Skip, Run again, or the brand link). */
export function stopReplay(): void { token++ }

/** True while a recording is playing. */
export function replaying(): boolean { return active }
let active = false

export async function replay(rt: DojoRuntime, rec: Recorded, speed = 1, onStep?: (i: number, total: number) => void): Promise<void> {
  if (active) return
  // The replayed human presses controls with script-dispatched events, which are not trusted. The
  // flag that lets those through is set only while the recording plays and is cleared on the way out,
  // so a real session after the replay is gated on isTrusted again.
  const w = window as unknown as { __dojoAllowSynthetic?: boolean }
  w.__dojoAllowSynthetic = true
  active = true
  const mine = ++token
  try {
    await play(rt, rec, speed, mine, onStep)
  } finally {
    active = false
    delete w.__dojoAllowSynthetic
  }
}

async function play(rt: DojoRuntime, rec: Recorded, speed: number, mine: number, onStep?: (i: number, total: number) => void): Promise<void> {
  rt.store.set({ agentName: `${rec.model} (recorded ${rec.date})`, recording: `${rec.model}, ${rec.date}` })
  const total = rec.steps.length
  let skipped = 0
  for (const [i, step] of rec.steps.entries()) {
    if (token !== mine) return
    onStep?.(i, total)
    if (rt.store.state.phase === 'report') break
    if (step.kind === 'agent') {
      rt.store.event({ kind: 'agent', at: performance.now(), text: step.text.replace(/\s+/g, ' ').slice(0, 140) })
      await wait(500 / speed)
      continue
    }
    if (step.kind === 'human') {
      if (rt.store.state.pendingHuman) { await playHuman(rt); await wait(600 / speed) }
      continue
    }
    // A human-only value (the seal code) is generated fresh on every reveal, so the recording's
    // value cannot match. The replayed human relays what they just revealed, as the live human did.
    const input = { ...step.input }
    const clue = (window as unknown as { dojo?: { human: { readClue: () => string | null } } }).dojo?.human.readClue()
    if (clue) for (const [k, v] of Object.entries(input)) if (typeof v === 'string' && /^[A-Z0-9]{5}$/i.test(v)) input[k] = clue
    try {
      await rt.registry.invoke(step.name, input, 'replay')
      skipped = 0
    } catch {
      // A tool that is not registered at this point in the replay is skipped once or twice (the agent may have
      // retried); three in a row means the page and the recording have diverged, and the replay says so.
      if (++skipped >= 3) { rt.store.set({ status: 'the recording does not match this run; replay stopped' }); return }
    }
    await wait(700 / speed)
  }
}

async function playHuman(rt: DojoRuntime): Promise<void> {
  const p = rt.store.state.pendingHuman
  if (!p) return
  if (p.kind === 'confirm') { rt.humanConfirm(true); return }
  if (p.kind === 'answer' && p.control) {
    const el = document.querySelector<HTMLElement>(p.control)
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return
  }
  if (p.kind === 'answer') { rt.humanAnswer(p.hint); return }
  if (p.kind === 'clue' && p.control) {
    const el = document.querySelector<HTMLElement>(p.control)
    if (!el) return
    const r = el.getBoundingClientRect()
    const opts = { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 1, isPrimary: true }
    el.dispatchEvent(new PointerEvent('pointerdown', opts))
    await wait((p.holdMs ?? 1200) + 200)
    el.dispatchEvent(new PointerEvent('pointerup', opts))
  }
}
