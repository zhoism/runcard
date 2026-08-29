# Judge scorecards — build fd8620c

## Codex CLI (scientist + WebMCP lens)

build: fd8620c · bundle: index-DsyBgKpr.js · 2026-08-29  
scores: webmcp 9/10 · execution 8/10 · impact 9/10 · creativity 9/10

webmcp 9/10 — Fourteen coherent tools support provenance, analysis, validation, controlled proposals, approval, and bundle generation; no real ChatGPT/WebMCP client was available to verify client interoperability.  
execution 8/10 — The stateful workflow completed and bad inputs failed clearly, but some outputs are excessively long and one ladder status overstates the evidence.  
impact 9/10 — This directly addresses reproducibility and false precision in MD, while exposing reusable patterns for other computational workflows.  
creativity 9/10 — The visible agent-proposes/human-approves boundary, controlled scientific fork, and provenance-bearing rerun bundle form a distinctive interaction model.

top costs (ranked, ≤ 5):  
[P1] “Independently replicated” is marked verified for rep4 despite only two 30 ps runs · confidence_ladder · observed nine mixed-length independent runs, with matched-length n=3 only at 5 ps; rep4’s 30 ps numerical result is not replicated under the rung’s stated ≥3 criterion · make the rung run-specific or rename it “seed variation characterized,” reserving verified replication for ≥3 matched-length runs.  
[P2] The lead uncertainty mixes heterogeneous trajectory lengths · explain_result / get_ensemble · ±0.66 combines 2–30 ps runs, while the ≥10 ps subset is ±0.79 and only two runs match rep4’s 30 ps length · lead with a stratified or matched-length estimate and keep the mixed-length SD secondary.  
[P2] Tool responses bury the decision in large payloads · explain_result / plan_sampling / fork_experiment · observed long repeated caveats, full run lists, block tables, and duplicated sign claims before concise panel summaries · return a compact default result with optional detailed evidence fields.  
[P2] Warning causality is stated more strongly than archived evidence permits · explain_result · output says the MMPBSA warning “is triggered by” the quantified DIHED residual, yet also says the cause is not recorded · say the residual accompanies and is consistent with the warning unless the trigger condition is provenance-backed.  
[P3] Browser presentation could not be independently verified · #/run/1l2y-rep4 · supplied Chrome exited without producing either screenshot or DOM, and no connected Chrome/WebMCP client was available; harness state and tool outputs did work · provide a deterministic browser-test artifact or hosted judge capture fallback.

demo walk-through:  
1. Open 1l2y-rep4 → works through tool navigation; archived ΔG reported as −19.1953 kcal/mol.  
2. Verify result and inputs → works; all six stages PASS and full-window recomputation exactly reproduces −19.1953 with SD 1.7114.  
3. Compare independent runs → works but needs careful reading; n=9 mixed-length SD 0.656, while n=5 at ≥10 ps gives SD 0.793.  
4. Ask what evidence is missing → works; plan labels projections expected and recommends six additional ≥30 ps runs for target SEM 0.25.  
5. Ask a nearby question → works; 310 K fork changes only density and product, preserves listed controls, and creates two pending proposals.  
6. Human approval and bundle → works; approval applies both proposals and generates a self-contained 13-file fresh-seed local bundle.

needs a product decision (not a fix): whether confidence is attributed to the specific 30 ps result, the prepared system, or the broader mixed-length protocol; whether the primary reported uncertainty should prioritize matched-length comparability or the larger available ensemble; how much scientific detail belongs in default agent output versus drill-down evidence.

What genuinely earned points: the product was unusually honest about what its numbers mean. It distinguished per-frame SEM 0.1711, autocorrelation-corrected SEM 0.2779, mixed-length run spread 0.656, and long-stratum spread 0.793; refused to infer ensemble uncertainty or sign robustness for the single 3htb-jz4 run; detected drift in 1l2y-regression; rejected both a plausible stage-name mistake and a zero uncertainty target with actionable errors; declined to compare ΔG across different complexes; and enforced the human approval boundary before producing a lineage-bearing, self-contained rerun bundle.
## Claude agent (design-critic lens)

build: fd8620c · bundle: index-DsyBgKpr.js (confirmed in served HTML) · 2026-08-29 · design lens, headless only (no clicks, no WebMCP client; click targets read from markup/handlers)

scores:
- webmcp 8/10 — 14 tools in one visible table, ✎ marks the mutating ones, run_id prefilled per page, header pill reports registration state; not exercised in a real client.
- execution 7/10 — all seven routes render first try at 1440 and 2560; no text < 13 px in the served CSS (min is 13px), no `text-transform: uppercase`, sticky rail has `z-index:2`, hero number is 22 px. Costs below are repeats, an empty state and a silent click.
- impact 7/10 — the run page reads like a real lab record; the compare view and the 3D card are thin next to it.
- creativity 8/10 — the ladder and fork cards make the "what would it take to trust this" loop visible without any tool call.

