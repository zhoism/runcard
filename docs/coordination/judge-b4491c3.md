# Judge scorecards — build b4491c3

## Codex CLI (scientist + WebMCP lens, network-enabled sandbox)

build: b4491c3 · bundle: index-Y31UbNAm.js · 2026-08-29  
scores: webmcp 9/10 · execution 8/10 · impact 9/10 · creativity 9/10  
webmcp justification: Fourteen coherent tools expose provenance, reanalysis, validation, comparison, experiment design, approval, and bundling beyond ordinary page navigation.  
execution justification: The complete stateful workflow worked first try once given the harness’s undocumented `input` step shape; malformed and incompatible calls failed safely.  
impact justification: This directly addresses reproducibility and misleading uncertainty in computational science, with a design applicable beyond AMBER/MM-GBSA.  
creativity justification: The controlled-fork → visible pending proposals → human approval → lineage-bearing bundle loop is unusually concrete and scientifically meaningful.

top costs (ranked, ≤ 5):  
[P2] “Value is known to about ±0.7” overstates the evidence · explain_result / confidence_ladder · observed SD 0.66 pools nine 2–30 ps trajectories from one prepared start, while the tool itself reports long-run SD 0.79 and strong SD uncertainty · say “observed seed-to-seed SD is 0.66 in this short heterogeneous ensemble,” not “known.”  
[P2] “Independently replicated” is slightly over-earned as a full rung · confidence_ladder · nine distinct seeds exist, but production lengths vary 2–30 ps; this earns seed robustness of the sign, not identical-protocol replication of the numerical estimate · split “independent seed runs” from “matched-length independent replication.”  
[P2] Extension planning and generated execution diverge · fork_experiment / generate_rerun_bundle · fork recommends 11 runs per condition, but approval produces one fresh-seed bundle with no ensemble launch manifest · generate an explicit 11-member seed plan or label the artifact “one of 11 required runs.”  
[P3] “No drift detected” can read stronger than its short-window test supports · explain_result on 3htb-jz4 · the 5 ps run passes a halves test with N_eff 42.6, but has no independent runs and cannot establish broader equilibration · use “no drift detected by this halves test over 5 ps.”  
[P3] Real-client integration remains unverified · live WebMCP surface · the supplied real-manifest harness exercised all behavior, but no real ChatGPT/WebMCP client was available to assess discovery and presentation · add a recorded real-client discovery-and-approval smoke test.

demo walk-through:  
1. Open 1l2y-rep4 → works: archived ΔG −19.1953 and the intended −19.2 ± 0.7 interpretation are returned with caveats.  
2. Verify result and inputs → works: all six stages PASS; full-window recomputation exactly reproduces −19.1953 and SD 1.7114 without claiming MMPBSA.py was rerun.  
3. Compare independent runs → works: n=9, mean −18.01, SD 0.66; ≥10 ps subset n=5, SD 0.79; all values remain negative.  
4. Ask what evidence is missing → works: expected plan requests six additional ≥30 ps runs for n=11 and clearly labels assumptions and plug-in uncertainty.  
5. Ask nearby scientific question → works: changing temp0 to 310 K creates controlled PASS→PASS proposals for density and production while preserving the heating schedule.  
6. Review, approve, and bundle → works: human approval changed both proposals to approved; fresh-seed local bundle contained 13 files, applied exactly two edits, and reported itself self-contained.

needs a product decision (not a fix): whether the confidence ladder should reward heterogeneous-duration seed runs as “independently replicated”; whether sampling plans should generate one runnable member or the entire planned ensemble; whether “robust” should remain analysis-window-only or require a separately named modelling-choice rung.

What genuinely earned points: the entry is impressively honest about the distinction between per-frame SEM, autocorrelation-corrected SEM, run-to-run SD, and SEM of the ensemble mean. It preserved provenance down to archived filenames, exposed the MMPBSA internal-term warning instead of hiding it, correctly withheld sign confidence for the lone 3htb-jz4 run, downgraded the drifting regression run’s window-robustness rung, rejected an inverted frame window, refused a cross-system ΔΔG, and enforced the human-approval boundary before applying either temperature edit.
## Claude agent (design-critic lens)

