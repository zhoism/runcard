# STATUS — runcard

Updated 2026-08-31. Deadline **Sep 3 2026, 1:00 pm PDT** (Devpost, OpenAI WebMCP Challenge).

## Investigation workspace build (live 2026-08-31 as 5a885d9)

- Default build implemented: evidence-first home/run overview, typed outcomes keyed by run, invocation-source attribution, proposal/bundle snapshots, and a current-investigation panel. No fixed `investigate_everything` sequence was added; the agent still chooses tools in response to evidence.
- Added `export_evidence_brief` (tool 15): pure Markdown builder plus page prepare/copy/download controls. Reports distinguish archive/reanalysis, within-run/run-to-run uncertainty, live proposal status, and the bundle's applied set at generation. `include_session:false` exports archived assessment only.
- Added focused evidence-brief and mocked WebMCP registration/execution tests. The mocked registration is not a native-browser claim; real WebMCP verification for this build remains required after deployment.
- This state is intentionally in-memory. Reloading clears investigations and proposals; exporting creates a snapshot, not durable identity or validation.
- **Fix pass before deploy (5a885d9).** The run page crashed in *production* builds only: `useStore` hands its selector to `useSyncExternalStore` as `getSnapshot`, so `CurrentInvestigation`'s `s.proposals.filter(...)` returned a new array every call and looped (React #185). There are no DOM tests, so the suite stayed green — but an adversarial review falsified my first explanation of it: restoring the bug and loading the **dev** server fails identically and prints `The result of getSnapshot should be cached to avoid an infinite loop`, naming the cause. It was not a production-only fault. It shipped because nobody opened the run page after the change, and my own dev check was run *after* the fix and compared against a stale cached production bundle. The lesson is to open the page, not to distrust dev builds; the commit message of 5a885d9 records the wrong reason. Also fixed: the Proposals panel filtered by route and so said "None yet" on Home while proposals were pending (the queue is global again, current run sorted first, count in the header); the bundle file list is back as a disclosure; six tests now drive the real store through `callTool` to cover the approved-and-this-run filter that alone keeps unapproved edits out of a bundle (mutation-checked: dropping the run clause fails 1 test, the status clause 3); `setProposalStatus` refuses to approve an edit that fails validation. Home keeps its name and its runs, and the agent prompts moved to the run page, generated per run as code blocks.

### Deferred phases — explicitly not in this build

1. Budget-aware planning: accept a run budget and return conditional candidate outcomes without claiming optimal design.
2. Returned-run lineage: finish bundle-layout extraction and intended-versus-observed checks only when a genuine returned result is available.
3. Dedicated usability/visual polish, then the demo video and submission writeup. Do not open another feature branch after that freeze unless a material bug appears.

## Where it stands

