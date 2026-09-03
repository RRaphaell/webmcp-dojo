// Shareable report cards with no backend: the result is encoded in the URL
// fragment (never sent to a server), compact enough to paste anywhere.

import type { BeltResult } from './belts/types'

export interface ReportCard {
  /** Payload version. Links from an older version decode to null and the page says so. */
  v: 2
  /** ISO time the run finished. */
  at: string
  /** Free text the human typed for the agent name, e.g. "ChatGPT (Sol)". */
  agent: string
  engine: 'native' | 'shim'
  /** True when any call on this run was made by a person through the inspector rather than by an agent. */
  hand?: boolean
  /** True when the calls came from the recorded-run replay (a real transcript executed for real, but not a live agent). */
  replay?: boolean
  results: BeltResult[]
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function encodeReport(card: ReportCard): string {
  const compact = {
    v: card.v, at: card.at, agent: card.agent, engine: card.engine, hand: card.hand ? 1 : 0, replay: card.replay ? 1 : 0,
    r: card.results.map((r) => [r.id, r.pass ? 1 : 0, r.calls, Math.round(r.ms), r.note, r.honors ?? [], r.marks ?? [], r.safetyFailure ?? '', r.checks.map((c) => [c.label, c.pass ? 1 : 0, c.evidence === 'human-attested' ? 'h' : c.evidence === 'tool-observed' ? 't' : ''])]),
  }
  return toBase64Url(new TextEncoder().encode(JSON.stringify(compact)))
}

export function decodeReport(fragment: string, names: Record<string, string>): ReportCard | null {
  try {
    const json = JSON.parse(new TextDecoder().decode(fromBase64Url(fragment)))
    if (json?.v !== 2 || !Array.isArray(json.r)) return null
    return {
      v: 2, at: String(json.at), agent: String(json.agent ?? ''), engine: json.engine === 'native' ? 'native' : 'shim', hand: json.hand === 1, replay: json.replay === 1,
      results: json.r.map((row: unknown[]) => ({
        id: String(row[0]), name: names[String(row[0])] ?? String(row[0]), pass: row[1] === 1, calls: Number(row[2]), ms: Number(row[3]), note: String(row[4] ?? ''),
        honors: Array.isArray(row[5]) ? (row[5] as unknown[]).map(String) : [],
        marks: Array.isArray(row[6]) ? (row[6] as unknown[]).map(String) : [],
        ...(typeof row[7] === 'string' && row[7] ? { safetyFailure: row[7] } : {}),
        checks: Array.isArray(row[8]) ? (row[8] as unknown[][]).map((c) => ({ label: String(c[0]), pass: c[1] === 1, ...(c[2] === 'h' ? { evidence: 'human-attested' as const } : c[2] === 't' ? { evidence: 'tool-observed' as const } : {}) })) : [],
      })),
    }
  } catch {
    return null
  }
}

export function reportUrl(card: ReportCard): string {
  const u = new URL(location.href)
  // Keep the run mode in the link so a reload or "Run again" lands in the same mode.
  const keep = new URLSearchParams()
  for (const k of ['quick', 'seed', 'static', 'compat']) { const v = new URLSearchParams(location.search).get(k); if (v) keep.set(k, v) }
  u.search = keep.toString() ? '?' + keep.toString() : ''
  u.hash = '#card=' + encodeReport(card)
  return u.toString()
}

export function readReportFromUrl(names: Record<string, string>): ReportCard | null {
  const m = location.hash.match(/^#card=([A-Za-z0-9_-]+)/)
  return m ? decodeReport(m[1], names) : null
}
