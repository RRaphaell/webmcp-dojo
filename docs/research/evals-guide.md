# WebMCP evals and tool design: the official format, and how The Dojo should mirror it

Research pass, 2026-09-03. Everything below is quoted or read directly from primary sources. Nothing is inferred from a filename.

## Sources actually read

| Source | URL | Published / last updated |
|---|---|---|
| Evals for WebMCP (Kasper Kulikowski) | https://developer.chrome.com/docs/ai/webmcp/evals | Published May 19 2026, updated May 28 2026 |
| Build your user's agentic workflows with WebMCP tools (Andre Cipriani Bandarra) | https://developer.chrome.com/docs/ai/webmcp/build-tools | Published Aug 26 2026 |
| WebMCP best practices (Alexandra Klepper) | https://developer.chrome.com/docs/ai/webmcp/best-practices | Published May 18 2026 |
| WebMCP tool security (Julia Pagnucco, Alexandra Klepper) | https://developer.chrome.com/docs/ai/webmcp/secure-tools | Published Jun 9 2026, updated Jul 1 2026 |
| The evals CLI itself | https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals | clone at commit `41cb97a29002a2f2d3fb3ab05bde92652118c667`, 2026-09-02 |
| Published package | `npm i -g webmcp-evals` / `npx webmcp-evals` | latest `0.0.4`, Apache-2.0 |
| Create AI evaluations (course, linked twice from the evals guide) | https://developer.chrome.com/docs/ai/evals | course index |

Verification notes (checked, not assumed): the `evals-cli` URL printed in the evals guide returns **404**; `webmcp-evals` returns 200. The npm tarball for `webmcp-evals@0.0.4` was unpacked and confirmed to contain all four commands (`local`, `browser`, `smoke`, `analyze`) and the `optional` matcher logic, so `npx webmcp-evals` is not behind git HEAD in any way that matters to us.

Note on the name. The evals guide's last link says "Download our experimental evaluation tools on GitHub" and points at `.../webmcp-tools/tree/main/evals-cli`. That path 404s today; the directory was renamed to **`webmcp-evals/`**. The participant who mentioned "Google's WebMCP evals CLI" means this. It is published to npm as `webmcp-evals`, so `npx webmcp-evals <command>` works with no clone.

---

## 1. The official eval task format

An eval suite is a **JSON array of test cases**. Each case is `{ name?, messages[], expectedCall }`. Types, verbatim from `webmcp-evals/src/types/evals.ts`:

```ts
export type Eval = {
  name?: string;
  messages: Message[];
  expectedCall: ExpectedCallNode[] | null;
};

export type FunctionCall = {
  functionName: string;
  arguments?: object | null;   // omitted/null = no constraint on args
  result?: unknown;            // optional assertion on the tool's return value
  mockOutput?: unknown;        // what to feed the model in `local` mode
  optional?: boolean;          // may or may not fire; contributes no PASS and no FAIL
};

export type ExpectedCallNode =
  | FunctionCall
  | { unordered: ExpectedCallNode[] }
  | { ordered: ExpectedCallNode[] };
```

Messages are one of three shapes, which is how you pre-seed an agent into a mid-trajectory state:

```ts
type ContentMessage          = { role: "user" | "model"; type: "message"; content: string };
type FunctionCallMessage     = { role: "model"; type: "functioncall"; name: string; arguments: object };
type FunctionResponseMessage = { role: "user"; type: "functionresponse"; name: string; response: object };
```

### 1a. Minimal case (verbatim, from the evals guide)

```json
{
  "messages": [
    {
      "role": "user",
      "content": "I'd like a small pizza."
    }
  ],
  "expectedCall": [
    {
      "functionName": "set_pizza_size",
      "arguments": { "size": "Small" }
    }
  ]
}
```

The guide's framing: "`expectedCall` is used to perform a rule-based, deterministic test." The shipped example file adds `name` and `type` (`webmcp-evals/examples/pizza-maker/evals.json`):

```json
{
  "name": "Set Pizza Size: Small",
  "messages": [
    { "role": "user", "type": "message", "content": "I'd like a small pizza." }
  ],
  "expectedCall": [
    { "functionName": "set_pizza_size", "arguments": { "size": "Small" } }
  ]
}
```

### 1b. Constraint operators (README table, verbatim)

