# Reference code study + ready-to-use scaffold for The Dojo

Read after `docs/CONTEXT.md`. Everything below was read from source on Sep 3 2026, 00:2x PT. Every snippet is verbatim from the cited file unless the heading says "ours".

## Sources actually read

| Source | What it is | How it was read |
|---|---|---|
| `cloudflare/agents` `examples/webmcp-react` | React + Workers WebMCP starter. `package.json`, `wrangler.jsonc`, `vite.config.ts`, `src/useWebMCPTools.ts`, `src/webmcp.d.ts`, `src/App.tsx`, `src/App.test.tsx`, `src/schemas.ts`, `src/server.ts`, `.mcp.json`, `README.md` | `gh api` tree + `raw.githubusercontent.com/cloudflare/agents/main/examples/webmcp-react/...` |
| `sdras/webmcp-demo` | Judge Sarah Drasner's own demo. Whole repo is 4 files: `index.html`, `styles.css`, `app.js` (752 lines), `README.md`. **Vanilla, no build step.** | raw.githubusercontent |
| `GoogleChromeLabs/webmcp-tools` | Chrome's demo collection. Read `demos/shared/webmcp-polyfill.js` (572 lines, **the reference implementation of the API surface**), `demos/shared/webmcp-batch.js`, `demos/pizza-maker/script.js`, `demos/real-estate-map/mcp.js`, `demos/page-agent/script.js`, `demos/doors/README.md`, `.github/workflows/deploy.yml` | `gh api` tree + raw |
| npm `use-webmcp-tool` | v0.2.0, published 2026-07-30, Apache-2.0, repo `GoogleChromeLabs/use-webmcp-tool`, peer `react >=18`, **zero runtime deps**. README fetched from the npm registry JSON (npmjs.com returns 403 to WebFetch; use `curl -s https://registry.npmjs.org/use-webmcp-tool`) | registry.npmjs.org |
| developer.chrome.com/docs/ai/webmcp/{imperative-api, secure-tools} | Signatures and the security budgets | WebFetch |
| developers.cloudflare.com/workers/wrangler/configuration/ | assets-only Worker config | WebFetch |

---

# (a) The patterns, with verbatim snippets

## A1. The canonical registration call

From the `use-webmcp-tool` README (Chrome-maintained), this is the raw imperative API stated plainly:

```js
const controller = new AbortController();

document.modelContext.registerTool({
  name: "add-todo",
  description: "Add a new item to the user's active todo list",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text content of the todo item" },
    },
    required: ["text"],
  },
  async execute({ text }) {
    await addTodoItemToCollection(text);
    return { content: [{ type: "text", text: `Added todo item: "${text}" successfully.` }] };
  },
}, { signal: controller.signal });

// Unregister later:
controller.abort();
```

That README also carries a dated accuracy note we should mirror in our README:

> **Status / accuracy note (2026-06-05):** Built against the current WebMCP spec, which exposes the imperative API on **`document.modelContext`** (`registerTool` + an `AbortSignal` for unregistration).

Chrome's imperative-api doc gives the fuller signature, including two options `CONTEXT.md` does not mention:

```javascript
await document.modelContext.registerTool({ ... }, { signal?: AbortSignal, exposedTo?: string[] })
const tools  = await document.modelContext.getTools({ fromOrigins?: string[] })
const result = await document.modelContext.executeTool(tool, jsonString, { signal?: AbortSignal })
document.modelContext.addEventListener("toolchange", (event) => {})
```

Note `execute` also receives a second argument: Chrome documents `execute: async (params, { signal }) => {...}`.

`getTools()` returns an "alphabetically ordered list of tools" whose entries carry `name`, `description`, `inputSchema`, `annotations`, `origin`, `title`, `window`. **`executeTool` takes the tool object, not the name.** That matters for our evals harness and inspector (see A9).

Chrome's doc: "As of Chrome 153, you can unregister a tool without cancelling and breaking in-flight executions" via `AbortController.abort()`.

`exposedTo` is real and in use. `demos/pizza-maker/script.js`:

```js
const toolOptions = { exposedTo: ["http://localhost:8080", "http://127.0.0.1:8080", "https://chrome.dev"] };
document.modelContext.registerTool({ name: 'set_pizza_size', ... }, toolOptions);
```

