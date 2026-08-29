# Judge scorecards — build 662e98d

## Codex CLI (scientist + WebMCP lens)

build: 662e98d · bundle: index-CZfZNhsT.js · 2026-08-29

scores: webmcp 9/10  
webmcp justification: Fourteen well-scoped tools expose provenance, reanalysis, validation, comparison, planning, controlled mutation, approval, and bundling; all harness calls worked, though no real ChatGPT/WebMCP client was available to test discovery UX.

execution: 8/10  
execution justification: The complete stateful proposal→approval→bundle flow succeeded first try, malformed inputs were handled safely, and unsupported ensemble claims were withheld; some scientific labels overstate what very short, mixed-length sampling earns.

impact: 8/10  
impact justification: Traceable run cards, honest autocorrelation-aware uncertainty, semantic input checks, and reproducible rerun bundles address real computational-science pain, but the present evidence is picosecond-scale and system-specific.

creativity: 9/10  
creativity justification: The visible agent-proposes/human-approves boundary, controlled experiment fork, and lineage-bearing bundle form a novel, coherent interaction rather than a decorative tool wrapper.

top costs (ranked, ≤ 5):

[P1] “Independently replicated: verified” is broader than the evidence · confidence_ladder / 1l2y-rep4 · nine runs mix 2, 5, 10, 20, and 30 ps; only the 5 ps stratum is matched-length with n=3, and all begin from one prepared start · label the rung “verified narrowly at 5 ps” or require matched-length ensembles for the global status.

[P1] Treated-versus-control plan is not fully controlled · fork_experiment temp0=310 · it prescribes 11 treated 30 ps runs but says the parent’s five ≥10 ps runs are the control, although those controls span 10–30 ps · require matched 30 ps controls or stratify the comparison by production length.

[P2] ±0.66 is presented as “the uncertainty of a single run” · explain_result / 1l2y runs · that SD pools different production lengths and short trajectories, so it mixes seed variation with duration effects; caveats acknowledge this but the imperative headline remains stronger · call it the observed mixed-length run-to-run spread and foreground the matched-length SD where available.

[P2] “Robust to analysis-window choices: verified” is statistically narrow · confidence_ladder / 1l2y-rep4 · four windows from one stationary 30 ps trajectory stay within 0.6 corrected SEM, but the windows are dependent and no model/preparation choice varies · rename the rung “window-insensitive on this trajectory” while retaining the verified evidence.

[P3] The judge-facing run view could not be visually verified · #/run/1l2y-rep4 · the supplied Chrome command exited without producing a screenshot or rendered DOM; curl returned only the 457-byte app shell, while all harness behavior remained available · provide a deterministic render artifact or browser-independent smoke-test snapshot for judging.

demo walk-through:

1. Open 1l2y-rep4 → confusing: tool navigation reached the run route, but the requested rendered screenshot/DOM was unavailable.

2. Verify result and inputs → works: all six stages passed; the archived 100-frame mean −19.1953 and population SD 1.7114 were reported as reproduced, though recompute_result itself was not part of the prescribed script.

3. Explain confidence → works: naive SEM 0.1711, corrected SEM 0.2779, nine-run SD 0.6560, five-long-run SD 0.7931, and the mixed-length caveat were clearly distinguished.

4. Plan sampling → works: labeled expected; recommended six additional ≥30 ps runs for n=11 and projected ensemble-mean SEM ≈0.24, with assumptions and n=5–19 sensitivity shown.

5. Fork nearby question → works: temp0 300→310 K changed only density and production, produced two PASS→PASS pending proposals, and explicitly preserved the 300 K heating schedule.

6. Human approval and bundle → works: approving both proposals applied exactly two edits; fresh-seed local generation returned 13 self-contained files with no missing build inputs.

needs a product decision (not a fix): Decide whether confidence-rung names describe broad scientific conclusions or explicitly narrow archived-data tests; decide whether sampling plans optimize the ensemble mean or uncertainty of a future single run; decide whether controlled extensions must automatically generate matched control ensembles.

