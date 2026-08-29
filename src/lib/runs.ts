import type { Manifest, IndexEntry, SystemKey } from "./types";
import { checkAmberIn, type Report } from "./amberCheck";
import { zipSync, strToU8 } from "fflate";
import { GB_TERMS, type PerFrame, type GbTerm } from "./types";
import { mean, sd, sem, statisticalInefficiency, integratedAutocorrelationTime, correctedSem, blockAverageSem, halves, driftSlope, round, projectedSem } from "./stats";

// ---- loading ----------------------------------------------------------
// The dev server answers a missing file with the SPA's index.html (HTTP 200, text/html);
// a static host answers 404. Both must become the same readable, actionable error, and a
// failed load must not be cached, or a mistyped id can never recover without a reload.

/** A run manifest could not be loaded. `message` names the run, the cause, and the recovery. */
export class RunLoadError extends Error {
  readonly runId: string; readonly reason: string; readonly status: number | null;
  constructor(runId: string, reason: string, status: number | null) {
    super(`run '${runId}' could not be loaded: ${reason}. Call list_runs (or open the run list at #/) for valid run ids.`);
    this.name = "RunLoadError"; this.runId = runId; this.reason = reason; this.status = status;
  }
}

/** Read a JSON body, rejecting HTML fallbacks and unparseable text with a stated reason. */
async function readJson(r: Response, url: string): Promise<unknown> {
  const type = r.headers.get("content-type") ?? "";
  const text = await r.text();
  if (/html/i.test(type) || /^\s*</.test(text)) throw new Error(`${url} returned an HTML page instead of JSON (the file does not exist; the server sent its fallback page)`);
  try { return JSON.parse(text); } catch { throw new Error(`${url} is not valid JSON`); }
}

export async function loadIndex(): Promise<IndexEntry[]> {
  const url = "/runs/index.json";
  const r = await fetch(url);
  if (!r.ok) throw new Error(`run index could not be loaded: HTTP ${r.status} for ${url}`);
  const idx = await readJson(r, url);
  if (!Array.isArray(idx)) throw new Error(`run index could not be loaded: ${url} is not a list of runs`);
  return idx as IndexEntry[];
}

async function fetchRun(id: string): Promise<Manifest> {
  const url = `/runs/${id}/manifest.json`;
  let r: Response;
  try { r = await fetch(url); }
  catch (e: any) { throw new RunLoadError(id, `network error fetching ${url} (${e?.message ?? e})`, null); }
  if (!r.ok) throw new RunLoadError(id, r.status === 404 ? `no such run (HTTP 404 for ${url})` : `HTTP ${r.status} for ${url}`, r.status);
  let m: any;
  try { m = await readJson(r, url); }
  catch (e: any) { throw new RunLoadError(id, e.message, r.status); }
  if (!m || typeof m !== "object" || typeof m.id !== "string" || !Array.isArray(m.stages)) throw new RunLoadError(id, `${url} is not a run manifest (no id/stages)`, r.status);
  return m as Manifest;
}

const cache = new Map<string, Promise<Manifest>>();
/** Cached per id. A rejected load is evicted so the next call (a retry, or a corrected id) fetches again. */
export function loadRun(id: string): Promise<Manifest> {
  let p = cache.get(id);
  if (!p) {
    p = fetchRun(id); cache.set(id, p);
    p.catch(() => { if (cache.get(id) === p) cache.delete(id); });
  }
  return p;
}

// ---- validation -------------------------------------------------------
export function validateStage(m: Manifest, stage: string): Report & { stage: string } {
  const s = m.stages.find(x => x.name === stage);
  if (!s) throw new Error(`no stage '${stage}' in ${m.id}; stages: ${m.stages.map(x => x.name).join(", ")}`);
  return { stage, ...checkAmberIn(s.mdin) };
}
export function validateAll(m: Manifest) {
  const stages = m.stages.map(s => validateStage(m, s.name));
  return { run: m.id, verdict: stages.some(s => s.hasFail) ? "FAIL" : stages.some(s => s.hasWarn) ? "WARN" : "PASS", stages };
}

// ---- same prepared system: fingerprint over the fields that define it ------
export function systemKey(m: Manifest): SystemKey {
  const sy = m.system;
  return { ligand: sy.ligand.resname, ligand_atoms: sy.ligand.atoms, atom_types: [...(sy.ligand.atom_types ?? [])].sort(), charge_method: sy.ligand.charge_method,
    net_charge: sy.ligand.net_charge, protein_atoms: sy.protein.atoms, force_fields: sy.force_fields, solvent: sy.solvent.model, box: sy.solvent.box, buffer_A: sy.solvent.buffer_A };
}
/** Stable string identity of a prepared system. Two runs with equal fingerprints simulate the same thing. */
export function systemFingerprint(k: SystemKey): string {
  return [k.ligand, k.ligand_atoms, k.atom_types.join("+"), k.charge_method, k.net_charge, k.protein_atoms, k.force_fields.join("+"), k.solvent, k.box, k.buffer_A].map(v => v == null ? "?" : String(v)).join("|");
}
export function sameSystem(a: IndexEntry, b: IndexEntry) { return systemFingerprint(a.system) === systemFingerprint(b.system); }