| Operator | Description | Example |
|---|---|---|
| `$pattern` | Regex match | `{"$pattern": "^2026-\\d{2}$"}` |
| `$contains` | Substring match | `{"$contains": "York"}` |
| `$gt`, `$gte` | Greater than (or equal) | `{"$gte": 1}` |
| `$lt`, `$lte` | Less than (or equal) | `{"$lte": 120}` |
| `$type` | Type check | `{"$type": "string"}` |
| `$any` | Field presence check | `{"$any": true}` |

`$pattern` also accepts a POSIX inline-flag prefix, e.g. `"(?i)^colou?r$"`; the matcher strips `(?flags)` and passes `d g i m s u v y` to `new RegExp`. Unknown flags throw.

A real case using them plus a `result` assertion (`examples/french-bistro/evals.json`):

```json
{
  "name": "Book Bistro Table: Bob Smith Terrace Anniversary",
  "messages": [
    { "role": "user", "type": "message",
      "content": "Can I get a table at the bistro for 2 people on the Terrace tomorrow at 18:30? The name is Bob Smith, phone 555-123-4567. We are celebrating an anniversary." }
  ],
  "expectedCall": [
    {
      "functionName": "book_table_le_petit_bistro",
      "arguments": {
        "name":     { "$pattern": "Bob.*Smith" },
        "phone":    { "$pattern": "555.*123.*4567" },
        "time":     "18:30",
        "date":     { "$type": "string" },
        "guests":   "2",
        "seating":  "Terrace",
        "requests": { "$contains": "anniversary" }
      },
      "result": "pending form submission"
    }
  ]
}
```

### 1c. Ordering: `ordered` / `unordered` (verbatim from the evals guide)

```json
{
  "messages": [
    {
      "role": "user",
      "content": "I am looking to buy a black jacket and a pair of jeans.
        Could you provide a breakdown of the materials used ?"
    }
  ],
  "expectedCall": [
    { "functionName": "navigate_to_category", "arguments": { "category": "clothes" } },
    {
      "unordered": [
        { "ordered": [
            { "functionName": "search_clothes",      "arguments": { "query": "black jacket" } },
            { "functionName": "get_product_details", "arguments": { "productId": "JACKET002" } }
        ]},
        { "ordered": [
            { "functionName": "search_clothes",      "arguments": { "query": "jeans" } },
            { "functionName": "get_product_details", "arguments": { "productId": "JEANS001" } }
        ]}
      ]
    }
  ]
}
```

### 1d. Negative test: `"expectedCall": null`

This is the officially supported "the agent should NOT call a tool" case. Six shipped examples use it. From `examples/healthcare/evals.json`:

```json
{
  "name": "Chest Tightness Emergency (No expected tool)",
  "messages": [
    { "role": "user", "type": "message", "content": "My chest is tight and I can't breathe, help!" }
  ],
  "expectedCall": null
}
```

From `examples/events/evals.json`, a scope test (the site has no restaurant tool):

```json
{
  "name": "Book Restaurant: Ginno's Pizza",
  "messages": [
    { "role": "user", "type": "message", "content": "Create a restaurant reservation for three at Ginno's pizza for tomorrow at 7PM" }
  ],
  "expectedCall": null
}
```

### 1e. Optional calls (tolerating an eager model)

`examples/hotel-chain/evals.json`:

```json
{
  "name": "Hotel Chain: Search Tokyo and filter amenities",
  "messages": [
    { "role": "user", "type": "message", "content": "I am looking for a hotel in Tokyo - filter for gym and breakfast" }
  ],
  "expectedCall": [
    { "functionName": "search_location",           "arguments": { "query": "Tokyo" } },
    { "functionName": "filter_search_results",     "arguments": { "amenities": ["gym", "breakfast"] } },
    { "functionName": "get_current_search_results","arguments": {}, "optional": true }
  ]
}
```

Source comment on `optional`: "A skipped optional contributes no PASS, no FAIL, and no consumed actual - it's simply omitted from the reconciliation."

### 1f. Pre-seeded mid-trajectory state

`examples/travel/evals.json` puts the agent into a state by replaying a prior call and its response, then asks the follow-up:

```json
{
  "name": "Filter Flight: Add Direct Filter to $300-$800 Range",
  "messages": [
    { "role": "user",  "type": "message",          "content": "Filter for price between 300 and 800" },
    { "role": "model", "type": "functioncall",     "name": "filterFlights", "arguments": { "minPrice": 300, "maxPrice": 800 } },
    { "role": "user",  "type": "functionresponse", "name": "filterFlights", "response": { "result": "Filters successfully updated." } },
    { "role": "user",  "type": "message",          "content": "Show me only direct flights" }
  ],
  "expectedCall": [
    { "functionName": "filterFlights", "arguments": { "minPrice": 300, "maxPrice": 800, "stops": [0] } }
  ]
}
```

The guide calls this out for **mid-chain failure testing**: "you can manually execute this sequence of tool calls, without the interacting with a model, to simulate this scenario. Bring your application to the state where you anticipate the tool fails."

### 1g. The tool-schema file (`local` mode)

`local` mode does not need a browser. It reads a static schema file shaped `{ "tools": [ { name, description, inputSchema, outputSchema } ] }`. The guide is explicit that you must supply the **full tool list for the state you are testing**, not just the tool under test:

> "On opening, WebMCP exposes `add_topping`, `set_pizza_size`, and `set_pizza_style` tools. To accurately test any of these individual tools, you should include all of the tools to create a simulated, complete state."
> "NOTE: An agent might have access to additional tools, but the best you can do is evaluate the tools you provide."

---

## 2. How success is judged

Scoring lives in `webmcp-evals/src/utils.ts` and `src/matcher.ts`. The unit of scoring is a **step**, not a case: one expected call = one row = one pass/fail.

`functionCallOutcome(expected, actual)` returns `"pass"` only if all of:

1. `expected === null && actual === null` -> pass (the negative test).
2. `expected.functionName === actual.functionName`.
3. If `expected.arguments != null`, `matchesArgument(expected.arguments, actual.args)`.
4. If `expected.result !== undefined`, `matchesArgument(expected.result, actual.result)`.

Matching semantics, from the source comments:

- **Objects are subset-matched.** "every key present in `expected` must exist in `actual` with a matching value, but extra keys in `actual` are ignored." So an eval can constrain only the args it cares about.
- **Arrays are strict.** Same length, positional match. "Arrays are typically meaningful sequences (`line_items`, `selected_options`, ...) where silently accepting extra elements would surprise authors more often than help."
- A constraint object is one where **all** keys start with `$`.
- `unordered` groups are resolved with **maximum bipartite matching** (DFS augmenting paths), because constraint objects can match several actual calls unequally.
- **Extra, unexpected calls fail.** `evaluateExecutionTrajectory` appends `...executions.slice(consumed).map(actual => ({ expected: null, actual, outcome: "fail" }))`. This is the built-in efficiency penalty: every call beyond the expected trajectory is a FAIL row.
- If `expectedCall` is null and the agent called nothing, that is a single `pass` row. If `expectedCall` is null and the agent called anything, every call is a `fail` row.
- Outcomes are three-valued: `pass` / `fail` / `error`. `error` is a thrown exception (page never registered tools, model call blew up), tracked separately.

The system prompt the CLI gives the agent under test is short and worth copying (`src/evaluator/prompts.ts`):

```
# INSTRUCTIONS
You are an agent helping a user navigate a page via the tools made available to you. You must
use the provided tools to query page content when you absolutely need it.
CRITICAL RULE: Do not try to use other tools than the available ones. Never use more tool calls than necessary.

# ADDITIONAL CONTEXT
Today's date is: <new Date().toDateString()>.
```

There is also an **LLM-as-judge layer**, but it judges the *report*, not the run: the `analyze` command feeds the JSON report plus WebMCP guidance to a model with three fixed hypotheses:

> 1. Model Logic Failure: Did the LLM fail to follow instructions or send invalid parameters?
> 2. App/Tool API Failure: Is the application's tool description confusing, or did the tool return broken results?
> 3. Test/Assertion Over-Rigidity: Did the model behave correctly/smartly (e.g., self-correcting), but the test assertion was too strict?

and a fixed markdown skeleton: `## 1. Summary`, `## 2. Failed Trajectories & Deep Dives`, `## 3. Root Cause Hypotheses`, `## 4. Actionable Fixes`.

---

## 3. How to run it

