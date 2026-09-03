# Build log

Running record of what was done, why, and what is open. Newest at the bottom. Times in Pacific.

## Sep 2, 23:5x - repo created
- `gh repo create RRaphaell/webmcp-dojo --public --license mit`. GitHub detects the MIT license in the About box (rule: license "detectable and visible at the top of the repository page").
- Cloned to `projects/webmcp-hackathon/dojo/`. Secrets normalized into `../.secrets.env` (Cloudflare token + account id verified against the API; Anthropic key verified 200). Never inside the repo.

## Sep 3, 00:20 - autonomous overnight build starts
- Raphael: joined the hackathon on Devpost, going to sleep, returns ~10 AM to test in ChatGPT desktop, record the video, submit.
- Wrote `docs/CONTEXT.md` (the brief for every agent). Plan: fresh research + design panel workflow, then build, then evals, then adversarial review, then docs/video script.

## Sep 3, 00:35-01:05 - foundation + deploy pipeline
- Probed real Chrome 152: `--enable-features=WebMCP` exposes `document.modelContext`. Full semantics recorded in `docs/research/chrome-152-probe.md` (executeTool takes JSON-string args, returns a string; duplicate names reject; AbortSignal unregisters; only readOnlyHint/untrustedContentHint survive).
- Built `src/webmcp/{types,shim,registry}.ts`: shim mirrors the engine; registry logs every call (name, args, result, latency) and switches whole tool sets via AbortController. Enforces Chrome's budgets (500/150/1500 chars) at registration.
- `tests/`: Playwright harness that drives tools through real Chrome the way an agent runtime does (getTools + executeTool). `npm test` runs every test on native Chrome AND the shim. Registry test green on both.
- Deployed placeholder to Cloudflare Workers static assets: https://webmcp-dojo.billowing-frost-066e.workers.dev (wrangler, token from ../.secrets.env). Recon+design workflow (5 research + 3 proposals + 3 judges + synthesis, Opus) running in background.

## Sep 3, 00:2x - reference implementations studied
- Read in full: `cloudflare/agents` examples/webmcp-react (13 files), `sdras/webmcp-demo` (whole repo, 4 files, vanilla), `GoogleChromeLabs/webmcp-tools` shared polyfill + batch + pizza-maker + real-estate-map + page-agent + doors + Pages workflow, npm `use-webmcp-tool` v0.2.0 README (via registry.npmjs.org; npmjs.com 403s), Chrome imperative-api + secure-tools docs, Cloudflare wrangler config reference.
- Wrote `docs/research/reference-code.md`: verbatim patterns with sources, the full scaffold (wrangler.jsonc, package.json, vite.config.ts, folder layout, GitHub Pages fallback), and the `document.modelContext` dev shim design.
- Correction for CONTEXT.md section 6: the security budget also includes **30 characters per tool name and parameter name** (developer.chrome.com/docs/ai/webmcp/secure-tools). Tool-name regex from Chrome's own polyfill is `/^[a-zA-Z0-9_.-]{1,128}$/`; build to 30.
- Decisions locked: vanilla TS (no React), hash routing + `base: "./"` so one `dist/` serves Workers and Pages, assets-only wrangler (`main` is optional for assets-only Workers), always return explicit `{content:[{type:"text",text}]}`, never pass `exposedTo`, ship the shim in production as the human-only mode.

## Sep 3, 01:10-01:55 - agent-behavior research
- Wrote `docs/research/agent-behavior.md`: how Sol/Terra actually behave with site tools, from OpenAI docs (webmcp/browser/sites, incl. `.md` variants), the live W3C spec, four Chrome guides, and the webmcp spec issue tracker (where Challenge participants are filing field reports).
- Three corrections to CONTEXT.md section 6: (1) there is NO destructive hint in WebMCP - `ToolAnnotations` is exactly `readOnlyHint` + `untrustedContentHint`; `consequentialHint` was resolved by the CG on 2026-05-28 but has not landed. (2) `execute()` is `Promise<any>`, the MCP `{content:[...]}` shape is convention not requirement (OpenAI's own example returns a bare object). (3) the budget list is missing 30 chars per tool/param name.
- Biggest new risk found: spec issue #262 - unregistering a tool destroys the agent's context about why it vanished. That is our per-belt dynamic registration. Mitigation locked: one always-registered `get_dojo_state` tool, register-before-abort, and every belt's last result says in plain text what changed.
- Biggest new rule: never `throw` from `execute`. The spec discards the rejection reason (`completionSteps(null,false)`, bare `UnknownError`) so a thrown message never reaches the model. Every guiding error and refusal must be a resolved result.
- Q4 answered against us: the agent CAN see the page as pixels (spec: observations "often include screenshots"; ChatGPT Browser doc: "inspect rendered state, take screenshots"). A rendered code is NOT human-only. The human-only belt must generate its secret inside a trusted human click so it never exists before the click.
- X coverage is a gap: TwitterAPI.io returns 402 Payment Required (account out of credits).

## Sep 3, 00:38-00:46 - runtime, UI shell, two real-engine bugs found and fixed
- `src/runtime.ts`: belt lifecycle, always-on `get_dojo_state` + `start_belt` (never unregistered, so a tool-set change is never a dead end), non-blocking human channel (propose/check; a judge agent flagged that a blocking tool call could hang inside ChatGPT), `window.dojo` human-side hooks for the UI/tests/evals, report card encoded in the URL.
- `src/app.ts` + `src/ui/*` + `src/styles/app.css`: lobby (copyable prompt, belt list, how-to), belt view with human box, live feed (page-side ms, read/write badges), tool inspector (run by hand), report card with share link. Screenshot `docs/screenshots/00-shell-lobby.png`, no console errors, engine chip reads "WebMCP detected".
- **Engine finding 1:** `executeTool` right after a register/abort in the same tick can reject with a transient UnknownError. Harnesses retry.
- **Engine finding 2 (would have broken every belt's last tool in ChatGPT):** a tool that unregisters its own set synchronously during `execute()` gets its result destroyed. Fixed by deferring every abort to the next task (`deferAbort` in the registry). Probes in `../probe/`, notes in `docs/research/chrome-152-probe.md`.
- `tests/runtime.test.mjs`: full agent-style lifecycle (state → start → guiding errors → pass → next belt → propose/approve/commit → rank → URL card) green on native Chrome and shim.
- Panel result: all 3 judges picked the product-first design (42/42/41 of 50). Synthesis writing DESIGN.md.
