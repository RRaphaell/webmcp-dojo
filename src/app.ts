// Placeholder app entry until docs/DESIGN.md lands. Replaced in the build phase.
import type { EngineKind } from './webmcp/shim'

export function boot(engine: EngineKind): void {
  const root = document.getElementById('app')!
  root.innerHTML = `<main style="font-family:var(--sans);padding:48px;max-width:720px;margin:0 auto">
    <p style="font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)">the dojo · engine: ${engine}</p>
    <h1 style="font-weight:900;letter-spacing:.02em;font-size:40px;margin:12px 0">A website that tests the agent visiting it.</h1>
    <p style="color:var(--muted)">Building. Come back in a few hours.</p>
  </main>`
}