**Decision for the Dojo: do NOT pass `exposedTo`.** It is an allowlist. Omitting it keeps the default (same-origin agents plus the browser's own agent). Passing an allowlist that misses ChatGPT's origin would silently hide every tool from the judges.

## A2. What `execute` may return (the single most important gotcha)

The three references disagree on the surface, and the `use-webmcp-tool` README explains why: **the browser normalizes**. Verbatim from the README:

> **`execute` return values** are normalized:
> - a **string** → `{ content: [{ type: "text", text }] }`
> - **`undefined`/`null`** (no return) → `{ content: [] }` (success, no payload)
> - a value that is **already** `{ content: [...] }` → passed through untouched
> - a **thrown value** — Error or not (`throw "not signed in"`, `throw { code: 403 }` both count) → `{ content: [{ type: "text", text }], isError: true }`, after `onError`. A failure must never read as success to the agent.
> - a **returned `Error`** → treated exactly like a throw: `onError` fires, then an `isError` result
> - anything else (object/array/number) → JSON-serialized into a text block

That is why `cloudflare/agents` returns bare objects:

```ts
async execute(args) {
  const { status = "all" } = parseArgs(listTodosArgsSchema, args);
  const todos = getTodos(status);
  return { status, count: todos.length, todos: todos.map(presentTodo) };
}
```

...why `sdras/webmcp-demo` returns bare objects:

```js
return { ok: true, confirmationId: c.id, date: c.date, time: c.time };
```

...and why the Chrome vanilla demos return plain strings:

```js
return `Filters successfully applied. Found ${visibleCount} properties matching the criteria.`;
```

**Decision for the Dojo: always return the explicit `{ content: [{ type: "text", text }] }` shape from a single shared helper.** Reasons: it is the shape ChatGPT actually receives, it is the only shape that is identical across real API / shim / evals harness, and it lets us enforce the 1.5K output budget in one place. We never rely on browser normalization, because the normalizer lives in the browser and our shim would have to reimplement it to stay honest.

## A3. Errors are returned, not just thrown, and they must guide

`cloudflare/agents` throws on validation failure, and their test asserts the message is actionable:

```ts
await expect(
  tools.get("delete_todo")!.execute({ id: "missing-id" })
).rejects.toThrow("was not found");
```

The Chrome vanilla demos instead return an error string that tells the agent what to do next:

```js
return `Error: Location '${params.location}' is not available.`;
```
```js
return `Could not determine a valid size. Please specify a size or number of guests.`;
```

That second one is exactly the pattern judge Sarah Drasner flagged in the build-tools guide ("let the agent ask for missing parameters instead of assuming"). **Decision: the Dojo returns `isError: true` results with a next-step sentence, and never throws a raw `Error` at the agent.** The error-recovery belt grades on whether the agent follows the sentence.

## A4. Lifecycle registration with one AbortController (the dynamic-tool-set pattern)

`cloudflare/agents` `src/useWebMCPTools.ts`, lines 40-141, condensed to the mechanism:

```ts
const modelContext = document.modelContext;
if (!modelContext) {
  setState({ supported: false, registered: false, error: null });
  return;
}
const registeredModelContext = modelContext;
const controller = new AbortController();
setState({ supported: true, registered: false, error: null });

async function registerTools() {
  try {
    await Promise.all(
      tools.map((tool) =>
        registeredModelContext.registerTool(tool, { signal: controller.signal })
      )
    );
    if (!controller.signal.aborted) setState({ supported: true, registered: true, error: null });
  } catch (caught) {
    if (!controller.signal.aborted) setState({ supported: true, registered: false, error: ... });
  }
}
void registerTools();

// Aborting unregisters every tool when the component unmounts.
return () => controller.abort();
```

Their README compresses it to:

```tsx
useEffect(() => {
  const controller = new AbortController();
  void document.modelContext?.registerTool(tool, { signal: controller.signal });
  return () => controller.abort();
}, [tool]);
```

**This is the whole mechanism the Dojo needs for "each belt registers its own tool set and unregisters the previous one."** One `AbortController` per belt. Enter belt: new controller, register that belt's tools. Leave belt: `controller.abort()`. No React required. In vanilla it is a module-level variable.

`registerTool` is async and returns a promise, so `Promise.all` the batch and only then flip the UI to "tools ready".

## A5. Wrapping `execute` to drive the live feed

`sdras/webmcp-demo` `app.js` lines 342-368. This is the pattern for our tool-call feed, and the comment states the reason:

```js
function registerTool(spec) {
    // Wrap execute so EVERY invocation — whether from the in-page sim or a
    // real WebMCP agent — flashes the matching tool card and shows the call
    // in the "Last call" panel. Tools no longer need to call flashTool() themselves.
    const userExecute = spec.execute;
    const wrappedExecute = async (input, client) => {
      flashTool(spec.name, input);
      return await userExecute(input, client);
    };
    const wrappedSpec = { ...spec, execute: wrappedExecute };
    localRegistry.push(wrappedSpec);

    if (HAS_WEBMCP) {
      try {
        document.modelContext.registerTool({
          name: spec.name,
          title: spec.title,
          description: spec.description,
          inputSchema: spec.inputSchema,
          annotations: spec.annotations || {},
          execute: wrappedExecute,
        });
      } catch (err) {
        // duplicate name on hot reload, invalid schema, etc. — non-fatal here
        console.warn(`[webmcp-demo] registerTool("${spec.name}") failed:`, err);
      }
    }
    renderToolsPanel();
}
// expose for inspection
window.__webmcpDemoTools = localRegistry;
```

Three things to steal:
1. **The local mirror registry.** The page keeps its own array of specs so the on-page panel can render schemas and animate calls without asking the browser. We need the same for the inspector and the "tool table" in the lobby.
2. **`window.__webmcpDemoTools`** as an escape hatch for inspection. We do the same under `window.__dojo`, and Playwright drives it.
3. **The `try/catch` with the comment naming the real failure modes**: duplicate name on hot reload, invalid schema. Vite HMR will hit the duplicate-name case constantly. Our wrapper must abort the previous controller before re-registering.

Our version adds latency and result capture:

```ts
// ours: src/webmcp/register.ts
const wrapped = async (args: unknown, ctx?: { signal?: AbortSignal }) => {
  const t0 = performance.now();
  const call: ToolCall = { id: nextId(), tool: spec.name, args, startedAt: Date.now() };
  feed.push(call);                       // renders "running" row immediately
  try {
    const result = await spec.execute(args, ctx);
    call.ms = Math.round(performance.now() - t0);
    call.result = result;
    return result;                       // already MCP-shaped, see A2
  } catch (err) {
    call.ms = Math.round(performance.now() - t0);
    call.result = toolError(String((err as Error)?.message ?? err));
    return call.result;                  // never throw at the agent, see A3
  } finally {
    feed.commit(call);
  }
};
```

## A6. Feature detection and the three honest UI states

`sdras/webmcp-demo` lines 325-334:

```js
const HAS_WEBMCP = !!(globalThis.document && document.modelContext &&
                     typeof document.modelContext.registerTool === "function");
```

Matches `CONTEXT.md` section 6 exactly. She then renders one of two states, and the shim state says so plainly:

> `This is a simulation — install the WebMCP extension and run Chrome with this flag enabled: chrome://flags/#enable-webmcp-testing. Then refresh this page and you should see "live" status — your agent can call the tools on this page!`

`cloudflare/agents` `src/App.tsx` lines 34-64 has the better four-state model, which is what we should copy:

```ts
function statusView(state: WebMCPToolsState) {
  if (state.error)      return { label: "WebMCP registration failed",   detail: state.error.message, ... };
  if (state.registered) return { label: "WebMCP tools ready",           detail: "document.modelContext", ... };
  if (state.supported)  return { label: "Registering WebMCP tools…",    detail: "document.modelContext", ... };
  return                       { label: "WebMCP testing is not enabled", detail: "chrome://flags/#enable-webmcp-testing", ... };
}
```

**Decision: the Dojo's "Agent attached" chip has five states**: `unsupported` (shim active, human-only mode), `supported`, `registered`, `attached` (a tool has actually been called at least once), `error`. The jump from `registered` to `attached` on first tool call is the moment the video wants.

## A7. Exact API semantics, taken from Chrome's own polyfill

`GoogleChromeLabs/webmcp-tools/demos/shared/webmcp-polyfill.js` is the closest thing to a spec we can execute. Facts to build against:

```js
// Name length must be between 1 and 128, only ASCII alphanumeric, _, -, and .
const nameRegex = /^[a-zA-Z0-9_.-]{1,128}$/;
if (!nameRegex.test(name)) throw new DOMException('Invalid tool name format', 'InvalidStateError');

if (window.__webmcp_registered_tools.has(name))
  throw new DOMException(`Tool "${name}" is already registered`, 'InvalidStateError');
```

- Missing or non-string `name` -> `DOMException('Invalid tool name', 'InvalidStateError')`.
- Missing or non-string `description` -> `DOMException('Invalid tool description', 'InvalidStateError')`. **Description is mandatory.**
- `inputSchema` is optional but must survive `JSON.stringify`, else `TypeError`.
- An already-aborted signal at registration time throws `signal.reason || new DOMException('Aborted','AbortError')`.
- `ModelContext extends EventTarget`; both `registerTool` and unregister do `this.dispatchEvent(new Event('toolchange'))`. There is an `ontoolchange` property accessor as well as `addEventListener`.
- Stored tool objects carry `{ name, description, inputSchema, window, origin, annotations, _execute }`.
- `getTools({ fromOrigins })` de-dupes by name, then filters: `t.origin === window.origin || (origins && origins.has(t.origin))`.
- `executeTool(tool, args, options)` accepts `args` as a JSON **string** and parses it: `if (typeof args === 'string') { try { parsedArgs = JSON.parse(args); } catch (e) {} }`.
- Declarative form tools get CSS pseudo-classes `:tool-form-active` / `:tool-submit-active`, and the window gets `toolactivated` / `toolcancel` events. **Not usable for us: ChatGPT has no declarative form API (CONTEXT.md 6), so the Dojo is imperative-only.**
- Autosubmit forms time out at 5000 ms if the page never calls `respondWith`.

The polyfill guards itself correctly and that guard is our shim's first line:

```js
(function () {
  if (window.document.modelContext) {
    return;
  }
```

## A8. Security budgets, corrected

developer.chrome.com/docs/ai/webmcp/secure-tools, verbatim quantities:

- "500 characters per tool description"
- "150 characters per parameter description"
- **"30 characters per tool name and parameter name"**  <- this one is missing from `CONTEXT.md` section 6, add it
- "1.5K character limit per individual tool output"

Note the tension: Chrome's guidance says 30 characters per tool name, the polyfill's regex allows 128. Build to 30. Every Dojo tool name must be <= 30 chars, ASCII alphanumeric plus `_ - .`, and every parameter name too.

Also verbatim on hints:
- `untrustedContentHint`: use "If a tool returns user-generated content (UGC) or externally sourced data" to "help protect your site's integrity while providing a signal to the agent that this data requires heightened scrutiny."
- `readOnlyHint`: apply "on tools that don't change state" to let "the agent make better decisions about when to ask for user confirmations."
- On injection: "it's impossible to guarantee safety inside of a large language model (LLM)."

`cloudflare/agents` sets both hints on every tool, defaulting to the conservative value:

```ts
const annotations = { readOnlyHint: false, untrustedContentHint: true };
// ...and per tool:
annotations: { ...annotations, readOnlyHint: true },
```

**Decision: a `budget.ts` module asserts all four limits at registration time in dev and throws loudly, and the README publishes the measured max for each of our tools.** That is cheap evidence of "genuine effort" for the WebMCP Leverage criterion.

## A9. Calling a tool from outside the page (evals + Playwright + inspector)

`demos/page-agent/script.js` shows the full loop of a real LLM driving WebMCP tools. The important detail is that `executeTool` wants the **tool object**, so you re-fetch the list and find by name:

```js
async function getTools() {
  const iframeOrigin = new URL(iframe.src).origin;
  const tools = await document.modelContext.getTools({ fromOrigins: [iframeOrigin] });
  return tools;
}
// ...
const tools = await getTools();
const tool = tools.find((t) => t.name == name);
const result = await document.modelContext.executeTool(tool, inputArgs);
```

And the JSON-Schema handoff to the model, including the string-schema fallback:

```js
const functionDeclarations = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parametersJsonSchema:
    typeof tool.inputSchema === 'string'
      ? JSON.parse(tool.inputSchema)
      : tool.inputSchema || { type: 'object', properties: {} },
}));
```

`inputSchema` can come back as a **string**. Our evals harness must handle both.

Their system prompt is one line long and is worth copying for the evals harness baseline:

```js
const systemInstruction = [
  'You are an assistant embedded in a web page.',
  'CRITICAL RULE: Do not try to use other tools than the available ones.',
];
```

`demos/shared/webmcp-batch.js` adds a `$ref:` step-chaining scheme (`resolveReferences`, `executeDeclarativeBatch`) so one `execute_batch` tool can run a plan. **Not for the Dojo:** batching hides per-call latency and call counts, which are two things we grade on.

## A10. The test shim already exists in the reference code

`cloudflare/agents` `src/App.test.tsx` lines 23-43. This is the minimum viable `document.modelContext`, and it is the seed of our part (c):

```ts
function installModelContext() {
  const tools = new Map<string, RegisteredTool>();
  const modelContext = {
    async registerTool(
      tool: RegisteredTool,
      options: { signal?: AbortSignal } = {}
    ) {
      tools.set(tool.name, tool);
      options.signal?.addEventListener("abort", () => {
        if (tools.get(tool.name) === tool) tools.delete(tool.name);
      });
    }
  };

  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: modelContext
  });

  return tools;
}
```

Note `configurable: true` (the polyfill uses `writable: false, configurable: true`). And their setup file resets between tests:

```ts
beforeEach(() => { storage.clear(); Reflect.deleteProperty(document, "modelContext"); });
afterEach(()  => { cleanup();       Reflect.deleteProperty(document, "modelContext"); });
```

They also test the two states we must not forget:

```ts
it("unregisters tools when the app unmounts", async () => { ... view.unmount(); expect(tools.size).toBe(0); });
it("surfaces browser registration failures", async () => {
  Object.defineProperty(document, "modelContext", { configurable: true, value: {
    registerTool() { return Promise.reject(new Error("Tools are blocked on this page.")); } } });
  ...
});
```

The Dojo's belt-switching test is the same shape: enter belt 2, assert belt 1's tool names are gone from the map.

## A11. Gotchas found in comments and configs

| Gotcha | Source |
|---|---|
| "duplicate name on hot reload, invalid schema, etc. — non-fatal here" | sdras `app.js:365` |
| "Cloudflare serves the SPA before invoking this Worker. Only unmatched requests reach this fallback." | cloudflare `src/server.ts` |
| "a browser-visible schema is not a validation boundary" (validate again at runtime) | cloudflare README, Key patterns |
| "WebMCP is governed by the `tools` Permissions Policy. A cross-origin iframe embedding this app must include `allow=\"tools\"`." | cloudflare README |
| Chrome may need BOTH `chrome://flags/#enable-webmcp-testing` **and** `chrome://inspect/#remote-debugging` enabled for a coding agent to drive it | cloudflare `AGENTS.md` |
| A duplicate registration throws `InvalidStateError`, it does not replace | polyfill L148 |
| `getTools()` filters by origin; tools from other origins are invisible unless `fromOrigins` names them | polyfill L243-247 |
| Autosubmit declarative forms silently resolve `null` after 5s | polyfill L434 |
| Their agent demo re-calls `getTools()` before **every** execution, because the tool list is dynamic | page-agent `script.js:194` |

Chrome DevTools MCP has first-class WebMCP support, checked into `cloudflare/agents/examples/webmcp-react/.mcp.json`. Copy this file into our repo verbatim, it costs nothing and it is a real dogfooding signal:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@1.7.0", "--categoryExperimentalWebmcp", "--autoConnect", "--no-usage-statistics"],
      "directTools": ["navigate_page", "list_webmcp_tools", "execute_webmcp_tool"],
      "approveTools": ["execute_webmcp_tool"]
    }
  }
}
```

## A12. What the closest prior art does that the Dojo must beat

`demos/doors` is the nearest concept to the Dojo: a multi-page game the agent plays, per-page tool sets, and one state-gated tool. From its README:

> **The Wizard's Attic (`magic.html`)**: Demonstrates state changes. The "Return to Hallway" tool is initially disabled. The model must first use the "castLight" tool (Imperative) to illuminate the room, which then dynamically enables the declarative navigation tool to leave.

It has no scoring, no verification, no feed, no report, no human channel. Our differentiator is not "the agent plays", it is "the page grades". Do not let the Dojo look like Doors with a scoreboard bolted on: the pass/fail verifier and the human-only channel are the product.

---

# (b) Recommended scaffold: Vite + TypeScript, vanilla DOM, Cloudflare Workers static assets

## Why vanilla is the right call here

The judge's own demo (`sdras/webmcp-demo`) is 4 files with no build step. The React starter's entire WebMCP value is `useEffect` + `AbortController`, which is 6 lines of plain TS. React would add ~140KB and a hydration boundary to a page whose main job is a live log and a state machine. We keep Vite and TypeScript for the type-checked tool specs, JSON-Schema-shaped `inputSchema` literals, and a hashed production build.

## Folder layout

```text
dojo/
├── docs/                      CONTEXT.md, BUILD_LOG.md, SUBMISSION.md, VIDEO_SCRIPT.md, research/, screenshots/
├── evals/
│   ├── run.ts                 headless Anthropic agent vs the Dojo (reads ../.secrets.env)
│   └── results.md             generated table, pasted into README
├── public/
│   ├── favicon.svg
│   └── _headers               Cloudflare + Pages header file, see B5
├── src/
│   ├── main.ts                boot: shim decision, router, mount
│   ├── state.ts               single Store, URL-hash persistence, no backend
│   ├── router.ts              hash router: #/ , #/belt/:id , #/report?r=<encoded>
│   ├── webmcp/
│   │   ├── types.ts           ToolSpec, ToolResult, ModelContextLike  (our WebMCP typings)
│   │   ├── shim.ts            the dev shim, part (c)
│   │   ├── register.ts        registerBeltTools() + AbortController lifecycle + feed wrapping
│   │   ├── result.ts          ok() / err() helpers, the { content: [...] } shape, 1.5K clamp
│   │   └── budget.ts          asserts 30/500/150/1500 at registration time
│   ├── belts/
│   │   ├── index.ts           BELTS array, ordering, ranks
│   │   ├── types.ts           Belt = { id, name, tests, tools(ctx), verify(ctx) }
│   │   ├── b1-read.ts         read-only surface tool  (Nahas pattern 1)
│   │   ├── b2-navigate.ts     navigation tool, state-changing  (pattern 2)
│   │   ├── b3-elicit.ts       write tool with confirm-before-submit  (pattern 3)
│   │   ├── b4-inject.ts       prompt-injection trap, untrustedContentHint
│   │   ├── b5-ambiguity.ts    must ask, not guess
│   │   ├── b6-recover.ts      guiding error message, must retry correctly
│   │   ├── b7-efficiency.ts   graded on call count
│   │   └── b8-asymmetric.ts   human-only input the agent cannot read
│   ├── ui/
│   │   ├── lobby.ts  belt.ts  feed.ts  report.ts  inspector.ts  chip.ts
│   │   └── dom.ts             tiny h() helper, no framework
│   ├── styles/
│   │   ├── tokens.css         BRAND.md palette + dark twin
│   │   └── app.css
│   └── vite-env.d.ts
├── tests/
│   ├── unit/*.test.ts         vitest + jsdom, uses shim.ts directly
│   └── e2e/dojo.spec.ts       Playwright, drives window.__dojo.callTool
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── wrangler.jsonc
├── .mcp.json                  chrome-devtools-mcp, copied from cloudflare/agents
├── LICENSE  (MIT, present)
└── README.md
```

## `wrangler.jsonc` (exact, assets-only, no Worker script)

Cloudflare's configuration reference states verbatim: **"The main key is optional for assets-only Workers."** and `workers_dev` "defaults to `true` unless explicitly set to `false`". So we omit `main` entirely and drop `src/server.ts`. The `cloudflare/agents` example only has a `main` because it wants a JSON 404 fallback.

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "webmcp-dojo",
  "compatibility_date": "2026-09-02",
  "workers_dev": true,
  "assets": {
    "directory": "./dist",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application"
  },
  "observability": { "enabled": true }
}
```

Live URL becomes `https://webmcp-dojo.<account-subdomain>.workers.dev`. Confirm the subdomain from the `wrangler deploy` output and put the exact URL in the README, `docs/SUBMISSION.md`, and the video.

Notes:
- `compatibility_date` is required. `2026-09-02` is today-minus-one and safe. Compare: `cloudflare/agents` pins `"compatibility_date": "2026-06-11"`.
- `not_found_handling: "single-page-application"` is belt-and-braces. Our router is hash-based (see below) so deep links never hit the server anyway, but this makes a stray `/belt/3` still serve the app.
- No `compatibility_flags` needed. `nodejs_compat` in the reference exists only for their Worker script.
- No `binding` needed. That is for a Worker script reading assets.

## `package.json` (exact)

Node here is v22.23.2, npm 10.9.8, which satisfies Vite 7/8 (needs 20.19+ or 22.12+). Do not copy `cloudflare/agents`' `"engines": { "node": ">=24.0.0" }`.

```json
{
  "name": "webmcp-dojo",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "description": "The Dojo: a website that tests the AI agent visiting it, over WebMCP.",
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --port 4173 --strictPort",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "e2e:install": "playwright install chromium",
    "evals": "tsx evals/run.ts",
    "deploy": "npm run build && wrangler deploy",
    "deploy:dry": "npm run build && wrangler deploy --dry-run",
    "build:pages": "PUBLIC_BASE=/webmcp-dojo/ npm run build"
  },
  "devDependencies": {
    "@playwright/test": "^1.56.0",
    "@types/node": "^24.3.0",
    "jsdom": "^27.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vite": "^7.1.0",
    "vitest": "^3.2.0",
    "wrangler": "^4.115.0"
  },
  "dependencies": {}
}
```

`"dependencies": {}` is deliberate and is a line worth putting in the README: **zero runtime dependencies, the whole thing is the platform API plus DOM.** The evals harness needs `@anthropic-ai/sdk` and `dotenv`, both devDependencies (add them when writing `evals/run.ts`; they never ship to the browser).

Pin versions with an actual `npm install` before committing; the carets above are floors, not verified resolutions.

## `vite.config.ts` (exact)

```ts
import { defineConfig } from "vite";

// base:
//   Cloudflare Workers assets serve from "/", GitHub Pages serves from "/webmcp-dojo/".
//   "./" makes the built asset URLs relative so the SAME dist/ works on both without a rebuild.
//   PUBLIC_BASE is the escape hatch if an absolute base is ever needed.
export default defineConfig({
  base: process.env.PUBLIC_BASE ?? "./",
  build: {
    target: "es2022",
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,       // judges may read the source in DevTools; let them
    modulePreload: { polyfill: false }
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true }
});
```

**Routing decision that makes the one-dist-two-hosts trick work: hash routing.** `#/`, `#/belt/3`, `#/report?r=<base64url>`. No server rewrites, no 404.html trick on Pages, and it satisfies the `CONTEXT.md` requirement that the report card is "a shareable URL (state encoded in the URL, no backend)". Encode the report as base64url JSON in the hash so it never reaches a server, which is also the honest privacy story for the README.

## `index.html` (root, exact skeleton)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>The Dojo — belt tests for your agent</title>
    <meta name="description" content="A website that tests the AI agent visiting it. Eight belts, real WebMCP tools, a live call feed, and a report card." />
    <link rel="icon" href="./favicon.svg" />
    <meta property="og:title" content="The Dojo" />
    <meta property="og:description" content="A website that tests the AI agent visiting it." />
    <script>
      // Theme before first paint, mirroring cloudflare/agents/examples/webmcp-react/index.html
      (() => {
        const stored = localStorage.getItem("dojo-theme");
        const mode = stored || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        document.documentElement.setAttribute("data-mode", mode);
        document.documentElement.style.colorScheme = mode;
      })();
    </script>
  </head>
  <body>
    <div id="app"></div>
    <noscript>The Dojo needs JavaScript. WebMCP tools are registered from script.</noscript>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Do not put the app in an iframe and do not embed one. ChatGPT registers tools in the top-level page only (`CONTEXT.md` 6). Also do not set `Origin-Agent-Cluster: ?0` anywhere, it disables WebMCP.

## `src/webmcp/types.ts` (ours, derived from cloudflare's `webmcp.d.ts` + the polyfill)

`cloudflare/agents/examples/webmcp-react/src/webmcp.d.ts` types only `registerTool`. We need the rest, because the shim and inspector use `getTools`/`executeTool`/`toolchange`.

```ts
export type ToolContent = { type: "text"; text: string };
export type ToolResult  = { content: ToolContent[]; isError?: boolean };

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolSpec {
  name: string;                 // <= 30 chars, /^[a-zA-Z0-9_.-]+$/
  title?: string;
  description: string;          // <= 500 chars, REQUIRED (polyfill throws without it)
  inputSchema?: object;         // JSON Schema draft-07 object; param descriptions <= 150 chars
  annotations?: ToolAnnotations;
  execute(args: any, ctx?: { signal?: AbortSignal }): ToolResult | Promise<ToolResult>;
}

/** What getTools() hands back. Note origin/window and the string-schema possibility. */
export interface ToolDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object | string;
  annotations?: ToolAnnotations;
  origin?: string;
  window?: Window;
}