// ---- ensemble: run-to-run statistics, all runs and long runs --------------
/** Production length below which a run is reported separately. Chosen 2026-08-28; the page shows both strata. */
export const LONG_RUN_MIN_PS = 10;
export interface Stratum { n: number; mean: number | null; sd: number | null; min: number | null; max: number | null; negative: number; runs: { id: string; delta_g: number; production_ps: number }[] }
function stratum(rs: IndexEntry[]): Stratum {
  const g = rs.map(r => r.delta_g); const n = g.length;
  const mean = n ? g.reduce((a, b) => a + b, 0) / n : null;
  const sd = n > 1 && mean != null ? Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  return { n, mean, sd, min: n ? Math.min(...g) : null, max: n ? Math.max(...g) : null, negative: g.filter(x => x < 0).length,
    runs: rs.map(r => ({ id: r.id, delta_g: r.delta_g, production_ps: r.production_ps })) };
}
export function ensemble(idx: IndexEntry[], id: string) {
  const me = idx.find(r => r.id === id); if (!me) throw new Error(`no run ${id} in index`);
  const peers = idx.filter(r => sameSystem(r, me));
  const all = stratum(peers), long = stratum(peers.filter(r => r.production_ps >= LONG_RUN_MIN_PS));
  return { fingerprint: systemFingerprint(me.system), all, long: { min_ps: LONG_RUN_MIN_PS, ...long },
    sd_convention: "sample SD (n−1) across runs",
    caveat: `Independent runs of the same prepared system (ig=-1 Langevin, different realized seeds). Production lengths differ (${[...new Set(peers.map(r => r.production_ps))].sort((a, b) => a - b).join(", ")} ps), so 'all' mixes short and long runs; 'long' keeps runs ≥ ${LONG_RUN_MIN_PS} ps. Run-to-run spread, not the per-frame SEM, is the uncertainty to quote.` };
}
/** "all 9 runs give ΔG < 0" / "7 of 9" / "none" — computed, never assumed. */
export function signClaim(st: Stratum): string {
  if (st.n === 0) return "no runs of this system";
  const range = `range ${st.min} to ${st.max} kcal/mol`;
  if (st.negative === st.n) return `${st.n === 1 ? "The single run gives" : `All ${st.n} independent runs give`} ΔG < 0 (${range}); ${st.n >= 3 ? "the sign is robust, the second decimal is not" : "the sign is not yet established (n < 3)"}.`;
  if (st.negative === 0) return `None of the ${st.n} runs gives ΔG < 0 (${range}).`;
  return `${st.negative} of ${st.n} runs give ΔG < 0 (${range}); the sign is not robust across runs.`;
}

