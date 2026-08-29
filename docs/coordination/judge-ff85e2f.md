# Judge scorecard — build ff85e2f (Codex CLI, scientist + WebMCP lens, network-enabled sandbox; design lens: see judge-f64789f.md)

build: ff85e2f · bundle: index-USiMctXW.js · 2026-08-29

scores: webmcp 9/10 · execution 7/10 · impact 8/10 · creativity 9/10  
webmcp 9/10 — 14 well-scoped tools expose provenance, validation, reanalysis, controlled proposals, approval state, and bundle generation beyond ordinary page navigation.  
execution 7/10 — The tool workflow and defensive errors worked first try with valid harness syntax, but the generated “rerun bundle” omits required original build inputs; visual QA was unavailable because headless Chrome produced neither screenshot nor DOM after retry.  
impact 8/10 — Honest separation of frame SEM, autocorrelation-corrected SEM, and run-to-run SD would be genuinely useful, though the archived sampling is only 2–30 ps from one prepared start.  
creativity 9/10 — The agent-proposes/human-approves fork, controlled treatment diff, lineage, and fresh-seed bundle form a clear, novel interaction loop.

top costs (ranked, ≤ 5):  
[P1] Generated bundle is not self-contained · generate_rerun_bundle · output lists 10 files, while README says it still needs ligand mol2/frcmod and cleaned PDB from the original run · include those inputs or call it a rerun recipe, not a reproducible bundle.  
[P2] “Robust to reasonable analysis choices” is too broad for the earned rung · confidence_ladder · verified status tests only four window/stride choices and explicitly says force field, protonation, box, igb, and saltcon were not varied · label it “robust to trajectory-window choices” or leave the broader rung not established.  
[P2] Protocol-level precision is stronger than this ensemble warrants · explain_result / 1l2y-rep4 · −18.01 ± 0.22 combines nine 2–30 ps runs from one prepared start; the tool itself says this is not a survey of conformational space · qualify it as a conditional mean over this short-run ensemble.  
[P2] Unsupported uncertainty wording on the singleton system · explain_result / 3htb-jz4 · “within-run SEM 0.2902 understates the uncertainty” is asserted with n=1 and no run-to-run estimate · say it “does not estimate run-to-run uncertainty.”  
[P3] Sampling recommendation looks more certain than its variance estimate · plan_sampling · six additional runs is calculated from SD 0.7931 estimated from only five heterogeneous 10–30 ps runs · show a sensitivity interval or explicitly call six a plug-in estimate.

demo walk-through:  
1. Open/validate 1l2y-rep4 → works; all six stages PASS, with concrete dt, cutoff, thermostat, and ramp checks.  
2. Explain result → works; distinguishes archived −19.1953, naive SEM 0.1711, corrected SEM 0.2779, and run SD 0.6560 with file provenance and the MMPBSA warning.  
3. Confidence ladder → mostly works; recomputable and independently replicated are earned, repeatable is honestly expected, but the robustness rung is over-broad.  
4. Plan sampling → works; labels projections expected and recommends six more ≥30 ps runs for target SEM 0.25, with assumptions exposed.  
5. Fork temp0 300→310 K → works; creates two pending proposals for density/product, preserves the heat ramp, lists controls, and stops for approval.  
6. Approve and generate fresh-seed bundle → interaction works and applies exactly two approved edits, but the resulting archive requires missing external build inputs.

needs a product decision (not a fix): whether the confidence ladder’s fourth rung means narrow trajectory-window robustness or genuine robustness across scientifically reasonable modelling choices; whether “rerun bundle” promises a self-contained executable archive or intentionally assumes access to the original run directory.

What genuinely earned points: the entry is unusually honest about autocorrelation, drift, mixed run lengths, seed variation, entropy omission, and the internal-term warning. It rejects incompatible ΔΔG comparison for 3htb-jz4 versus 1l2y-regression, handles “production” versus “product” and discard_ps=999 with actionable errors, and keeps mutation behind an observable human approval boundary.

## Disposition (Claude, next build)
- P1 bundle not self-contained → fixed: `tools/extract_run.py` archives the files leap.in loads (ligand mol2/frcmod, cleaned protein PDB — all three present for all 10 runs, 122 KB total) under `public/runs/<id>/build/`; `generate_rerun_bundle` fetches and ships them (`self_contained: true`, 13 files) and the README states "Self-contained" or names exactly what is still needed; `bundleGaps()` is computed from leap.in minus what was actually shipped.
- P2 rung 4 over-broad → renamed "robust to analysis-window choices" everywhere (tool, page, description), described as the narrow, earned form of the vision's rung.
- P2 protocol-level precision → the ensemble mean ± SEM is now stated as "conditional on this short-run ensemble (2–30 ps from one prepared start; seed variation, not a survey of conformational space)" in the brief and `this_run_vs_ensemble.note`.
- P2 singleton wording → "does not estimate run-to-run uncertainty; no spread can be quoted until ≥ 3 independent runs exist" (tool and page).
- P3 plug-in n_needed → `run_to_run.n_needed_range` {low, high, sd_relative_se} from the SD's own sampling SE (1/√(2(n−1))), and the recommendation says "plug-in estimate; ±1 SE on the SD gives n = a–b".
- Codex note "headless Chrome produced neither screenshot nor DOM" — its sandbox, not the site; the design lens covers visuals.
- left for the user: what the fourth rung should ultimately mean (window-only vs modelling choices) — the label now says exactly what is tested.