Four commands: `local`, `browser`, `smoke`, `analyze`.

```bash
# static schema, no browser
npx webmcp-evals local   -t examples/pizza-maker/schema.json -e examples/pizza-maker/evals.json

# live page, Puppeteer + Chrome, real WebMCP tools
npx webmcp-evals browser -u https://example.com/demo -e examples/pizza-maker/evals.json --open

# deterministic, no LLM, no API key: replays expectedCall against the live page
npx webmcp-evals smoke   -u http://localhost:3000 -e examples/pizza-maker/evals.json -v

# LLM post-mortem on a JSON report
npx webmcp-evals analyze .evals/report-1784621327799.json --open
```

Global options (defaults in parentheses): `-b, --backend` (`vercel`), `-m, --model` (`gemini-3.5-flash`), `-r, --runs` (`1`), `--max-steps`, `--reporter` (`console html`), `-o, --output-dir` (`.evals`), `--analyzer-model`, `--open-analysis`, `--chrome-channel` (`chrome-canary`).

Backends: `vercel` (Vercel AI SDK, the default), `gemini` (`@google/genai`), `ollama`. **The `vercel` backend already speaks Anthropic and OpenAI** - `src/evaluator/models.ts` routes on a model-id prefix:

```ts
if (config.provider === "anthropic" || modelId.startsWith("anthropic:")) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return createAnthropic({ apiKey, baseURL: process.env.ANTHROPIC_BASE_URL })(
    modelId.replace("anthropic:", ""));
}
```

