# runcard: make it intuitive for a new user

> **Superseded 2026-09-01 evening by `PROMPT-codex-new-user-2026-09-01.md`.** Deliverable E (adopt the mockup's
> visual language) is withdrawn: the owner tried it and reverted it (commit 92aae16). The theme in `src/report.css`
> is fixed. Everything else here still applies as background.

You are a senior product designer and frontend engineer working in this repository (`runcard`, a Vite + React +
TypeScript site, package manager `bun`). Work autonomously: do not stop to ask questions; make the call, record it in
your plan file, and keep going. Work in a git worktree on a new branch `codex/onboarding` so the main working tree is
untouched. Commit after each deliverable with a clear message. Do not push and do not deploy.

## Read first, in this order
1. `CLAUDE.md` — the rules. They are not negotiable: no accounts, no uploads, no backend, no live MD; every number on
   the page traces to a file under `public/runs/`; agents propose, a human approves; 17 tools in `src/webmcp.ts`.
2. `STATUS.md` — current state, and the "GitHub-for-MD-runs reframe" section for the intent.
3. `docs/design/SPEC-2026-09-01-designer-round2.md` — what was just built (pinned proposals, analysis filters, fork cards).
4. `docs/design/redesign-2026-09-01/runcard-redesign.html` and the four PNGs beside it — the designer's mockup.
   **This is the visual language to adopt.** The last build kept the older `src/report.css` look and only added the
   functions; the owner's verdict was "it barely looks different". Fix that.
5. `src/App.tsx`, `src/report.css`, `src/store.ts`, `src/webmcp.ts` — the whole UI is here.

## The intent, in one paragraph
runcard is GitHub for molecular-dynamics runs. A finished simulation becomes a page, not a folder: every number on it
traces to a file, the page knows which step did what and how much the answer normally wobbles, and it says plainly what
is verified versus only expected. Runs are public URLs you fork, compare, and hand to an AI agent, which reads the page
through WebMCP as tools rather than scraping it. The agent can validate, explain, diff, and review, but it can only
propose a change; you approve it on the same page, the way you'd merge a pull request. Every UI decision follows from
that: a run page reads like a repo, lineage is a headline, agent work is auditable activity, and Approve is the most
important control on the screen.

## The problem you are solving
A new visitor (a hackathon judge with two minutes, or a scientist sent a link) lands on `#/` and sees a table. Nothing
says what this site is, what to click first, why an AI agent is involved, or that all 14 runs are one lab's public
records and there is nothing to log in to. The run page is long and has no orientation. Compare is only reachable from
a dropdown. The GitHub metaphor (run = repo, fork = rerun with lineage, proposal = pull request, Approve = merge,
automode = agent review, compare = diff) is never stated on the page.

## Deliverables (each its own commit)
A. **Landing / Home that explains itself in one screen.** Above the run list: what runcard is (two sentences, the
   GitHub metaphor stated), a "start here" run (the longest 1L2Y run, `1l2y-rep4`, already flagged in `cohorts()`),
   and a three-step "how it works" strip: open a run → ask an agent (or use the Tool Console) → approve what it
   proposes. Say plainly: "14 public runs from one lab; no account needed." Keep the fork network and the run tables
   below it.
B. **Navigation.** A persistent top nav: Runs (home), Compare, How it works. On a run page, a breadcrumb
   (runs / <cohort> / <run id>) and a right-aligned section nav or table of contents (Result · Forks · Stages ·
   Evidence · Analyses · Provenance) that scrolls to the sections. Compare must be reachable from Home (pick two runs)
   and from the nav, not only from the run-page dropdown.
C. **Explore.** On Home, a search box and filters over `public/runs/index.json`, client-side only: free text over id /
   title / ligand / engine, and filters for system (cohort), engine, production length, and "has forks". Results keep
   the existing table columns. No new data files; everything comes from the index.
D. **Run-page orientation.** A short "what you are looking at" line under the title (system, what was measured, how
   long, how many independent runs it sits among), and the sidebar reorganised as in the mockup: an **Agent** panel
   (connected / not connected, in plain words, with the Chrome flag and an "Open Tool Console" button) and a
   **Recent activity** feed (the existing tool-call log rendered as a timeline: time, tool, one-line outcome, and
   whether it came from an agent, the console, or a page action). Proposals stay pinned to stages (already built).
E. **Adopt the mockup's visual language** across the site: its type (IBM Plex Sans + IBM Plex Mono, via Google
   Fonts, with real fallbacks), its paper ground and surfaces, its spacing and card style, the confidence ladder as
   four side-by-side cards, and its agent accent colour for anything an agent did or proposed. Keep the semantic
   colour code (green pass / verified, amber needs attention / pending, red fail) and keep every warning banner.
   No italics for emphasis, no all-caps, text ≥ 13 px, lowercase display of warnings stays.
F. **First-visit help.** A dismissible "new here?" banner on Home and on the run page (remembered in localStorage,
   wrapped in try/catch) that points at the three-step strip and the start-here run. No modal, no tour library.

## Constraints that stay true after your work
- `bun run test` passes (660 tests today; add tests for any new pure function, e.g. the search/filter over the
  index) and `bun run build` passes. `tsc` is part of the build.
- Nothing in `public/runs/` changes. Nothing in `src/lib/` changes semantics; UI-only work lives in `src/App.tsx`,
  `src/report.css` (or a new stylesheet imported from `src/main.tsx`), and `src/store.ts` if a UI state field is needed.
- The 17 tools keep their names, descriptions, and behaviour. The Approve button stays the most prominent control on a
  run page. `investigate_run` still creates nothing.
- No horizontal overflow at 390 px on Home, a run page (with a stage open), and Compare. Measure it: launch headless
  Chrome with `--remote-debugging-port`, set `Emulation.setDeviceMetricsOverride {width:390, mobile:true}`, and check
  `document.documentElement.scrollWidth === clientWidth`. Plain `--window-size=390` silently renders at 500 px.
- Every number a visitor reads still comes from a run's files. Explanatory copy may describe kinds of things
  ("a plot of backbone drift"), never a value that is not on the page already.
- Keep the WebMCP header pill's behaviour: when the API is absent it links to the Tool Console; it never routes Home.

## Process
1. Write `docs/design/PLAN-codex-onboarding-2026-09-01.md` first: the page map after your changes, what each
   deliverable adds, and anything from the list above you decided not to do and why. Commit it.
2. Implement A–F in that order, one commit each, tests green at every commit.
3. After each of A, D and E, screenshot Home, `#/run/1l2y-rep4` and `#/compare/1l2y-rep4/1l2y-regression` at 1440 px
   and 390 px into `docs/design/shots/codex/` and look at them before moving on.
4. Update `STATUS.md` with a short "Codex onboarding pass" section: what shipped, what was left, measurements.
5. Finish by printing the branch name, the commit list, and the paths of the final screenshots. Do not merge.