export interface ModelContextLike extends EventTarget {
  registerTool(tool: ToolSpec, options?: { signal?: AbortSignal; exposedTo?: string[] }): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<ToolDescriptor[]>;
  executeTool(tool: ToolDescriptor | string, args?: unknown | string, options?: { signal?: AbortSignal }): Promise<unknown>;
}

declare global {
  interface Document { readonly modelContext?: ModelContextLike }
  interface Window {
    __dojo?: {
      isShim: boolean;
      tools(): ToolDescriptor[];
      callTool(name: string, args?: unknown): Promise<ToolResult>;
      feed(): unknown[];
      state(): unknown;
      goto(hash: string): void;
      reset(): void;
    };
  }
}
export {};
```

## `src/webmcp/result.ts` (ours)

One helper, one place to enforce the 1.5K output budget:

```ts
import type { ToolResult } from "./types";

const MAX_OUTPUT = 1500;                       // "1.5K character limit per individual tool output"

function clamp(text: string): string {
  return text.length <= MAX_OUTPUT
    ? text
    : text.slice(0, MAX_OUTPUT - 22) + "\n[truncated by the page]";
}

export const ok  = (text: string): ToolResult => ({ content: [{ type: "text", text: clamp(text) }] });
export const err = (text: string): ToolResult => ({ content: [{ type: "text", text: clamp(text) }], isError: true });
export const json = (v: unknown): ToolResult  => ok(JSON.stringify(v, null, 2));
```

Every belt returns `ok(...)` / `err(...)`. `err()` messages must end with the next action, per A3.

## `src/webmcp/register.ts` (ours, the belt lifecycle)

```ts
let current: AbortController | null = null;