// ---- explain --------------------------------------------------------
/** Convergence thresholds, stated in the output so the verdict is checkable. */
export const CONVERGENCE = { drift_sigma: 2, min_n_eff: 10 };
export function uncertaintyFromFrames(pf: PerFrame, lengthPs: number | null) {
  const x = pf.delta_total, n = x.length;
  const g = statisticalInefficiency(x), nEff = n / g, tau = integratedAutocorrelationTime(g);
  const naive = sem(x, 0), corrected = correctedSem(x, g, 0);
  const blocks = blockAverageSem(x); const plateau = blocks.length ? blocks[blocks.length - 1] : null;
  const h = halves(x); const slope = driftSlope(x);
  const framePs = lengthPs != null ? lengthPs / n : null;
  const drifting = Math.abs(h.diff) > CONVERGENCE.drift_sigma * corrected;
  const verdict = nEff < CONVERGENCE.min_n_eff ? "too short to judge" : drifting ? "drifting" : "no drift detected";
  return {
    n_frames: n, frame_interval_ps: framePs != null ? round(framePs, 3) : null,
    per_frame_sd: round(sd(x, 0)), per_frame_sem: round(naive),
    statistical_inefficiency_g: round(g, 2), integrated_autocorrelation_time_frames: round(tau, 2),
    integrated_autocorrelation_time_ps: framePs != null ? round(tau * framePs, 3) : null,
    n_eff: round(nEff, 1), corrected_sem: round(corrected),
    block_averaging: { sem_by_block: blocks.map(b => ({ block: b.block, blocks: b.blocks, sem: round(b.sem) })), plateau_sem: plateau ? round(plateau.sem) : null },
    halves: { first: round(h.first), second: round(h.second), diff: round(h.diff) },
    drift_kcal_per_frame: round(slope, 5), drift_kcal_per_ps: framePs ? round(slope / framePs, 4) : null,
    verdict, thresholds: { drifting_if: `|second half − first half| > ${CONVERGENCE.drift_sigma} × corrected SEM`, too_short_if: `N_eff < ${CONVERGENCE.min_n_eff}` },
    method: "g = 1 + 2Σ(1−t/N)C(t) to first non-positive C(t) (Chodera 2007); N_eff = N/g; corrected SEM = SD·√(g/N); block averaging per Flyvbjerg–Petersen",
    reproduces: pf.reproduces,
  };
}
// ---- recompute: re-analyse ΔG over a frame window from the archived per-frame energies ----
function slicePerFrame(pf: PerFrame, idx: number[]): PerFrame {
  const pick = (v: number[]) => idx.map(i => v[i]);
  return { ...pf, n: idx.length, delta_total: pick(pf.delta_total), terms: Object.fromEntries(GB_TERMS.map(k => [k, pick(pf.terms[k])])) as PerFrame["terms"] };
}
/** Fewer frames than this and no statistic is meaningful (g needs N ≥ 4). */
export const MIN_WINDOW_FRAMES = 4;
export interface RecomputeOpts { start_frame?: number; end_frame?: number; interval?: number; discard_ps?: number }
/** ΔG, SD, corrected SEM and drift verdict over frames [start_frame, end_frame] every `interval`, from the archived per-frame energies. MMPBSA.py is not rerun. */
export function recomputeResult(m: Manifest, opts: RecomputeOpts = {}) {
  const mm = m.results.mmgbsa; if (!mm) throw new Error(`no MM-GBSA result in ${m.id}`);
  const pf = mm.per_frame; if (!pf) throw new Error(`${m.id} has no archived per-frame energies (per_frame absent); recompute_result needs the _MMPBSA_*_gb.mdout.0 data. explain_result still reports MMPBSA.py's own numbers.`);
  const n = pf.delta_total.length;
  const prod = m.stages.find(s => s.role === "production");
  const L = prod?.length_ps ?? null; const dPs = L != null ? L / n : null;
  const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
  if (opts.start_frame != null && opts.discard_ps != null) throw new Error("give discard_ps or start_frame, not both");
  let start = 1;
  if (opts.discard_ps != null) {
    if (typeof opts.discard_ps !== "number" || !(opts.discard_ps >= 0)) throw new Error("discard_ps must be a number ≥ 0");
    if (dPs == null) throw new Error(`production length unknown for ${m.id}; use start_frame`);
    start = Math.floor(opts.discard_ps / dPs + 1e-9) + 1;
  } else if (opts.start_frame != null) { if (!isInt(opts.start_frame)) throw new Error("start_frame must be an integer"); start = opts.start_frame; }
  const end = opts.end_frame ?? n; const interval = opts.interval ?? 1;
  if (!isInt(end) || !isInt(interval)) throw new Error("end_frame and interval must be integers");
  if (start < 1) throw new Error(`start_frame ${start} < 1`);
  if (end > n) throw new Error(`end_frame ${end} > ${n} frames archived for ${m.id}`);
  if (start > end) throw new Error(`start_frame ${start} > end_frame ${end}`);
  if (interval < 1) throw new Error(`interval ${interval} < 1`);
  const idx: number[] = []; for (let i = start - 1; i <= end - 1; i += interval) idx.push(i);
  const k = idx.length;
  if (k < MIN_WINDOW_FRAMES) throw new Error(`window keeps ${k} frame(s) of ${n}; at least ${MIN_WINDOW_FRAMES} are needed for any statistic (≥ ${CONVERGENCE.min_n_eff} effectively independent for a verdict)`);
  const w = slicePerFrame(pf, idx);
  const dW = dPs != null ? dPs * interval : null;
  const unc = uncertaintyFromFrames(w, dW != null ? dW * k : null);
  const meanW = mean(w.delta_total);
  const terms = Object.fromEntries(GB_TERMS.map(t => [t, { mean: round(mean(w.terms[t])), sd: round(sd(w.terms[t], 0)) }])) as Record<GbTerm, { mean: number; sd: number }>;
  const termsSum = GB_TERMS.reduce((a, t) => a + mean(w.terms[t]), 0);
  const full = start === 1 && end === n && interval === 1;
  const diff = meanW - mm.delta_total_kcal_mol;
  const ps = (f: number) => dPs != null ? round(f * dPs, 3) : null;
  const window = { start_frame: start, end_frame: end, interval, frames_used: k, of_frames: n, start_ps: ps(start), end_ps: ps(end), discarded_ps: ps(start - 1), frame_interval_ps: dW != null ? round(dW, 3) : null, full };
  const brief = `Frames ${start}–${end}${interval > 1 ? ` every ${interval}th` : ""} (${window.start_ps ?? "?"}–${window.end_ps ?? "?"} ps of ${L ?? "?"} ps, ${k} frames): ΔG = ${round(meanW, 2)} ± ${round(unc.corrected_sem, 2)} kcal/mol (corrected SEM; per-frame SD ${unc.per_frame_sd}), ${unc.verdict}. Archived full-window value ${mm.delta_total_kcal_mol} → Δ = ${round(diff, 2)} (${round(Math.abs(diff) / unc.corrected_sem, 1)} corrected SEM). Recomputed from archived per-frame energies; MMPBSA.py not rerun.`;
  return {
    run: m.id, window,
    delta_g: { mean: round(meanW), per_frame_sd: unc.per_frame_sd, corrected_sem: unc.corrected_sem, n_eff: unc.n_eff, verdict: unc.verdict },
    uncertainty: unc,
    terms, terms_sum_of_means: round(termsSum),
    archived: { delta_g: mm.delta_total_kcal_mol, per_frame_sd: mm.frame_std, frames: mm.frames, params: mm.params ?? null },
    vs_archived: { diff: round(diff), diff_in_corrected_sem: round(diff / unc.corrected_sem, 2), exact_when_full_window: pf.reproduces.delta_total_mean },
    brief,
    method: "Recomputed in the browser from the per-frame energies archived in the manifest (_MMPBSA_{complex,receptor,ligand}_gb.mdout.0 + SASA; ESURF = surften·SASA + surfoff). MMPBSA.py was NOT rerun. Statistics as in explain_result: SD ddof=0 (MMPBSA.py convention); g, N_eff, corrected SEM, block averaging, halves drift with the same thresholds.",
    provenance: { recomputed_from: pf.source, esurf_formula: pf.esurf_formula, mmpbsa_rerun: false, full_window_reproduces_mmgbsa_dat: pf.reproduces },
  };
}