What genuinely earned points: The least-supported 3htb-jz4 case correctly withheld both a spread and a sign claim at n=1; the drifting 1l2y-regression run was called drifting with a 2.16σ half-window shift; an incompatible 1l2y/3htb comparison refused ΔΔG; and deliberately bad mdin triggered four failures plus four warnings. Most importantly, mutation stopped at pending proposals until the explicit human approval step, after which the downloadable bundle recorded lineage, material edits, seed policy, complete inputs, and executable rerun instructions.
## Claude agent (design-critic lens)

build: 662e98d · bundle: index-CZfZNhsT.js · 2026-08-29 · design-critic pass (headless Chrome 1440×2600 + 2560×2400, DOM dumps, live CSS; no clicks, no real WebMCP client)

scores:
webmcp 8/10 — 14 tools listed in the in-page console with question-led descriptions and a ✎ marker on the three mutating ones; header pill honestly says "no WebMCP here"; a plain page could not recompute, plan sampling or stage an approval. Not exercised by a real agent here.
execution 7/10 — every route I hit rendered, including the odd pair; copy is honest to a fault. Points lost to hierarchy (result third in reading order), duplicated facts, a dead-end compare view, and a console whose default is the least relevant tool.
impact 7/10 — the ladder + run-to-run spread is exactly what a computational chemist argues about; the page proves it generalises only by one 3HTB run, and that run shows the single-run fallback works.
creativity 8/10 — the proposes/approves loop is visible on every page (Proposals panel is the first thing in the sticky rail), and "Fork this experiment" makes the three kinds of rerun a first-class UI object.

top costs (ranked, ≤ 6):
- [P2] The primary claim is subordinate. On every run page the ΔG headline is the third card, under System and Structure and after Stages; at 1440 wide the number sits at y≈730 px, i.e. at the fold of a 900 px viewport and below it on a 768 px laptop. Evidence: rep4.png / rep2.png / jz4.png (same order on all three). Fix: move "Binding free energy" to the first row and demote System to a collapsible strip.
- [P2] Tool Console defaults to `list_runs` with `{}` on a run page and on compare pages. Evidence: DOM on #/run/1l2y-rep4: `<option value="list_runs">` first, `<div id="tool-schema">{}</div>`, textarea `{}`. A judge on a run page has to pick a tool and type the run id before anything happens. Fix: default to `explain_result` (or `confidence_ladder`) with `{"run_id":"<current>"}` prefilled.
- [P2] Compare view is a dead end and repeats itself. #/compare/1l2y-rep4/1l2y-rep6: no "compare with…" control, only route out is the two h1 links; the grid2 leaves the right half empty (one card); the green line "identical prepared system; no parameter differences (seeds excluded)" restates the interp box "Same prepared system and protocol; only seeds differ". Evidence: cmp46.png, cmp46.html. Fix: keep the pair selector in the titlebar, drop the green line into the interp box, collapse grid2 when there is one card.
- [P3] Sections disagree on the next step for a short run. #/run/1l2y-rep2 (2 ps): within-run says **drifting**, ladder rung 4 says "to climb: longer sampling (plan_sampling)", yet the Fork card offers the same three buttons as rep4 and its only extension is "draft an extension (temp0 → 310 K)"; the headline still reads "-17.72 ± 0.66" with no drift marker. Evidence: rep2.html strings above. Fix: on a drifting run, make the Fork card's first action "extend sampling (plan_sampling)" and put "drifting" next to the headline.
- [P3] Same fact twice on 3htb-jz4. Contacts card lists 6 hydrophobic residues + 1 H-bond, then a full-width white bar chart shows hydrophobic=6, hydrogen_bond=1; the "frame 186 of 500 (medoid)" line has no spacing from the dl. Evidence: jz4.png. Also the ladder rung-3 evidence on rep4 states the spread twice in one paragraph ("run-to-run SD ±0.66" … "seed-to-seed SD is ±0.7"). Fix: drop the bar chart (keep the link), cut the second sentence.
- [P3] Design-rule nits: `input checks PASS` badge is an all-caps label (rule 7; evidence `<span class="badge ">input checks PASS</span>`); Confidence-ladder h2 carries a 20-word defensive subtitle ("3 of 4 assessed rungs verified · 1 not assessed — each computed from the archived data; a passing input check is not a rung"); gallery captions say the name twice ("rmsd · rmsd.png"). Fix: "input checks pass", move the caveat into the first rung, caption "rmsd" only.