So `-m "anthropic:claude-..."` with `ANTHROPIC_API_KEY` in `.env` works with the stock CLI, and `openai:` likewise (it deliberately uses Chat Completions, not Responses, for gateway compatibility). `.env` keys read: `GOOGLE_AI`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_HOST`, plus `*_BASE_URL` overrides.

Browser mode mechanics worth knowing before we lean on it:

- `puppeteer.launch({ browser: "chrome", channel: "chrome-canary", headless: true, args: ["--enable-features=WebMCP", "--no-sandbox", "--disable-setuid-sandbox"] })`.
- It reads tools with `page.webmcp.tools()`, a `puppeteer-core@^25.4.0` API. Not a `document.modelContext` shim we control.
- **Fresh page per case**, `waitUntil: "networkidle2"`, 30s timeout.
- If zero tools are registered it throws with an explicit debug line naming URL, channel, and flags.
- It re-reads the tool list on every step via `prepareStep`, so **dynamic registration and unregistration is a first-class, tested case**. That is exactly the Dojo's belt-switching design, and the official harness will follow it.
- It captures browser console errors and page errors during each tool call and attaches them to the result as `browserConsoleErrors`.
- Local mode caps the loop at `DEFAULT_MAX_STEPS = 6` via `stopWhen: stepCountIs(maxSteps)`.

---

## 4. What metrics they report

**Console summary.** Header `Evaluation summary`, then a `cli-table3` with columns:

```
Step | Status | Expected Function | Actual Function | Details
```

grouped by `Test Case: <name>` rows and ` • [Run N]` rows. `Status` is `PASS` in green or the uppercased outcome (`FAIL` / `ERROR`) in red. `Details` comes from `getFailureDetail`, which emits exactly one of:

- `-` (pass)
- `No tool called`
- `Unexpected tool call`
- `Function mismatch (expected "X", got "Y")`
- `Arguments mismatch`
- `Result mismatch: expected "...", got "..."` (actual truncated to 37 chars + `...`)
- `Execution error` / `Failed`

Then the single summary line:

```
Pass count (steps): 7/9 (77.8%)
```

**Smoke summary.** Header `Smoke Test Summary for <url>`, columns `Case | Step | Status | Tool | Error`, then `Passed steps: X/Y across N case(s).` Exit code 1 if any errors.

**HTML report** (`.evals/report-<timestamp>.html`): a `Configuration` block (Tool definitions, Evals, Backend, Model, Chrome channel) and a five-tile `Summary` grid:

```
Total Evals | Passed | Failed | Errors | Pass Rate
```

plus `Evaluated N test cases across R runs.` and per-case `X/Y Passed`.

**JSON report** (`.evals/report-<timestamp>.json`): `{ config, results: { results[], testCount, passCount, failCount, errorCount } }`, where each result carries `test`, `response`, `outcome`, `trajectory` (per step: `text`, `reasoningText`, `toolCalls`, `toolResults`, `availableTools`), `browserConsoleErrors`, `runIndex`, `stepIndex`. This is the file `analyze` consumes.

So the five numbers to reproduce are **Total Evals, Passed, Failed, Errors, Pass Rate %**, over **steps**, with **runs** stated.

---

## 5. Tool-design rules the guides state

### 5a. Design method (build-tools)

Four steps, in order: **define the user goal** (ideal outcome, required context, boundaries, which journeys to prioritise) -> **define the initial state** (application state, agent context, system constraints) -> **role-play the conversation** turn by turn ("Map the conversation... Analyze tool and site needs... Iterate and refine") -> **evaluate**.

The worked flight example produces tools by asking, at each turn, what the agent needs: `get_user_profile()`, `search_flights(...)`, `filter_flights(criteria={"stops": 0, "class": "economy"})`, `lookup_flight(airline='DL')`, `book_flight(flight_id="delta_123")`.

### 5b. Ask for missing parameters, do not assume (verbatim)

> "A user may be vague when asking for help from an agent. For example, they may say 'I need to go to NYC next week.' This request doesn't indicate a specific day, so you should build tools that are flexible enough that for the agent to ask for missing parameters ('Which day next week?'), instead of making assumptions which may lead to failure."

### 5c. Error messages that guide, not dead-end (verbatim, all four)

> "the response should act as a guide rather than a dead end. Always provide context-aware feedback to help the agent recover; avoid returning generic error messages, raw API errors, or failing silently."

- Wrong state or missing prerequisites: `filter_flights` before `search_flights` -> **"No flight search results found. Search for flights first."**
- Invalid parameters: wrong date format -> **"Invalid date format. Provide the date in YYYY-MM-DD format."**
- Unexpected return values: empty/malformed external result -> **"No flights found matching your criteria. Try adjusting your search parameters."**
- Business logic violations: `cancel_order` on a shipped item -> **"Order 123 has already shipped. Redirect the user to the returns policy."**

### 5d. Naming and description (best-practices)

- One function per tool; no overlapping tools. "The more tools you provide and the more the tools have overlap, the harder it is for the agent to pick correctly."
- **Distinguish execution from initiation in the verb.** "`create-event` is a tool for immediate event creation, but `start-event-creation-process` is a tool that redirects the user to a form to create the event."
- Positive language only. Don't: `"Don't use this tool for weather."` Do: `"This tool can create a calendar event, scheduled for a specific date and time."` "Limitations should be implicit in a well-written description."
- "Trust the agent to complete the task. Instead of writing rigid or negative instructions, assume the agent is able to understand what is required."
- Register tools when useful in a page state, unregister when they are not. "For most applications, static registration should be the default approach." (The Dojo's per-belt registration is the documented exception, and it is what browser-mode evals re-read every step.)

### 5e. Minimize cognitive computing (best-practices)

- **Accept raw user input.** "if a user says, '11:00 to 15:00,' the tool should accept this as a string. Avoid asking the model to calculate the minutes between these times."
- Declare specific types: string, number, enum.
- **Explain why.** "declare shipping type with natural language instead of using an ambiguous ID: `shipping="Express"` instead of `shipping_id=1`."

### 5f. Reliability (best-practices)

- Graceful failure on rate limits; return a meaningful error or tell the user to do it manually.
- **Update the interface state after functions complete.** "Agents may rely on the interface to plan next steps."
- **"Validate strictly in code, loosely in schema."** "schema constraints... are not guaranteed. Add descriptive errors to your function code to allow the model to self-correct and retry with new, valid parameters."
- Do not patch a specific model's quirk with a narrow rule; abstract the tool, or make the field optional and have the agent ask the user.

### 5g. Security and annotations (secure-tools)

- `untrustedContentHint` on any tool returning user-generated or externally sourced content. "This field explicitly labels the payload as untrusted... a signal to the agent that this data requires heightened scrutiny."
- `readOnlyHint` on non-state-changing tools. "This allows the agent to make better decisions about when to ask for user confirmations."
- `exposedTo: ['https://trusted.com']` in the `registerTool` options object controls cross-origin exposure. Default is no cross-origin observation.
- `requestUserInteraction()` is in the spec draft "to asynchronously request user input at tool execution."

### 5h. Character budgets (secure-tools, verbatim)

> - 500 characters per tool description
> - 150 characters per parameter description
> - **30 characters per tool name and parameter name**
> - 1.5K character limit per individual tool output

Framing: "To avoid running into agent guardrails, write succinct tool descriptions and outputs." Note the **30-character name limit** is not in our CONTEXT.md section 6. Add it.

### 5i. Failure taxonomy from the evals guide (use this as the Dojo's belt taxonomy)

| Failure | Example | Diagnostic questions the guide asks |
|---|---|---|
| Agent selects the wrong tool | "The agent skips `addToCart` and goes directly to `checkout`." | Is the `description` clear, complete, accurate? Is the `functionName` intuitive? Is the tool exposed in the current state/context? Is the schema too similar to another tool, leading to call ambiguity? |
| Agent calls tools in the wrong order | "The agent calls `checkout` and then `addToCart`." | Do descriptions overlap, confusing the required sequence? Does the preceding tool's output provide necessary context? Is state correctly updated and new tools exposed? Is the use case still correct in a different order? Have you tested the chain in isolation by forcing the preceding calls? |
| Agent calls tool with incorrect arguments | "The agent calls `addToCart`, but adds shoes instead of a t-shirt." | Is `inputSchema` clearly defined, including `enum` values and a `description` per property? Are required parameters explicitly marked? Does the argument description guide the LLM on mapping user input to structured data? |
| Tool output is incorrect or incomplete | "The user asks to `viewCart`, but the agent outputs the total cart cost, instead of the product names and individual prices." | Bugs in tool logic? UI state updated and side effect reported? Output formatted clearly for LLM ingestion? **Is the output overly verbose?** |
| Tool throws | any JS failure | Runtime errors handled? Error reported back gracefully? External services healthy? **"Is the error structure clear enough that the model can differentiate between a temporary issue (retry) and a critical failure?"** |

And the four things evals should check, verbatim:

> - Check that the model understands your tool's purpose, based on its description and schema.
> - Verify that the model chooses the right tool with the correct parameters to support user intent.
> - Confirm that the model is acting upon information it received, for example to use information to call another tool.
> - Verify successful user journeys.

Plus: "You should continue to write classic deterministic tests for any system interaction that doesn't communicate with the model," and on dataset design: "include both direct queries that test baseline tool execution and open-ended queries that test model reasoning and tool selection logic."

---

## 6. Recommendation: how The Dojo's eval harness should be shaped

The goal is that a judge who has read Sarah Drasner's evals-guide link opens `evals/` and immediately recognises the format. Three concrete moves.

### Move 1: adopt the official schema verbatim. Do not invent one.

Ship `evals/dojo.evals.json` as a plain JSON array of `{ name, messages, expectedCall }` using `type: "message"`, `$pattern` / `$contains` / `$type` / `$any` / `$lte`, `ordered` / `unordered`, `optional: true`, and `expectedCall: null`. Same key names, same casing (`functionName`, not `tool` or `name`). Also ship `evals/dojo.schema.json` in the `{ "tools": [ { name, description, inputSchema } ] }` shape, generated from the belt modules so it cannot drift.

Payoff: both official commands run against us with zero adaptation, and the README can say so:

```bash
npx webmcp-evals browser -u https://<dojo-url> -e evals/dojo.evals.json -m "anthropic:claude-..."
npx webmcp-evals local   -t evals/dojo.schema.json -e evals/dojo.evals.json
npx webmcp-evals smoke   -u http://localhost:8788 -e evals/dojo.evals.json -v
```

That line in the README is worth more than any harness we write ourselves, because it is a third-party-verifiable claim. Verify at least the `local` and `smoke` paths actually run before printing the command; do not print an unrun command.

### Move 2: our own runner, same format, same output, no Chrome dependency

The official `browser` mode needs Chrome Canary, `puppeteer-core@25`, and `page.webmcp.tools()`. That is a fragile overnight dependency and it will not run on a judge's laptop either. So write `evals/run.mjs` (Node, ~200 lines, `@ai-sdk/anthropic` + `ai`, key from `../.secrets.env`) that:

1. **Imports the belt tool modules directly.** Refactor each belt to `src/belts/<belt>.js` exporting `{ id, tools: [{ name, description, inputSchema, annotations, execute }] }` where `execute` closes over an injected plain state object. The page calls `document.modelContext.registerTool(...)` over that list; the harness imports the same list. One source of truth, real tool logic, no browser, no mocks. This also directly answers judging criterion 1 (a non-trivial WebMCP implementation) because the tool layer is provably the same code the page ships.
2. Drives the model with `generateText` + `stopWhen: stepCountIs(N)` and the **official system prompt from `src/evaluator/prompts.ts`, quoted with attribution** in a comment. Reusing their prompt is the point: it makes our numbers comparable to theirs.
3. Collects every tool call across every step (name, args, result, latency) exactly as `VercelBackend` does.
4. Scores with a port of `functionCallOutcome` + `evaluateExecutionTrajectory`: subset-match objects, strict arrays, `$` constraints, bipartite matching for `unordered`, extra calls become FAIL rows, `expectedCall: null` passes only on zero calls.
5. Prints **their** table and **their** summary line, verbatim in shape:

```
Evaluation summary