// ---- plan: how much more sampling for a target uncertainty (expected, from archived numbers) ----
export const PLAN_LENGTHS_PS = [5, 10, 20, 50, 100];
/** Default target for the SEM of the ensemble mean. 0.5 is already met on the 1L2Y ensemble (n=5 long runs, SD 0.79 → 0.35), so 0.25 makes the tool say something. */
export const PLAN_DEFAULT_TARGET_KCAL = 0.25;
export interface PlanOpts { target_uncertainty_kcal?: number; min_run_ps?: number }
export function planSampling(m: Manifest, idx: IndexEntry[], opts: PlanOpts = {}) {
  const T = opts.target_uncertainty_kcal ?? PLAN_DEFAULT_TARGET_KCAL;
  if (typeof T !== "number" || !Number.isFinite(T) || T <= 0) throw new Error("target_uncertainty_kcal must be a number > 0");
  const minPs = opts.min_run_ps ?? LONG_RUN_MIN_PS;
  if (typeof minPs !== "number" || !Number.isFinite(minPs) || minPs <= 0) throw new Error("min_run_ps must be a number > 0");
  const mm = m.results.mmgbsa; if (!mm) throw new Error(`no MM-GBSA result in ${m.id}`);
  const pf = mm.per_frame; if (!pf) throw new Error(`${m.id} has no archived per-frame energies; plan_sampling needs them for the within-run projection`);
  const prod = m.stages.find(s => s.role === "production"); if (!prod) throw new Error(`no production stage in ${m.id}`);
  const L0 = prod.length_ps; if (L0 == null) throw new Error(`production length unknown for ${m.id}`);
  const ens = ensemble(idx, m.id);
  const unc = uncertaintyFromFrames(pf, L0);
  // unrounded inputs for the projection so at_current_length reproduces corrected_sem exactly
  const SD = sd(pf.delta_total, 0), g = statisticalInefficiency(pf.delta_total), dPs = L0 / pf.delta_total.length;
  // run-to-run
  const plannedOn: "long" | "all" | null = ens.long.n >= 3 ? "long" : ens.all.sd != null ? "all" : null;
  const st: Stratum | null = plannedOn ? ens[plannedOn] : null;
  const s = st?.sd ?? null, nNow = st?.n ?? null;
  const semNow = s != null && nNow ? s / Math.sqrt(nNow) : null;
  const nNeeded = s != null ? Math.ceil((s / T) ** 2) : null;
  const additional = nNeeded != null && nNow != null ? Math.max(0, nNeeded - nNow) : null;
  const semAfter = s != null && nNow != null && nNeeded != null ? s / Math.sqrt(Math.max(nNow, nNeeded)) : null;
  const targetMet = semNow != null ? semNow <= T : false;
  const stratumRow = (x: Stratum) => ({ n: x.n, sd: x.sd != null ? round(x.sd) : null, sem_of_mean: x.sd != null && x.n ? round(x.sd / Math.sqrt(x.n)) : null });
  // within-run
  const expSem = (Lps: number) => round(projectedSem(SD, g, dPs, Lps));
  const lengthForTarget = round(g * dPs * (SD / T) ** 2, 1);
  const Lrec = Math.max(minPs, L0);
  const spreadOverWithin = s != null ? round(s / unc.corrected_sem, 1) : null;
  // suggested edits: data for propose_change; nothing is proposed here
  const dt = Number(prod.cntrl.dt), nstlimNow = Number(prod.cntrl.nstlim), ntwx = Number(prod.cntrl.ntwx) || null;
  const nstlimNew = Math.round(Lrec / dt);
  const mmInterval = Number(mm.params?.interval) || 1;
  const suggested = nstlimNew !== nstlimNow ? {
    run_id: m.id, stage: prod.name,
    edits: { nstlim: String(nstlimNew), ...(prod.cntrl.ig !== "-1" ? { ig: "-1" } : {}) },
    reason: `extend production from ${L0} to ${Lrec} ps (${nstlimNew} steps at dt=${dt}) so the run joins the ≥ ${minPs} ps stratum`,
    expected_frames_written: ntwx ? Math.floor(nstlimNew / ntwx) : null,
    expected_frames_analysed: ntwx ? Math.floor(Math.floor(nstlimNew / ntwx) / mmInterval) : null,
    note: "Data for propose_change; nothing has been proposed. ntwx is unchanged, so the frame cadence Δ is unchanged and the analysed frame count scales with length.",
  } : null;
  const rerunNote = suggested ? null : `This run is already ≥ ${Lrec} ps; independent samples need no &cntrl edit — generate_rerun_bundle with seed='fresh' (ig=-1) for each new run.`;
  const recommendation = plannedOn == null
    ? `expected: no run-to-run estimate — this is the only run of its prepared system. Within this run the corrected SEM is ${unc.corrected_sem} kcal/mol at ${L0} ps; one run would reach ±${T} at ≈ ${lengthForTarget} ps (expected, stationary). Seed-to-seed spread cannot be estimated from one run: at least 3 independent runs (ig=-1) of ≥ ${Lrec} ps are needed before an ensemble uncertainty can be quoted.`
    : targetMet
      ? `expected: target ±${T} kcal/mol on the ensemble mean is already met on the ${plannedOn} stratum (n=${nNow}, SD ${round(s!, 2)}, SEM of mean ${round(semNow!, 2)}); 0 more runs needed.`
      : `expected: ${additional} more independent run${additional === 1 ? "" : "s"} (ig=-1) of ≥ ${Lrec} ps each → n=${nNeeded}, SEM of the ensemble mean ≈ ${round(semAfter!, 2)} ≤ ${T} kcal/mol. Extending this run alone reaches ±${T} at ≈ ${lengthForTarget} ps (expected), but run-to-run SD ${round(s!, 2)} is ${spreadOverWithin}× this run's corrected SEM, so seed spread, not frame noise, limits the estimate.`;
  const assumptions = [
    plannedOn ? `The sample SD across the ${plannedOn} stratum (${nNow} runs) holds for new runs of ≥ ${Lrec} ps; it includes within-run noise (not decomposed), so it may shrink slightly with longer runs — not modelled.` : "No run-to-run SD is available from a single run.",
    "New runs are independent samples (ig=-1) of the same prepared system and protocol.",
    `Within-run projection assumes stationarity: the same per-frame SD (${unc.per_frame_sd}), statistical inefficiency g (${unc.statistical_inefficiency_g}; τ ≈ ${unc.integrated_autocorrelation_time_ps} ps) and output cadence Δ = ${round(dPs, 3)} ps/frame at any length.`,
    ...(unc.verdict !== "no drift detected" ? [`This run's convergence verdict is '${unc.verdict}', so its τ and SD are less reliable inputs.`] : []),
    "Nothing was run: every number labelled expected is computed in the browser from the archived numbers.",
  ];
  return {
    label: "expected" as const, run: m.id, target_uncertainty_kcal: T,
    what_the_target_means: "the standard error of the ensemble-mean ΔG (run-to-run SD / √n): how well the mean over independent runs is pinned down — not the spread to quote for a single run (explain_result gives that)",
    min_run_ps: minPs,
    run_to_run: { planned_on: plannedOn, strata: { all: stratumRow(ens.all), long: { min_ps: ens.long.min_ps, ...stratumRow(ens.long) } },
      sd_used: s != null ? round(s) : null, n_now: nNow, sem_of_mean_now: semNow != null ? round(semNow) : null, n_needed: nNeeded, additional_runs: additional,
      expected_sem_of_mean_after: semAfter != null ? round(semAfter) : null, target_met: targetMet, sign_claim: signClaim(st ?? ens.all) },
    within_run: { this_run: { production_ps: L0, per_frame_sd: unc.per_frame_sd, g: unc.statistical_inefficiency_g, tau_ps: unc.integrated_autocorrelation_time_ps, frame_interval_ps: round(dPs, 3), corrected_sem: unc.corrected_sem, n_eff: unc.n_eff, verdict: unc.verdict },
      formula: "expected SEM(L) = SD · √(g·Δ/L) = SD · √((Δ + 2τ)/L), N = L/Δ frames",
      at_current_length: { length_ps: L0, expected_sem: expSem(L0) },
      expected_sem_by_length: PLAN_LENGTHS_PS.map(Lps => ({ length_ps: Lps, expected_frames_analysed: Math.round(Lps / dPs), expected_sem: expSem(Lps) })),
      expected_length_for_target_ps: lengthForTarget, spread_over_within: spreadOverWithin },
    recommended_run_ps: Lrec, recommendation, suggested_edits: suggested, rerun_note: rerunNote, assumptions,
    method: "Run-to-run: n_needed = ⌈(SD_runs / target)²⌉ so that SD_runs/√n ≤ target. Within-run: corrected SEM projected as SD·√(g·Δ/L), g from Chodera 2007 on this run's per-frame ΔG. All from archived numbers; nothing simulated.",
  };
}

