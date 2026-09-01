// automode: an evidence-driven investigation of one run.
//
// Not a fixed sequence. The point of this site is that an agent reasons about evidence rather than
// running a script, so a canned "call all fifteen tools in order" would contradict the thing it is
// meant to demonstrate. This reads the confidence ladder, decides which rung is actually holding the
// run back, and chases that one — so different runs produce different investigations, and the same
// run produces a different investigation after its evidence changes.
//
// It creates nothing. Every function it calls is read-only, and the only thing it does to the page is
// record the trace for display. The recommendation is named in words; queueing a change to a
// scientific input stays something a human or an agent asks for explicitly.
import type { Manifest, IndexEntry } from "./types";
import { confidenceLadderFull, explainResult, ensemble, planSampling, recomputeResult, bundleGaps,
  uncertaintyFromFrames, type Rung } from "./runs";

/** What could move a rung. The ladder's own status says whether a rung is earned; this says who can earn it. */
export type MovableBy = "archived data on this site" | "a run executed elsewhere" | "not assessable here";

const MOVABLE: Record<string, MovableBy> = {
  "recomputable": "archived data on this site",
  "repeatable": "a run executed elsewhere",
  "independently replicated": "a run executed elsewhere",
  "robust to analysis-window choices": "archived data on this site",
  "externally supported": "not assessable here",
};

/** Ranked worst-first. "expected" outranks "verified" but nothing else: it is the ceiling for a rung
 *  that can only be earned off-site, so a run whose every assessable rung is verified still surfaces it. */
const SEVERITY: Record<string, number> = { "not established": 0, "partly established": 1, "expected": 2, "verified": 3, "not assessed": 4 };

export interface Step { tool: string; why: string; found: string }
export interface NextAction { rationale: string; tool: string | null; input: Record<string, unknown> | null; needs_a_human: boolean }
export interface Investigation {
  run: string;
  summary: string;
  headline: string;
  steps: Step[];
  ladder: { verified_of_assessable: string; rungs: { rung: string; status: string; short: string; movable_by: MovableBy }[] };
  bottleneck: { rung: string; status: string; movable_by: MovableBy; why: string } | null;
  next: NextAction | null;
  created: string;
  method: string;
}

const n2 = (v: number | null | undefined) => v == null ? "—" : v.toFixed(2);

/** The rung actually holding this run back: worst status first, and among equals the lowest rung, because
 *  the ladder is climbed in order — a gap low down is not excused by something verified above it. */
function bottleneckOf(rungs: Rung[]): Rung | null {
  const candidates = rungs.filter(r => r.status !== "verified" && MOVABLE[r.rung] !== "not assessable here");
  if (!candidates.length) return null;
  return candidates.reduce((worst, r) => {
    const a = SEVERITY[r.status] ?? 9, b = SEVERITY[worst.status] ?? 9;
    if (a !== b) return a < b ? r : worst;
    return rungs.indexOf(r) < rungs.indexOf(worst) ? r : worst;   // ladder order breaks the tie
  });
}

