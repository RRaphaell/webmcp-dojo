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
