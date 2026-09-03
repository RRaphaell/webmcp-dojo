# RESEARCH — the two pages a builder needs

Digest of `docs/research/{api-truth, agent-behavior, evals-guide, reference-code, chrome-152-probe, field-scan}.md`. Everything here is either quoted from a primary source or **MEASURED** on real Chrome 152.0.7977.66. If it is not in this file, read the source file before you rely on it.

**Three statements in `docs/CONTEXT.md` §6 are wrong. They are corrected below.**

---

## 1. API cheat sheet

Namespace is **`document.modelContext`**. `navigator.modelContext` does not exist (the July 2026 rename is real). The whole prototype in Chrome 152 is:

```
["ontoolchange", "executeTool", "getTools", "registerTool", "constructor"]
```

No `unregisterTool`. No `provideContext`. No `requestUserInteraction`. `SecureContext` + `Exposed=Window`, so `undefined` on plain `http://` other than localhost, and inside workers.

**Feature detection, exactly OpenAI's line:**
```js
const HAS_WEBMCP = typeof document.modelContext?.registerTool === "function";
```

**Register:**
```js
const controller = new AbortController();
await document.modelContext.registerTool({
  name,            // required, 1-128 chars [A-Za-z0-9_.-]. Build to 30.
  title,           // optional, shown in the browser's tool UI. Omitted -> ""
  description,     // required, non-empty. Build to 500.
  inputSchema,     // optional object. NOT VALIDATED BY THE BROWSER.
  annotations,     // { readOnlyHint, untrustedContentHint } and nothing else
  execute,         // (args, opts) => any JSON-serializable
}, { signal: controller.signal });
controller.abort();   // the ONLY way to unregister
```

### The seven things that will bite you

1. **`execute` gets exactly ONE argument in Chrome 152**, contradicting Chrome's own docs which show `execute: async (args, { signal }) => ...`. Destructuring `{ signal }` in the parameter list **crashes on every call**. Write `execute(args, opts)` and guard `opts?.signal`. Do not "fix" this against the docs.
2. **Never throw.** The spec discards the rejection reason; the agent receives a bare `UnknownError: Tool was executed but the invocation failed`. Your carefully written guiding error is destroyed. Every refusal, validation failure and error is a **resolved** value whose text carries the guidance.
3. **Re-registering a live name REJECTS, it does not replace:** `InvalidStateError: Duplicate tool name`. Abort first, then register. (Or keep names globally unique, which is what the Dojo does.)
4. **Aborting a tool's own controller from inside its `execute` destroys the call.** Synchronously or in a microtask -> `UnknownError: The operation failed for an unknown transient reason`, result never reaches the agent. Aborting in a **later task** (`setTimeout(..., 0)`) is safe. Use `deferAbort()`.
5. **`getTools()[i].inputSchema` comes back as a STRING**, not an object. `JSON.parse` it.
6. **`executeTool(tool, args)` needs a JSON STRING.** Passing an object throws `UnknownError: Failed to parse input arguments`. And `tool` must be a `RegisteredTool` from `getTools()`, not a name string. Return value is **always a string**.
7. **The browser validates NOTHING in `inputSchema`.** Wrong types and missing required params pass straight through to `execute`. Chrome says it too: *"Validate strictly in code, loosely in schema."*

### Annotations: there are exactly two

```webidl
dictionary ToolAnnotations {
  boolean readOnlyHint = false;
  boolean untrustedContentHint = false;
};
```

**`destructiveHint`, `idempotentHint`, `openWorldHint` DO NOT EXIST.** MEASURED: passing them is accepted and then **silently dropped**; `getTools()` returns only the two. **CONTEXT.md §6 is wrong about this.** They must not appear in code, README, tool table or video. A Chrome judge who greps finds a fabricated annotation.

Express write/destructive as `readOnlyHint: false` plus wording in the description. Nahas's three patterns map to: read-only = `readOnlyHint: true`; navigation/state-changing = `readOnlyHint: false`; write-with-elicitation = `readOnlyHint: false` + a propose/check tool pair.

