# THE DOJO — build context (read this first, every agent, every session)

**What this is:** the single brief for building "The Dojo", Raphael Kalandadze's entry to the OpenAI WebMCP Challenge. Any agent or session working on this repo reads this file first. It contains the product idea, the rules we must obey, the judging criteria we are optimizing for, the design constraints, the technical facts about WebMCP as it exists today, and the timeline.

**Hard deadline: Thursday Sep 3 2026, 1:00 PM Pacific.** Build started Thu Sep 3, 00:20 PT. Raphael is asleep and will return ~10:00 AM PT to do the human-only steps (test in ChatGPT desktop, record video, upload to YouTube, submit on Devpost by 12:30). Everything else is done autonomously overnight. After 1:00 PM nothing may be edited (repo, video, live site) - the organizers said so explicitly.

**Repo:** https://github.com/RRaphaell/webmcp-dojo (public, MIT, license detected by GitHub). Commit small and often. Every commit is evidence the work happened inside the window (Aug 25 - Sep 3).

---

## 1. The product in one paragraph

**The Dojo is a website that tests the AI agent visiting it.** A person opens the page inside the ChatGPT desktop app's built-in browser (or Chrome with WebMCP enabled). The page exposes WebMCP tools. The person asks their agent to take the Dojo. The agent works through a series of small, real challenges ("belts") using only the page's tools, while the person watches a live feed of every tool call, coaches when the agent gets stuck, and confirms the actions that need a human. At the end the person gets a shareable report card: what their agent is actually good at, where it failed, whether it resisted a prompt injection, whether it asked before guessing.

**The inversion that makes it new:** in every other WebMCP demo the agent is the operator doing chores for the human. In the Dojo the agent is the *subject*. The site is the examiner. Three competitors are building "test the website's tools" products; nobody is building "the website tests the agent."

