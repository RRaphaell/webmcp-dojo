# WebMCP API truth — code-level cheat sheet

**Compiled:** 2026-09-03. **Method:** every claim below is either (a) quoted from a primary
source with the URL attached, or (b) **MEASURED** by running probe pages in real Chrome
**152.0.7977.66** (macOS arm64, headless, driven by Playwright with `channel: "chrome"`) against
`http://localhost:8791/` with `--enable-features=WebMCP`. Facts I could not falsify or confirm are
marked **UNVERIFIED** and say so loudly.

Read the corrections section (§16) before you write code: three statements in `docs/CONTEXT.md`
are wrong or incomplete.

Primary sources used:
- ChatGPT: <https://learn.chatgpt.com/docs/webmcp> (full markdown at `https://learn.chatgpt.com/docs/webmcp.md`)
- Chrome: <https://developer.chrome.com/docs/ai/webmcp>, `/imperative-api`, `/declarative-api`,
  `/best-practices`, `/secure-tools`, `/build-tools`, `/evals`
- DevTools: <https://developer.chrome.com/docs/devtools/application/webmcp>
- Origin trial blog: <https://developer.chrome.com/blog/ai-webmcp-origin-trial>
- Spec (W3C WebML CG draft): <https://raw.githubusercontent.com/webmachinelearning/webmcp/main/index.bs>
  and README (the explainer): <https://raw.githubusercontent.com/webmachinelearning/webmcp/main/README.md>
  (**note:** `docs/explainer.md` referenced in the task 404s; the explainer lives in `README.md`)
- Implementation status: <https://raw.githubusercontent.com/webmachinelearning/webmcp/main/implementation-status.md>
- Google's own agent guidance: <https://raw.githubusercontent.com/GoogleChrome/modern-web-guidance/main/skills/modern-web-guidance/guides/webmcp/webmcp.md>
- Judge demo: <https://raw.githubusercontent.com/sdras/webmcp-demo/main/app.js>
- Cloudflare: `https://raw.githubusercontent.com/cloudflare/agents/main/examples/webmcp-react/src/useWebMCPTools.ts` and `.../src/webmcp.d.ts`
- Chromium source: `chrome/browser/about_flags.cc`, `third_party/blink/renderer/platform/runtime_enabled_features.json5`

---

## 1. Feature detection

The exact line both OpenAI and the judge's demo use:

```js
if (typeof document.modelContext?.registerTool === "function") { /* ... */ }
```
Source: <https://learn.chatgpt.com/docs/webmcp> and `sdras/webmcp-demo/app.js:325-326`:

```js
const HAS_WEBMCP = !!(globalThis.document && document.modelContext &&
                     typeof document.modelContext.registerTool === "function");
```

Namespace is `document.modelContext`. `navigator.modelContext` does not exist — **MEASURED**:
the only own property names on `Object.getPrototypeOf(document.modelContext)` in Chrome 152 are

```
["ontoolchange", "executeTool", "getTools", "registerTool", "constructor"]
```

That list is the whole API surface today. `SecureContext` + `Exposed=Window` (spec IDL), so it is
`undefined` on plain `http://` origins other than `localhost`, and inside workers.

---

## 2. `registerTool` — exact signature

Spec IDL (`index.bs`, `ModelContext Interface`):

```webidl
[Exposed=Window, SecureContext]
interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool, optional ModelContextRegisterToolOptions options = {});
  Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {});
  Promise<DOMString> executeTool(RegisteredTool tool, optional object inputObject = {}, optional ModelContextExecuteToolOptions options = {});

  attribute EventHandler ontoolchange;
};

dictionary ModelContextTool {
  required DOMString name;
  USVString title;
  required DOMString description;
  object inputSchema;
  required ToolExecuteCallback execute;
  ToolAnnotations annotations;
};

dictionary ToolAnnotations {
  boolean readOnlyHint = false;
  boolean untrustedContentHint = false;
};

dictionary ToolExecuteCallbackOptions {
  required AbortSignal signal;
};

callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options);

dictionary ModelContextRegisterToolOptions {
  sequence<USVString> exposedTo;
  AbortSignal signal;
};

dictionary ModelContextGetToolOptions {
  sequence<USVString> fromOrigins;
};

dictionary ModelContextExecuteToolOptions {
  AbortSignal signal;
};

dictionary RegisteredTool {
  required DOMString name;
  DOMString title;
  required DOMString description;
  object inputSchema;
  required Window window;
  required USVString origin;
  ToolAnnotations annotations;
};
```