export function internalResidual(pf: PerFrame, deltaG: number) {
  const internal = ["BOND", "ANGLE", "DIHED", "1-4 VDW", "1-4 EEL"] as const;
  const by = Object.fromEntries(internal.map(k => { const v = pf.terms[k]; return [k, { mean: round(mean(v)), sd: round(sd(v, 0)), max_abs: round(Math.max(...v.map(Math.abs))) }]; })) as Record<typeof internal[number], { mean: number; sd: number; max_abs: number }>;
  const tot = pf.delta_total.map((_, i) => internal.reduce((a, k) => a + pf.terms[k][i], 0));
  const dominant = internal.reduce((a, b) => by[a].max_abs >= by[b].max_abs ? a : b);
  return { by_term: by, total: { mean: round(mean(tot)), sd: round(sd(tot, 0)), max_abs: round(Math.max(...tot.map(Math.abs))) },
    fraction_of_delta_g: round(Math.abs(mean(tot)) / Math.abs(deltaG), 6), dominant_term: dominant,
    note: `In single-trajectory MM-GBSA the internal terms of complex − receptor − ligand should cancel exactly. Here ${dominant} is the term that does not (max |Δ| ${by[dominant].max_abs} kcal/mol per frame); the others cancel to print precision. The residual's mean is ${round(mean(tot))} kcal/mol against ΔG = ${deltaG}. The cause is not recorded in the artifacts.` };
}
export function explainResult(m: Manifest, idx: IndexEntry[]) {
  const mm = m.results.mmgbsa; if (!mm) return { error: "no MM-GBSA result in this run" };
  const prod = m.stages.find(s => s.role === "production");
  const ens = ensemble(idx, m.id);
  const pf = mm.per_frame ?? null;
  const unc = pf ? uncertaintyFromFrames(pf, prod?.length_ps ?? null) : null;
  const resid = pf ? internalResidual(pf, mm.delta_total_kcal_mol) : null;
  const spreadSd = ens.all.sd;
  const which = unc && spreadSd != null
    ? `Quote ±${spreadSd.toFixed(2)} kcal/mol (run-to-run SD, n=${ens.all.n}) as the uncertainty of a single run's ΔG. Within this run the correlation-corrected SEM is ${unc.corrected_sem} (N_eff ≈ ${unc.n_eff} of ${unc.n_frames} frames); the naive per-frame SEM ${unc.per_frame_sem} is ${(unc.corrected_sem / unc.per_frame_sem).toFixed(1)}× too small. Run-to-run spread is ${(spreadSd / unc.corrected_sem).toFixed(1)}× the corrected SEM, so seed-to-seed variation, not frame noise, dominates.`
    : unc ? `Within this run the correlation-corrected SEM is ${unc.corrected_sem}; no other runs of this system to estimate run-to-run spread.` : "per-frame data not archived for this run; only MMPBSA.py's naive SEM is available.";
  const brief = [
    `ΔG = ${mm.delta_total_kcal_mol} kcal/mol, single-trajectory MM-GBSA over ${mm.frames} frames of a ${prod?.length_ps ?? "?"} ps production run.`,
    spreadSd != null ? `Quote ±${spreadSd.toFixed(2)} kcal/mol (run-to-run SD over ${ens.all.n} independent runs); the within-run SEM (${unc ? unc.corrected_sem : mm.frame_sem}) is not the uncertainty to report.` : `Only one run of this system; within-run SEM ${unc ? unc.corrected_sem : mm.frame_sem} understates the uncertainty.`,
    unc ? `Convergence: ${unc.verdict} (N_eff ≈ ${unc.n_eff}, halves ${unc.halves.first} → ${unc.halves.second}).` : "Convergence: per-frame data not archived, cannot judge.",
    signClaim(ens.all),
  ].join(" ");
  return {
    brief,
    value_kcal_mol: mm.delta_total_kcal_mol,
    what_it_is: `Single-trajectory MM-GBSA (igb=${mm.igb}, saltcon=${mm.saltcon}) binding free energy, averaged over ${mm.frames} frames (every ${mm.params?.interval ?? "?"}th of ${mm.params?.endframe ?? "?"}) of the ${prod?.length_ps} ps production stage.`,
    per_frame_std: mm.frame_std, per_frame_sem: mm.frame_sem, sd_convention: mm.sd_convention,
    uncertainty: unc, which_uncertainty_to_quote: which,
    stochasticity: { requested_seed: prod?.requested_seed, realized_seed: prod?.realized_seed, thermostat: `ntt=${prod?.cntrl.ntt} gamma_ln=${prod?.cntrl.gamma_ln}`,
      note: "ig=-1 draws a wallclock seed; pmemd wrote the realized seed to the .out. Two runs with different seeds are different samples of the same ensemble — differing ΔG is expected, not a bug." },
    run_to_run: ens,
    sign_claim: { all_runs: signClaim(ens.all), long_runs: signClaim(ens.long) },
    warnings: mm.warnings, internal_term_residual: resid,
    warning_note: mm.warnings.length ? (resid ? `MMPBSA.py's warning is triggered by the internal-term residual quantified in internal_term_residual: ${resid.total.mean} ± ${resid.total.sd} kcal/mol per frame (${(resid.fraction_of_delta_g * 100).toFixed(3)} % of ΔG), from ${resid.dominant_term}. Recorded verbatim, quantified, not suppressed.` : "MMPBSA.py emits this when complex − receptor − ligand internal terms do not cancel exactly in single-trajectory mode; per-frame data not archived, so the size of the residual is unknown.") : undefined,
    provenance: { computed_on: mm.run_on, mmpbsa_version: mm.mmpbsa_version, engine: prod?.engine, ambertools: m.environment.conda_lock.ambertools, source_run_dir: m.source?.run_dir, per_frame_source: pf?.source, frames_header_text: mm.frames_header_text, frames_note: mm.frames_note },
  };
}