build: b4491c3 · bundle: index-Y31UbNAm.js (css index-BuWuT4u2.css) · 2026-08-29 · lens: design critic, headless Chrome 1440×2600 + 2560×2400, DOM dumps; no clicks, no WebMCP client
scores: webmcp 8/10 · execution 7/10 · impact 7/10 · creativity 7/10

Owner's seven rules, checked against the live CSS: font sizes are 13/14/18/22 px only (16×13px, 7×14px); no text-transform except a "none" reset; no position:sticky/fixed anywhere (so the z-index rule is moot, but see cost 1). ALL CAPS appears once, in verbatim file text (see decisions). Sizes/caps/sticky pass; hierarchy, repetition and grouping carry the costs.

top costs (ranked, ≤ 6):
[P2] Fork actions and their result are ~1,400 px apart · #/run/1l2y-rep4 (Fork card vs Proposals card) · evidence: rep4-1440.png, "Fork this experiment" buttons (`<button class="ghost">` ×3: build pinned bundle / plan a replicate / draft an extension) sit at y≈1470–1610; the "Proposals — None yet" card is at y≈60–170 in a right rail with no sticky rule in live.css. Whatever "draft an extension" does, its Approve step renders off-screen at any viewport ≤1400 px tall — the human-approves loop is not visible where it is triggered · fix: make the rail sticky (with a z-index) or echo the new proposal inline beneath the Fork card with an "approve ↑" link.
[P2] Compare view buries its verdict and repeats it · #/compare/1l2y-rep4/1l2y-rep6 · evidence: cmp-1440.png — the finding "1.7σ → consistent with sampling noise" is the last clause of a two-line sentence in the bordered box; the ΔG table below restates |ΔΔG| 1.59, SD 0.66 and n=9 ("run-to-run (n=9) −18.01 ± 0.66", "ΔΔG (1l2y-rep4 − 1l2y-rep6) −1.59"); two half-width cards each hold one green line ("identical prepared system", "no parameter differences (seeds excluded)") · fix: bold the verdict as the first line; state 1.59 / 0.66 / n=9 once; collapse the two empty-state cards into one line under the table.
[P2] Analyses gallery is a dead end · every run page · evidence: rep4.html — 12 × `<figure><img alt="" loading="lazy" src="/runs/1l2y-rep4/rmsd.png">` with no anchor; `.gallery` minmax(200px) renders ~180 px thumbnails whose axis labels are illegible in rep4-1440.png. A judge who "reads a number and asks where it came from" cannot open the plot or the file · fix: wrap each figure in `<a href={src} target=_blank>`; add a caption with the source filename.
[P3] Confidence ladder: "3 of 4 rungs verified" above five equal-weight rows · #/run/1l2y-rep4, 3htb-jz4, 1l2y-rep2 · evidence: crop-ladder.png — five `<li>` rows (verified / expected / verified / verified / not assessed), no rung numbers or order cue; it reads as a checklist, not a ladder, and the count mismatch costs the reader a beat · fix: number rungs 1–5, grey the fifth row, heading "3 of 4 assessed rungs verified · 1 not assessed".
[P3] Ensemble facts stated three times on one page · #/run/1l2y-rep4 · evidence: crop-bfe.png — "± is the run-to-run SD over 9 independent runs", then "n=9: mean −18.01, SD 0.66", then the ladder rung "9 runs of the same system … (2–30 ps)"; the same card mixes precision: headline −19.20 ± 0.66 vs "halves −19.1023 → −19.2882" · fix: state n/SD/range once in the Binding card, let the rung link to it, and print halves to 2 decimals.
[P3] Home table title contradicts the "9 independent runs" claim · #/ · evidence: home-1440.png — only 1l2y-regression is titled "1L2Y + MOL (indole)"; the other eight are "run 1…8" with the same ligand column MOL; nothing tells the reader that "(indole)" is the ninth member of the n=9 set, and the "(indole)" implies the others are not indole · fix: "1L2Y + MOL, run 0 (regression)" or drop "(indole)".