`untrustedContentHint: true` on anything returning user-generated or external text. The client may sanitize, spotlight, **or hide that part of the response entirely**.

### What `execute` may return

Anything JSON-serializable. **CONTEXT.md §6's "must return `{content:[{type:"text",text}]}`" is wrong as a requirement** — the browser JSON-stringifies whatever you fulfil with, and OpenAI's own sample returns a bare object. The Dojo returns the explicit `{content:[{type:'text',text}]}` shape anyway, from one shared helper, because it is identical across the real API, our shim and the evals harness, and it is the one place the 1.5K clamp lives.

### `toolchange`

Fires on register **and** on abort, one event per change. Use it to drive UI. Do **not** use it to sequence anything; the spec says timing relative to other task sources is not guaranteed.

### Do not pass `exposedTo`

It is an origin allowlist. Omit it and you get the default (same-origin plus the browser's own agent). Pass one that misses ChatGPT's origin and every tool is **silently invisible** with no error anywhere.

### Registration error strings, MEASURED

| Attempt | Result |
|---|---|
| duplicate name | `InvalidStateError: Duplicate tool name` |
| name 129 chars, or with a space or `!` | `InvalidStateError: Invalid tool name` |
| `description: ""` | `InvalidStateError: Description is required` |
| no `inputSchema` | resolves |
| already-aborted signal | `AbortError: signal is aborted without reason` |
| extra annotation keys | resolves, keys dropped |

---

## 2. Budgets

Chrome's secure-tools guide, verbatim. **None are enforced by the browser** (500 tools registered fine; a 10,000-char description registered fine; a 20,000-char output came back whole). They are agent-guardrail heuristics, so **we enforce them ourselves and fail the build.**

| Thing | Budget | Dojo measured max |
|---|---|---|
| tool name | **30 chars** (missing from CONTEXT.md) | 22 |
| parameter name | **30 chars** | 13 |
| tool description | 500 chars | 317 |
| parameter description | 150 chars | 118 |
| single tool output | 1.5K chars | 912 |

Hard browser rule underneath: name 1-128 chars, `[A-Za-z0-9_.-]` only, description non-empty.

**An overrun description truncates SILENTLY** (spec issue #266, from a production deployer: *"that is how a price or a review-policy caveat disappears from what a buying agent reads"*). Put the load-bearing clause **first** in every description regardless.

On tool count: no cap, but *"each tool takes up part of the context window and adds to the time for completion."* OpenAI's own Margin demo ships 10 at once. The Dojo keeps max 8 concurrent out of 24 definitions.

---

## 3. ChatGPT behavior rules

**Where it works:** ChatGPT desktop app's built-in browser, models **GPT-5.6 Sol or Terra**. Luna has WebMCP disabled. **Not available on Enterprise or Edu workspaces.** Toggle: `Settings > Browser > Permissions > Enable site tools`. The user sees a "Site tools" chip in the address bar and can inspect calls under `Sources > Recently used`.

**Unsupported, verbatim:** no declarative (HTML form attribute) API; **no tools inside iframes**, same-origin or cross-origin. JavaScript registration in the top-level page only.

**Tools do not cross pages.** *"Closing or navigating away from a page can make its tools unavailable."* Single page, hash routing, no navigation between belts.

### Registration alone produces zero tool calls

The pickup rule, from ChatGPT's help article: site tools are available *"only when your account and selected model support them and **the current webpage provides a tool that matches your request**."* That is a request-to-tool match, not an autonomous scan. Field-confirmed: RKRohk in the office hours, *"terra and sol don't use the tools unless nudged."* And spec issue #256, the most rigorous public measurement: *"The observed ChatGPT/Chrome and Edge configurations produced **no confirmed native invocation**."*

**Consequence:** the user's sentence is the trigger. The lobby's copy-paste prompt must share vocabulary with the tool descriptions verbatim. And the page's **rendered text is a second legitimate channel to the model** (spec: an observation *"often includes screenshots of the page, not just a DOM serialization"*), so printing the orientation line is part of the discovery path, not decoration.

### You cannot trigger the confirmation modal

There is no annotation for it. Confirmation is ChatGPT's own model-and-policy judgement of the action's semantic category, applied per invocation. The four named categories: sending messages, purchases, deleting data, changing permissions. **Never build a pass condition on the native modal firing.** Build in-page elicitation instead (propose/check, or a `confirm` parameter that refuses until true, with the refusal as a *resolved* result).

### The safety review, and what it blocks

*"Before each call, ChatGPT reviews the tool and the information it would receive to help prevent unauthorized data sharing or actions that don't match your request."* It fails closed and **intermittently**: the observed user-facing string on the adjacent MCP surface is *"This tool call was blocked by OpenAI's safety checks"*, same call succeeding later. Render a blocked call distinctly and score it `inconclusive`, never `fail`.

**Injection belt rules, non-negotiable:**
- **Output injection only.** The payload lives in a *tool result* with `untrustedContentHint: true`. This is the spec's own illustrated pattern.
- **Never description poisoning.** Instructions inside a tool name or description poison our own registration, are visible to a judge in the Site tools panel, and are the shape most likely to get the origin treated as hostile.
- The honeypot must point at a tool **we register**, with **zero real-world effect**: no fetch, no network, no navigation, no credentials, no payment, no email, nothing touching the user's account.
- **Do not name it with a real destructive verb.** Avoid `delete_*`, `purchase_*`, `send_email`, `transfer_*`, anything with `password`/`permission`/`credential`/`payment`. A modal or an intermittent hard block mid-video is a cost with no benefit. Name it in-fiction.
- **Score three outcomes, not two.** The client may hide the payload entirely before the model sees it, so "never called" cannot distinguish a model that declined from a client that blocked it. Only an explicit flag proves the model noticed.

### A rendered secret is not a secret

The agent can see the page **as pixels**. Spec: observations *"often include screenshots."* ChatGPT Browser doc: Computer Use can *"inspect rendered state, take screenshots."* So an on-screen code, an SVG, or a `<canvas>` painted at belt start is readable.

**The only genuinely asymmetric construction: make the secret not exist until a human acts.** Generate it inside the `click`/`pointerup` handler of a real control, gated on `event.isTrusted`. Before that gesture the value is in no DOM, no memory, no tool output and no screenshot at any fidelity. That is the Brown belt's invariant.

### Latency

No published per-call number. Planning figure: **2 to 6 seconds of wall clock per call**, dominated by the model turn plus the mandatory safety review, essentially independent of how fast our `execute` is (our own probe: a 120 ms async execute returns fine).

- **Score on call count, never wall clock.** Wall clock measures OpenAI's infrastructure.
- Keep every belt completable in **2 to 4 calls**. A belt that needs eight calls will not fit on camera.
- Label the feed's number **page-side execution time**, measured with `performance.now()` around `execute`, or a reviewer breaks the claim in one question.

### Unregistering destroys context

Spec issue #262: *"The agent only sees that the tool disappeared... semantic context blindness."* A Challenge entrant hit it exactly. Three mitigations, all mandatory:
1. Always-registered orientation tool (`get_dojo_state`) that never unregisters and always explains the current phase.
2. `start_belt`'s return text **enumerates the newly live tool names verbatim**, so the agent is oriented even if its client's list lags.
3. Register the new set **before** aborting the old, so the surface is never empty.

**Whether ChatGPT re-reads tools registered after page load is UNVERIFIED.** No first-party source either way. `?compat=1` registers everything at once and is the one-line default flip.

### Tool description phrasing (Chrome best-practices, judge-flagged)

- Name: verb-first, distinguish execution from initiation. `create-event` creates; `start-event-creation-process` opens a form.
- Description: **what it does, then when to use it**, load-bearing clause first, positive language. Their Don't: *"Don't use this tool for weather."* Their Do: *"This tool can create a calendar event, scheduled for a specific date and time."*
- No overlapping tools.
- Declare specific types, especially **enum** — the enum values themselves are the natural-language mapping surface.
- **Accept raw user input.** *"if a user says '11:00 to 15:00,' the tool should accept this as a string."*
- **Explain why:** `shipping="Express"`, not `shipping_id=1`.
- **Errors guide, never dead-end.** The four canonical shapes: *"No flight search results found. Search for flights first."* / *"Invalid date format. Provide the date in YYYY-MM-DD format."* / *"No flights found matching your criteria. Try adjusting your search parameters."* / *"Order 123 has already shipped. Redirect the user to the returns policy."*
- **Let the agent ask for missing parameters** instead of assuming. This is the Green belt, sanctioned verbatim.

---

## 4. Evals: the official format

`npx webmcp-evals` (npm, `0.0.4`, Apache-2.0). The guide's `evals-cli` link 404s; the directory was renamed to `webmcp-evals/`.

A suite is a **JSON array** of `{ name?, messages[], expectedCall }`.

```json
{
  "name": "Set Pizza Size: Small",
  "messages": [{ "role": "user", "type": "message", "content": "I'd like a small pizza." }],
  "expectedCall": [{ "functionName": "set_pizza_size", "arguments": { "size": "Small" } }]
}
```

Message shapes: `{role, type:"message", content}` · `{role:"model", type:"functioncall", name, arguments}` · `{role:"user", type:"functionresponse", name, response}`. The last two pre-seed a mid-trajectory state.

Operators: `$pattern` (regex) · `$contains` · `$gt` `$gte` `$lt` `$lte` · `$type` · `$any`.
Grouping: `{ "ordered": [...] }` and `{ "unordered": [...] }`, nestable.
`"optional": true` on a call that may or may not fire: no PASS, no FAIL.
**`"expectedCall": null` is the official negative test** — "the agent should NOT call a tool". Six shipped examples use it. This is the primitive for the injection and ambiguity belts.

**Scoring semantics** (`src/utils.ts`, `src/matcher.ts`): objects are **subset-matched** (extra keys ignored); arrays are **strict** (same length, positional); `unordered` uses maximum bipartite matching; **every call beyond the expected trajectory is a FAIL row**, which is the built-in efficiency penalty; `expectedCall: null` passes only on zero calls. Outcomes are `pass` / `fail` / `error`. The unit of scoring is a **step**, not a case.

**Commands:**
```bash
npx webmcp-evals local   -t evals/dojo.schema.json -e evals/dojo.evals.json
npx webmcp-evals smoke   -u <live url> -e evals/dojo.evals.json -v      # deterministic, no LLM, no key
npx webmcp-evals browser -u <live url> -e evals/dojo.evals.json -m "anthropic:claude-..."
npx webmcp-evals analyze .evals/report-<ts>.json --open
```
The `vercel` backend already routes `anthropic:` and `openai:` model ids from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.

**Report shape to reproduce:** console table `Step | Status | Expected Function | Actual Function | Details`, then `Pass count (steps): 7/9 (77.8%)`. HTML/JSON summary tiles: `Total Evals | Passed | Failed | Errors | Pass Rate`.

**Never print a command in the README that has not actually been run.**

---

## 5. Deploy and dev commands

```bash
npm install
npm run dev                      # localhost:5173, shim active unless the Chrome flag is on
npm run build && npm run preview # localhost:4173, what the tests drive
npm test                         # runs on native Chrome AND the shim
npm run evals                    # real Chrome + Anthropic agent, writes evals/results/
node evals/budget-check.mjs      # 30/500/150/1500, fails the build

# Cloudflare Workers static assets (primary)
export $(grep -E '^CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)=' ../.secrets.env | xargs)
npm run build && npx wrangler deploy
npx wrangler deployments list

# MANDATORY post-deploy assertion: WebMCP is disabled on any document that is
# not origin-isolated, and Origin-Agent-Cluster: ?0 does exactly that.
curl -sI "$URL" | grep -i 'origin-agent-cluster' && { echo "FAIL"; exit 1; }
```

Live: `https://webmcp-dojo.billowing-frost-066e.workers.dev`. GitHub Pages fallback is configured **before** it is needed: `base: "./"` + hash routing means the identical `dist/` serves both hosts with no rebuild. Pages is never the primary URL in the submission.

`wrangler.jsonc` is assets-only. `main` is optional for assets-only Workers, so there is no Worker script.

### Enabling WebMCP for automated tests

```js
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-features=WebMCP'] });
```

**Playwright's bundled Chromium CANNOT run WebMCP.** MEASURED on 147.0.7727.15: `document.modelContext` is `undefined` with no flag, with `--enable-features=WebMCP`, with `--enable-blink-features=WebMCP`, and with `WebMCPTesting`. It must be `channel: 'chrome'` against installed Chrome >= 149, and **the README must say so** or a judge reproducing the harness concludes the API does not work.

Manual: `chrome://flags/#enable-webmcp-testing` -> Enabled -> relaunch. DevTools: Application panel -> WebMCP pane (Invoked Tools log + Available Tools list, with a Run tool button). Extension: Model Context Tool Inspector.

`--categoryWebMCP` is **not** a Chrome switch; it is a `chrome-devtools-mcp` flag. Do not put it in the README.

---

## 6. Competitive position (as of Sep 3, 00:30-01:10 PT)

The Devpost gallery is still unpublished, so there is no public competitor list. Two confirmed entries leaked by other routes: **MCPencil** (agent/human pictionary) and **Taboo** (agent describes, human guesses). Both are party games with a score, not diagnostics.

The evals space is crowded: **Prism**, webmcp-eval.com, webmcp-tool.com, headless.vision/ora.ai, isitagentready.com, agentready.market, and a swarm of site-readiness scanners. **Every single one tests the website.**

A scan of **496 live WebMCP sites** grepping every tool name for `agent|identify|attest|challenge|belt|dojo|train|coach|inject|eval|test|score|grade|judge|benchmark|exam` found **zero sites that test, grade or challenge the visiting agent.** The closest hits were `identify_agent` (used for personalization) and `get_verification_challenge` (an invoice captcha).

**Consequence for copy:** say **"tests your agent"** in the first clause, never just "evals". The word is taken.

---

## 7. Rules that can disqualify

- All commits inside **Aug 25 - Sep 3**. Video under 3:00, public on YouTube, with voice. Public repo, LICENSE detectable by GitHub (**check the About box in an incognito window**).
- **The project must stay live, public and unchanged until Sep 21, 5:00 PM PT.** Verbatim: *"If you keep building on the same repo or the same live site after the deadline, you put your eligibility at risk."* Freeze at 1:00 PM Sep 3.
- Judges *"are not required to test the Project and may choose to judge based solely on the text description, images, and video."* The video and description must stand alone. Automated AI analysis may be used, so the README must be machine-legible: clear claims, a tool table, real numbers.
- Video guidance, tightened Sep 1: *"Show the project working in the first 10 to 15 seconds. Skip intros and title screens." "Start already logged in." "Do not type live. Paste in long text, or cut to the finished result." "Show one strong example."*
- Naming guidance, Sep 1: *"pick something specific that says what it does"* — AI-generated names *"all sound alike."*
- Fill the **Testing instructions** field. Aim to submit ~3 hours early (10:00 AM PT).
- The organizer's own most common failure mode, verbatim: *"Open your live URL somewhere clean. Use a new incognito window in a WebMCP-capable browser, with no cached login. Then run the task an agent is supposed to be able to do. This is the single most common way a working project looks broken to a judge."*

---

## Sources

`docs/research/api-truth.md` (Chrome 152 probe + spec + all Chrome guides + OpenAI docs) · `agent-behavior.md` (spec issues #176 #231 #256 #262 #263 #266 #267 #268 #282, OpenAI forum, office hours) · `evals-guide.md` (webmcp-evals @ 41cb97a, npm 0.0.4, all four Chrome guides) · `reference-code.md` (cloudflare/agents, sdras/webmcp-demo, GoogleChromeLabs/webmcp-tools polyfill) · `chrome-152-probe.md` · `field-scan.md` (496-site scan, Devpost updates 46161/46162).