// ---- diff -----------------------------------------------------------
const SEMANTIC: Record<string, string> = {
  dt: "integration timestep (ps)", nstlim: "number of MD steps", temp0: "target temperature (K)", tempi: "initial temperature (K)", cut: "non-bonded cutoff (Å)",
  ntt: "thermostat (3 = Langevin)", gamma_ln: "Langevin collision frequency (ps⁻¹)", ntp: "pressure coupling", barostat: "barostat (2 = Monte Carlo)", pres0: "reference pressure (bar)", taup: "pressure relaxation time (ps)",
  ntc: "SHAKE constraints", ntf: "force evaluation (2 = skip H-bond forces)", ntb: "periodic boundary (1 = constant V, 2 = constant P)", ig: "random seed request", irest: "restart flag", ntx: "coordinate/velocity read",
  ntr: "positional restraints", restraint_wt: "restraint force constant (kcal/mol/Å²)", restraintmask: "restrained atoms", iwrap: "wrap coordinates into the box",
  ntwx: "trajectory write interval", ntpr: "energy print interval", ntwr: "restart write interval", ntwe: "energy file write interval", ioutfm: "trajectory format (1 = NetCDF)",
  imin: "minimization flag", maxcyc: "minimization cycles", ncyc: "steepest-descent cycles", drms: "minimization gradient convergence", nmropt: "NMR restraints / &wt ramps",
};
/** What a differing &cntrl key changes. Materiality is by class, not by an ad-hoc list. */
export type ParamClass = "physics" | "thermodynamic_state" | "sampling_length" | "restraints" | "minimization" | "output_cadence" | "stochastic" | "other";
export const PARAM_CLASS: Record<string, ParamClass> = {
  dt: "physics", cut: "physics", ntc: "physics", ntf: "physics", ntb: "physics", nmropt: "physics",
  temp0: "thermodynamic_state", tempi: "thermodynamic_state", ntt: "thermodynamic_state", gamma_ln: "thermodynamic_state", ntp: "thermodynamic_state", pres0: "thermodynamic_state", barostat: "thermodynamic_state", taup: "thermodynamic_state",
  nstlim: "sampling_length", irest: "sampling_length", ntx: "sampling_length",
  ntr: "restraints", restraint_wt: "restraints", restraintmask: "restraints",
  imin: "minimization", maxcyc: "minimization", ncyc: "minimization", drms: "minimization",
  ntpr: "output_cadence", ntwx: "output_cadence", ntwr: "output_cadence", ntwe: "output_cadence", ioutfm: "output_cadence", iwrap: "output_cadence",
  ig: "stochastic",
};
export const paramClass = (k: string): ParamClass => PARAM_CLASS[k.toLowerCase()] ?? "other";
export const isMaterial = (c: ParamClass) => c !== "output_cadence" && c !== "stochastic";
export function diffRuns(a: Manifest, b: Manifest, ia: IndexEntry[]) {
  const ka = systemKey(a), kb = systemKey(b);
  const systemDiff = (Object.keys(ka) as (keyof SystemKey)[]).filter(k => JSON.stringify(ka[k]) !== JSON.stringify(kb[k])).map(k => ({ field: k, a: ka[k], b: kb[k] }));
  const same = systemFingerprint(ka) === systemFingerprint(kb);
  const stages = a.stages.map(s => s.name).filter(n => b.stages.some(t => t.name === n));
  const stageDiffs = stages.map(n => {
    const sa = a.stages.find(s => s.name === n)!, sb = b.stages.find(s => s.name === n)!;
    const keys = [...new Set([...Object.keys(sa.cntrl), ...Object.keys(sb.cntrl)])].filter(k => sa.cntrl[k] !== sb.cntrl[k]);
    const changes = keys.map(k => { const c = paramClass(k); return { key: k, meaning: SEMANTIC[k] ?? null, class: c, material: isMaterial(c), a: sa.cntrl[k] ?? null, b: sb.cntrl[k] ?? null }; });
    return { stage: n, length_ps: { a: sa.length_ps, b: sb.length_ps }, changes };
  }).filter(d => d.changes.length);
  const classes = new Set(stageDiffs.flatMap(d => d.changes.map(c => c.class)));
  const material = [...classes].filter(isMaterial);
  const seeds = { a: a.stages.map(s => s.realized_seed), b: b.stages.map(s => s.realized_seed) };
  const ea = ia.find(r => r.id === a.id);
  const dg = { a: a.results.mmgbsa?.delta_total_kcal_mol, b: b.results.mmgbsa?.delta_total_kcal_mol,
    diff: a.results.mmgbsa && b.results.mmgbsa ? +(a.results.mmgbsa.delta_total_kcal_mol - b.results.mmgbsa.delta_total_kcal_mol).toFixed(4) : null };
  const spread = same && ea ? ensemble(ia, a.id) : null;
  const sdAll = spread?.all.sd ?? null;
  const vsSpread = dg.diff != null && sdAll != null ? `|ΔΔG| = ${Math.abs(dg.diff).toFixed(2)} kcal/mol vs run-to-run SD ${sdAll.toFixed(2)} (${(Math.abs(dg.diff) / sdAll).toFixed(1)}×)` : null;
  // Descriptive, not evaluative: state what differs and give the reader the scale to judge ΔΔG against. No claim about which run is "better" or converged — that is reported per run by explain_result.
  const interpretation = !same
    ? "Different prepared systems (see the system table). The two ΔG values describe different complexes and are not compared here."
    : material.length === 0
      ? `Same prepared system and protocol; only ${[...classes].join(" and ") || "seeds"} differ, so the two ΔG values are independent samples of the same protocol. ${vsSpread ?? ""}`.trim()
      : material.every(c => c === "sampling_length")
        ? `Same prepared system and physics; the runs differ in production length (${stageDiffs.map(d => `${d.stage}: ${d.length_ps.a} vs ${d.length_ps.b} ps`).join("; ")}), so they are different-length samples of the same protocol. Whether either run is converged is reported per run (drift verdict in explain_result). ${vsSpread ?? ""}`.trim()
        : `Same prepared system; the protocol differs in ${material.join(", ")} parameters (see stage changes). The ΔG difference combines that change with seed-to-seed sampling; the run-to-run spread is the scale to judge it against. ${vsSpread ?? ""}`.trim();
  return { a: a.id, b: b.id, same_system: same, system: systemDiff, stages: stageDiffs, differing_classes: [...classes], material_classes: material,
    realized_seeds: seeds, delta_g: dg, run_to_run_spread: spread, interpretation };
}