| Area | State |
|---|---|
| Validator (`src/lib/amberCheck.ts`) | done — 11 rules, pinned to `check_amber.py` via `test/oracle/expected.json` over 553 inputs |
| Manifests (`public/runs/`) | done — 14 runs, all fields extracted from artifacts by `tools/extract_run.py`; per-frame ΔG (100 frames × 9 GB terms) reconstructed from `_MMPBSA_*_gb.mdout.0` + SASA and gated on reproducing `mmgbsa.dat` exactly |
| Tools (`src/webmcp.ts`, `src/lib/runs.ts`) | done locally — 15 tools; one table drives WebMCP + in-page console. Tool 15, `export_evidence_brief`, prepares a qualified Markdown snapshot and does not approve, download, post, or run MD |
| WebMCP in a real agent | **verified 2026-08-28** in ChatGPT's browser (localhost) and **2026-08-29 on the live URL** by Codex's browser (batch RC-20260828-02, `docs/coordination/`): 10 tools registered, full demo flow `validate_stage` → `explain_result` → `propose_change` → human Approve → `generate_rerun_bundle` with the approved dt=0.001 landing in the downloaded ZIP; live 404 recovery; 390 px no overflow; zero failures. **Batch 03 (2026-08-29, live d604351):** 12 tools registered; `recompute_result` + `plan_sampling` → `propose_change` → Approve → bundle chain verified from the downloaded ZIP; one real bug (RC-003, stale `ps` in the mdin title after a duration edit) found and fixed. **Batch 04 (2026-08-30, live 7d77378 → 2f7ac29):** 14 tools registered; `confidence_ladder` 2 of 4 + "partly established" accepted as the honest state (RC-004 A disputed, accepted); `fork_experiment` extend temp0=310 → 2 proposals → Approve both → 13-file self-contained bundle with Fork lineage, partial-approval warning, `stages:["heat"]` error, console prefill all verified live; RC-004 B (replicate on a 1-run site gave a null recommendation) fixed and verified on 2f7ac29. Codex's browser cannot capture downloads, so ZIPs are inspected from user-supplied archives: the **full fork** archive is verified (13 entries, 13475 B, SHA-256 `6005ea20…d8ae048` — `heat.in` temp0=300.0, `density.in`/`product.in` temp0=310.0 with ig=-1, README lineage with no partial warning, `manifest.json` parent=1l2y-rep4 and `fork.complete: true`). The **partial-approval** archive is verified too (13 entries, 13514 B, SHA-256 `e355d370…d4c854a5` — `density.in` 310 K, `product.in` and `heat.in` 300 K, README carries the partial-approval warning, `manifest.json` `stages_applied=[density]`, `stages_not_applied=[product]`, `fork.complete: false`). **Batch 04 complete** 2026-08-31T02:15Z after one fix/retest round, zero open issues. **Batch 05 (2026-08-31T02:18Z): passed clean, zero of three rounds used** — 14 tools, ladder 2 of 4 + partly established, replicate guidance, invalid-stage error, console prefill, and both bundle paths re-verified from Codex's own downloads (full `ee6f81b6…cc24f5c6`, 13475 B, `fork.complete=true`; partial `cfd194e1…1dc22dca25`, 13514 B, `fork.complete=false`). **Batch 06 (2026-08-31T02:20Z): passed clean, zero of three rounds used** — same matrix, both bundle paths re-verified from its own downloads (full `b24565b9…`, `fork.complete=true`; partial `4f2c1e94…`, `fork.complete=false`). **Batches 04–06 are complete; Codex mode is `complete`, its heartbeat deleted, and no `ready_for_claude` request is open.** Across the three batches the live build was exercised by a real WebMCP client 3× end-to-end with six independently downloaded archives inspected byte-for-byte; the only code change required was RC-004 B. The one item Codex structurally cannot test — the **flag-off header pill** — was verified here instead on live `index-DwFbZHdi.js` via headless Chrome (no WebMCP): the pill renders `no WebMCP here — use the Tool Console ↓` as `<a href="#tool-console">`, and clicking it scrolls 0 → 192 px with the Tool Console in view (top 147 px) while the hash stays `#/run/1l2y-rep4` and the h1 stays `1L2Y + MOL, run 4` — it does not route home |
| Page renders | verified (headless Chrome): home, run, compare. WebGL-less browsers get a fallback instead of a crash |
| Deploy | `https://runcard.vercel.app` public since 2026-08-28 (Deployment Protection off). **Live = 5a885d9** (deployed 2026-08-31 from a clean `git worktree` of HEAD, bundle `index-D3GpiLiC.js` — the 15-tool investigation-workspace build; verified live by headless CDP: 15 tools in the console, run-page order ΔG → Stages → System/Structure → Evidence overview → Current investigation → ladder → Fork, 3 prompt code blocks naming the run on screen, proposals still listed from Home and Compare, bundle file list showing 13 files. Previous: 2f7ac29 / `index-DwFbZHdi.js`, 7d77378 / `index-B7PiDcQK.js`, 6f317dc / `index-DEIhYtI0.js`, 3ef2cb5 / `index-BTW4-AZd.js`, fd8620c / `index-DsyBgKpr.js`, 662e98d / `index-CZfZNhsT.js`, b4491c3 / `index-Y31UbNAm.js`, ff85e2f / `index-USiMctXW.js`, f64789f / `index-CqSj8sfl.js`, 097a01a / `index-D8epXSVf.js`, 46ca5ba / `index-D_Ku5S9V.js`, d604351 / `index-DoMhorJt.js`). Deploy from a worktree whenever another session has uncommitted edits in the working tree; missing manifest → 404, which the loader handles. Project is not git-connected: every deploy is a CLI deploy |
| Demo video, Devpost text | not started |
| UI polish | first pass done 2026-08-28 (f39c348): sentence-case headings, ≥13 px text, ΔG at heading size, no horizontal overflow at 390 px (measured via CDP), header badge explains itself without WebMCP, Tool Calls panel readable, tool descriptions question-led, `explain_result.brief`. PASS is neutral and scoped as an input sanity check (2bd3127). **Correction 2026-08-31:** the "no horizontal overflow at 390 px" claim below stopped being true once the Fork card landed — its action column is `max-content` and its longest button is ~366 px, which starved the description column to 0 px wide and 2176 px tall and scrolled the page 103 px sideways at ≤ 480 px. Measured on live at 390/414/480 px, fixed in `dl.fork` with a stacking media query, re-measured clean (390/390, description 324×68). Codex review batch 1 (`docs/coordination/`): RC-001, RC-002 fixed (a44bb7f). Not done: PLIP png/residue repeat, 12-thumbnail gallery hierarchy, MMPBSA warning styling, preprint theme (separate chat) |

