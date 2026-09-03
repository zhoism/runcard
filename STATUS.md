# STATUS — runcard

Updated 2026-09-02. Deadline **Sep 3 2026, 1:00 pm PDT** (Devpost, OpenAI WebMCP Challenge).

## Golden path pass (2026-09-02, branch `feat/golden-path`, preview only, not promoted)

From a product brief on the live site (a GPT pass) and the user's rulings: the golden run is `1l2y-rep4`; `#/` is a
landing page and Kevin's profile stays at `#/u/kevin`. **Home:** one claim ("MD runs you can inspect, verify, fork and
continue"), one primary CTA to the demo run, a "Start here" card read from the index (ΔG ± run-to-run SD, fork-network
status, engine change named), and a "What an agent can do here" card: seven verbs from `src/agentActions.ts`, each the
real tool it calls; "run it on the demo run" makes the call from the page (`console.run` in the store), the fork verb
prefills the console and its proposals wait for Approve. **Run page:** an objective line derived by `objectiveOf`
(system from the catalogue, method, length, count of runs, lineage with the engine change named on a fork — no run
directory records an objective, so nothing is typed), a "Next step" callout from `nextStep(confidenceLadderFull)` (the
first climbable rung → replicate / extend / plan_sampling / reproduce; a fully verified ladder yields the controlled
extension), the length dropped from the summary strip, the evidence overview down to two cells, "Fork and continue"
on the button and the cards, the seven verbs on the agent rail. A proposal thread from a fork carries a fork-terms
block (inherits / changes / what Approve does). **Current investigation** shows a planned fork (parent → child,
"expected · not yet run", approval x of y with links to the waiting pins, Prepare rerun bundle once approved, then the
bundle line) and points at the four executed forks and the compare page: the honest "fork created" — nothing runs in
the browser, and the executed forks are the proof the loop closes. Verified end to end in headless Chrome at 1440 and
390 (no overflow, no console errors): home → demo run → Fork and continue → Extend → Call → popover → Approve ×2 →
planned fork → bundle; explain and trace from the rail; the home "run it" auto-call; the ice1 objective; compare.
Tests 691 (agentActions ↔ TOOLS schema check, every verb runs on the demo run, objective/next-step); lint unchanged.

