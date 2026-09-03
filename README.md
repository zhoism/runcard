# runcard

**A shareable, validated record of a molecular-dynamics simulation** — a page a
collaborator opens, inspects, and hands to their agent.

**Live: https://runcard.vercel.app** · Built for the OpenAI WebMCP Challenge
(Aug 25 – Sep 3, 2026).

The differentiator is not that the page stores a run. It is that the page
**understands what was stored**: stage semantics, physics validity, environment,
seeds, and whether two differing stochastic results are actually in conflict.
Nothing runs, uploads, or is authored here — it is the reader-facing layer for
work that already happened.

## Try it with an agent

Open the live URL in ChatGPT's built-in browser, or in Chrome 149+ with
`chrome://flags/#enable-webmcp-testing` enabled. (Chrome DevTools → Application → WebMCP lists the
registered tools and can run any of them by hand.) The header pill should read **WebMCP · 17 tools**
in green. Grey means the tools are still registering; amber means this browser has not exposed WebMCP
to the page. Without WebMCP, the in-page **Tool Console** runs the identical tool table by hand — one
table drives both, so the console is never a mock.

Start on the demo run, `#/run/1l2y-rep4`, and ask your agent these three things in order. Each is a
question or an intent, not an instruction: the agent picks the tools.

1. `Using only the tools this page exposes, verify this result. Tell me what I can claim, what I can't, and the single next experiment that would most strengthen it. Be brief.`
   The archived −19.1953 kcal/mol reproduces from the per-frame energies; the agent should refuse a
   run-level error bar (2 of 3 matched replicates exist) and recommend one fresh-seed 30 ps run on
   Amber 26 PMEMD.
2. `What happens to binding at 310 K? Prepare whatever it takes to find out, and stop before anything changes to a scientific input.`
   `fork_experiment` pins proposals to `density` and `product` and leaves `heat` alone (its ramp is a
   schedule, not a condition — the page says so). A planned fork appears under *Current investigation*
   marked "expected · not yet run". Nothing is applied until you click **Approve** on each pin.
3. `Approved. Build the bundle.`
   `generate_rerun_bundle` writes a self-contained 15-file ZIP: `density.in` and `product.in` carry
   `temp0=310.0`, `heat.in` still `300.0`; `run.sh` for the MD; `run_analysis.sh` and
   `analysis/mmgbsa.in` for the MM-GBSA with every setting — masks, `igb`, `saltcon`, frame window —
   read from that run's manifest (a 3HTB bundle carries `:1-163`, a 1L2Y one `:1-20`). Its
   `manifest.json` records the parent and the fork.

Every call is listed in the **Tool activity** card at the bottom of the right-hand rail with its
source, so you can confirm each line says `via agent / WebMCP`.

## The tools

Sixteen; nine read-only. Of the seven that are not, only `propose_change` and
`fork_experiment` prepare a change to a scientific input, and both stop at the
Approve button. The other five — `generate_rerun_bundle`, `export_evidence_brief`,
`recompute_result`, `plan_sampling`, `investigate_run` — write page state only.

`investigate_run` is **automode**: it reads the confidence ladder, works out which
rung is actually holding a run back, and chases that rung with the read-only tools
that bear on it. It is not a fixed sequence — `1l2y-rep4` (every assessable rung
earned) is investigated differently from `3htb-jz4` (one run, nothing to replicate)
and differently again from `1l2y-regression` (drifting, so window agreement proves
nothing). It recommends one action in words and **creates nothing**. The console has
an Auto/Manual switch: Auto calls it, Manual lets you pick any tool yourself.

| | |
|---|---|
| **Find** | `list_runs` |
| **Read** | `get_run_manifest`, `get_stage_input` |
| **Check** | `validate_stage` — an AMBER `.in` validator, port of `check_amber.py` |
| **Analyze** | `explain_result`, `recompute_result`, `get_ensemble`, `diff_runs` |
| **Plan** | `plan_sampling`, `confidence_ladder`, `fork_experiment` |
| **Change** | `propose_change` → `list_proposals` → `generate_rerun_bundle` |
| **Export** | `export_evidence_brief` — prepares Markdown on the page; never posts, downloads, approves, or runs MD |

### Question-driven investigations

