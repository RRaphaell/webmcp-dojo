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
    return (await res.json()) as Recorded
  } catch {
    return null
  }
}

/** Replays the recording. Returns when the run reaches the report card or the steps run out. */
export async function replay(rt: DojoRuntime, rec: Recorded, speed = 1, onStep?: (i: number, total: number) => void): Promise<void> {
  ;(window as unknown as { __dojoAllowSynthetic?: boolean }).__dojoAllowSynthetic = true
  rt.store.set({ agentName: `${rec.model} (recorded ${rec.date})` })
  const total = rec.steps.length
  for (const [i, step] of rec.steps.entries()) {
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
      await rt.registry.invoke(step.name, input)
    } catch {
      /* a tool that is not registered at this point in the replay is skipped */
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