**The thesis sentence (this is the answer to the submission form's question 3, it goes first in the video and the description):**
> A person and their agent can now find out together what the agent is actually good at, on a real site, in one sitting. That was impossible before, because no page could hand an arbitrary visiting agent a task and watch how it used it.

**Two real audiences:** (1) people who want to know what their agent can do before trusting it; (2) site owners shipping WebMCP tools who need to know whether agents can actually use them (Chrome published an evals guide for exactly this gap and no product fills it).

## 2. Rules we must obey (from webmcp.devpost.com/rules, re-read Sep 2 21:20 PT, unchanged)

Submission needs ALL of:
1. **Live URL** that works in ChatGPT's in-app browser (desktop app, models Sol/Terra) or Chrome 149+ with `chrome://flags/#enable-webmcp-testing`.
2. **Video under 3:00**, public on YouTube, with voice, showing the project working and how WebMCP is used. No copyrighted music. Judges are not required to watch past 3 minutes: best material first.
3. **Public repo** with an open-source LICENSE file GitHub detects (done: MIT).
4. **All commits inside Aug 25 - Sep 3** (new project; this repo was created Sep 2 late night).
5. **Text description** answering explicitly: why WebMCP fits this use case; how it improves the user experience; what people and agents can do together that was difficult or impossible before; how WebMCP was implemented.
6. Submitted on Devpost before 1:00 PM PT Sep 3. Raphael has already joined the hackathon on Devpost. Organizers advise having it in ~3 hours early (10:00 AM).
7. **The project must stay live, public, and unchanged until judging ends Sep 21, 5:00 PM PT.** Verbatim: "If you keep building on the same repo or the same live site after the deadline, you put your eligibility at risk." So: freeze at 1 PM; further work goes on a separate branch or a separate deploy, never on main or the submitted URL.
8. Devpost form has a **Testing instructions** field: fill it (no login needed for the Dojo; include the ChatGPT desktop steps and the Chrome flag steps). Check the license shows in the About box **in an incognito window**. The repo must contain the actual `registerTool` code (it does).
9. Organizer guidance on naming (Sep 1): "pick something specific that says what it does" - AI-generated names "all sound alike". Devpost title: **"The Dojo: a website that tests the agent visiting it"** (name + what it does).

## 3. Judging criteria (four, equally weighted, verbatim)

1. **WebMCP Leverage** - "How thoroughly and skillfully does the project use WebMCP? Does the code reflect genuine effort and a working, non-trivial implementation?"
2. **Execution** - "Does the project deliver a working or runnable project that has a complete, coherent product experience - not just a technical proof of concept?"
3. **Potential Impact** - "Does the project make a credible, specific case for solving a real problem for a real audience - and does the solution actually address that problem based on what's demonstrated?"
4. **Creativity & Ambition** - "How creative and novel is the concept and does the project differ from existing concepts?"

Stage-1 gate: fits the theme ("humans and agents interact, collaborate, and create together") and genuinely uses WebMCP.

Judges may score from **video + text alone** without opening the app, and may use "automated AI-driven analysis". So: the README, the description and the video must be legible to a machine and a skimming human. Clear claims, a tool table, timestamps.

Organizer video guidance (Sep 1 update, verbatim): "Show the project working in the first 10 to 15 seconds. Skip intros and title screens." "Start already logged in." "Do not type live. Paste in long text, or cut to the finished result." "Show one strong example. You do not need to repeat the same feature." "Save your team story and your inspiration for the written description, not the video." Description guidance: "'An agent can complete a multi-step booking in one turn, instead of clicking through six screens' tells us something. 'Leverages WebMCP for seamless agentic experiences' tells us nothing."

## 4. What the organizers said they want (verbatim, from the kickoff livestream, tutorial video, office hours, and organizer posts)

- "You shouldn't just prompt Codex to add WebMCP, even though you can. **We really want to see people rethink how all these interactions might look like.**"
- "Surprise us, and show us really new ways of how a web with agents would look like."
- Execution should "feel **production ready** and not just a demo site for a hackathon."
- Impact = "solving a really specific pain point... will people use it over and over again... **will people love it?**"
- Creativity = "a new type of experience that is **not possible today without WebMCP tools**."
- "UI is for people. WebMCP is for agents." Agent and human share one page through **different channels**. Sites can expose tools "we would never expose in a UI" and data "you might not want to cram into the DOM".
- Their flagship pattern is **asymmetric channels**: some things only the human can see or do, some only the agent can reach through tools. (The Archive: visual clues human-only, tool clues agent-only.)
- "**Codex is your customer.** It's the one using the tools, not the user." Dogfood with the agent. Trim the tool set. Make descriptions clear. Eric Provencher even added a feedback tool so the agent can flag errors to the builder.
- Dom (dkundel) on why not plain MCP: (1) **discovery on visit**, no install step; (2) **human and agent share the same browser session, no backend needed** ("store the document entirely in local storage"). "Imagine a game that you're cooperatively playing with the agent in that same browser session."
- Judge Sarah Drasner (Chrome) re-flagged, 3 days before the deadline: the **evals guide** (developer.chrome.com/docs/ai/webmcp/evals), the **build-tools guide** (design tools by role-playing the conversation turn by turn; error messages should guide, not dead-end: "No flight search results found. Search for flights first."; let the agent ask for missing parameters instead of assuming), the **secure-tools guide**.
- Judge Alex Nahas (MCP-B creator) on good tool design: **read-only tools** ("surface everything; let the agent query what it needs"), **navigation tools** (marked as state-changing), **write tools with elicitation** ("Here's what I'm about to submit. Yes or no?").
- OpenAI's own demos show the page **performing the collaboration**: an "Agent attached" live feed, every tool call logged with latency, read/write tool-count badges, surfaced agent errors.

## 5. What NOT to build (already done by sponsors/OpenAI, creativity penalty)

storefront/checkout, coffee ordering, todo list, restaurant reservations, guestbook, chat-with-my-site, generic site builder, 3D modeling studio, doc editor with agent comments, crossword/puzzle builder, trip planner, detective mystery. Also crowded now: "test the website's tools" (Prism 'purpose-aware WebMCP evaluation' on ChatGPT Sites, webmcp-eval.com, a swarm of site-readiness scanners; plus the games MCPencil pictionary and Taboo, both submitted). A scan of 496 live WebMCP sites found zero that test the visiting agent (docs/research/field-scan.md). The Dojo is the opposite direction: the site tests the agent. Say "tests your agent" in the first clause, never just "evals".

## 6. Technical facts about WebMCP today (build against these exactly)

- API namespace is **`document.modelContext`** (renamed from `navigator.modelContext` in July 2026; old tutorials are stale). Feature-detect: `typeof document.modelContext?.registerTool === "function"`.
- Register: `document.modelContext.registerTool({ name, description, inputSchema, annotations?, execute }, { signal? })`. `execute(args)` returns `{ content: [{ type: "text", text }] }`. `AbortSignal` unregisters. `getTools()`, `executeTool()`, and a `toolchange` event exist in the spec. Dynamic registration (tools appearing/disappearing with app state) is a documented strength few use: **each Dojo challenge registers its own tool set and unregisters the previous one.**
- Annotations: `readOnlyHint` (non-state-changing), `untrustedContentHint` (tool returns user-generated/external content), destructive hints for navigation/write tools.
- ChatGPT's implementation: **JavaScript registration in the top-level page only**; no declarative form API; no tools inside iframes. Works in the ChatGPT desktop app with models **Sol or Terra** (not Luna, not mobile, not Enterprise/Edu). The user sees a "Site tools" chip in the address bar (cursor icon, "Available site tools") and can inspect each call under Sources > Recently used. Every call passes ChatGPT's own safety review; consequential actions may get a confirmation prompt. Tool definitions and results are treated as **untrusted content** by ChatGPT.
- Field-tested by participants: **Sol/Terra "don't use the tools unless nudged"** - so tool names and descriptions must state their purpose plainly, the page should show the human a suggested prompt, and the demo prompt should nudge ("use this site's tools to take the Dojo"). Tool calls "feel quite slow" - keep challenges snappy; show latency per call as a feature.
- Chrome: 149+ with the flag; Model Context Tool Inspector extension can list and call tools manually; DevTools has a WebMCP panel. Disabled if the page sends `Origin-Agent-Cluster: ?0`.
- Chrome security budgets (follow and state them in the README): **tool name and parameter name <= 30 chars (ASCII letters, digits, `_ - .`), tool description <= 500 chars, parameter description <= 150 chars, single tool output <= 1.5K chars.** Use `untrustedContentHint` on anything returning external text. Reuse the app's own validation.
- Reference implementations to learn from: cloudflare/agents `examples/webmcp-react`, `sdras/webmcp-demo` (judge's own 2-tool booking demo), vercel/shop PR #498, GoogleChromeLabs/webmcp-tools demos, npm `use-webmcp-tool`.

## 7. Design constraints (Raphael's brand system, brand/BRAND.md, applied to a product)

- **Palette:** white background `#FFFFFF`, ink `#171815`, muted gray `#6E7069`, surface `#F3F3EF`, line `rgba(23,24,21,.14)`, accent swamp green `#3F5442` used rarely (a rule, a badge, a pass mark), optional flat purple `#7A4FB3` for one rare bold moment, never a gradient. Dark mode twin: bg `#131412`, ink `#F0F0EA`, muted `#9A9C92`, green `#7FA88E`. A green-gray wash `#ECF0E9` is allowed as a playful surface.
- **Type:** headlines in a heavy sans (weight 800-900, wide letter-spacing, uppercase or not). Body in a serif or system sans. **Mono for data, captions, tool names, latency, logs.** One italic serif word inside a headline is a signature move, at most one per headline.
- **Hard NOs:** purple gradients, corporate SaaS blue, glassmorphism, 3D blobs, emoji as design elements, meme visuals, warm cream paper, listicle/LinkedIn phrasing ("what most people get wrong"), em-dashes in copy, winking parentheticals, explaining a joke.
- **Voice:** brief, plain, technical but accessible, casual. One clause per sentence. Concrete beats abstract: show the real tool name, the real number, the worked example.
- **Information design:** more information in fewer elements. If a fix for "unclear" is to add a box, it is the wrong fix. Structure should encode a real distinction. Hand-drawn ink line art is the house illustration style if any illustration is used; small, unexplained. No AI-slop aesthetics.
- The site must look **professional and modern**, not like a hackathon page. Real empty states, real errors, works on a laptop-width window (the ChatGPT in-app browser is not huge).

## 8. Product requirements (what "done" means)

Must have:
- A lobby with a clear one-line explanation, a suggested prompt for the human to paste to their agent, and the list of belts.
- **At least 6 belts**, each a self-contained challenge with its own dynamically registered tool set, programmatic pass/fail verification, and a one-line "what this tests". Cover all three Nahas patterns plus: a prompt-injection trap (`untrustedContentHint`), an ambiguity test (agent should ask instead of guess), an error-recovery test (guiding error messages), an efficiency test (call count), and at least one **asymmetric** challenge where the human must contribute something the agent cannot get through tools.
- A **live feed**: every tool call with name, args, result summary, latency, and a running score. "Agent attached" state.
- A **report card** at the end with a belt rank, per-challenge results, and a shareable URL (state encoded in the URL, no backend).
- **Works without an agent**: a human can browse belts, read what each tests, run tools by hand through a built-in inspector, and view a sample report card.
- **Evals in the official format**: Google's `webmcp-evals` CLI (npm, `npx webmcp-evals local|browser|smoke|analyze`) defines a JSON case format `[{ name, messages, expectedCall }]` with `$pattern/$contains/$type/$any/$lte` operators, `ordered/unordered`, `optional: true`, and `expectedCall: null` for negative tests (details: docs/research/evals-guide.md). The Dojo ships `evals/dojo.evals.json` in that exact format plus `evals/dojo.schema.json`, so `npx webmcp-evals smoke -u <live url> -e evals/dojo.evals.json` verifies the trajectories deterministically against the live page. Our own runner mirrors their scoring and prints their table shape. Also ships a harness that runs a real LLM agent against the Dojo's tools headlessly (Anthropic key available in `../.secrets.env` outside the repo, never committed) and prints a results table. Results table pasted into the README.
- Security budgets respected and documented. Annotations correct.
- Deployed to a live URL (Cloudflare Workers static assets via wrangler, token in `../.secrets.env`; fallback GitHub Pages).
- README: what it is, the thesis, how to try it (ChatGPT desktop steps, Chrome flag steps), the tool table per belt, the evals table, architecture, security notes, license. Professional.
- `docs/SUBMISSION.md`: the four-question description ready to paste; `docs/VIDEO_SCRIPT.md`: shot-by-shot script under 3 minutes with the killer moment in the first 20 seconds.

## 9. Process rules for agents

- Read this file, then `docs/BUILD_LOG.md` (running log of what has been done, decisions, open issues). Append to the build log when you finish a task.
- Close the loop: after building anything, run it (local server + Playwright), take a screenshot into `docs/screenshots/`, check the console for errors, and only then mark it done.
- Commit after every meaningful step with a clear message. Never commit secrets. `.secrets.env` lives one directory above the repo.
- Do not add features that are not in section 8 unless they clearly raise a judging criterion. Do not remove features to save time without logging why.
- No AI-slop copy. No emoji in UI text. No em-dashes.