// ---- proposals (bounded edits, human-approved) -----------------------
export interface Proposal { id: string; run: string; stage: string; edits: Record<string, string>; reason: string; before: Report; after: Report; mdin_after: string; status: "pending" | "approved" | "rejected" }
export function applyEdits(mdin: string, edits: Record<string, string>): string {
  let out = mdin;
  for (const [k, v] of Object.entries(edits)) {
    const re = new RegExp(`(\\b${k}\\s*=\\s*)('[^']*'|"[^"]*"|[^\\s,/]+)`, "i");
    if (re.test(out)) out = out.replace(re, `$1${v}`);
    else out = out.replace(/(&cntrl[^\n]*\n)/i, `$1  ${k}=${v},\n`);
  }
  return retitleDuration(out, edits);
}
/** The AMBER title line is free text and ours state the stage length ("…, 5.0 ps"). When an edit changes nstlim or dt, that number must follow nstlim·dt, or the file claims two durations. Untouched otherwise (byte-identical). */
function retitleDuration(mdin: string, edits: Record<string, string>): string {
  if (!Object.keys(edits).some(k => /^(nstlim|dt)$/i.test(k))) return mdin;
  const num = (k: string) => { const m = mdin.match(new RegExp(`\\b${k}\\s*=\\s*([-+0-9.eEdD]+)`, "i")); return m ? Number(m[1].replace(/[dD]/, "e")) : null; };
  const dt = num("dt"), nstlim = num("nstlim");
  if (dt == null || nstlim == null || !Number.isFinite(dt * nstlim)) return mdin;
  const nl = mdin.indexOf("\n"); const title = nl < 0 ? mdin : mdin.slice(0, nl);
  if (/^\s*&/.test(title)) return mdin;                                   // no title line
  const re = /(\d+(?:\.\d+)?)\s*ps\b/i; const hit = title.match(re); if (!hit) return mdin;
  const decimals = hit[1].includes(".") ? hit[1].split(".")[1].length : 0;
  return title.replace(re, `${(dt * nstlim).toFixed(decimals)} ps`) + (nl < 0 ? "" : mdin.slice(nl));
}
const EDITABLE = new Set(["dt", "nstlim", "ntc", "ntf", "cut", "ntt", "gamma_ln", "temp0", "tempi", "ntp", "barostat", "taup", "pres0", "ig", "iwrap", "ntwx", "ntpr", "ntwr", "ntr", "restraint_wt", "irest", "ntx", "nmropt"]);
export function makeProposal(m: Manifest, stage: string, edits: Record<string, string>, reason: string): Proposal {
  const s = m.stages.find(x => x.name === stage); if (!s) throw new Error(`no stage '${stage}'`);
  const bad = Object.keys(edits).filter(k => !EDITABLE.has(k.toLowerCase()));
  if (bad.length) throw new Error(`not an editable &cntrl key: ${bad.join(", ")}. Editable: ${[...EDITABLE].join(", ")}`);
  const after = applyEdits(s.mdin, edits);
  return { id: `p${Date.now().toString(36)}`, run: m.id, stage, edits, reason, before: checkAmberIn(s.mdin), after: checkAmberIn(after), mdin_after: after, status: "pending" };
}