export async function registerBeltTools(specs: ToolSpec[]): Promise<RegState> {
  current?.abort();                 // unregisters the previous belt's tools (A4)
  current = new AbortController();
  const { signal } = current;

  specs.forEach(assertBudgets);     // budget.ts: 30 / 500 / 150 name+desc limits
  const wrapped = specs.map(withFeed);   // A5: latency, args, result into the live feed
  mirror.replace(wrapped);          // local registry for the inspector + lobby tool table

  const mc = getModelContext();     // real API, else the shim (part c)
  if (!mc) return { supported: false, registered: false, error: null };
  try {
    await Promise.all(wrapped.map((t) => mc.registerTool(t, { signal })));
    return { supported: true, registered: !signal.aborted, error: null };
  } catch (e) {
    return { supported: true, registered: false, error: e as Error };
  }
}

export function unregisterAll() { current?.abort(); current = null; mirror.clear(); }
```

## Local dev and deploy commands

```bash
npm install
npm run dev                 # http://localhost:5173, shim active unless Chrome flag is on
npm run build && npm run preview   # http://localhost:4173, this is what Playwright tests
npm run test                # vitest + jsdom unit tests against shim.ts
npm run e2e                 # Playwright against the preview build
npm run evals               # Anthropic agent vs the tools, writes evals/results.md