**Coherence pass on the same branch (2026-09-02, from a second GPT review of the preview):** (1) the replication rung is
engine-aware — verified only with three distinct-seed runs at this length **on this engine**; runs at the length on another
engine are disclosed as cross-engine reruns and not counted. rep4 drops from "3 of 4" to "2 of 4" verified with "2 of 3 on
PMEMD at 30 ps; 4 cross-engine not counted", which is the honest number and removes the contradiction between "replicated ✓"
and "the forks disagree beyond seed noise"; its next step is now one more PMEMD run at 30 ps, the same thing the fork
callout asks for. "13 comparable runs" reads "13 runs of one system and protocol · … · PMEMD × 9, SANDER × 4". (2) One
next-step rule: `nextStep` moved to `investigate.ts` and uses automode's `bottleneckOf`, so the callout under the result
and the investigation trace name the same rung; the callout labels "to strengthen the evidence" (the bottleneck's action)
and "to explore the science" (the robust rung's controlled extension, once verified). (3) The automode trace names what
ran: the bundle-readiness step is `bundleGaps (read-only check)`, never `generate_rerun_bundle`, and a test forbids the
write tool's name in any trace. (4) `recompute_result`, `plan_sampling` and `investigate_run` descriptions say their only
write is page state, which is why `readOnlyHint` is false. (5) Trims: the two "Ask your agent" prompt cards fold into a
details, the rail explainer is two sentences. (6) Small: "molecular dynamics (MD)" in the lede; loading text fades in after
450 ms; the ΔG line sets −19.20 kcal/mol apart from "± 0.64 run-to-run SD, 13 runs"; an "on this page" nav under the
objective; in-page anchors (`#trust`, `#network-…`) now scroll instead of routing to Home (a pre-existing bug: the router
treated any hash as a route). Skipped on purpose: route-specific tool registration and shorter tool descriptions — not
touching the registration path a judge hits first, the day before judging.

**Stratified uncertainty (2026-09-02, third GPT review, same branch):** the pooled ±0.64 over 13 runs mixes seeds, lengths
(2–30 ps) and two engines, and the page had called it "seed spread". Now `ensemble` carries a `matched` stratum (same
engine, same length) and a `seed_only` summary that is quoted only from 3 such runs (`SEED_MIN_RUNS`) and never
substituted by the pooled spread. rep4: "± 0.64 spread over 13 runs" on the headline with the caption "seed-only
uncertainty at 30 ps on PMEMD is not yet estimated (2 of 3 runs)"; ice1: "± 0.54 seed-only spread, 4 runs" because the
four SANDER reruns differ in nothing but the seed. A seed-only row joins the run-to-run table; explain_result and the
automode headline state both numbers; `seed_only_spread` is in explain_result's output. Wording: the sign claim is
"consistent across all n runs", the fork verdict measures "beyond the cohort's observed spread" and names engine and seed
as confounded, project blurbs say "same prepared system and core settings, differing seeds, lengths and engines"; a test
forbids the affirmative "seed noise" phrases in anything computed. A qualifier sits under the number ("short-run
estimate · a 30 ps MM-GBSA estimate from the archived trajectory: not a converged binding free energy, and not
experimentally validated"), the card is "Binding free energy estimate" and the section "what this record establishes".
"Continue" is narrowed: the lede says a continuation is prepared here, approved, run elsewhere and published back as a
child card; the fork card and the planned-fork card name `tools/extract_run.py` as the closing step. The rail shows
three verbs (explain, verify by recomputing, prepare a bounded fork); the other four sit under "All agent tools" with
the tool chips. Tool descriptions: Codex's `codex/tool-descriptions` (4de268b) is merged — 17 descriptions total 4.8k characters (from 9.9k), each ≤ 392, question-first, every tool states what it leaves on the page ("navigates; leaves nothing" for get_run_manifest and diff_runs), "for X use Y" lines on the overlapping pairs, schema property descriptions ≤ 90; a test in test/webmcp.test.ts caps all of it.

**Matched-only rule everywhere (2026-09-02, fourth GPT review, same branch):** one rule now governs every claim about
noise: only runs at the same length on the same engine (the `matched` stratum, ≥ `SEED_MIN_RUNS` = 3) can produce a
"seed" or "noise" statement; everything pooled is descriptive dispersion. (1) `diffRuns` classifies ΔΔG only against
the matched seed spread (`delta_g_vs_noise.basis` = "matched replicates" / "insufficient matched replicates" /
"conditions differ"); rep4 vs rep6 reads "Insufficient matched replicates to classify this difference. Observed ΔΔG
−1.59 kcal/mol; 2 of 3 same-engine, same-length runs exist — 1 more is needed"; the project dispersion is a `scale`
line, never the verdict. (2) The headline is the number alone; the rows beneath are "project dispersion" (descriptive,
not an error bar for any run), "matched seed uncertainty" (this run's error bar, or "not established — 2 of 3") and
"within run"; the ± beside the number appears only when a matched error bar exists (ice1: ±0.54, 4 runs).
explain_result's brief and `which_uncertainty_to_quote` say the same three things and never "quote ±pooled"; the
automode headline too. (3) `planSampling` sizes the ensemble on the matched stratum only (`planned_on` = "matched" |
null); below three matched runs it says "insufficient matched data — k of 3 … run n more matched replicates" with the
mixed-cohort projection marked "for scale only"; `run_to_run.matched`, `matched_runs_needed` and `scale` are in the
output; an extension's control runs are matched runs (rep4: 2 exist, 1 more). (4) The replication rung keeps its
engine-aware short text. (5) The fork network is an observed shift: "4 cross-engine forks are shifted 1.7 kcal/mol
from 1l2y-rep4 … engine and seed changed together, so significance and cause cannot yet be determined"; badges say
"shifted", never "in tension" (status key unchanged). Wording: "one prepared system and core parameters"; the demo and
project cards show "ΔG mean … dispersion SD 0.64 across 13 mixed-condition runs" instead of "±"; the Spread caption's
band is "mean ± SD across these runs, a dispersion". "Continue" is narrowed to "Prepare a continuation" on the button,
the fork card and the next-step link (the h1 keeps the brief's verb; the lede narrows it). The home card shows three
verbs with four folded, like the rail. Not done, on purpose: an import/publish action (uploads are out of scope),
tool consolidation, flipping investigate_run's annotation (the stated page-state rule stays).

## GitHub-for-MD-runs reframe (2026-09-01)

The intent, decided with the user 2026-09-01: **a shareable, agent-readable GitHub for MD runs.** Since the evening of 2026-09-01: **repo = prepared system (a project),
commit = run**, fork = a run re-executed from a rerun bundle with `parent` lineage, proposal = pull request (Approve reads as Merge),
CI = validation + confidence ladder, release = rerun bundle / evidence brief, automode = agent review, compare = diff. UI follows from it: lineage is a headline, agent work is auditable activity, Approve is the most important control.
Built: `forkNetwork`/`forkNetworks` in `runs.ts` (index.json now carries `parent`/`fork`), the `fork_network` tool, a **Fork network**
card on Home (parent node, rail, forks with engine/length/ΔG, computed verdict) and on the parent's run page below the ΔG card,
`fork of …` / `N forks · status` badges in the titlebar, and `↳ fork of` / `· N forks` markers in the run table. The one real
network on the site is in **tension** (parent −19.20 vs fork mean −17.51 ± 0.54, 2.6× the run-to-run SD, PMEMD vs SANDER named
as the confound) — shown in amber, not hidden. Not built (need a backend): comments, stars, uploads; say so in the Devpost.
**Designer round 2 (2026-09-01, spec in `docs/design/SPEC-2026-09-01-designer-round2.md`), built:** (1) proposals are
Figma-style comments pinned to the stage they target — bubble beside the stage dot; the pin toggles the thread, which
opens as a popover under the bubble (a bottom sheet at ≤700 px; Escape / outside click close it, focus returns to the
pin) with who/when (callTool stamps `source`/`t`), the diff, validation after, Approve / Reject, while the stage's
.in file and checks stay inline; the sidebar only points at the pins for the run on screen. Approve / Reject can be
undone for 15 s (thread and sidebar; `setProposalStatus(id, "pending")`, page-only, no tool reaches it); the Undo
line says when a rerun bundle prepared after the approval still contains the edit, since a bundle is not rewritten. (2) Analyses: `src/lib/analysisCatalog.ts` names each cpptraj plot, files it
under structure / dynamics / ensemble / energy and gives a one-clause technical description (plot type, never a run's
number) — shown as the figure's tooltip and in a collapsed "What these plots show" key under the gallery, not under
each plot, since the audience is computational chemists; filter pills above the gallery. (3) Fork flow: three cards (Reproduce / Replicate / Extend, one navy verb each, Copy prompt,
amber "needs your approval" on Extend), moved up under the fork network, with a **Fork** button in the title bar; the
general agent prompts moved into Current investigation. 390 px re-measured clean with a stage open.
**Visual language:** the designer's mockup (`docs/design/redesign-2026-09-01/`) was adopted in 007890a and **reverted the
same evening on the owner's instruction**; the app is back on the navy/bento report theme of e365aa6. Kept from the
interval: the Fork dropdown, the grouped compare picker, the header logo mark, the fixed approved-pin colour.
Next if time: an activity feed (the call log as a timeline) and an agent-review card on pending proposals.

### The editorial theme (2026-09-01, late — branch `design/editorial`, preview only)

The user judged the report theme against the WebMCP reference sites on Devpost's resources page ("looks like
hot ass") and asked for their look, built on a branch. `src/editorial.css` replaces `src/report.css` in the
entry; the markup gains a serif display face with one italic accent, sentence-case kickers, borderless cards,
a `WebMCP · 17 tools` pill (green registered · grey registering · amber off in this browser), a tinted "your
agent is invited" rail card with the developer console (17 tool chips) folded under it, and `src/Spread.tsx` —
one dot per run on the ΔG axis, band = mean ± run-to-run SD, hollow ring = the run the page starts from — as the
object home cards and the project page lead with. Rulings in `docs/design/DECISION.md` (late addendum).

Two review workflows ran on the branch (judge's first minute; then design · claims · phone/a11y · judge, each
finding adversarially verified). All 8 + 22 findings were applied: one navy primary per view (buttons default
to outlined; `.primary` marks the rail's Investigate and Approve), ids never set in the serif, each fact once
per page (fork status, rungs verified, ensemble numbers), AA contrast for amber/green/muted text, the runs table
scrolls on phones, spread dots get 24 px hit areas and pixel-based lanes, `role="group"` so the dot links are
announced, a new proposal scrolls to its Approve button, `diffRuns` names a differing engine in every branch,
`signClaim` rounds to 2 dp, a registering state so a WebMCP browser is never told it is off. 668 tests.

Preview: `vercel deploy --yes` from the branch (URL in the session; not production). Master still renders the
report theme until the user compares the preview and says so. **Codex worked in parallel**: its branch
`codex/new-user` (4 commits: first-visit banner, top nav, run filters, compare start page, run-page jump nav,
"Page tools" rail) is based on e112424 — before profiles, project pages and this theme — and uses the old
"run = repo" metaphor; it does not merge onto this branch. Some Codex working-tree edits (spread overflow
guards, fork-action stacking at ≤480 px, `pre.out.fail`) were swept into the branch commits and kept; its
`alert()` demo card and 11 px phone text were removed.

### Profiles: the home page has an owner (2026-09-01, evening)

The user, walking the site as a new visitor: "is this really what I'm opening runcard to? Don't we need a home? A profile?"
The opening page was an unowned run table, so it read as "my runs" with the name torn off. Decided: **the home page `#/` is a
profile** — GitHub's logged-out org page, not a dashboard — and there are still no accounts. `public/runs/owners.json` names
who published each card (`kevin`, default; `pace-ice` for the four PACE-ICE reruns, *under Kevin's cluster account* — the bio says
so; it is a second profile to open in the demo, not a second person). It is the one hand-typed field on the site, because no
artifact records who ran a job; `tools/build_index.py` stamps `owner` into `index.json`, and `list_runs` / `fork_network` return it.
Profile page (`Profile` in `App.tsx`, `ownerStats` / `ownerHandles` / `loadOwners` in `runs.ts`, 3 tests): avatar, name, `@handle`,
bio, stats (runs, systems, forks of these runs by whom, forks from whom, proposals awaiting approval), an "Also on runcard" line to
every other profile, the owner's rows in each cohort table (the cohort line stays site-wide, with "9 of 13 here"), and the fork
network compact under the tables. Run pages are named `owner / id` in the breadcrumb, `fork of kevin/1l2y-rep4` in the badge and
lineage line, and fork-network nodes carry their owner. `#/u/<handle>`; an unknown handle says so. Sidebar prefill now reads the run
id only on `/run/` routes (it had taken `pace-ice` for a run id). Before this, the same evening: the home page was cut to lead with
the tables (one-line lede, fork network compact and below) — superseded by the profile.

**The reviewer pass (2026-09-01, late evening; commits a666296 → this).** A new-user review found the science credible but said
the site "makes me absorb its entire internal data model before it tells me the simplest story" and asked to stop treating the run
as the container for everything. Decided with the user: system = repo, run = commit; home = projects; all five priorities, minimal.
Built: (A) `Cohort.slug`, `cohortBySlug`, `projectSummary` (runs per owner, external forks, engines, the cohort's fork network),
`protocolPairs` — pure, tested. (B) **Home `#/` = the project list** (`ProjectCard`: what the system is, "13 comparable runs · 9 by
Kevin Zhou · 4 by PACE-ICE (external forks)", ΔG ± SD, fork-status badge, Open project / Longest run) and a **project page
`#/p/<slug>`**: shared system + protocol (re-read from the index key), ensemble result (`ensemble` strata + `signClaim`), the
**fork callout** (`ForkCallout`: one finding + "Plan a replicate"; the arithmetic stays in the network card), the longest run's
ladder *labelled as that run's*, the runs table with owner and engine, the full network, `ForkCards`, a comparability paragraph.
Profiles keep their project cards with the owner's rows folded. (C) **Run page reordered**: crumbs `owner / project / id` →
summary strip (engine · length · seed · "3 of 4 assessed rungs verified" · **Investigate this run**) → fork callout on parents →
ΔG + contacts → *can I trust it?* (evidence overview, ladder) → *what happened* (structure, **3 featured plots** of 12 with "All
analyses") → *build on it* (fork cards, network, current investigation) → *how it was produced* (stages with the proposal pins,
system, provenance). The MMPBSA warning is an interpreted status (`details.warnstatus`: residual % of ΔG, "retained caveat, not
outcome-determining" when < 0.1 %, verbatim text behind the summary). (D) **Sidebar agent-first on run pages**: "Ask runcard about
this run" with one Investigate button; the 17-tool console sits under **Developer tools**; the visitor's choice sticks; compare
pages scope the run id to their first run (the `{}` Auto input the reviewer hit). Not done, on purpose: a protocol nav level (one
protocol per system), an ensemble-level confidence score (the ladder is per run), "Ask an agent" on cards (Investigate is a
deterministic trace, labelled as such).

**Tightening pass after the reviewer's second look (same night).** Seven cleanups, no new architecture: breadcrumbs are
project-first (`projects / 1L2Y + MOL / 1l2y-rep4`) with the owner as run metadata (`Kevin Zhou @kevin` in the summary strip);
the project page's "compare this run with" became **Compare two runs** (two pickers, in the Comparability card); the **Proposals
panel collapses to a count** (`details.card.proposals`, forced open only while something is pending) and sits below the console;
the console is **agent-first on every page** with a contextual action — run: Investigate; project: Investigate the longest run +
Check the forks (`fork_network`); home: What is on this site? (`list_runs`) — Developer tools is the alternate tab; the header
"Investigate this run" button is gone (one primary button, in the sidebar); on the run page the **result comes before the fork
callout** (metadata → ΔG → "can I trust it?" with the rung badge → callout → evidence → ladder); and the spread is worded as the
**observed run-to-run spread across comparable runs with different seeds, lengths and disclosed engines** everywhere it was
"seed-to-seed" (`signClaim`, `explainResult`, `diffRuns`, the ΔG card, project and cards; `ensemble()` now returns `engines`).
"Projects 2" lost its count.

**Experiment cards, not a run table (same evening).** The user: "this is just a load of runs… if they are really just run files
and there's 9 of them, put them under a dropdown." The runs are the commits, not the repo. Each prepared system is now one card:
title + what it is (`src/lib/systemCatalog.ts`, reference facts about the PDB entries and ligands, no numbers: Trp-cage · indole,
T4 lysozyme L99A/M102Q · 2-propylphenol), a two-sentence description, ΔG mean ± run-to-run SD with the spread explained in a
clause, one primary action ("Open …, the longest"), forks by whom, and the run table folded under a `details` (open only when
≤ 3 rows). The table lost the columns identical across a cohort (ligand, protein atoms); "PLIP" is labelled "contacts".

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
| Tools (`src/webmcp.ts`, `src/lib/runs.ts`) | done locally — 17 tools; tool 17, `fork_network` (read-only), lists the runs forked from a parent with fork mean ± SD and the parent's offset in run-to-run SDs — `agree` / `tension` / `sign`, never smoothed; one table drives WebMCP + in-page console. Tool 15, `export_evidence_brief`, prepares a qualified Markdown snapshot and does not approve, download, post, or run MD. Tool 16, `investigate_run` (**automode**), reads the ladder, picks the rung holding the run back and chases it with read-only tools, then recommends one action in words — it creates nothing, and the console's Auto/Manual switch calls it |
| WebMCP in a real agent | **verified 2026-08-28** in ChatGPT's browser (localhost) and **2026-08-29 on the live URL** by Codex's browser (batch RC-20260828-02, `docs/coordination/`): 10 tools registered, full demo flow `validate_stage` → `explain_result` → `propose_change` → human Approve → `generate_rerun_bundle` with the approved dt=0.001 landing in the downloaded ZIP; live 404 recovery; 390 px no overflow; zero failures. **Batch 03 (2026-08-29, live d604351):** 12 tools registered; `recompute_result` + `plan_sampling` → `propose_change` → Approve → bundle chain verified from the downloaded ZIP; one real bug (RC-003, stale `ps` in the mdin title after a duration edit) found and fixed. **Batch 04 (2026-08-30, live 7d77378 → 2f7ac29):** 14 tools registered; `confidence_ladder` 2 of 4 + "partly established" accepted as the honest state (RC-004 A disputed, accepted); `fork_experiment` extend temp0=310 → 2 proposals → Approve both → 13-file self-contained bundle with Fork lineage, partial-approval warning, `stages:["heat"]` error, console prefill all verified live; RC-004 B (replicate on a 1-run site gave a null recommendation) fixed and verified on 2f7ac29. Codex's browser cannot capture downloads, so ZIPs are inspected from user-supplied archives: the **full fork** archive is verified (13 entries, 13475 B, SHA-256 `6005ea20…d8ae048` — `heat.in` temp0=300.0, `density.in`/`product.in` temp0=310.0 with ig=-1, README lineage with no partial warning, `manifest.json` parent=1l2y-rep4 and `fork.complete: true`). The **partial-approval** archive is verified too (13 entries, 13514 B, SHA-256 `e355d370…d4c854a5` — `density.in` 310 K, `product.in` and `heat.in` 300 K, README carries the partial-approval warning, `manifest.json` `stages_applied=[density]`, `stages_not_applied=[product]`, `fork.complete: false`). **Batch 04 complete** 2026-08-31T02:15Z after one fix/retest round, zero open issues. **Batch 05 (2026-08-31T02:18Z): passed clean, zero of three rounds used** — 14 tools, ladder 2 of 4 + partly established, replicate guidance, invalid-stage error, console prefill, and both bundle paths re-verified from Codex's own downloads (full `ee6f81b6…cc24f5c6`, 13475 B, `fork.complete=true`; partial `cfd194e1…1dc22dca25`, 13514 B, `fork.complete=false`). **Batch 06 (2026-08-31T02:20Z): passed clean, zero of three rounds used** — same matrix, both bundle paths re-verified from its own downloads (full `b24565b9…`, `fork.complete=true`; partial `4f2c1e94…`, `fork.complete=false`). **Batches 04–06 are complete; Codex mode is `complete`, its heartbeat deleted, and no `ready_for_claude` request is open.** Across the three batches the live build was exercised by a real WebMCP client 3× end-to-end with six independently downloaded archives inspected byte-for-byte; the only code change required was RC-004 B. The one item Codex structurally cannot test — the **flag-off header pill** — was verified here instead on live `index-DwFbZHdi.js` via headless Chrome (no WebMCP): the pill renders `no WebMCP here — use the Tool Console ↓` as `<a href="#tool-console">`, and clicking it scrolls 0 → 192 px with the Tool Console in view (top 147 px) while the hash stays `#/run/1l2y-rep4` and the h1 stays `1L2Y + MOL, run 4` — it does not route home |
| Page renders | verified (headless Chrome): home, run, compare. WebGL-less browsers get a fallback instead of a crash |
| Deploy | `https://runcard.vercel.app` public since 2026-08-28 (Deployment Protection off). **Live = d44ec58** (deployed 2026-09-02, bundle `index-BE1mQlsW.js` — the editorial theme with the two review passes, the feedback branches 2/6/7/8, Codex's port, Newsreader, and the spread hover; 681 tests). Previous: 502cd50 / `index-XXvRWZIK.js` — RC-006B: automode reads `build_inputs.present` instead of calling bundleGaps bare, so it no longer contradicts the bundle tool's `self_contained:true`; verified on live by Codex over real WebMCP at batch 08 close. Previous: 7aa4eb5 / `index-CzZf_syG.js` — the MM-GBSA bundle step, 15 files, client-verified by batch 08. Previous: 5aa3d80 / `index-BKr9BWEa.js` — RC-005 fixes: run lineage rendered under the title and in Provenance, and the evidence brief no longer backslash-escapes artifact and tool names. **390 px closed on this asset by Claude** (Codex's in-app browser cannot resize): doc scrollWidth = clientWidth = 390 on `1l2y-rep4` and `1l2y-rep4-ice1`, nothing past 391 px, fork `dd` 324×68, lineage wraps, and automode's trace renders at phone width with the proposals queue still empty. Previous: 0c6fc66 / `index-Buc2vnBI.js` — automode; verified on live by headless CDP on `#/run/3htb-jz4`: the Auto/Manual switch renders, Auto → Investigate runs the investigation, the 4-step trace renders in the investigation panel, the panel states it created nothing, and the Proposals queue stayed empty. Previous: f8aedc7 / `index-ImjCbwKG.js` — same bundle hash as b1ee36a because nothing in `src/` changed after it; the manifests did, and live serves the per-field `composition_source`. The b1ee36a verification below still describes this build: verified live by headless CDP on `#/run/1l2y-rep4`: `index.json` serves 14 runs with all four `1l2y-rep4-ice*` at 30 ps under `Amber 24 SANDER (2024)`, and the ladder renders **3 of 4** with rung 3 *verified* — "6 of 3 needed ✓" — including the engine-mix sentence (4 SANDER, 2 PMEMD) and the wider matched-length SD ±0.80. No page errors. Previous: 2fabdc3 / `index-rt0eVFZ8.js`, 1dac802 / `index-CHGgfGiH.js`, 5a885d9 / `index-D3GpiLiC.js`, 2f7ac29 / `index-DwFbZHdi.js`, 7d77378 / `index-B7PiDcQK.js`, 6f317dc / `index-DEIhYtI0.js`, 3ef2cb5 / `index-BTW4-AZd.js`, fd8620c / `index-DsyBgKpr.js`, 662e98d / `index-CZfZNhsT.js`, b4491c3 / `index-Y31UbNAm.js`, ff85e2f / `index-USiMctXW.js`, f64789f / `index-CqSj8sfl.js`, 097a01a / `index-D8epXSVf.js`, 46ca5ba / `index-D_Ku5S9V.js`, d604351 / `index-DoMhorJt.js`). Deploy from a worktree whenever another session has uncommitted edits in the working tree; missing manifest → 404, which the loader handles. Project is not git-connected: every deploy is a CLI deploy |
| Demo video, Devpost text | not started |
| UI polish | first pass done 2026-08-28 (f39c348): sentence-case headings, ≥13 px text, ΔG at heading size, no horizontal overflow at 390 px (measured via CDP), header badge explains itself without WebMCP, Tool Calls panel readable, tool descriptions question-led, `explain_result.brief`. PASS is neutral and scoped as an input sanity check (2bd3127). **Correction 2026-08-31:** the "no horizontal overflow at 390 px" claim below stopped being true once the Fork card landed — its action column is `max-content` and its longest button is ~366 px, which starved the description column to 0 px wide and 2176 px tall and scrolled the page 103 px sideways at ≤ 480 px. Measured on live at 390/414/480 px, fixed in `dl.fork` with a stacking media query, re-measured clean (390/390, description 324×68). Codex review batch 1 (`docs/coordination/`): RC-001, RC-002 fixed (a44bb7f). **2026-09-02 editorial branch:** fork card buttons stack at ≤480px; spread SVG constrained with responsive text; home adds one-click WebMCP demo card (`list_runs`, `explain_result`, `investigate_run`); console errors pretty-print. Verified clean at 390/1440. Not done: PLIP png/residue repeat, 12-thumbnail gallery hierarchy, MMPBSA warning styling, preprint theme (separate chat) |

`bun --bun x vitest run` (667 tests) and `bun --bun run build` pass in the current checkout. **Environment note (2026-08-29):** with the system Node 20.12 at `/usr/local/bin/node`, `bun run test`/`vite build` fail at startup inside rolldown (`util.styleText` array form needs Node ≥ 22). Run them under bun's runtime instead: `bun --bun x vitest run` and `bun --bun run build`.

## Review 2026-08-29 (five-dimension workflow on live d604351)

11-agent review (science claims · agent usability · first-minute judge pass · accessibility · code quality), each finding adversarially re-checked; ranked list with file:line in `~/Desktop/runcard-review.md` (55 items: 0 P1, 12 P2, 43 P3). **Quick fixes applied (uncommitted → this commit), all 12 P2s plus ~25 P3s:**

- Science: the drift verdict was a 1σ test (|Δhalves| > 2×full-series SEM); now 2σ of the half-difference, √(SEM₁²+SEM₂²) with per-half corrected SEMs — no archived verdict flips, `halves.se_of_diff`/`diff_in_sigma` exposed, threshold text states the formula. "seed-to-seed variation dominates" is now gated on the ratio (≥2 / 1.2–2 / <1.2). `explain_result` names the stratum and quotes the ≥10 ps SD next to the all-runs SD so it agrees with `plan_sampling`. Block SEMs use ddof=0 like everything else. Cross-system `diff_runs` returns `delta_g.diff = null` (was a meaningless ΔΔG). n=1 ensembles get a one-run caveat; sign claim quantifies "pinned to about ±SD"; `long_runs` says "no runs ≥ 10 ps" instead of "no runs".
- Tools: two approved proposals on one stage now compose (was: oldest only, README claimed both); SLURM `#SBATCH` after the shebang; enum enforcement on `generate_rerun_bundle`; proposal ids unique per ms; `propose_change` rejects empty/array/comma-smuggled edits and accepts JSON-string edits, names stages with roles on a miss, says "cannot be approved" on a FAIL after-report; `discard_ps` ≥ run length and bad `get_ensemble` ids get actionable errors; `verdictOf()` replaces five hand copies.
- Page: header pill scrolls to the console instead of routing Home; Tool Console prefills `run_id` from the run on screen and shows the Chrome flag in text; `.grid2` cards align to top (empty Contacts card no longer 500 px); minimization stages drop "NVT"; `net −0.000001` renders as 0; stage note moved out of the h2; frames_note reference explained inline; ΔG unit on the home table; single-run row on 3htb; compare tables have headers and "material / not material" text; badges 13 px; run rows show a pointer; `document.title` per route; aria-labels on selects/textarea, a polite live region for tool calls and console output, alt text fixed, disabled-Approve reason visible.

**Also done (second commit):** entropy caveat — `tools/extract_run.py` now records `params.entropy` from `_MMPBSA_info` (all runs: `0`, manifests re-extracted, only that field and the `extracted` date changed); `explain_result.entropy_term` + a sentence in `what_it_is` ("effective interaction energy for ranking, not an absolute binding free energy"); the ΔG card heading says "no entropy term". Drifting-run projection — `plan_sampling` no longer prints a single-run length for a run whose verdict is not "no drift detected" (`expected_length_for_target_ps: null` + `expected_length_note`; recommendation and panel line say so).

**Not done (from the review):** repeated facts on the run page (ps/seed/AmberTools ×2–3), same-system compare repeating ΔΔG, 2560 px `.app` max-width, `plateau_sem` naming, counter-ion count in the fingerprint, focus management on route change, a `webmcp.test.ts`. RC-002 keyboard disclosures still only partially retested. `index.css` changes must be mirrored in `theme.css` when the preprint theme lands.

## Handoff — 2026-08-31, end of the replication session

**Live = HEAD = f8aedc7**, pushed. 643 tests, `tsc` and `build` clean. No known open bugs.

What this session did: took four real 30 ps replicates run on Georgia Tech PACE-ICE from a
`generate_rerun_bundle` output, extracted them as cards, and flipped `1l2y-rep4`'s
"independently replicated" rung from *partly established* to **verified** on real data (3 of 4).
Four extractor defects surfaced and were fixed (sander banners, sander wall time, per-run
`env.lock.yml`, composition read from artifacts when the build pipeline's `s*.json` is absent),
plus two found by reviewing the session's own diff: dead coverage on the ladder's
partly-established branch, and all-or-nothing provenance on the new composition fallback.

### The queue, in order. Everything here ships before Sep 3 1:00 pm PDT or is cut — judges test the
### live URL, so whatever is deployed at the deadline *is* the product. There is no "after".

1. ~~**`generate_rerun_bundle` ships no MMPBSA step.**~~ **Closed 2026-09-01.** The bundle now carries
   `run_analysis.sh` and `analysis/mmgbsa.in` alongside `run.sh`, so it reproduces the card's ΔG and not
   only its trajectory — 15 files, up from 13. Every analysis parameter is read from that run's own
   manifest (receptor/ligand masks, `igb`, `saltcon`, frame window, production stage name), so a 3HTB
   bundle carries `:1-163`/`:164` and a 1L2Y one `:1-20`/`:21`; nothing is hardcoded. The script is
   modelled on the one that actually produced these numbers on PACE-ICE, including the non-obvious detail
   that `ante-MMPBSA.py`'s `-m` and `-n` are mutually exclusive, so passing the receptor mask as `-m`
   makes the ligand default to its complement. The README states plainly that nothing was executed by the
   page, and what a fresh seed means for the number. **Client-verified by batch 08** (2026-09-01): both
   ZIPs downloaded over real WebMCP, 15 CRC-clean files each, masks differing per system, SLURM job
   names and README claims exact. **And now executed** (2026-09-01, local AmberTools): the exact
   generated bundle, run unmodified against `1l2y-rep4`'s archived trajectory, reproduces the archived
   ΔG — **−19.1939 vs −19.1953**, 1.4e-3 apart, two orders below the frame SEM, clustering structure
   included. The execution caught a real bug no file inspection had: the script hardcoded
   `--radii=mbondi2` while every archived analysis ran on **mbondi** topologies — a 0.47 kcal/mol error
   in the number the bundle exists to reproduce. Radii are now read from each run's own prmtop artifact
   into the manifest (`results.mmgbsa.radii`) and emitted from there; the four ICE runs archived no dry
   topology, so their bundles omit `--radii` and say so instead of guessing. Receipts:
   `docs/verification/20260901-generated-analysis-execution/`.
2. **A new UI — resolved 2026-09-01: the app is the "report" theme** (`src/report.css`, commit
   a20b924), built to designer Lailai Zhang's rulings from their Figma review (Inter + mono only,
   deep-blue nav with white text, white bento cards on grey, green/amber/red semantics with PASS now
   color-coded, warnings as bold lowercased banners with a caption keeping the verbatim claim honest,
   rail sized to the viewport). Full ruling record: `docs/design/DECISION.md` addendum. `theme.css`
   (preprint), `amber.css`, `index.css` are all rejected reference-only — never import them unasked.
   App.tsx changes were minimal: Verdict always emits the verdict class, and the warning caption
   copy. Verified: 654 tests, tsc, build; no overflow at 390/1440. **Production still serves the old
   dark UI — deploy is pending the user's ok.**
3. **Demo video + Devpost writeup.** Last, after 1 and 2, so it shows the finished thing.

**Batch 07 is done** (2026-09-01, stopped early). It verified automode's two critical invariants, the
3-of-4 ladder with the engine-mix disclosure, the global proposal queue, both bundle paths, seed
precedence, brief semantics and the console — and found two real bugs (RC-005 A and B), both fixed in
`5aa3d80` and deployed. 390 px was closed by Claude on the live asset rather than by a WebMCP client,
because Codex's in-app browser cannot resize.

**Editorial theme polish (2026-09-02).** Quick 5-min fixes on the `design/editorial` branch before demo:
- Fork cards: action buttons stack at ≤480px (`.fork-actions { flex-direction: column }`), no horizontal overflow at 390px
- Spread: `min-width: 0; overflow: hidden` on figure; `max-width: 100%` on SVG; figcaption wraps; text/font sizes scale down at ≤420px
- Tool Console: JSON errors now pretty-print with `.fail` class (red) instead of inline style
- Removed blocking `alert()`-based Quick demo card from Home (redundant with sidebar's one-click buttons)
- Verified: 668 tests pass, `bun --bun run build` clean, headless Chrome confirms `document.documentElement.scrollWidth === clientWidth` on home, run, and project pages

**Batch 08 is done** (2026-09-01, complete after 1 of 3 rounds). Over real WebMCP on live it verified
the entire MM-GBSA bundle step (both systems' ZIPs downloaded and inspected: 15 CRC-clean files, masks
`:1-20` vs `:1-163` with no cross-contamination, SLURM job names, pinned/fresh README claims), retested
RC-005 A and B — both now carry client verification, not just Claude's — and re-passed the batch 07
regressions. It filed RC-006: A was a tester file-attribution error (the quoted line was `run.sh`'s,
whose unsuffixed job name is correct; dispute accepted after Codex inspected the downloaded ZIP by
filename), B was real — automode called `bundleGaps(m)` bare and so reported the three archived build
inputs as missing while `generate_rerun_bundle` said `self_contained:true` on the same page. Fixed in
`502cd50` (automode reads `build_inputs.present`; regression test added), deployed as
`index-XXvRWZIK.js`, and Codex verified the fix on live. Both coordination heartbeats are deleted.

**Cut:** the cosmetic leftovers listed under "Not done (from the review)" — pre-existing, invisible in
a five-minute judging pass, and each risks regressing code that is currently green.

### Constraints that will bite a new session

- **What renders is `src/report.css` + `src/App.tsx`** since a20b924 (the designer-spec report look).
  `src/theme.css`, `src/amber.css`, `src/index.css` are rejected designs kept as reference-only; do
  not import them. Figma comments are read via `~/.figma-token` + REST, not the MCP. The
  file-ownership split between sessions is over.
- **`useStore` passes its selector straight to `useSyncExternalStore` as `getSnapshot`**
  (`src/store.ts:12`), so a selector returning a fresh array or object loops forever (React #185).
  Subscribe to the stable value and filter outside the selector. This shipped once.
- **Node.** System Node 20.12 breaks the npm scripts inside rolldown. Use `bun --bun x vitest run`,
  `bunx tsc -b --noEmit`, `bun --bun run build`, `bun --bun run dev`.
- **Deploys silently no-op.** Three times now. Always `curl` the live bundle hash and compare against
  `dist/assets/` after deploying, and re-run if it did not change.
- **Deploy from a clean `git worktree` of HEAD** plus `cp -R .vercel`, because other sessions leave
  uncommitted files in the working tree. The project is not git-connected; every deploy is a CLI deploy.
- **Reviewing this repo:** commit or ignore `docs/` first. The cloud review of this session's work saw
  ~20,600 insertions of which 151 were code, and returned one documentation nit.

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

Invariants (from CLAUDE.md): a number is a claim — every figure traces to a file; seven of the seventeen tools are
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