// ---- rerun bundle ---------------------------------------------------
export function rerunBundle(m: Manifest, opts: { seed: "pinned" | "fresh"; target: "local" | "slurm"; approved: Proposal[] }) {
  const files: Record<string, string> = {};
  for (const s of m.stages) {
    let text = s.mdin;
    for (const p of opts.approved.filter(p => p.stage === s.name)) text = p.mdin_after;
    if (opts.seed === "pinned" && s.realized_seed !== undefined && /\big\s*=/.test(text)) text = applyEdits(text, { ig: String(s.realized_seed) });
    files[`md/${s.name}.in`] = text;
  }
  files["build/leap.in"] = m.system.leap_in;
  const pm = opts.target === "slurm" ? "srun pmemd.MPI" : "${PMEMD:-pmemd}";
  const lines = ["#!/usr/bin/env bash", "# Generated by runcard from run " + m.id, "set -euo pipefail", "cd \"$(dirname \"$0\")/md\"",
    "# Expects comp_oct.top / comp_oct.crd from build/leap.in (tleap -f leap.in) in md/", ""];
  if (opts.target === "slurm") lines.unshift("#SBATCH --job-name=" + m.id, "#SBATCH --nodes=1", "#SBATCH --time=04:00:00");
  let prev = "comp_oct.crd";
  for (const s of m.stages) {
    const isMin = s.role === "minimization";
    const ref = s.cntrl.ntr === "1" ? ` -ref ${prev}` : "";
    lines.push(`echo "[md] ${s.name}" >&2`, `${pm} -O -i ${s.name}.in -o ${s.name}.out -p comp_oct.top -c ${prev} -r ${s.name}.rst${isMin ? "" : ` -x ${s.name}.nc`}${ref}`, "");
    prev = `${s.name}.rst`;
  }
  files["run.sh"] = lines.join("\n");
  files["README.md"] = [`# Rerun bundle: ${m.title} (${m.id})`, "",
    `Seed policy: **${opts.seed}** — ${opts.seed === "pinned" ? "each stage's ig is set to the seed pmemd actually used in the original run (exact replay on the same build; different hardware/compilers may still diverge)." : "ig=-1 as in the original; this is an independent sample, expect ΔG within the run-to-run spread, not equal."}`,
    `Target: ${opts.target}`, "", "## Environment", `- ${m.environment.pmemd ?? m.stages[0].engine}`, ...Object.entries(m.environment.conda_lock).map(([k, v]) => `- ${k}=${v}`), "",
    "## Approved changes", ...(opts.approved.length ? opts.approved.map(p => `- ${p.stage}: ${JSON.stringify(p.edits)} — ${p.reason}`) : ["- none"]), "",
    "## Steps", "1. `cd build && tleap -f leap.in` (needs the ligand mol2/frcmod and cleaned protein PDB from the original run's build/ directory)",
    "2. copy comp_oct.top / comp_oct.crd into md/", "3. `bash run.sh`", "", "## Force fields", ...m.system.force_fields.map(f => `- leaprc.${f}`)].join("\n");
  files["manifest.json"] = JSON.stringify({ ...m, stages: m.stages.map(s => ({ ...s, mdin: undefined })) }, null, 1);
  return files;
}
export function zipBundle(files: Record<string, string>): Uint8Array {
  const o: Record<string, Uint8Array> = {}; for (const [k, v] of Object.entries(files)) o[k] = strToU8(v);
  return zipSync(o, { level: 6 });
}