export function investigateRun(m: Manifest, idx: IndexEntry[]): Investigation {
  const steps: Step[] = [];
  const L = confidenceLadderFull(m, idx);
  steps.push({ tool: "confidence_ladder", why: "start from what the archived evidence already earns, so the investigation chases a real gap rather than a fixed list",
    found: `${L.verified_of_assessable} assessable rungs verified` + (L.rungs.filter(r => r.status === "partly established").length ? "; 1 partly established" : "") });

  // What the number is, and which uncertainty is the honest one to quote — the site's central teaching, so
  // it is reported for every run regardless of which rung turns out to be the bottleneck.
  const e = explainResult(m, idx) as any;
  const mm = m.results.mmgbsa;
  const quote = e.uncertainty_to_quote;
  // Format from the ensemble's own SD, not from the value explain_result already rounded to 3 dp: rounding a
  // rounded number moves 0.645 to "0.65" where explain_result prints "0.64", and the same quantity shown two
  // ways on one page is the thing this project exists to refuse.
  const spreadSd = ensemble(idx, m.id).all.sd;
  const headline = quote && spreadSd != null
    ? `ΔG = ${n2(mm?.delta_total_kcal_mol)} kcal/mol. Quote ±${spreadSd.toFixed(2)} (run-to-run SD over ${quote.n} runs of this system), not the within-run SEM ${n2(e.within_run?.corrected_sem)} — seed spread, not frame noise, is what a single run's number is uncertain by.`
    : `ΔG = ${n2(mm?.delta_total_kcal_mol)} kcal/mol. No run-to-run spread can be quoted: this site has one run of this prepared system.`;
  steps.push({ tool: "explain_result", why: "establish which uncertainty a reader should quote before judging whether the run is trustworthy", found: headline });

  const bn = bottleneckOf(L.rungs);
  let next: NextAction | null = null;

  if (!bn) {
    steps.push({ tool: "—", why: "no assessable rung is unverified", found: "every rung archived data can earn is earned; only external support is left, and that is not assessable on this site" });
  } else if (bn.rung === "recomputable") {
    // The one gap that is about the archive itself rather than the science: the card cannot re-derive its
    // own headline, so nothing above it on the ladder is worth chasing yet.
    const pf = mm?.per_frame;
    steps.push({ tool: "recompute_result", why: "the run cannot re-derive its own archived number, so every rung above this one rests on a figure nothing on the page checks",
      found: pf ? "per-frame energies are archived but do not reproduce mmgbsa.dat" : "per-frame energies were not archived; only mmgbsa.dat's summary is on the card" });
    next = { rationale: "re-extract this run with the per-frame MMPBSA artifacts archived, then recompute. Until the headline is reproducible from files, the rungs above it are not worth chasing.",
      tool: null, input: null, needs_a_human: true };
  } else if (bn.rung === "independently replicated") {
    const en = ensemble(idx, m.id);
    const p = planSampling(m, idx, { detail: true }) as any;
    steps.push({ tool: "get_ensemble", why: "the rung turns on how many comparable runs exist, so count them and measure their spread",
      found: `${en.all.n} run${en.all.n === 1 ? "" : "s"} of this prepared system${en.all.sd != null ? `, run-to-run SD ±${n2(en.all.sd)}` : " — a single run, so no spread exists to quote"}` });
    // Below two runs there is no SD to size an ensemble from, so plan_sampling cannot answer and must not be
    // made to look as if it did. State the 3-run floor the rung itself requires instead of printing a null.
    const MIN_RUNS = 3, toFloor = Math.max(0, MIN_RUNS - en.all.n);
    const sized = en.all.n >= 2 && p.run_to_run?.additional_runs != null;
    steps.push({ tool: "plan_sampling", why: "turn the gap into a number of runs rather than a vague 'more sampling'",
      found: !sized ? `no run-to-run estimate exists yet (${en.all.n} run${en.all.n === 1 ? "" : "s"}); ${toFloor} more comparable independent run${toFloor === 1 ? "" : "s"} are needed before any spread can be quoted, and plan_sampling can size the ensemble only after that`
        : p.run_to_run.target_met ? `the ±${p.target_uncertainty_kcal} target is already met on the ensemble mean; what is missing is runs at this run's own production length`
        : `${p.run_to_run.additional_runs} more independent run${p.run_to_run.additional_runs === 1 ? "" : "s"} to reach ±${p.target_uncertainty_kcal} on the ensemble mean` });
    next = { rationale: bn.to_climb ?? "more independent runs at this run's production length", tool: "fork_experiment",
      input: { run_id: m.id, kind: "replicate" }, needs_a_human: true };
  } else if (bn.rung === "robust to analysis-window choices") {
    // Reachable only with per-frame energies archived — without them the recomputable rung is not established
    // and wins the bottleneck as the lower rung — but say so rather than asserting it away.
    const pf = mm?.per_frame ?? null;
    const u = pf ? uncertaintyFromFrames(pf, null) : null;
    const full = pf ? recomputeResult(m, {}) as any : null;
    steps.push({ tool: "recompute_result", why: "the rung is decided by whether ΔG survives reasonable analysis-window choices, so re-analyse the archived frames",
      found: !u ? "per-frame energies are not archived, so no window can be re-analysed"
        : u.verdict === "no drift detected" ? `windows disagree by more than 2 corrected SEMs (corrected SEM ${n2(full.uncertainty?.corrected_sem)})`
        : `the series is not stationary (verdict: ${u.verdict}), so window agreement cannot establish robustness — this is a sampling problem, not an analysis one` });
    next = { rationale: !u ? "archive the per-frame MMPBSA artifacts and re-extract, so windows can be re-analysed at all"
        : u.verdict === "no drift detected" ? "the archived window choices already disagree; a longer or repeated run is what would settle it"
        : `this run is ${u.verdict} over its archived window, so it needs more sampling before window agreement means anything`,
      tool: u ? "plan_sampling" : null, input: u ? { run_id: m.id } : null, needs_a_human: true };
  } else {
    // repeatable — structurally the ceiling for every run here, because nothing is ever executed in the browser.
    const gaps = bundleGaps(m);
    steps.push({ tool: "generate_rerun_bundle", why: "the rung is 'expected' for every run on this site — nothing executes here — so the useful question is whether a bundle would actually replay",
      found: gaps.length ? `the bundle is a recipe: ${gaps.join(", ")} must come from the original build directory` : "seeds, environment pins, leap.in and its build inputs are all archived, so a pinned bundle is self-contained" });
    next = { rationale: "run the pinned bundle off-site and extract the result as a card. That is the only rung left that data can move, and it is the one thing this page structurally cannot do for you.",
      tool: "fork_experiment", input: { run_id: m.id, kind: "reproduce" }, needs_a_human: true };
  }

  const summary = bn
    ? `${L.verified_of_assessable} assessable rungs verified. The bottleneck is ${bn.rung} (${bn.status}), movable by ${MOVABLE[bn.rung]}.`
    : `${L.verified_of_assessable} assessable rungs verified; nothing archived data can earn is outstanding.`;

  return {
    run: m.id, summary, headline, steps,
    ladder: { verified_of_assessable: L.verified_of_assessable,
      rungs: L.rungs.map(r => ({ rung: r.rung, status: r.status, short: r.short, movable_by: MOVABLE[r.rung] })) },
    bottleneck: bn ? { rung: bn.rung, status: bn.status, movable_by: MOVABLE[bn.rung], why: bn.short } : null,
    next,
    created: "nothing — automode is read-only. No proposal was queued, no bundle written, no input changed.",
    method: "reads confidence_ladder, then picks the rung with the worst status (ties broken by ladder order, since the ladder is climbed from the bottom) among rungs that are not already verified and are not 'externally supported', which this site never assesses. The chosen rung decides which read-only tools run next, so the trace differs by run and changes when a run's evidence changes. It proposes nothing.",
  };
}