Step | Status | Expected Function | Actual Function | Details

Pass count (steps): 27/31 (87.1%)
```

and writes `.evals/report-<ts>.json` with `{ config, results: { results, testCount, passCount, failCount, errorCount } }` so `npx webmcp-evals analyze` works on our report too. Paste the table plus `Total Evals / Passed / Failed / Errors / Pass Rate` into the README as CONTEXT section 8 requires.

Run it against at least two models (a Claude and a GPT) and `-r 3` if time allows; the report format already carries `runIndex`, and "across 3 runs" is the line that signals we understand probabilistic testing.

### Move 3: express each belt as an official primitive, and say which one

The Dojo's six belts map one-to-one onto the official vocabulary. Put this mapping in the README; it is the cheapest possible proof that the Dojo is built on Chrome's own framework rather than beside it.

| Belt / what it tests | Official primitive | Shape |
|---|---|---|
| Prompt-injection trap | negative test | `"expectedCall": null` after a tool result carrying injected text; any call to the bait tool is a FAIL row |
| Ambiguity (ask, don't guess) | negative test | `"expectedCall": null` on an under-specified request; matches build-tools 5b verbatim |
| Error recovery | pre-seeded state + guiding error | `messages` with `functioncall` + `functionresponse` putting the agent in the wrong state, then expect the recovery call. Error strings modelled on "No flight search results found. Search for flights first." |
| Efficiency (call count) | extra-call penalty + `optional` | expected trajectory lists the minimum path; tolerated extras marked `optional: true`; everything beyond `consumed` fails automatically |
| Ordering / read-then-write | `ordered` + `unordered` | mirror the black-jacket-and-jeans example |
| Asymmetric (human must contribute) | `$any` / `$pattern` | the arg can only be obtained from the human channel, so `{"$pattern": "..."}` on it proves the human-agent handoff happened |
| Correct-tool-selection baseline | plain `expectedCall` | one direct query, one open-ended query per belt, per the guide's dataset advice |

Two extra things to ship because they are cheap and legible:

- **`evals/budget-check.mjs`**: assert every registered tool against the secure-tools numbers (name <= 30, description <= 500, each param description <= 150, each `execute` output <= 1500 chars) and print a pass table. Wire it into the same npm script. This turns CONTEXT section 8's "budgets respected and documented" into a machine-checked claim with a number next to it.
- **A `--json` flag** so the whole thing is one command in CI and one command in the video.

### Naming and script wiring

```json
"scripts": {
  "evals": "node evals/run.mjs",
  "evals:budget": "node evals/budget-check.mjs",
  "evals:official": "npx webmcp-evals local -t evals/dojo.schema.json -e evals/dojo.evals.json"
}
```

Directory `evals/`, report dir `.evals/` (gitignored except one committed sample report). Both match the CLI's own conventions.

### What not to do

- Do not invent metric names. "Belt rank" is the product surface; the harness prints Pass Rate over steps.
- Do not hard-code model-specific fixes into tool descriptions (best-practices 5f explicitly warns against it), and do not tune an eval until it passes. A failing belt with an honest number is better evidence than a green board.
- Do not claim the official CLI passes against our live URL unless we have actually run it.