top costs (ranked):
1. [P2] Same fact stated three times on one page · #/run/3htb-jz4 · headline note "no spread can be quoted until three independent runs exist", ladder rung 3 "1 run of this system…; 3 needed", fork card "three are needed before one can be quoted" (jz4.html). Same pattern on rep4: run-to-run line "seed-to-seed variation over 2–30 ps… production lengths differ" vs rung 3 "9 same-protocol runs with distinct seeds at mixed lengths (2–30 ps)"; on rep2 "drifting" appears as a badge, in the within-run line, and in rung 4. · Fix: state the ensemble/drift fact once in the headline card and have the ladder and fork rows reference it ("see run-to-run above") or just carry the badge.
2. [P2] Same-system compare has no diff and no empty state · #/compare/1l2y-rep4/1l2y-rep6 · cmp46.html contains only the ΔG card; no "Stage parameters" or "System" card and no sentence saying the inputs are identical, while the odd pair (cmpodd.html) does show a "Stage parameters" table. At 1440×2600 the page is one 330 px card over an empty column (cmp46.png). · Fix: one line "stage inputs identical across all 6 stages (11 keys checked); only seeds differ" plus the seed rows already shown.
3. [P2] "draft an extension (temp0 → 310 K)" click is invisible · #/run/* fork card · handler only does `set({console:{tool:'fork_experiment',input:…}})` then `scrollIntoView` on `#tool-console`; the rail is `position:sticky; top:0` and the console is already on screen at 1440×900 (rep4-fold.png), so the only feedback is a dropdown change 900 px to the right; nothing runs until the user also presses Call. · Fix: label it "prefill the console →" and focus/highlight the Call button after prefill.
4. [P2] The tool description dominates the sticky rail · every route · at 1440×900 the explain_result description is a 120-word 13 px paragraph from y≈380–590 (rep4-fold.png), the longest block on the first screen, beside a 22 px primary; it is agent-facing copy shown verbatim. · Fix: show the first sentence (the question) and put the rest behind a "what it returns" disclosure.
5. [P3] Copy contradicts itself between adjacent cards · #/run/* · Proposals card: "nothing is applied until you approve it here"; Fork card one screen below: "Reproduce and replicate need no approval" and `build pinned bundle` calls `generate_rerun_bundle` directly (live.js). Consistent with the invariant, but a judge reads it as a contradiction. Also odd pair: banner "ΔG not compared" sits directly above a two-row ΔG table (cmpodd.png). · Fix: Fork subtitle "Reproduce and replicate change no inputs, so no proposal is needed; extend does"; odd-pair card title "ΔG, listed not compared".
6. [P3] Mixed case and mixed naming · "input checks PASS" badge (rep4.html) is the only caps label on the page; compare h1 says "1l2y-rep4 vs 1l2y-rep6" while the picker beside it says "1L2Y + MOL, run 6" (cmp46.png). · Fix: "input checks pass"; use titles in the h1 with ids as the dim secondary, as the run page already does.

needs a product decision (not a fix):
- Home gives no starting point: ten identical-looking rows, the signature run (rep4) is row 5, no sort or "start here" cue (home-fold.png). Do you pick a run for the judge, or sort by production length?
- Should the verbatim MMPBSA.py warning stay in all caps (it is quoted source text, labelled "Recorded verbatim")? It is the only caps block and it violates the rule on purpose.
- Should reproduce/replicate bundles bypass the Approve button? The invariant permits it; the page's own copy makes it look like a loophole.
- Card text has no measure limit: at 2560 the run-to-run line runs ~150 characters wide (rep4wide.png) while `.lede` is capped at 70ch. Cap cards or accept it.

what genuinely earned points: The run page has one clear primary — "-19.20 ± 0.66 kcal/mol" at 22 px with the ± immediately defined as run-to-run SD and the within-run SEM explicitly demoted — and every number under it names its file or its formula (the "how these numbers were computed" disclosure quotes the mmgbsa.dat 100.8 quirk rather than hiding it). Related facts are grouped: uncertainty/method/sparkline/warning in one card, system in one, provenance in one; the ladder uses four honest states (verified / expected / not established / not assessed) and each rung's evidence is collapsed so the page stays scannable. The odd-pair compare refuses the comparison in its first line instead of printing a meaningless ΔΔG, and marks nstlim/ntwx "moot across systems". Sizes, case and sticky z-index all pass the rules in the served CSS, and the same page structure holds on the short run and the single-run system without empty cards.

## Disposition (Claude, final build of this loop)
- Codex P2 warning causality → the residual "accompanies and is consistent with" the warning; the trigger is not recorded, so it is not called the cause (tool + page).
- Design P2 repeats on single-run / drifting pages → fork replicate row now references the card above; drift stays as one badge + the within-run row that carries the test.
- Design P2 same-system compare empty state → "stage inputs identical across all N stages (every &cntrl key compared, seeds excluded) — only the seeds listed above differ" (`diff_runs.stages_compared`).
- Design P2 invisible extension click → button reads "prefill the console with an extension (temp0 → 310 K) →" and the Call button receives focus after the prefill.
- Design P2 tool description dominates the rail → the console shows the tool's question; the rest sits behind "what it returns".
- Design P3s → fork subtitle "change no inputs, so no proposal is needed"; odd-pair ΔG card titled "listed, not compared"; compare h1 uses run titles with ids secondary.
- **Recurring product decisions (three rounds running; the loop stops here rather than re-judging them):**
  1. Rung names vs what is earned — keep the vision's names with the one-line qualifiers (current), or rename to what is tested ("seed-replicated", "window-insensitive"), or make rung 3 run-specific (verified only when ≥ 3 runs match this run's length).
  2. Which spread leads — the mixed-length 9-run SD (current, with the ≥10 ps stratum and matched-length SD stated beside it) or a matched-length estimate first.
  3. Default payload size of explain_result / plan_sampling / fork_experiment — compact-by-default with evidence on request, or the full record (current).
  4. Home page primary / "start here" run; canned temp0 example vs per-run choice; gallery placement; MMPBSA caps (verbatim) vs the caps rule; whether reproduce/replicate should also stop at Approve; `input checks PASS` casing.