`bun --bun x vitest run` (641 tests) and `bun --bun run build` pass in the current checkout. **Environment note (2026-08-29):** with the system Node 20.12 at `/usr/local/bin/node`, `bun run test`/`vite build` fail at startup inside rolldown (`util.styleText` array form needs Node ≥ 22). Run them under bun's runtime instead: `bun --bun x vitest run` and `bun --bun run build`.

## Review 2026-08-29 (five-dimension workflow on live d604351)

11-agent review (science claims · agent usability · first-minute judge pass · accessibility · code quality), each finding adversarially re-checked; ranked list with file:line in `~/Desktop/runcard-review.md` (55 items: 0 P1, 12 P2, 43 P3). **Quick fixes applied (uncommitted → this commit), all 12 P2s plus ~25 P3s:**

- Science: the drift verdict was a 1σ test (|Δhalves| > 2×full-series SEM); now 2σ of the half-difference, √(SEM₁²+SEM₂²) with per-half corrected SEMs — no archived verdict flips, `halves.se_of_diff`/`diff_in_sigma` exposed, threshold text states the formula. "seed-to-seed variation dominates" is now gated on the ratio (≥2 / 1.2–2 / <1.2). `explain_result` names the stratum and quotes the ≥10 ps SD next to the all-runs SD so it agrees with `plan_sampling`. Block SEMs use ddof=0 like everything else. Cross-system `diff_runs` returns `delta_g.diff = null` (was a meaningless ΔΔG). n=1 ensembles get a one-run caveat; sign claim quantifies "pinned to about ±SD"; `long_runs` says "no runs ≥ 10 ps" instead of "no runs".
- Tools: two approved proposals on one stage now compose (was: oldest only, README claimed both); SLURM `#SBATCH` after the shebang; enum enforcement on `generate_rerun_bundle`; proposal ids unique per ms; `propose_change` rejects empty/array/comma-smuggled edits and accepts JSON-string edits, names stages with roles on a miss, says "cannot be approved" on a FAIL after-report; `discard_ps` ≥ run length and bad `get_ensemble` ids get actionable errors; `verdictOf()` replaces five hand copies.
- Page: header pill scrolls to the console instead of routing Home; Tool Console prefills `run_id` from the run on screen and shows the Chrome flag in text; `.grid2` cards align to top (empty Contacts card no longer 500 px); minimization stages drop "NVT"; `net −0.000001` renders as 0; stage note moved out of the h2; frames_note reference explained inline; ΔG unit on the home table; single-run row on 3htb; compare tables have headers and "material / not material" text; badges 13 px; run rows show a pointer; `document.title` per route; aria-labels on selects/textarea, a polite live region for tool calls and console output, alt text fixed, disabled-Approve reason visible.

**Also done (second commit):** entropy caveat — `tools/extract_run.py` now records `params.entropy` from `_MMPBSA_info` (all runs: `0`, manifests re-extracted, only that field and the `extracted` date changed); `explain_result.entropy_term` + a sentence in `what_it_is` ("effective interaction energy for ranking, not an absolute binding free energy"); the ΔG card heading says "no entropy term". Drifting-run projection — `plan_sampling` no longer prints a single-run length for a run whose verdict is not "no drift detected" (`expected_length_for_target_ps: null` + `expected_length_note`; recommendation and panel line say so).

