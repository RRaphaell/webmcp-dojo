// Shareable report cards with no backend: the result is encoded in the URL
// fragment (never sent to a server), compact enough to paste anywhere.

import type { BeltResult } from './belts/types'

export interface ReportCard {
  v: 1
  /** ISO time the run finished. */
  at: string
  /** Free text the human typed for the agent name, e.g. "ChatGPT (Sol)". */
  agent: string
  engine: 'native' | 'shim'
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
    v: card.v, at: card.at, agent: card.agent, engine: card.engine,
    r: card.results.map((r) => [r.id, r.pass ? 1 : 0, r.score, r.calls, Math.round(r.ms), r.note, r.checks.map((c) => [c.label, c.pass ? 1 : 0])]),
  }
  return toBase64Url(new TextEncoder().encode(JSON.stringify(compact)))
}

export function decodeReport(fragment: string, names: Record<string, string>): ReportCard | null {
  try {
    const json = JSON.parse(new TextDecoder().decode(fromBase64Url(fragment)))
    if (json?.v !== 1 || !Array.isArray(json.r)) return null
    return {
      v: 1, at: String(json.at), agent: String(json.agent ?? ''), engine: json.engine === 'native' ? 'native' : 'shim',
      results: json.r.map((row: unknown[]) => ({
        id: String(row[0]), name: names[String(row[0])] ?? String(row[0]), pass: row[1] === 1, score: Number(row[2]), calls: Number(row[3]), ms: Number(row[4]), note: String(row[5] ?? ''),
        checks: Array.isArray(row[6]) ? (row[6] as unknown[][]).map((c) => ({ label: String(c[0]), pass: c[1] === 1 })) : [],
      })),
    }
  } catch {
    return null
  }
}

export function reportUrl(card: ReportCard): string {
  const u = new URL(location.href)
  u.search = ''
  u.hash = '#card=' + encodeReport(card)
  return u.toString()
}

export function readReportFromUrl(names: Record<string, string>): ReportCard | null {
  const m = location.hash.match(/^#card=([A-Za-z0-9_-]+)/)
  return m ? decodeReport(m[1], names) : null
}