Checked and clean: no text below 13 px (live CSS: .small/.mono/.badge/.stagebox all 13px), no uppercase-tracking labels, headline number is 22 px (no hero blowout), aside is `position:sticky; top:0; z-index:2; max-height:100vh; overflow-y:auto` and Proposals is its first card, so a "Fork this experiment" button fired at any scroll depth would have the Proposals panel on screen at 1440 and 2560. 2560 layout stays centred at 1720 px with no stretching.

needs a product decision (not a fix):
- Home page has no primary: ten near-identical rows and a lede; the claimed demo run (rep4, −19.20) is not featured. Should the landing page open on rep4 or pin a "start here" row?
- Should "Fork → extend" always propose the canned temp0→310 K, or should the extension be chosen per run (and hidden on runs that cannot support it)?
- Is the 12-thumbnail cpptraj gallery worth ~500 px of every run page, or should it be a collapsed strip below Provenance?
- Compare view on an unrelated pair shows only two "moot across systems" parameters — is a stage table meaningful at all when the systems differ, or should it be replaced by the one-line verdict?

What genuinely earned points: the site never lies to the reader. The headline ± is the run-to-run SD and the page says so in the next line; the 9 runs are called "same protocol at different lengths, not identical replicates" in the ladder evidence; the odd pair (3htb-jz4 vs 1l2y-rep4) refuses to compare ΔG with a clear reason instead of printing a meaningless ΔΔG; the single-run 3HTB page says "no spread can be quoted until three independent runs exist" and drops the ±; the MMPBSA warning is quoted verbatim and quantified rather than hidden; the ladder's rung 2 is honestly "expected — not executed here" and rung 5 "not assessed". The Tool Console exposing the exact 14-tool table an agent sees, with ✎ on the mutating three and the Proposals panel pinned above it, makes the approve/propose loop legible in one glance without a WebMCP client.

## Disposition (Claude, next build)
- Codex P1 controls not matched → `fork_experiment.sampling.control`: counts the parent's same-protocol runs at the recommended length (rep4 → 2 at 30 ps), says how many more control runs are needed, or to stratify by length.
- Codex P2 "uncertainty of a single run" → `which_uncertainty_to_quote` now names it "the observed run-to-run spread over all 9 runs … at mixed production lengths" and gives the matched-length SD where ≥ 3 runs share a length (5 ps: n=3).
- Codex P1 "independently replicated: verified" too broad and P2 rung-4 naming → **product decision, not changed**: the rung names come from the vision doc; the page and tool already state the narrow thing each rung earns ("seed-replicated; matched-length at 5 ps (n=3)", "4 analysis windows agree within 2 corrected SEMs"). Codex lists this under its own "needs a product decision". Options: keep the names + qualifiers (current), or rename rungs to what is tested ("seed-replicated", "window-insensitive").
- Design P2 primary claim third → the ΔG card is now the first card; Stages, then System/Structure follow.
- Design P2 console default → on a run page the console opens on `explain_result` with that run's id until the human picks a tool.
- Design P2 compare dead end/repeat → pair selector in the titlebar; the duplicate green line is gone; single column when only the ΔG card exists.
- Design P3s → "drifting" badge beside the headline on drifting runs; PLIP chart replaced by a link (residues stated once); ladder heading shortened, "not a rung" caveat moved into the Stages note; captions name the plot once; rung-3 evidence no longer repeats the SD.
- Left for the user: home page primary / "start here" row; canned temp0 example vs per-run choice; gallery placement; stage table on unrelated pairs; `input checks PASS` casing (PASS is the validator's token).