**Not done (from the review):** repeated facts on the run page (ps/seed/AmberTools ×2–3), same-system compare repeating ΔΔG, 2560 px `.app` max-width, `plateau_sem` naming, counter-ion count in the fingerprint, focus management on route change, a `webmcp.test.ts`. RC-002 keyboard disclosures still only partially retested. `index.css` changes must be mirrored in `theme.css` when the preprint theme lands.

## Confidence ladder + fork (2026-08-29, vision doc → code)

- `confidenceLadder(m, idx)` / tool `confidence_ladder` / card on every run page. Five rungs, each computed: **recomputable** (mean + population SD of the archived per-frame energies re-derived and compared to mmgbsa.dat at the 4 dp mmgbsa.dat prints, to one unit in the last place), **repeatable** (at best *expected*: realized seeds for every dynamics stage + env lock + leap.in archived; never executed here), **independently replicated** (≥ 3 runs with the same system fingerprint AND the same production-protocol key AND distinct realized seeds — `protocol`/`seed` now in `index.json` from `tools/build_index.py`; all 14 runs share one protocol key), **robust to reasonable analysis choices** (ΔG over discard-10/25/50 % and stride-2 windows within 2 corrected SEMs of the archived value — analysis-window sensitivity only, said so), **externally supported** (always *not assessed*). rep4: **3 of 4** verified as of 2026-08-31. Rung 3 is two-level since decision 1 (2026-08-29): seed-replicated across the cohort ✓, *and* — since the four PACE-ICE replicates landed — 6 of the 3 needed runs exist at rep4's own 30 ps length, so it now reads *verified*. The rung also discloses the engine mix at that length (4 × Amber 24 SANDER, 2 × Amber 26 PMEMD): the protocol key fixes `&cntrl` and the GB model, not the integrator, so counting across engines has to be stated rather than assumed.
- `forkExperiment(m, idx, {kind, treatment, question, stages})` / tool `fork_experiment` / "Fork this experiment" card. reproduce → pinned bundle (no approval; nothing changes); replicate → fresh bundle + plan_sampling's run count; **extend** → ONE treatment `&cntrl` key of a material class, finite numeric value; thermodynamic-state keys apply to equilibration + production (heating ramp left alone, stated as a temperature jump then equilibration), others to production; `stages` override validated against that set; one pending proposal per stage (`Proposal.fork` metadata); NOTHING applied until Approve. Demo treatment: `temp0` 300 → 310 K (salt is an MMPBSA analysis parameter, not `&cntrl`, so it is not a controlled MD extension here).
- Lineage: `rerunBundle` README `## Fork` + bundle `manifest.json` `parent`/`fork` derived from the edits actually applied (partial approval and combined forks are flagged, `complete: false`); `tools/extract_run.py` copies `parent`/`fork` from a `manifest.json` in the rerun directory onto the child card.
- Reviewed adversarially by `codex exec` (11 findings, all addressed: replicated-rung criterion, lineage under partial/multi-fork approval, extractor lineage, robustness threshold, re-derivation, repeatable gating, page copy, `stages` validation, non-finite values, empty-window false pass, controls wording).
- Page button "extend" drafts the call into the Tool Console (`store.console`); the human edits and presses Call — the console remains the only path.

## Judge loop 2026-08-29 (stopped; decisions pending)

Five judge→fix→deploy iterations ran unattended (scorecards + dispositions in `docs/coordination/judge-*.md`): 46ca5ba → 097a01a (ladder + fork) → f64789f → ff85e2f → b4491c3 → 662e98d → fd8620c → this build. Scores moved from 8.2/7.2/7.0/7.3 (workflow judges) to Codex 9/8/9/9 and design 8/7/7/8. Every P1/P2 that was a fix has been applied; what remains are the recurring product decisions listed in `judge-fd8620c.md` (rung naming, which spread leads, default payload size, home primary, canned extension, gallery placement, MMPBSA caps, reproduce/replicate vs Approve). The loop stopped rather than re-judge those. **Decided 2026-08-29:** (1) rung 3 is two-level — 'verified' only with ≥ 3 runs at this run's length, else 'partly established' stating both parts; (2) the 9-run SD stays the headline with n and lengths in the caption; (3) `explain_result` / `plan_sampling` / `confidence_ladder` are compact by default, `detail: true` for the full record. (4) home page is the cohort view — runs grouped by prepared system + protocol with the run-to-run ΔG on the group line and a data-derived 'start here' on the longest run of the largest cohort (7d77378). Codex desktop batch 04 request is in `claude.md`, awaiting the user's start authorization.