So the complete option-name list is: tool object → `name`, `title`, `description`, `inputSchema`,
`execute`, `annotations`. Second argument → `exposedTo`, `signal`. There is nothing else.

`registerTool` returns a **Promise**. Cloudflare's production hook awaits them all together
(`examples/webmcp-react/src/useWebMCPTools.ts`):

```ts
await Promise.all(
  tools.map((tool) =>
    registeredModelContext.registerTool(tool, { signal: controller.signal })
  )
);
```

`title` is optional and is what the browser shows in UI. **MEASURED:** if you omit it,
`getTools()` reports `title: ""`.

---

## 3. `inputSchema` conventions

- Plain JSON Schema object (`[[JSON-SCHEMA]]` in the spec). `type: "object"` at the root.
- Optional — **MEASURED**: registering with no `inputSchema` at all succeeds.
- ChatGPT's own sample adds `additionalProperties: false`:

```js
inputSchema: {
  type: "object",
  properties: {},
  additionalProperties: false,
},
```
(<https://learn.chatgpt.com/docs/webmcp>)

- **The schema is NOT enforced by the browser.** MEASURED in Chrome 152: a tool declared as
  `{type:"object",properties:{n:{type:"number"}},required:["n"]}` executed with
  `'{"n":"not-a-number","extra":1}'` delivered `{"n":"not-a-number","extra":1}` straight to
  `execute`; executing with `'{}'` delivered `{}` despite `required:["n"]`. **Validate in your own
  code.** Chrome says the same in words: "Validate strictly in code, loosely in schema…
  schema constraints can be helpful, they're not guaranteed"
  (<https://developer.chrome.com/docs/ai/webmcp/best-practices>).
- `enum` + `title`-per-`const` under `oneOf` is Chrome's documented shape for a rich dropdown
  parameter (see the `get_order_status` sample on the imperative-api page).
- **MEASURED:** `getTools()` hands the schema back as a **JSON string**, not an object:
  `typeof tool.inputSchema === "string"`, value `{"type":"object","properties":{"a":{"type":"number"}}}`.
  The spec calls the internal `input schema` "a string" too. `JSON.parse` it if you build an inspector.

---

## 4. What `execute()` must return — the real answer

**`execute` may return anything JSON-serializable. There is no required MCP `{content:[…]}` wrapper.**

Spec, `imperative execute steps` (`index.bs`):

> Let |serializedResult| be the result of [=serializing a JavaScript value to a JSON string=] given |v|.

`executeTool()` is typed `Promise<DOMString>` — a **string** always reaches the caller/agent.

**MEASURED** in Chrome 152, what `executeTool()` resolves to for each return value:

| `execute` returns | agent receives (string) |
|---|---|
| `{ok:1}` | `{"ok":1}` |
| `'abc'` | `abc`  (3 chars, **not** re-quoted) |
| `42` | `42` |
| `null` | `null` |
| `undefined` (no return) | `undefined` |
| `{content:[{type:'text',text:'hello'}]}` | `{"content":[{"type":"text","text":"hello"}]}` — accepted, just serialized like any object |

ChatGPT's documented sample returns a bare object:

```js
execute: async () => ({ title: document.title }),
```

Chrome's samples return bare template strings:

```js
execute: async ({ layer, action }) => {
  await toggleLayer(layer, action);
  return `Performed ${action || 'toggle'} on layer: ${layer}`;
},
```

The judge's demo returns bare objects, including its error path (`sdras/webmcp-demo/app.js`):

```js
const c = widgetWith.state.confirmed;
if (!c) return { ok: false, error: "Slot unavailable or input invalid." };
return { ok: true, confirmationId: c.id, date: c.date, time: c.time };
```

**Build rule: return a small plain object. `{content:[…]}` is legal but wastes ~30 chars of your
1.5K output budget for nothing.**

### 4b. Throwing loses your error message

**MEASURED:** `execute: async () => { throw new Error('boom detail') }` →
`executeTool` rejects with

```
UnknownError: Tool was executed but the invocation failed. For example, the script function threw an error
```

`boom detail` appears only in the page console (`WebMCP tool execution failed: Uncaught Error: boom detail`).
**Never throw for a recoverable condition — return the guiding error as a value**, which is also what
Chrome's build-tools guide asks for: *"No flight search results found. Search for flights first."*
(<https://developer.chrome.com/docs/ai/webmcp/build-tools>).

### 4c. The `execute` second argument is spec'd but NOT delivered in Chrome 152

Chrome's docs claim: *"The `execute` function receives an `AbortSignal` parameter named `signal` as
its second argument"* with this sample:

```js
execute: async ({ url, priority }, { signal }) => {
  const response = await fetch(url, { priority, signal });
  ...
}
```
(<https://developer.chrome.com/docs/ai/webmcp/imperative-api>)

**MEASURED, contradicting the doc:** invoked through `document.modelContext.executeTool()` in
Chrome 152, `execute` is called with **exactly one argument** —
`{"len":1,"a0":"object","a1":"undefined","a1keys":null,"a1sig":false}`.
Cancellation still works end-to-end (see §7), it just does not surface to your callback on this path.
**UNVERIFIED:** whether a real agent invocation (ChatGPT, or Chrome's own browser agent) passes the
second argument. Write `execute(args, opts = {})` and guard `opts?.signal` — never destructure
`{ signal }` in the parameter list or you crash on Chrome 152.

---

## 5. Registration errors (exact `name: message` pairs, MEASURED in Chrome 152)

| Attempt | Result |
|---|---|
| duplicate `name` | rejects `InvalidStateError: Duplicate tool name` |
| `name` 129 chars | rejects `InvalidStateError: Invalid tool name` |
| `name` 128 chars | resolves |
| `name` with a space or `!` | rejects `InvalidStateError: Invalid tool name` |
| `description: ""` | rejects `InvalidStateError: Description is required` |
| no `inputSchema` | resolves |
| `signal` already aborted | rejects `AbortError: signal is aborted without reason` |
| `exposedTo: ['https://example.com']` | resolves |
| extra annotation keys (`destructiveHint` etc.) | resolves, keys silently dropped |

Spec confirms the name rule: length 1–128, only ASCII alphanumerics plus `_`, `-`, `.`
(`index.bs`, `tool definition/name`).

### Re-registering the same name does NOT replace — it throws
This is the single most likely bug in a dynamic-tool app. `registerTool` rejects with
`InvalidStateError` on a name collision (spec: *"Returns a rejected promise if a tool with the same
name is already registered"*). **MEASURED:** `abort()` first, then re-register the same name →
resolves fine. So the dynamic pattern is always **abort the old controller, then register**.

---

## 6. Unregistering — `AbortSignal` only

There is **no `unregisterTool()`**. **MEASURED:** `typeof document.modelContext.unregisterTool === "undefined"`.
It is not in the IDL. Google's own agent guidance says it outright:

> Always use `AbortSignal` to unregister tools when pages transition or resources are released to
> avoid leaks and collisions. **Do not use `unregisterTool`.**
> — <https://raw.githubusercontent.com/GoogleChrome/modern-web-guidance/main/skills/modern-web-guidance/guides/webmcp/webmcp.md>

Canonical pattern (Chrome imperative-api page, verbatim):

```js
const addTodoTool = {
  name: "addTodo",
  description: "Add a new item to the to-do list",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
  },
  execute: async ({ text }) => {
    // You should handle the persistence logic here (omitted for demo)
    return `Added to-do: ${text}`;
  },
  annotations: {
    readOnlyHint: false,
    untrustedContentHint: true
  },
};
const controller = new AbortController();
await document.modelContext.registerTool(addTodoTool, { signal: controller.signal });

// Unregister the tool later...
controller.abort();
```

One controller can hold a whole belt's tool set — abort once, the set disappears (Cloudflare's hook
does exactly this: `return () => controller.abort();` on unmount).

Chrome note, verbatim: *"As of Chrome 153, you can unregister a tool without cancelling and breaking
in-flight executions."* Stable Chrome on 2026-09-03 is **152** (chromiumdash), so on today's stable
an `abort()` also cancels any in-flight call of those tools. Don't abort mid-challenge while a call
is running.

---

## 7. Cancellation of an in-flight call

**MEASURED:** `executeTool(tool, '{}', { signal })` then `controller.abort()` → the promise rejects
`AbortError: signal is aborted without reason` even though the tool's own 5s timer was still running.
Because the second `execute` argument is not delivered (§4c), your tool body cannot currently observe
that abort on Chrome 152 — it keeps running to completion, its result discarded.

---

## 8. `toolchange`

```js
document.modelContext.addEventListener("toolchange", (event) => {
  // Tools have changed.
});
```
(<https://developer.chrome.com/docs/ai/webmcp/imperative-api>) — also available as
`document.modelContext.ontoolchange = …`.

**MEASURED:** fires on register **and** on abort/unregister (1 event per change). Spec warns the
timing relative to other task sources is not guaranteed:

```js
// `Parent toolchange` will always log before `Child toolchange`, and
// `Register promise resolved` will always log after both.
// But `Post-register task` can log before, in between, or after all three.
```

Use it to drive the Dojo's "tools now live" UI; don't use it to sequence anything.

---

## 9. `getTools()` and `executeTool()` — for the built-in inspector

```js
const [tool] = await document.modelContext.getTools();
const result = await document.modelContext.executeTool(tool, '{"text": "Buy milk"}');
```

- **MEASURED:** returned objects have `{name, title, description, inputSchema (string), annotations,
  origin, window}`. Example: `{"name":"probe_tool","title":"","description":"probe",
  "annotations":{"readOnlyHint":true,"untrustedContentHint":true},"origin":"http://localhost:8791",
  "inputSchema":"{\"type\":\"object\",\"properties\":{}}"}`.
- **MEASURED:** ordering is alphabetical by name (`arity, bigout, bulk_0, bulk_1, bulk_10, …`),
  matching Chrome's doc ("an alphabetically ordered list").
- **MEASURED:** the second argument must be a **JSON string**. Passing an object throws
  `UnknownError: Failed to parse input arguments`. (The spec IDL says `object inputObject`; Chrome
  implements a string. Chrome's doc agrees: *"with input arguments as a valid JSON string"*.)
  **Pass `JSON.stringify(args)`.**
- `executeTool` returns "the result of the tool execution, or `null` when a navigation is triggered"
  (Chrome imperative-api).
- Same-origin by default; cross-origin needs both `fromOrigins` on the caller **and** `exposedTo` on
  the registrant. Irrelevant for a single-origin Dojo.
- Chrome's evals page explicitly blesses this for testing: *"You can trigger a WebMCP tool call using
  `document.modelContext.executeTool(...)`."* — that is the Dojo's manual inspector, sanctioned.

---

## 10. Every annotation that exists

**Exactly two.** From the spec IDL:

```webidl
dictionary ToolAnnotations {
  boolean readOnlyHint = false;
  boolean untrustedContentHint = false;
};
```

- `readOnlyHint` — "the tool does not modify any state and only reads data… helps agents make
  decisions about when it is safe to call the tool."
- `untrustedContentHint` — "the tool's output contains data that is untrusted, from the perspective
  of the author registering the tool." Chrome: *"If a tool returns user-generated content (UGC) or
  externally sourced data, consider adding the `untrustedContentHint`… a signal to the agent that
  this data requires heightened scrutiny."* Spec adds the client may "sanitize the payload, use
  indicators such as spotlighting to highlight untrustworthy content to the model, or hide that part
  of the response entirely."

**`destructiveHint`, `idempotentHint`, `openWorldHint` DO NOT EXIST in WebMCP.** They are MCP-server
annotations. **MEASURED:** passing all three is accepted without error and then **silently dropped** —
`getTools()` reported only `{"readOnlyHint":true,"untrustedContentHint":true}`. Do not put them in
the Dojo's code or README; a judge who checks will find them fabricated.

Consequence for the Dojo: **"destructive/write" is expressed by `readOnlyHint: false` plus wording in
the description**, not by an annotation. Alex Nahas's three patterns map to:
read-only tool = `readOnlyHint: true`; navigation/state-changing tool = `readOnlyHint: false`;
write-with-elicitation = `readOnlyHint: false` + a two-step preview/confirm tool pair.

---

## 11. `provideContext` / `requestUserInteraction` — neither exists today

- **MEASURED:** `typeof document.modelContext.provideContext === "undefined"` and
  `typeof document.modelContext.requestUserInteraction === "undefined"` in Chrome 152.
- Neither appears in `index.bs`.
- Chrome's secure-tools page links to *"the spec draft includes `requestUserInteraction()`"* at
  `https://webmachinelearning.github.io/webmcp/#model-context-client` — **that anchor does not exist
  in the published spec** (I fetched the rendered spec and grepped: zero hits for
  `model-context-client`, `ModelContextClient`, or `requestUserInteraction`). The Chrome page's link
  is stale. Elicitation is still an open issue: README line 480 —
  *"**User prompting and elicitation**: Exploring a way for a tool to prompt the user… See Issue #165
  and Issue #50 for discussion about the `ModelContextClient` interface."*
- **There is no `provideContext` API anywhere.** If the Dojo needs to hand the agent state, it is a
  `readOnlyHint: true` tool like `get_dojo_state`.

---

## 12. Limits

### Enforced by the browser (MEASURED, Chrome 152)
| Thing | Limit |
|---|---|
| tool `name` length | 1–128 chars, `[A-Za-z0-9_.-]` only. 129 → `InvalidStateError` |
| `description` | must be non-empty. **No maximum** — 10,000 chars registered fine |
| number of tools | **no cap** — 500 tools registered, `getTools()` returned all 506 |
| tool output length | **no cap** — a 20,000-char return came back at full length |
| `inputSchema` | must be JSON-serializable (circular ref → the `JSON.stringify` exception is rethrown) |

### Recommended budgets (NOT enforced — these are agent-guardrail heuristics)
Verbatim from <https://developer.chrome.com/docs/ai/webmcp/secure-tools>, "Set character budgets":

- 500 characters per tool description
- 150 characters per parameter description
- **30 characters per tool name and parameter name**  ← missing from `CONTEXT.md`
- 1.5K character limit per individual tool output

Followed by: *"It's likely that there is some variation across agents… These recommendations are
subject to change… Specific character limitations may be added to the API specification in the future."*

On tool count, Chrome best-practices: *"While there isn't a maximum number of tools allowed, each tool
takes up part of the context window and adds to the time for completion. The more tools you provide
and the more the tools have overlap, the harder it is for the agent to pick correctly."*
→ This is the technical argument for the Dojo registering **one belt's tools at a time**.

---

## 13. ChatGPT desktop in-app browser — what is actually true

All from <https://learn.chatgpt.com/docs/webmcp> (the full page; it is short, and it is the only
first-party OpenAI doc):

- Feature is user-facing as **"Site tools"**. Toggle: **Settings > Browser > Permissions > Enable site tools**.
- Models: *"Use GPT-5.6 Sol or GPT-5.6 Terra for site tools. GPT-5.6 Luna currently has WebMCP disabled…
  Site tools aren't available in Enterprise or Edu workspaces."* Clients: ChatGPT Work and Codex, in
  the desktop app's built-in browser.
- UI path for the human: *"Select **Site tools** in the browser's address bar… Choose **Available site
  tools** to inspect the individual tools… choose **Recently used** to open **Sources** and review those calls."*
- **Unsupported subset, verbatim:**
  > - **Declarative API:** Tools defined through HTML form attributes aren't available as site tools.
  > - **Tools in iframes:** The browser doesn't discover tools registered inside iframes, including
  >   same-origin and cross-origin iframes.
  >
  > Use JavaScript to register tools in the top-level page.
- Safety: *"Website-provided tool definitions and results are untrusted content… each tool invocation
  receives a safety review before it runs… including for consequential actions such as sending
  messages, making purchases, deleting data, or changing permissions."*
- Lifecycle hint: *"Tools belong to the page that provides them. Closing or navigating away from a page
  can make its tools unavailable."*
- The only OpenAI-published code sample is the one in §1/§4.

### Tools registered AFTER page load — **UNVERIFIED**
No OpenAI doc states whether or how fast ChatGPT re-reads the tool list after `toolchange`. Evidence
either way:
- *For* it working: the whole spec is built on `toolchange` notifications; Chrome's best-practices
  tells you to *"Register tools when they're useful in a certain page state, then unregister when the
  tool is no longer usable"*; the explainer's flagship scenario has the agent notice a tool that
  *"was dynamically registered"* mid-conversation (`edit-design`).
- *Against* assuming instant pickup: nothing in OpenAI's doc mentions dynamic registration, and
  participants report Sol/Terra *"don't use the tools unless nudged"* and that calls *"feel quite slow"*.

**Build defensively:** register the Dojo's *navigation/meta* tools (`list_belts`, `start_belt`,
`get_state`, `submit_answer`) **once at page load and never unregister them**, and let the per-belt
tools be the dynamic layer. If ChatGPT's refresh lags, the agent can still always reach a stable tool
that tells it what changed. Make `start_belt`'s return value enumerate the newly available tool names
in text — that works whether or not the client re-read the list.

---

## 14. Chrome: enabling it, including for automated tests

### The flag
```
chrome://flags/#enable-webmcp-testing   →  Enabled  →  relaunch
```
(<https://developer.chrome.com/docs/ai/webmcp>; Edge: `edge://flags/#enable-webmcp-testing`.)
Minimum build per Google's guidance: **Chromium 146.0.7672.0+**. Origin trial is live from **Chrome 149**
(<https://developer.chrome.com/blog/ai-webmcp-origin-trial>); Edge 150 has its own trial.

### The command-line switch (not documented by Google — derived from Chromium source, then MEASURED)
`chrome/browser/about_flags.cc`:

```cpp
{"enable-webmcp-testing", flag_descriptions::kWebMCPName,
 flag_descriptions::kWebMCPDescription, kOsAll,
 FEATURE_VALUE_TYPE(blink::features::kWebMCP)},
```

`third_party/blink/renderer/platform/runtime_enabled_features.json5`:

```json5
{
  name: "WebMCP",
  origin_trial_feature_name: "WebMCP",
  origin_trial_allows_third_party: true,
  public: true,
  base_feature_status: "enabled",
  copied_from_base_feature_if: "overridden",
  implied_by: [ "WebMCPDeclarativeFileInput", "WebMCPFormAssociatedCustomElements", "WebMCPTesting" ],
  status: "experimental",
},
```

**MEASURED — both of these work on Chrome 152:**

```
--enable-features=WebMCP
--enable-blink-features=WebMCP
```

Baseline control, same probe with no switch: `typeof document.modelContext === "undefined"`. Good.

Working headless invocation (this is the exact shape that produced every MEASURED fact here):

```js
// npm i playwright   (uses your installed Google Chrome, not the bundled build)
const { chromium } = require('playwright');
const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--enable-features=WebMCP'],
});
```

Plain CLI equivalent:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-first-run \
  --user-data-dir="$(mktemp -d)" \
  --enable-features=WebMCP \
  --virtual-time-budget=8000 --dump-dom http://localhost:8791/
```
(Caveat MEASURED: with `--dump-dom` + `--virtual-time-budget`, `getTools()` never settled before the
dump — virtual time doesn't drive the browser-process round trip. Drive it with Playwright/CDP and a
real `waitForFunction`, not `--dump-dom`, for anything past `registerTool`.)

### Playwright's bundled Chromium: NO — **MEASURED**
Playwright's bundled Chromium **147.0.7727.15** returns `typeof document.modelContext === "undefined"`
with **no flag**, with `--enable-features=WebMCP`, with `--enable-blink-features=WebMCP`, and with
`--enable-blink-features=WebMCPTesting`. Even though 147 > the 146.0.7672.0 minimum, the feature is
not reachable in that build. **The evals harness must use `channel: 'chrome'` (or `channel: 'msedge'`)
against a locally installed Chrome ≥149.** Say this in the README so a judge reproducing the evals
doesn't hit a silent `undefined`.

### DevTools
Chrome DevTools → **Application** panel → **WebMCP** pane. Dual pane: **Invoked Tools** (chronological
log; status Completed / Canceled / In Progress / Error; Input and Output per call) and **Available
Tools** (live list, per-tool invocation counter, clickable status icons that filter the log). Hover an
invoked tool → **Play (➜)** icon → manual test area pre-populated with that call's parameters → **Run tool**.
Filters by name/description, status, and Declarative vs Imperative tool type.
(<https://developer.chrome.com/docs/devtools/application/webmcp>)

`--categoryWebMCP` on that page is **not a Chrome switch** — it is a flag for
`ChromeDevTools/chrome-devtools-mcp`, under the heading "Automation and agents". Do not put it in the README.

### Extension
Model Context Tool Inspector / "WebMCP" extension, id `gbpdfapgefenggkahomfgkhfehlcenpd`
(from `sdras/webmcp-demo/app.js`), lets a human list and call tools manually in Chrome.

### Hard disable
WebMCP is only available in **origin-isolated** documents. If the document has `document.domain`
enabled — e.g. the server sends `Origin-Agent-Cluster: ?0` — the APIs are disabled
(spec: `registerTool` rejects `SecurityError`). Also gated by the `tools` Permissions Policy, default
`self`; cross-origin iframes need `<iframe src="…" allow="tools">`. **Check the deploy: Cloudflare
Workers must not emit `Origin-Agent-Cluster: ?0`.**

---

## 15. Declarative API (Chrome only — ChatGPT does not support it)

Do not build the Dojo on this, but know it for the report card / README comparison.

Attributes: `toolname` and `tooldescription` on `<form>`; `toolparamdescription` on a field;
`toolautosubmit` on the form to let the agent submit.
*"If you remove either the `toolname` or `tooldescription` HTML attribute, the tool is unregistered."*

```html
<form toolautosubmit toolname="search_tool"
  tooldescription="Search the web" action="/search">
  <input type=text name=query>
</form>
<script>
  document.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!myFormIsValid()) {
      if (e.agentInvoked) { e.respondWith(myFormValidationErrorPromise) };
      return;
    }
    if (e.agentInvoked) { e.respondWith(Promise.resolve("Search is done!")); }
  });
</script>
```

- `SubmitEvent.agentInvoked` (boolean) and `SubmitEvent.respondWith(Promise<any>)` — **MEASURED
  present** on `SubmitEvent.prototype` in Chrome 152.
- `window` events `toolactivated` / `toolcancel`, non-cancelable, with a `toolName` attribute
  (Chrome declarative-api page). **MEASURED:** the IDL `ontoolactivated` / `ontoolcancel` handler
  attributes are **absent** on `window` in Chrome 152 — use `addEventListener` and treat these as
  **UNVERIFIED** until you see one fire. The spec has them as open `Issue(#146)`.
- CSS `:tool-form-active` and `:tool-submit-active`. **MEASURED:** `CSS.supports('selector(:tool-form-active)')`
  → `true` in Chrome 152. Chrome's default style is verbatim:

```css
form:tool-form-active { outline: light-dark(blue, cyan) dashed 1px; outline-offset: -1px; }
input:tool-submit-active { outline: light-dark(red, pink) dashed 1px; outline-offset: -1px; }
```

- **MEASURED gotcha:** a declarative form tool does **not** appear in a `getTools()` call made from an
  inline script at parse time — the first `getTools()` returned `[]` and a later one returned
  `declarative_search`. Registration is async relative to parsing.

---

## 16. Corrections to `docs/CONTEXT.md` §6 — apply these

1. **"`execute(args)` returns `{ content: [{ type: "text", text }] }`" — WRONG as a requirement.**
   Any JSON-serializable value works and is stringified; OpenAI's and Chrome's own samples return a
   bare object or a bare string. Keep returns small and plain. (§4)
2. **"Annotations: … destructive hints for navigation/write tools" — those do not exist.**
   Only `readOnlyHint` and `untrustedContentHint`. Extras are silently discarded. (§10)
3. **Security budgets list is missing one:** 30 chars per tool name and per parameter name. (§12)
4. **Additions CONTEXT.md doesn't have, all build-critical:** re-registering a name throws
   `InvalidStateError: Duplicate tool name` (abort first); `executeTool` needs a JSON **string**;
   thrown errors are replaced by a generic message; `getTools().inputSchema` is a string;
   Playwright's bundled Chromium cannot run WebMCP.
5. `docs/explainer.md` in the spec repo is a 404 — cite `README.md` or the rendered spec instead.

---

## 17. Copy-paste starting point for a Dojo belt

```js
// Feature detection — exactly OpenAI's line.
const HAS_WEBMCP = typeof document.modelContext?.registerTool === "function";

// One controller per belt. Abort it to retire the whole belt's tool set.
let beltController = null;

async function activateBelt(belt) {
  // 1. Retire the previous belt FIRST. Re-registering a live name throws
  //    InvalidStateError: Duplicate tool name.
  beltController?.abort();
  beltController = new AbortController();
  const { signal } = beltController;

  await Promise.all(
    belt.tools.map((t) =>
      document.modelContext.registerTool(
        {
          name: t.name,                 // <=128 chars hard, aim <=30
          title: t.title,               // shown in the browser's tool UI
          description: t.description,   // required, non-empty, aim <=500 chars
          inputSchema: t.inputSchema,   // NOT validated by the browser
          annotations: {
            readOnlyHint: t.readOnly === true,
            untrustedContentHint: t.returnsUntrusted === true,
          },
          // Never destructure a second arg: Chrome 152 passes only one.
          async execute(args, opts) {
            const t0 = performance.now();
            try {
              const valid = validate(t.inputSchema, args); // your own validation
              if (!valid.ok) {
                // Guiding error as a RETURN VALUE, not a throw.
                return { error: valid.message, hint: valid.hint };
              }
              const result = await t.run(args, { signal: opts?.signal });
              logCall(t.name, args, result, performance.now() - t0);
              return result;            // small plain object; <=1.5K chars
            } catch (err) {
              logCall(t.name, args, err, performance.now() - t0);
              return { error: "Internal error.", detail: String(err?.message ?? err) };
            }
          },
        },
        { signal }
      )
    )
  );
}

// Live feed for the human.
document.modelContext?.addEventListener("toolchange", refreshToolPanel);

// Built-in manual inspector (works with no agent attached).
async function runByHand(name, args) {
  const tool = (await document.modelContext.getTools()).find((t) => t.name === name);
  // Second argument MUST be a JSON string. An object throws
  // UnknownError: Failed to parse input arguments.
  return document.modelContext.executeTool(tool, JSON.stringify(args));
}
```

---

## 18. Typings and helper packages

- `webmcp-types` (npm) — official TypeScript typings for the imperative API, recommended by
  Chrome's imperative-api page and linked from the spec README.
- React: Chrome names the **`usewebmcp`** package (*"React has experimental support for WebMCP using
  the `usewebmcp` package… The `useWebMCP` hook also provides schema-driven type inference and exposes
  local execution state."*). CONTEXT.md's `use-webmcp-tool` is a different/incorrect name —
  **UNVERIFIED**, and irrelevant if the Dojo stays vanilla.
- Angular: experimental support, DI-lifecycle registration + Signal Forms → tools.
- Cloudflare's hand-rolled hook (no dependency) is the cleanest reference:
  `cloudflare/agents/examples/webmcp-react/src/useWebMCPTools.ts`.

Minimal `.d.ts` if you want types with zero deps (from `cloudflare/agents/examples/webmcp-react/src/webmcp.d.ts`):

```ts
declare global {
  interface WebMCPTool {
    name: string;
    description: string;
    inputSchema: object;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    execute(input: unknown): Promise<unknown>;
  }
  interface WebMCPRegisterToolOptions { signal?: AbortSignal }
  interface Document {
    readonly modelContext?: {
      registerTool(tool: WebMCPTool, options?: WebMCPRegisterToolOptions): Promise<void>;
    };
  }
  interface SubmitEvent {
    readonly agentInvoked: boolean;
    respondWith(response: Promise<unknown>): void;
  }
}
```

---

## 19. Open UNVERIFIED items (say "unverified" if you cite these anywhere public)

1. Whether ChatGPT picks up tools registered after page load, and the latency. No first-party source. (§13)
2. Whether a real agent invocation passes the `ToolExecuteCallbackOptions` second argument to
   `execute`. Chrome documents it; Chrome 152's `executeTool` path does not deliver it. (§4c)
3. Whether `toolactivated` / `toolcancel` window events actually fire in Chrome 152 (the `on*` IDL
   attributes are absent; spec has them as `Issue(#146)`). (§15)
4. Chrome 153's "unregister without cancelling in-flight executions" behavior — 152 is stable today,
   untested.
5. The npm package name for the React hook (`usewebmcp` per Chrome vs `use-webmcp-tool` per CONTEXT.md).
6. Whether ChatGPT enforces the 500 / 150 / 30 / 1.5K character budgets or merely degrades. Chrome
   calls them recommendations; Chrome 152 enforces none of them.
