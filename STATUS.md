# STATUS — runcard

Updated 2026-08-28 (Tiers A and B done; Codex review batch 1 done; see `~/.claude/plans/great-plan-it-distributed-key.md` for tiers B–D). Deadline **Sep 3 2026, 1:00 pm PDT** (Devpost, OpenAI WebMCP Challenge).

## Where it stands

| Area | State |
|---|---|
| Validator (`src/lib/amberCheck.ts`) | done — 11 rules, pinned to `check_amber.py` via `test/oracle/expected.json` over 553 inputs |
| Manifests (`public/runs/`) | done — 10 runs, all fields extracted from artifacts by `tools/extract_run.py`; per-frame ΔG (100 frames × 9 GB terms) reconstructed from `_MMPBSA_*_gb.mdout.0` + SASA and gated on reproducing `mmgbsa.dat` exactly |
| Tools (`src/webmcp.ts`, `src/lib/runs.ts`) | done — 12 tools, one table drives WebMCP + in-page console. Added 2026-08-29: `recompute_result` (re-analysis over a frame window from the archived per-frame energies) and `plan_sampling` (expected additional runs / run length for a target uncertainty) |
| WebMCP in a real agent | **verified 2026-08-28** in ChatGPT's browser (localhost) and **2026-08-29 on the live URL** by Codex's browser (batch RC-20260828-02, `docs/coordination/`): 10 tools registered, full demo flow `validate_stage` → `explain_result` → `propose_change` → human Approve → `generate_rerun_bundle` with the approved dt=0.001 landing in the downloaded ZIP; live 404 recovery; 390 px no overflow; zero failures. **Batch 03 (2026-08-29, live d604351):** 12 tools registered; `recompute_result` + `plan_sampling` → `propose_change` → Approve → bundle chain verified from the downloaded ZIP; one real bug (RC-003, stale `ps` in the mdin title after a duration edit) found and fixed |
| Page renders | verified (headless Chrome): home, run, compare. WebGL-less browsers get a fallback instead of a crash |
| Deploy | `https://runcard.vercel.app` public since 2026-08-28 (Deployment Protection off). **Live = d604351** (deployed 2026-08-29T04:47:50Z from a clean `git worktree` of HEAD, bundle `index-DoMhorJt.js`). Deploy from a worktree whenever another session has uncommitted edits in the working tree; missing manifest → 404, which the loader handles. Project is not git-connected: every deploy is a CLI deploy |
| Demo video, Devpost text | not started |
| UI polish | first pass done 2026-08-28 (f39c348): sentence-case headings, ≥13 px text, ΔG at heading size, no horizontal overflow at 390 px (measured via CDP), header badge explains itself without WebMCP, Tool Calls panel readable, tool descriptions question-led, `explain_result.brief`. PASS is neutral and scoped as an input sanity check (2bd3127). Codex review batch 1 (`docs/coordination/`): RC-001, RC-002 fixed (a44bb7f). Not done: PLIP png/residue repeat, 12-thumbnail gallery hierarchy, MMPBSA warning styling, preprint theme (separate chat) |

`bun run test` (596) and `bun run build` pass at HEAD.

## Open decisions (human)

1. ~~Turn off Vercel Authentication~~ done 2026-08-28; ~~redeploy~~ live = f39c348. Local master is 3 commits ahead of origin/master (not pushed).
2. Demo story: `validate_stage` → `explain_result` → `propose_change` + Approve → `generate_rerun_bundle` — proven end-to-end on the live site 2026-08-29; script and video still to do.
3. ~~Does `1l2y-regression` belong in the ensemble?~~ Resolved: the ensemble reports both strata — all runs and runs ≥ 10 ps (`LONG_RUN_MIN_PS`).

## Known thin spots (real, but a judge who pokes will find them)

