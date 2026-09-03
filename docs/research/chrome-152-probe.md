# Ground truth: `document.modelContext` in real Chrome 152 (probed Sep 3 2026, 00:40 PT)

Probed with Playwright driving the installed Google Chrome 152.0.7977.66 (`channel: 'chrome'`). Scripts: `../../probe/flag_probe.mjs`, `api_probe.mjs`, `api_probe2.mjs` (kept outside the repo).

## Enabling it for automated tests

Any of these launch switches expose the API (no chrome://flags UI needed):
- `--enable-features=WebMCP` (use this one)
- `--enable-features=WebMCPTesting`, `--enable-blink-features=WebMCP`, `--enable-experimental-web-platform-features` also work.
- Playwright's bundled Chromium was not tested; the installed Chrome channel is what our harness uses.

Without a switch: `typeof document.modelContext === 'undefined'`. `navigator.modelContext` is never defined (the July 2026 rename to `document.modelContext` is real).

## API surface (prototype of `document.modelContext`)

`registerTool`, `getTools`, `executeTool`, `ontoolchange` (+ `addEventListener('toolchange')`). No `unregisterTool`, no `provideContext`, no `clearContext`.

## Observed semantics

| Call | Behavior |
|---|---|
| `registerTool(desc, { signal })` | Returns a **Promise**. Resolves on success. **Rejects `InvalidStateError: Duplicate tool name`** if the name is already registered. Fires `toolchange`. |
| `desc.inputSchema` | Must be an object (or omitted). A non-object throws `TypeError ... Failed to convert value to 'object'`. |
| `desc.title` | Accepted and stored. |
| `desc.annotations` | Only **`readOnlyHint`** and **`untrustedContentHint`** are kept. `destructiveHint`, `idempotentHint`, `openWorldHint`, unknown keys are dropped silently. |
| `signal.abort()` | Unregisters the tool(s) bound to that signal. Fires `toolchange`. This is the only way to unregister. |
| `getTools()` | Returns an **Array** of `RegisteredTool` objects with own props `name, title, description, inputSchema, annotations, origin, window`. **`inputSchema` comes back as a JSON string**, not an object. |
| `executeTool(tool, args)` | `tool` must be a `RegisteredTool` from `getTools()` (a name string throws TypeError). **`args` must be a JSON string** (`'{"text":"hi"}'`); passing an object throws `UnknownError: Failed to parse input arguments`. The page's `execute()` receives the parsed object. |
| `executeTool` return | **Always a string**: if `execute` returned an object it is `JSON.stringify`'d; if it returned a string it is returned as-is. |
| `execute` throws | `executeTool` rejects with `UnknownError: Tool was executed but the invocation failed...`. |
| Async `execute` | Awaited correctly (120 ms delay returned fine). |

## Implications for the Dojo

- Our page code only relies on `registerTool` + `AbortSignal` unregister + `toolchange` (shared with ChatGPT's implementation). `getTools`/`executeTool` are used only by our built-in inspector and the Playwright harness, and both fall back to our own in-page registry if they are absent on a given engine.
- The dev shim must mirror: promise-returning `registerTool`, duplicate-name rejection, string-only `executeTool` args and string return, `inputSchema` serialized as a string in `getTools()`.
- Return `{ content: [{ type: 'text', text }] }` from every `execute` (the MCP shape ChatGPT documents); the engine passes it through untouched.
- Each belt's tool set gets one `AbortController`; switching belts aborts the old controller and registers the new set. That is dynamic registration, verified to fire `toolchange` on both register and abort.
