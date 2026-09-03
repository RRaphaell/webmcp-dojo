export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (html) e.innerHTML = html
  return e
}

export function fmtArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args ?? {}).map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v.length > 40 ? v.slice(0, 39) + '…' : v) : JSON.stringify(v)}`)
  return parts.length ? parts.join(', ') : ''
}

export function fmtMs(ms: number): string {
  return ms < 1 ? '<1 ms' : ms < 100 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}