# Cloudflare
export $(grep -E '^CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)=' ../.secrets.env | xargs)
npm run deploy:dry          # validates wrangler.jsonc + the asset manifest, uploads nothing
npm run deploy              # vite build && wrangler deploy
npx wrangler deployments list
```

`wrangler deploy` reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment, so nothing is written into the repo. Never `wrangler login` here.

## B5. GitHub Pages fallback for the same `dist/`

Because `base: "./"` produces relative asset URLs and the router is hash-based, the identical `dist/` works at `https://rraphaell.github.io/webmcp-dojo/`. Two ways in, pick one on the night:

**Option 1, the workflow (mirrors `GoogleChromeLabs/webmcp-tools/.github/workflows/deploy.yml`).** `.github/workflows/pages.yml`:

```yaml
name: Deploy to Pages
on:
  push:
    branches: ["main"]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: "pages"
  cancel-in-progress: true
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: cp dist/index.html dist/404.html   # harmless with hash routing, saves a stray deep link
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then enable Pages with source "GitHub Actions" in repo settings.

**Option 2, no workflow, 30 seconds:** `npx gh-pages -d dist` after a build, Pages source "Deploy from a branch / gh-pages / (root)". Use this if Actions is not already enabled and the clock is short.

Caveats to check if we use Pages:
- Pages serves over HTTPS on `github.io`, which is required for WebMCP. Fine.
- Pages ignores a `_headers` file. Cloudflare honors it. Since we need no custom headers (and specifically must not send `Origin-Agent-Cluster: ?0`), `public/_headers` is optional. If we add one, keep it to caching only.
- Pages has a build/propagation delay of a minute or two. **Do not make Pages the primary URL in the submission.** Cloudflare Workers is primary, Pages is the fallback if Workers is down at 12:30.

Whichever URL ships, the same URL must appear in the README, `docs/SUBMISSION.md`, the Devpost form, and the video's last frame.

---

# (c) The `modelContext` dev shim

## What it is for, precisely

Three jobs, and they are the reason it earns its ~150 lines:

1. **Playwright and vitest can drive the tools.** Neither runs Chrome 149+ with the flag. Without a shim there is nothing to call and no e2e test exists. `cloudflare/agents` proves the approach (A10); we generalize it from `registerTool` to the full surface.
2. **The built-in inspector works for a human with no agent.** `CONTEXT.md` 8: "a human can browse belts, read what each tests, run tools by hand through a built-in inspector". The inspector should not have two code paths. It talks to `getModelContext()` and does not care which implementation answered.
3. **The evals harness has a target.** `evals/run.ts` drives a headless Chromium through Playwright, and the page under it is shimmed. The Anthropic agent's tool calls land on exactly the same `execute` functions ChatGPT would hit.

## Non-negotiable rules

- **Never shadow the real API.** First line is the polyfill's own guard: `if (document.modelContext) return;`. If ChatGPT or flagged Chrome is present, the shim does not load and does not exist.
- **Never claim to be real.** The status chip reads "Simulated tools (no agent browser detected)" when `window.__dojo.isShim` is true, in the spirit of sdras's `is-shim` copy. Nothing in the video or README may show the shim while implying a live agent.
- **Ship it in production.** It is not a test double, it is the human-only mode of the product. It is ~2KB gzipped.
- **Match the real semantics, including the throws.** Same `DOMException` names, same name regex, same duplicate rejection, same `toolchange` event, same abort behavior. A shim that is more forgiving than Chrome lets a bug reach ChatGPT.

## `src/webmcp/shim.ts` (ours, complete design)

```ts
import type { ModelContextLike, ToolSpec, ToolDescriptor } from "./types";

