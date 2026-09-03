// Tool inspector: the human-only view of what the agent can see and do right
// now. Lists every registered tool with its description and schema, and lets a
// person run a tool by hand. Works with no agent attached.

import type { ToolRegistry } from '../webmcp/registry'
import { esc } from './dom'

export function renderInspector(container: HTMLElement, registry: ToolRegistry): void {
  const tools = registry.tools
  if (!tools.length) {
    container.innerHTML = '<p class="muted">No tools registered.</p>'
    return
  }
  container.innerHTML = tools.map((t, i) => {
    const params = Object.entries(t.spec.params ?? {})
    const ann = [t.spec.annotations?.readOnlyHint ? 'readOnlyHint' : '', t.spec.annotations?.untrustedContentHint ? 'untrustedContentHint' : ''].filter(Boolean)
    return `<details class="tool-card" ${i === 0 ? 'open' : ''}>
      <summary><code>${esc(t.spec.name)}</code> <span class="muted mono">${esc(t.set)}</span>${ann.map((a) => `<span class="ann">${a}</span>`).join('')}</summary>
      <p class="desc">${esc(t.spec.description)}</p>
      ${params.length ? `<form class="run" data-tool="${esc(t.spec.name)}">
        ${params.map(([k, v]) => `<label><span class="mono">${esc(k)}</span> <span class="muted">${esc(v.description)}</span>
          ${v.enum ? `<select name="${esc(k)}"><option value="">-</option>${v.enum.map((o) => `<option>${esc(o)}</option>`).join('')}</select>` : `<input name="${esc(k)}" data-type="${v.type}" placeholder="${v.type}">`}
        </label>`).join('')}
        <button type="submit">Run by hand</button>
        <pre class="result" hidden></pre>
      </form>` : `<form class="run" data-tool="${esc(t.spec.name)}"><button type="submit">Run by hand</button><pre class="result" hidden></pre></form>`}
    </details>`
  }).join('')

  container.querySelectorAll<HTMLFormElement>('form.run').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const name = form.dataset.tool!
      const args: Record<string, unknown> = {}
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach((inp) => {
        if (inp.value === '') return
        const type = (inp as HTMLInputElement).dataset?.type
        args[inp.name] = type === 'number' || type === 'integer' ? Number(inp.value) : type === 'boolean' ? inp.value === 'true' : inp.value
      })
      const out = form.querySelector<HTMLPreElement>('.result')!
      out.hidden = false
      out.textContent = '…'
      try {
        const res = await registry.invoke(name, args)
        out.textContent = res.content.map((c) => c.text).join('\n')
      } catch (err) {
        out.textContent = String(err)
      }
    })
  })
}
