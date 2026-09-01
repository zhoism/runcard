# CLAUDE.md — runcard

Entry for the OpenAI WebMCP Challenge (Devpost, deadline **Sep 3 2026, 1:00 pm PDT**).
Judged equally on: WebMCP leverage · execution · potential impact · creativity.
Judges test the **live URL themselves** in ChatGPT's built-in browser or Chrome with
`chrome://flags/#enable-webmcp-testing`. A broken tool in the first minute loses.

## What it is

A shareable, *validated* record of an MD simulation — a GitHub-style page for a
computational experiment. The differentiator is not storage; it is that the page
**understands what was stored**: stage semantics, physics validity, environment,
seeds, and whether differing stochastic results are expected. The browser is the
reader-facing layer only — nothing runs or is authored here.

- `src/lib/amberCheck.ts` — AMBER `.in` validator, a port of `check_amber.py`
  from the internship pipeline (`../project-prime`, finished). Pinned to the
  Python by `test/oracle/expected.json`; regenerate with `python3 test/oracle/dump.py`
  after any rule change, and change the Python first.
- `src/lib/runs.ts` — the tool functions: validate, ensemble, explain, diff,
  proposals, rerun bundle. Pure; tested in `test/runs.test.ts`.
- `src/webmcp.ts` — the tool table. One table drives both
  `document.modelContext.registerTool` and the in-page Tool Console.
- `tools/extract_run.py` — run dir → `public/runs/<id>/manifest.json`. Reads
  artifacts only. Never type a number into a manifest.
- `public/runs/` — 14 real runs: 13 × 1L2Y+indole (same system, production
  2–30 ps — say that, don't call them all replicates), 1 × 3HTB+JZ4.
  4 of the 13 (`1l2y-rep4-ice1..4`) *are* true replicates of `1l2y-rep4`: run on
  PACE-ICE 2026-08-31 from a rerun bundle, fresh seeds, 30 ps, Amber 24 SANDER
  instead of Amber 26 PMEMD. They carry `parent`/`fork` lineage and their system
  composition is read from their own files (no `s*.json`), never copied from the
  parent.

## Rules that carry over from the parent project

- **A number is a claim.** Every figure on the page traces to a file in a run
  directory. "Verified" means executed and read; otherwise say "expected".
- **Human approves, agent proposes.** Seven of the sixteen tools are not
  read-only. Only `propose_change` and `fork_experiment` can prepare a change to
  a scientific input, and both stop at the Approve button; the other five write page
  state only (a bundle, a brief, a reanalysis, a plan or an automode trace shown on
  the page). `investigate_run` (automode) recommends in words and creates nothing —
  it must never queue a proposal. Keep it that way.
- **Minimum that solves it.** No accounts, uploads, live MD, DFT.
- `bun run test` is the check. `bun run build` must pass before a push.

## Commands

    bun run dev        # http://localhost:5173
    bun run test
    bun run build
    vercel --prod      # deploy (after `vercel login`)

## Status

See `STATUS.md` — state, open decisions, known thin spots, architecture. Update it when any of those change.