const NAME_RE = /^[a-zA-Z0-9_.-]{1,128}$/;   // polyfill L143, verbatim

class ShimModelContext extends EventTarget implements ModelContextLike {
  /** Marker so the UI, the inspector and Playwright can tell shim from real. */
  readonly isShim = true;
  #tools = new Map<string, ToolSpec>();

  async registerTool(tool: ToolSpec, options: { signal?: AbortSignal } = {}): Promise<void> {
    if (!tool || typeof tool !== "object")           throw new DOMException("Invalid tool object", "TypeError");
    if (!tool.name || typeof tool.name !== "string") throw new DOMException("Invalid tool name", "InvalidStateError");
    if (!tool.description || typeof tool.description !== "string")
                                                     throw new DOMException("Invalid tool description", "InvalidStateError");
    if (!NAME_RE.test(tool.name))                    throw new DOMException("Invalid tool name format", "InvalidStateError");
    if (this.#tools.has(tool.name))                  throw new DOMException(`Tool "${tool.name}" is already registered`, "InvalidStateError");
    if (tool.inputSchema) { try { JSON.stringify(tool.inputSchema); } catch { throw new TypeError("Failed to stringify inputSchema"); } }

    const signal = options.signal;
    if (signal) {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      signal.addEventListener("abort", () => {
        if (this.#tools.get(tool.name) === tool) {   // cloudflare App.test.tsx identity check
          this.#tools.delete(tool.name);
          this.dispatchEvent(new Event("toolchange"));
        }
      }, { once: true });
    }

    this.#tools.set(tool.name, tool);
    this.dispatchEvent(new Event("toolchange"));     // polyfill L183
  }

  async getTools(): Promise<ToolDescriptor[]> {
    return [...this.#tools.values()]
      .map(({ name, title, description, inputSchema, annotations }) =>
            ({ name, title, description, inputSchema, annotations, origin: location.origin, window }))
      .sort((a, b) => a.name.localeCompare(b.name));   // "alphabetically ordered", Chrome docs
  }

  async executeTool(tool: ToolDescriptor | string, args?: unknown, options?: { signal?: AbortSignal }) {
    const name = typeof tool === "string" ? tool : tool.name;   // shim-only convenience
    const spec = this.#tools.get(name);
    if (!spec) throw new Error(`Tool ${name} not found`);        // polyfill L299, verbatim message

    let parsed = args;                                           // polyfill L283-288
    if (typeof args === "string") { try { parsed = JSON.parse(args); } catch { /* keep the string */ } }

    options?.signal?.throwIfAborted();
    return await spec.execute(parsed ?? {}, { signal: options?.signal });
  }
}

/** Install only when the real API is absent. Returns whether the shim was installed. */
export function installShim(): boolean {
  if (document.modelContext) return false;             // polyfill L7-9, the guard
  Object.defineProperty(document, "modelContext", {
    value: new ShimModelContext(),
    writable: false,
    configurable: true,                                 // configurable so vitest can delete it between tests
  });
  return true;
}

export function getModelContext(): ModelContextLike | undefined { return document.modelContext; }
export function isShim(): boolean { return (document.modelContext as any)?.isShim === true; }
```

Two intentional divergences from Chrome, both documented in the README's Architecture section:
- `executeTool` accepts a bare tool **name** as well as a descriptor. Real Chrome wants the descriptor. Our own `window.__dojo.callTool` always resolves through `getTools()` first, so production code never depends on the divergence, and the evals harness works identically in both modes.
- `getTools()` does not walk iframes or `postMessage` to cross-origin windows (polyfill L192-249). The Dojo has no iframes by design, so the code would be dead.

## The façade both the inspector, Playwright, and evals use

Never let the inspector or a test touch `shim.ts` directly, or the shim path and the real path diverge silently. One façade, mounted in `main.ts`:

```ts
// ours: src/main.ts (tail)
window.__dojo = {
  get isShim() { return isShim(); },
  tools: () => mirror.list(),                     // local mirror, synchronous, for rendering
  async callTool(name, args = {}) {               // the ONE call path
    const mc = getModelContext();
    if (!mc) throw new Error("No modelContext");
    const found = (await mc.getTools()).find(t => t.name === name);   // page-agent pattern, A9
    if (!found) throw new Error(`Tool ${name} not registered right now`);
    return await mc.executeTool(found, args) as ToolResult;
  },
  feed: () => feed.all(),
  state: () => store.snapshot(),
  goto: (hash) => { location.hash = hash; },
  reset: () => store.reset(),
};
```

- The **inspector UI** renders `window.__dojo.tools()` (name, description, annotations badges, a generated form from `inputSchema`) and submits through `window.__dojo.callTool`. A human with no agent gets the full experience, and every call they make shows up in the same live feed with the same latency number.
- **Playwright** does `await page.evaluate(([n,a]) => window.__dojo.callTool(n,a), ["dojo_read_case", {}])` and asserts on `window.__dojo.feed()` and `window.__dojo.state()`.
- The **evals harness** launches Chromium via Playwright, navigates to the preview build, reads the schema list with `page.evaluate(() => window.__dojo.tools())`, hands it to Anthropic tool-use, and executes each requested call through `window.__dojo.callTool`. Same `execute` bodies as ChatGPT hits.

## Re-registration on belt change, in the shim

`toolchange` is the event that makes the inspector and the tool-count badge self-updating in both modes:

```ts
document.modelContext?.addEventListener("toolchange", () => {
  renderToolChip();      // "12 tools -> 3 tools" when a belt starts
  renderInspector();
});
```

Vite HMR will re-run modules and hit the duplicate-name `InvalidStateError` (A11). Guard it:

```ts
if (import.meta.hot) import.meta.hot.dispose(() => unregisterAll());
```

## Test hygiene, copied from `cloudflare/agents/src/test/setup.ts`

```ts
beforeEach(() => { Reflect.deleteProperty(document, "modelContext"); localStorage.clear(); });
afterEach(()  => { Reflect.deleteProperty(document, "modelContext"); });
```

`configurable: true` on the `defineProperty` is what makes `Reflect.deleteProperty` work. That is why the polyfill uses `writable: false, configurable: true` and not a plain assignment.

## Tests the shim makes possible (write these)

1. Registering belt 2 removes every belt-1 tool name from `getTools()`.
2. A duplicate name throws `InvalidStateError` with the exact polyfill message.
3. `assertBudgets` rejects a tool name over 30 chars, a description over 500 chars, and a parameter description over 150 chars.
4. Every tool's output is <= 1500 chars for its worst-case input.
5. The injection belt's payload is returned with `untrustedContentHint: true` and the verifier marks a pass only when the agent does not follow the embedded instruction.
6. `installShim()` returns `false` and mutates nothing when `document.modelContext` already exists.
7. An aborted-before-register signal throws `AbortError`.
8. `executeTool` parses a JSON-string `args` payload.

---

## Open items for whoever builds next

- Confirm the `.workers.dev` subdomain from the first `wrangler deploy` output and hardcode the exact URL everywhere.
- `CONTEXT.md` section 6 should gain the missing budget: **30 characters per tool name and parameter name.**
- Pin real versions after `npm install`; the `package.json` above has floors, not resolved versions.
- `evals/run.ts` needs `@anthropic-ai/sdk` and `dotenv` as devDependencies, reading `../.secrets.env`. Never commit.
- Copy `.mcp.json` from `cloudflare/agents/examples/webmcp-react` verbatim so a coding agent can drive the live page through `chrome-devtools-mcp`.

---

# (d) Reconciliation with the foundation already committed (`dd9f17c`)

A parallel agent landed `src/webmcp/{shim,registry,types}.ts`, `wrangler.jsonc`, `vite.config.ts`, `package.json`, `evals/run.mjs` and `tests/` before this study was written. That foundation is sound and closer to observed Chrome 152 behaviour than section (b) assumed in two places (it models `inputSchema` as a JSON **string** and `executeTool(tool, argsJson) -> string`, which matches `page-agent`'s `typeof tool.inputSchema === 'string'` fallback in A9). Do not rewrite it. Apply these seven deltas instead.

1. **`vite.config.ts` has `base: '/'`.** That hard-blocks the GitHub Pages fallback, which serves from `/webmcp-dojo/`. Change to `base: process.env.PUBLIC_BASE ?? './'` and keep the router hash-based, so one `dist/` deploys to both hosts with no rebuild. This is the single change that makes the fallback in B5 actually usable at 12:30.
2. **`sourcemap: false`.** Set it to `true`. Judges "may use automated AI-driven analysis" and may open DevTools; readable source is free evidence for the WebMCP Leverage criterion.
3. **No budget enforcement anywhere.** Add `src/webmcp/budget.ts` per A8 and call it from the registry: 30 chars per tool name and per parameter name, 500 per tool description, 150 per parameter description, 1500 per tool output. Publish the measured maxima in the README.
4. **The shim resolves silently on an already-aborted signal** (`if (options?.signal?.aborted) return Promise.resolve()`). Chrome's own polyfill throws `signal.reason ?? new DOMException('Aborted','AbortError')` (polyfill L163-165). A shim that is more forgiving than the browser hides a real bug. Make it reject.
5. **The shim does not validate the tool-name format.** Chrome's polyfill enforces `/^[a-zA-Z0-9_.-]{1,128}$/` and throws `DOMException('Invalid tool name format','InvalidStateError')`, and Chrome's security guidance caps names at 30. A belt tool named with a space or a colon would pass every local test and vanish in ChatGPT. Add the regex plus the 30-char cap.
6. **The shim does not require `description`.** The polyfill throws `DOMException('Invalid tool description','InvalidStateError')` when it is missing or non-string (L138-140). Add it, so a belt that forgets a description fails in tests instead of in front of a judge.
7. **`@anthropic-ai/sdk` sits in `dependencies`.** It is Node-only, used by `evals/run.mjs`, and never enters the browser bundle. Move it to `devDependencies` so the README can honestly say the shipped page has zero runtime dependencies.

Also still missing and cheap: `.mcp.json` copied verbatim from `cloudflare/agents/examples/webmcp-react` (A11), and the `.github/workflows/pages.yml` from B5.
