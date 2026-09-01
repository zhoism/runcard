# Devpost submission — runcard

Draft 2026-09-01. Paste-ready. Every number below is verified against the repo
or a Codex batch record as of live `502cd50`; nothing is aspirational.

---

## Project name

runcard

## Tagline (Devpost "elevator pitch" field)

A validated, shareable record of a molecular dynamics experiment — a page that
understands the physics it stores, with 16 WebMCP tools that let your agent
interrogate the evidence, challenge the number, and prepare the experiment that
would fix it.

## About the project (main writeup)

### What it is

Every computational chemistry paper rests on numbers like "ΔG = −19.2 kcal/mol."
Today those numbers travel as PDFs and zip files that no reader can question.
**runcard** is a GitHub-style page for an MD simulation where the record itself
understands what it stores — stage semantics, force fields, seeds, physics
validity, and whether a differing result is expected or alarming — and exposes
that understanding to any agent through WebMCP.

The site's one rule: **a number is a claim.** Every figure on a page traces to a
file in a run directory. "Verified" means executed and read; anything else says
"expected."

### Try it in three minutes (what we'd do in your seat)

Open a run, e.g. `#/run/1l2y-rep4`, then ask your agent:

1. *"Is this ΔG trustworthy? Which uncertainty should I quote?"* —
   `explain_result` answers with the run-to-run spread (±0.80 kcal/mol over the
   comparable ensemble), not the flattering within-run SEM, and explains why.
2. *"Investigate this run."* — automode reads the five-rung confidence ladder,
   picks the rung actually holding this run back, chases it with the read-only
   tools, and recommends in words. Different runs produce different
   investigations; it never queues a change.
3. *"Fork it with temp0 at 310 K and give me a rerun bundle."* — the agent
   proposes; the edit sits pending until **you** click Approve; the downloaded
   bundle (15 files) carries the MD inputs *and* the MM-GBSA analysis that
   reproduces the card's headline number, every parameter read from that run's
   own manifest.

The in-page Tool Console is driven by the same table as
`navigator.modelContext.registerTool` — it is never a mock.

### WebMCP leverage

16 tools, nine read-only. The seven that write touch page state only; the two
that can prepare a change to a scientific input (`propose_change`,
`fork_experiment`) both stop at a human Approve button. The division of labor is
the point: the agent reasons and proposes, the human approves, and the page is
the shared ground truth both can read. WebMCP is not a chat veneer here — the
tools return structured evidence (ensembles, ladder rungs, validated diffs,
reproducibility gaps) that an agent can build an argument from.

### Execution

- 14 real runs (13 × Trp-cage + indole at 2–30 ps production; 1 × T4 lysozyme
  L99A + JZ4), extracted from AMBER artifacts by a script that never types a
  number into a manifest.
- The `.in` validator is a line-for-line port of the internship pipeline's
  Python checker, pinned to it by a generated oracle.
- 653 tests. And the live site was adversarially tested across **eight
  coordination batches by a second AI agent** (OpenAI Codex) driving the
  production URL over real WebMCP in a real browser — filing issues, retesting
  fixes, and downloading and inspecting the actual ZIPs. The last batch closed
  in one round.
- This page practices what it stores: when the four cluster replicates arrived
  with a different engine (Amber 24 SANDER vs 26 PMEMD), the ladder discloses
  the engine mix instead of hiding it, and quotes the *wider* matched-length
  spread.

### Potential impact

The replication loop actually closed. The site said `1l2y-rep4` needed more
runs at its production length; we downloaded its rerun bundle, executed it on
Georgia Tech's PACE-ICE cluster with fresh seeds, extracted the four results
back in — and the "independently replicated" rung flipped to **verified**, with
the new runs carrying machine-readable lineage to their parent. That loop —
page recommends → cluster executes → page re-evaluates its own confidence — is
what computational reproducibility infrastructure should feel like, and WebMCP
is what lets an agent drive it end to end.

### Creativity

The confidence ladder: five rungs (recomputable → repeatable → independently
replicated → robust to analysis-window choices → externally supported), each
earned from archived files or honestly refused. Automode is the inverse of a
demo script — it reads the ladder and *decides* what to investigate, so the
same run gives a different investigation after its evidence changes. And the
submission holds itself to the site's standard: the generated analysis recipe
is labelled "expected, not verified — nothing here was executed by the page,"
because nobody has fed that exact generated script to AMBER yet.

### What's next

Execute one generated bundle end to end on the cluster and archive the result
as a child card — turning the last "expected" on the site into "verified."

## Built with (tags)

`webmcp` · `typescript` · `react` · `vite` · `bun` · `vitest` · `amber` ·
`python` · `vercel`

## Links

- Live (judges test here): https://runcard.vercel.app/
- Video: (added after the UI migration lands)

---

## Appendix — demo video

Superseded: the recording plan lives in `docs/video-plan.md` (six short clips, ≤2:00, built to the
Devpost recording rules — cold open on the agent working, no live typing, captions over narration).