demo walk-through (design path):
home → what is this / why WebMCP / what next are all answered in the first paragraph and the header pill — works
1l2y-rep4 → title, ΔG card, stages, ladder, fork read in order; the primary (−19.20 ± 0.66 with the ± caption) is clear — works
compare rep4 vs rep6 → honest but the verdict is subordinate to its own arithmetic — confusing
Tool console → select lists 14 tools, ✎ marks the three mutating ones, question-led description, schema hint + JSON textarea + Call, aria-live status; without a call there is no example output on screen — works (unverified: a click)
3htb-jz4 → ΔG card squeezed to half width beside Contacts; the PLIP bar chart (two bars) restates the residue list above it — confusing; odd pair #/compare/3htb-jz4/1l2y-rep4 says "not compared here" then still flags nstlim "material · sampling length" below — contradiction, minor
1l2y-rep2 (2 ps, drifting) → the headline −17.72 ± 0.66 looks identical to rep4's; "drifting" is one bold word mid-line and the ladder row "not established" — works, but weakly signalled

needs a product decision (not a fix):
- The MMPBSA.py warning is rendered in the file's ALL CAPS on every 1L2Y run; verbatim quoting is a project value, the caps rule is a design value — pick one (quote in a `<pre>`/mono block, or sentence-case with "verbatim: …").
- "draft an extension (temp0 → 310 K)" is the same hard-coded example on every run, including the drifting 2 ps rep2 and the single-run 3htb-jz4, where the ladder itself says the sensible next step is more sampling/replicates; should the fork card pick its suggested action from the ladder state?
- 3htb-jz4's "compare with…" menu offers only the nine incompatible 1L2Y runs; the compare page handles it honestly, but should the menu say so (group "same system" / "other systems") or hide them?
- Home at 2560: the runs table is ~570 px wide in a ~1,000 px column; is the table meant to stay compact (fine) or fill the column?

What earned points: the first screen answers the judge's three questions without a hero — "validated simulation records", a one-paragraph explanation naming navigator.modelContext, and a header pill that tells a flag-off browser exactly what to do. The run page has one clear primary (the ΔG headline whose ± is the run-to-run SD, with a caption saying why the within-run SEM is not the number to quote), and every card beneath it is subordinate and consistently structured. The Confidence ladder and Fork cards do read as structures in ten seconds — pill + bold rung name + one-line reason + collapsed evidence, and label + rationale + one ghost button per row — and the evidence disclosures name the source files and tolerances. Copy is honest and specific (2–30 ps "independent runs", "not executed here", "not assessed"), the drift and "not established" states change per run rather than being boilerplate, the odd-pair compare refuses to compare different complexes instead of printing a meaningless ΔΔG, and the Tool console mirrors the agent's tool table with mutating tools marked. Text sizes, casing and layout width hold at both 1440 and 2560 with no overflow.

## Disposition (Claude, next build)
- Codex P2 "known to about ±0.7" → sign claim now says "the observed seed-to-seed SD is ±0.7 kcal/mol in this short, mixed-length ensemble — a spread, not a converged uncertainty".
- Codex P2 replication rung over-earned → rung stays verified for seed replication but says so: "seed-replicated; matched-length replication at 5 ps (n=3)" (computed from the index by production length); evidence states what is and is not earned.
- Codex P2 fork plan vs one bundle → `ForkMeta.runs_per_condition`; bundle README states "this bundle is ONE member of the N planned … run it N times in separate copies"; `fork_experiment.sampling.note` says the same.
- Codex P3 drift wording → brief and page say "by the halves test over L ps; this tests drift within the archived window, not equilibration on longer timescales".
- Design P2 fork ↔ Approve 1400 px apart → the right rail is sticky (max-height 100vh, scrolls internally, z-index 2), so Proposals/Approve stay on screen when a Fork button fires; static below 1000 px.
- Design P2 compare verdict buried/repeated → `diff_runs` returns `verdict` (bold first line) separately from `interpretation` and `scale`; numbers appear once, in the ΔG table (with √2·SD); the two empty-state cards collapse to one line; cross-system parameter rows say "moot across systems" and carry `material: false`.
- Design P2 gallery dead end → each figure links to the PNG (new tab) and the caption names the file.
- Design P3s → rungs numbered 1–5 with the fifth greyed and the heading "3 of 4 assessed rungs verified · 1 not assessed"; headline caption no longer restates n; halves printed to 2 dp.
- Left for the user: "1L2Y + MOL (indole)" title of the regression run (naming is yours); MMPBSA warning in file caps vs the caps rule; canned "temp0 → 310 K" example on every run; grouping/hiding incompatible runs in "compare with…"; home table width at 2560; PLIP chart restating the residue list (known).