## Open decisions (human)

1. ~~Turn off Vercel Authentication~~ done 2026-08-28; ~~redeploy~~ live = f39c348. Local master is 3 commits ahead of origin/master (not pushed).
2. Demo story: `validate_stage` → `explain_result` → `propose_change` + Approve → `generate_rerun_bundle` — proven end-to-end on the live site 2026-08-29; script and video still to do.
3. ~~Does `1l2y-regression` belong in the ensemble?~~ Resolved: the ensemble reports both strata — all runs and runs ≥ 10 ps (`LONG_RUN_MIN_PS`).

## Known thin spots (real, but a judge who pokes will find them)

- ~~sign claim hardcoded~~ → `signClaim()` computes "all / k of n / none" from the data.
- ~~same system = ligand + atom count~~ → `systemFingerprint()` over ligand, atom types, charges, protein atoms, force fields, solvent, box, buffer; index carries the fields.
- ~~materiality = 4-key blacklist~~ → `PARAM_CLASS` taxonomy (physics / thermodynamic_state / sampling_length / restraints / minimization / output_cadence / stochastic); interpretation keyed on classes and quotes |ΔΔG| vs run-to-run SD.
- Proposals live in page memory; a reload clears them. Intentional (nothing is authored here) — say so on the page.
- ~~The rerun bundle needs the original `build/` inputs~~ → the extractor archives the leap.in inputs and `generate_rerun_bundle` ships them (`self_contained: true` on all runs); the README names anything still missing.
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
src/store.ts        tiny external store: route, proposals, sourced calls, typed investigations keyed by run, WebMCP status
src/App.tsx         Home / RunPage / ComparePage / Current Investigation / Sidebar
src/Viewer.tsx      3Dmol viewer with WebGL fallback + error Boundary
```

Invariants (from CLAUDE.md): a number is a claim — every figure traces to a file; six of the fifteen tools are
not read-only, and only `propose_change` and `fork_experiment` can prepare a change to a scientific input — both stop
at the Approve button, while the other four write page state only; a tool that
answers about one run navigates the page to it (`get_run_manifest`, `diff_runs`, `recompute_result`, `propose_change`,
`generate_rerun_bundle`, `fork_experiment`, `export_evidence_brief`) so the agent's actions are visible to the human.

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
| `recompute_result` | no (navigates; records a sourced run-scoped outcome) | ΔG, SD, corrected SEM, N_eff, drift verdict, per-term means over a chosen frame window (`start_frame`/`end_frame`/`interval` or `discard_ps`), Δ vs archived in corrected-SEM units; from archived per-frame energies only, MMPBSA.py not rerun; full window reproduces mmgbsa.dat |
| `plan_sampling` | no | **expected**: additional runs for a target SEM of the ensemble mean (run-to-run SD), expected single-run SEM at 5–100 ps and the length that reaches the target, which term limits the answer, `nstlim` as data for `propose_change`; assumptions listed |
| `confidence_ladder` | no | five rungs, each with status, the evidence behind it, and what would climb it; compact by default, `detail: true` for the full record |
| `fork_experiment` | **yes → pending** (extend only) | reproduce/replicate: seed policy and how many runs the spread still needs; extend: the controlled diff plus one pending proposal per affected stage, nothing applied until Approve |
| `propose_change` | **yes → pending** | bounded &cntrl edit, validated before/after, awaits Approve |
| `list_proposals` | no | proposals + status |
| `generate_rerun_bundle` | yes (page state) | .in files (approved edits applied), leap.in, run.sh, README, env pins |
| `export_evidence_brief` | yes (page report state) | qualified Markdown snapshot; optional run-scoped session outcomes; never approves, downloads, posts, or runs MD |
