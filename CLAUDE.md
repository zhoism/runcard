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
- `public/runs/` — 10 real runs: 9 × 1L2Y+indole (same system, production
  2–30 ps — say that, don't call them replicates), 1 × 3HTB+JZ4.

## Rules that carry over from the parent project

- **A number is a claim.** Every figure on the page traces to a file in a run
  directory. "Verified" means executed and read; otherwise say "expected".
- **Human approves, agent proposes.** `propose_change` is the only mutating
  path and it stops at the Approve button. Keep it that way.
- **Minimum that solves it.** No accounts, uploads, live MD, DFT.
- `bun run test` is the check. `bun run build` must pass before a push.

## Commands

    bun run dev        # http://localhost:5173
    bun run test
    bun run build
    vercel --prod      # deploy (after `vercel login`)
