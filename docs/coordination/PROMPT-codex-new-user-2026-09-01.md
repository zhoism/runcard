# runcard: be a new user first, then fix what confused you

You are working in this repository (`runcard`: Vite + React + TypeScript, package manager `bun`, tests `bun run test`,
build `bun run build`). Work autonomously — never stop to ask; decide, write the decision down, continue. Do all code
work in a git worktree on a new branch `codex/new-user`. Commit per deliverable. Do not push, deploy, or merge.

## Phase 1 — you are a new user (no code yet)

Pretend you have never seen this site. You are a computational chemist a colleague sent a link to, and separately a
hackathon judge with two minutes. Open the live preview in your browser:

    https://runcard-auflrpi1o-zhoism.vercel.app/

(If the browser is unavailable, run `bun run dev` and use http://localhost:5173/ — same build.) Do not read the source
or the docs before this phase. Walk it the way a stranger would, and keep a running log as you go:

1. Land on the home page. Write down, in your own words, what you think this site is for after five seconds, then after
   thirty. What is the first thing you'd click? Click it.
2. On the run page, scroll top to bottom once. For every section, note: did you understand what it is, did you know why
   it's there, did anything look clickable that wasn't or vice versa. Try the Fork button, the compare picker, a stage
   dot, an analyses filter pill, a ladder "evidence" disclosure.
3. Find the way back to the list of runs without the browser back button. Find a way to compare two runs from the home
   page. Find out whether you need an account. Find out what "WebMCP" means from the page alone. Find the Tool Console
   and try one tool (pick `explain_result`, press Call). Note every point where you had to guess.
4. Repeat steps 1–2 at a phone width (390 px).
5. Now read `CLAUDE.md`, `STATUS.md` (the "GitHub-for-MD-runs reframe" section is the intent), and
   `docs/design/SPEC-2026-09-01-designer-round2.md`. Note where your first impressions disagreed with the intent.

Write the whole thing to `docs/design/NEW-USER-WALKTHROUGH-2026-09-01.md`: the log, then a ranked list of the
confusions (most damaging first), each with: where it happens, what you expected, what you got, and the smallest change
that would fix it. Also list what worked without explanation — that must not be touched. Commit that file first.

## Phase 2 — fix the top of your own list

Take the ranked list and fix as many items from the top as you can do cleanly, one commit each, tests green at every
commit. Expect the list to include most of these — build them if it does, skip them if your walkthrough says they're
not needed:

- A home page that explains itself in one screen: what runcard is (the GitHub-for-MD-runs metaphor stated: run = repo,
  fork = rerun with lineage, proposal = pull request, Approve = merge), a start-here run, a three-step "open a run →
  ask an agent or use the Tool Console → approve what it proposes", and the plain sentence "14 public runs from one
  lab; no account needed".
- Persistent top navigation (Runs, Compare, How it works), a breadcrumb on the run page, and a section jump list on
  the run page (Result · Forks · Stages · Evidence · Analyses · Provenance).
- Search and filters over `public/runs/index.json` on the home page, client-side only (id/title/ligand/engine text;
  system, engine, length, has-forks filters).
- A one-line "what you are looking at" under the run title, and the WebMCP pill explained in words a stranger gets.
- A dismissible first-visit banner (localStorage, in try/catch), no modal, no tour library.

## Hard constraints

- **Do not change the theme.** `src/report.css` is the owner's decided look (navy header, white cards on grey, Inter +
  JetBrains Mono, green/amber/red). Add rules for new components in that vocabulary; do not restyle existing ones, do
  not change fonts, colours, radii, or the header. The owner adopted and then reverted a redesign today; don't reopen it.
- `CLAUDE.md` rules: no accounts, uploads, backend, or live MD. Every number on the page traces to a file under
  `public/runs/` — explanatory copy may describe kinds of things, never quote a value that isn't already on the page.
  Agents propose, a human approves: the Approve button stays the most prominent control on a run page.
- The 17 tools in `src/webmcp.ts` keep their names, descriptions, and behaviour. `src/lib/` semantics don't change; add
  a pure function (e.g. the search/filter) only with a test in `test/`.
- Nothing in `public/runs/` changes.
- No horizontal overflow at 390 px on Home, a run page with a stage open, and Compare. Measure it over CDP
  (`Emulation.setDeviceMetricsOverride {width:390, mobile:true}`, then `scrollWidth === clientWidth`); plain
  `--window-size=390` silently renders at 500 px.
- Text ≥ 13 px, no italics for emphasis, no all-caps.

## Finish

Screenshot Home, `#/run/1l2y-rep4` (with a stage open) and `#/compare/1l2y-rep4/1l2y-regression` at 1440 and 390 px
into `docs/design/shots/codex/`, look at them, fix what's wrong, re-shoot. Append a "Codex new-user pass" section to
`STATUS.md`: what shipped, what's left from your list, measurements. Print the branch, the commit list, and the paths
of the walkthrough file and final screenshots.