WebMCP, console, and page actions enter one typed, run-scoped investigation
workspace. Reanalysis, sampling plans, forks, approvals, and generated bundles
remain distinct outcomes rather than a forced tutorial sequence. Changing cards
cannot show another run's transient evidence, and every bundle remains a
historical snapshot of the proposal IDs applied when it was generated.

### Confidence ladder

Five rungs, every one computed from the archived artifacts rather than asserted:
**recomputable** (re-derived from per-frame energies), **repeatable** (seeds,
environment lock and `leap.in` archived — at best *expected*, since nothing is
executed here), **independently replicated** (≥ 3 same-system, same-protocol,
distinct-seed runs *at this run's production length*), **robust to
analysis-window choices** (ΔG across 10/25/50 % equilibration discards and
stride-2 windows, within 2 corrected SEMs), **externally supported** (always
*not assessed* — the page will not claim what it cannot check).

The flagship run scored **2 of 4** for most of this project's life, and said why:
seed replication was established across nine runs, but only two matched its 30 ps
length, so that rung read *partly established* with the missing run named. On
2026-08-31 four independent 30 ps replicates were run on Georgia Tech's PACE-ICE
cluster from a bundle this page generated, and that rung flipped to **verified**
on real data — 3 of 4. The rung that moved is the one the page had been pointing
at. Rungs the data does not earn are still the point of the feature: *repeatable*
remains at best *expected* because nothing executes here, and *externally
supported* is never assessed.

### Fork this experiment

`reproduce` pins every realized seed. `replicate` draws fresh seeds and reports
how many runs the spread still needs — on a one-run site it states the 3-run
minimum instead of returning a null. `extend` changes exactly **one** treatment
variable of a material class, holds every other condition, validates before and
after, and emits one pending proposal per affected stage.

**Nothing is applied until a person clicks Approve.** Approve partially and the
generated bundle says so in its README and records `fork.complete: false`.

## Use it on your own runs

`tools/extract_run.py` turns a finished AMBER + MMPBSA run directory into
`public/runs/<id>/manifest.json`, reading artifacts only. No number is ever typed
into a manifest by hand — if a figure is on the page, it came out of a file in a
run directory. Drop the manifest in, rebuild the index, and every tool above
works on your run.

## Rules the code actually enforces

- **A number is a claim.** Every figure traces to a file. "Verified" means
  executed and read; anything else says *expected*.
- **The agent proposes, a human approves.** Only `propose_change` and
  `fork_experiment` can prepare a change to a scientific input, and both stop at
  the Approve button. The other four tools that are not read-only write page state
  only: the bundle contains nothing a human has not already approved, and the
  brief, reanalysis and sampling plan only report.
- **The minimum that solves it.** No accounts, no uploads, no live MD, no DFT.

## The data

Fourteen real runs: thirteen of 1L2Y + indole (one prepared system, production
2–30 ps — same protocol at different lengths, *not* all replicates, and the page
says so) and one of 3HTB + JZ4, which is deliberately left as a single run so the
tools can demonstrate refusing to quote a spread.

Four of the thirteen are genuine replicates produced on PACE-ICE on 2026-08-31
from a `generate_rerun_bundle` output — same prepared system, same `&cntrl`,
fresh seeds, 30 ps. They ran under Amber 24 SANDER rather than the parent's
Amber 26 PMEMD (`pmemd` is licensed and absent from that cluster), so the
replication rung names the engine mix instead of counting them silently. Six
30 ps runs now give a matched-length SD of ±0.80 kcal/mol, wider than the ±0.64
pooled across all lengths — the honest number is the less flattering one.

## Develop

```
bun install
bun run dev        # http://localhost:5173
bun run test       # 648 tests
bun run build
```

`src/lib/amberCheck.ts` is pinned to the original Python by
`test/oracle/expected.json`; `test/corpus/` holds 553 input files (real pipeline
stages plus targeted mutants). Change the Python first, then regenerate.

## Verification

The live build was driven end-to-end three times by a real WebMCP client in
independent judge batches, with six generated bundles downloaded and inspected
byte-for-byte to confirm the approved treatment reached `density.in` and
`product.in`, the heating ramp stayed at 300 K, and partial approvals recorded
`fork.complete: false`. Findings and dispositions are in `docs/coordination/`.

## License

MIT