- ~~sign claim hardcoded~~ → `signClaim()` computes "all / k of n / none" from the data.
- ~~same system = ligand + atom count~~ → `systemFingerprint()` over ligand, atom types, charges, protein atoms, force fields, solvent, box, buffer; index carries the fields.
- ~~materiality = 4-key blacklist~~ → `PARAM_CLASS` taxonomy (physics / thermodynamic_state / sampling_length / restraints / minimization / output_cadence / stochastic); interpretation keyed on classes and quotes |ΔΔG| vs run-to-run SD.
- Proposals live in page memory; a reload clears them. Intentional (nothing is authored here) — say so on the page.
- The rerun bundle needs the original `build/` inputs (mol2, frcmod, cleaned PDB); it is not self-sufficient.
- `plan_sampling` treats the run-to-run SD as fixed; it includes within-run noise (not decomposed), so it over-asks slightly for longer runs. Default target 0.25 kcal/mol because 0.5 is already met on the 1L2Y ensemble (n=5 long runs, SD 0.79 → SEM of mean 0.35). The reanalysis line, like proposals, lives in page memory.
- ~~`100.8 complex frames`~~ → `frames: 100` from the per-frame blocks (cross-checked with `_MMPBSA_info numframes`); the header string is kept as `frames_header_text` with a note that it is `(endframe−startframe)/interval+1` un-floored.
- ~~"SEM understates uncertainty" with no number~~ → `explain_result.uncertainty`: g, τ, N_eff, corrected SEM, block-averaging plateau, halves drift + verdict with stated thresholds; `internal_term_residual` quantifies the MMPBSA warning (DIHED-only, ~0.01 % of ΔG).

## Architecture

```
public/runs/<id>/manifest.json   ← tools/extract_run.py <run_dir> <id>   (reads artifacts only; tools/extract_all.sh has the 10 run dirs)
public/runs/index.json           ← tools/build_index.py (derived from manifests; carries the same-system fields)
        │
src/lib/runs.ts     pure functions: validateStage/All, ensemble, explainResult, diffRuns,
                    recomputeResult, planSampling,
                    makeProposal/applyEdits, rerunBundle/zipBundle          (test/runs.test.ts)
src/lib/amberCheck.ts   validator port                                     (test/amberCheck.test.ts, oracle-pinned)
src/lib/stats.ts    autocorrelation / statistical inefficiency / block averaging / drift / projectedSem   (test/stats.test.ts, synthetic series)
        │
src/webmcp.ts       TOOLS[] — name, description, JSON schema, readOnly, run()
                    registerWebMCP(): navigator.modelContext.registerTool for each
                    callTool(): shared by the agent path and the in-page Tool Console; logs every call
        │
src/store.ts        tiny external store: route (hash), proposals, calls, bundle, reanalysis, webmcp status
src/App.tsx         Home / RunPage / ComparePage / Sidebar (Proposals, Bundle, Tool Console, Tool Calls)
src/Viewer.tsx      3Dmol viewer with WebGL fallback + error Boundary
```

Invariants (from CLAUDE.md): a number is a claim — every figure traces to a file; `propose_change` is the only
mutating tool and stops at the Approve button; read tools may navigate the page (`get_run_manifest`, `diff_runs`,
`propose_change`, `generate_rerun_bundle`) so the agent's actions are visible to the human.

## Tools

| tool | mutates | what it returns |
|---|---|---|
| `list_runs` | no | index: id, title, ligand, protein atoms, production ps, ΔG, PLIP? |
| `get_run_manifest` | no (navigates) | full manifest minus mdin text |
| `get_stage_input` | no | verbatim `.in` of one stage + restart source |
| `validate_stage` | no | PASS/WARN/FAIL findings for a stage, all stages, or supplied text |
| `explain_result` | no | ΔG meaning; naive vs autocorrelation-corrected SEM, N_eff, drift verdict; which uncertainty to quote; seeds; run-to-run spread (all / ≥10 ps); sign claim; MMPBSA warning verbatim + quantified residual; provenance |
| `diff_runs` | no (navigates) | same-system?, system diff, per-stage &cntrl diff with meaning/materiality, interpretation |
| `get_ensemble` | no | n/mean/SD/min/max of ΔG across same-system runs |
| `recompute_result` | no (navigates; sets the page's "agent reanalysis" line) | ΔG, SD, corrected SEM, N_eff, drift verdict, per-term means over a chosen frame window (`start_frame`/`end_frame`/`interval` or `discard_ps`), Δ vs archived in corrected-SEM units; from archived per-frame energies only, MMPBSA.py not rerun; full window reproduces mmgbsa.dat |
| `plan_sampling` | no | **expected**: additional runs for a target SEM of the ensemble mean (run-to-run SD), expected single-run SEM at 5–100 ps and the length that reaches the target, which term limits the answer, `nstlim` as data for `propose_change`; assumptions listed |
| `propose_change` | **yes → pending** | bounded &cntrl edit, validated before/after, awaits Approve |
| `list_proposals` | no | proposals + status |
| `generate_rerun_bundle` | yes (page state) | .in files (approved edits applied), leap.in, run.sh, README, env pins |
