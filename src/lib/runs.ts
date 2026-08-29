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
    // A transport failure is not a bad id: say "retry", not "check your run ids".
    super(`run '${runId}' could not be loaded: ${reason}. ${status == null ? "This is a network error, not an unknown run id — retry; if it persists the site's data files are unreachable from here." : "Call list_runs (or open the run list at #/) for valid run ids."}`);
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
/** PASS / WARN / FAIL from a report's flags — the one place this rule lives (tool output, panel line and page badge all use it). */
export const verdictOf = (r: { hasFail: boolean; hasWarn: boolean }) => r.hasFail ? "FAIL" : r.hasWarn ? "WARN" : "PASS";
export function validateAll(m: Manifest) {
  const stages = m.stages.map(s => validateStage(m, s.name));
  return { run: m.id, verdict: verdictOf({ hasFail: stages.some(s => s.hasFail), hasWarn: stages.some(s => s.hasWarn) }), stages };
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
  const me = idx.find(r => r.id === id); if (!me) throw new Error(`no run '${id}' in the run index. Call list_runs (or open #/) for valid run ids.`);
  const peers = idx.filter(r => sameSystem(r, me));
  const all = stratum(peers), long = stratum(peers.filter(r => r.production_ps >= LONG_RUN_MIN_PS));
  return { fingerprint: systemFingerprint(me.system), all, long: { min_ps: LONG_RUN_MIN_PS, ...long },
    sd_convention: "sample SD (n−1) across runs",
    caveat: peers.length < 2
      ? `Only one run of this prepared system (${me.production_ps} ps); no run-to-run spread can be estimated. At least 3 independent runs (ig=-1) are needed before an ensemble uncertainty can be quoted.`
      : `Independent runs of the same prepared system — same build inputs, force fields and protocol, different realized seeds (ig=-1 Langevin). Production lengths differ (${[...new Set(peers.map(r => r.production_ps))].sort((a, b) => a - b).join(", ")} ps), so 'all' mixes short and long runs; 'long' keeps runs ≥ ${LONG_RUN_MIN_PS} ps. The spread is seed-to-seed variation over picoseconds from one prepared start, not a survey of conformational space. Run-to-run spread, not the per-frame SEM, is the uncertainty to quote.` };
}
/** "all 9 runs give ΔG < 0" / "7 of 9" / "none" — computed, never assumed. `label` names the stratum when it is empty ("no runs ≥ 10 ps of this system"). */
export function signClaim(st: Stratum, label = ""): string {
  if (st.n === 0) return `no runs${label ? ` ${label}` : ""} of this system`;
  const range = st.n === 1 ? `ΔG = ${st.min} kcal/mol` : `range ${st.min} to ${st.max} kcal/mol`;
  const ps = st.runs.map(r => r.production_ps).filter(x => x != null); const psRange = ps.length ? `${Math.min(...ps)}–${Math.max(...ps)} ps` : "";
  const pinned = st.sd != null ? `; the observed seed-to-seed SD is ±${st.sd.toFixed(1)} kcal/mol in this short, mixed-length ensemble (${psRange}; range width ${(st.max! - st.min!).toFixed(1)}) — a spread, not a converged uncertainty` : "";
  if (st.negative === st.n) return `${st.n === 1 ? "The single run gives" : `All ${st.n} independent runs give`} ΔG < 0 (${range}); ${st.n >= 3 ? `the sign is robust to seed variation${pinned}` : "the sign is not yet established (n < 3)"}.`;
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
  // The half-difference has its own standard error: √(SEM₁² + SEM₂²) with each half's SEM corrected by the full-series g.
  // (Testing against the full-series SEM alone would be a 1σ test — ~32 % false "drifting" on a stationary series.)
  const half = Math.floor(n / 2);
  const seDiff = Math.sqrt(correctedSem(x.slice(0, half), g, 0) ** 2 + correctedSem(x.slice(half), g, 0) ** 2);
  const drifting = Math.abs(h.diff) > CONVERGENCE.drift_sigma * seDiff;
  const verdict = nEff < CONVERGENCE.min_n_eff ? "too short to judge" : drifting ? "drifting" : "no drift detected";
  return {
    n_frames: n, frame_interval_ps: framePs != null ? round(framePs, 3) : null,
    per_frame_sd: round(sd(x, 0)), per_frame_sem: round(naive),
    statistical_inefficiency_g: round(g, 2), integrated_autocorrelation_time_frames: round(tau, 2),
    integrated_autocorrelation_time_ps: framePs != null ? round(tau * framePs, 3) : null,
    n_eff: round(nEff, 1), corrected_sem: round(corrected),
    block_averaging: { sem_by_block: blocks.map(b => ({ block: b.block, blocks: b.blocks, sem: round(b.sem) })), plateau_sem: plateau ? round(plateau.sem) : null },
    halves: { first: round(h.first), second: round(h.second), diff: round(h.diff), se_of_diff: round(seDiff), diff_in_sigma: round(Math.abs(h.diff) / seDiff, 2) },
    drift_kcal_per_frame: round(slope, 5), drift_kcal_per_ps: framePs ? round(slope / framePs, 4) : null,
    verdict, thresholds: { drifting_if: `|second half − first half| > ${CONVERGENCE.drift_sigma} × √(SEM₁² + SEM₂²), each half's SEM autocorrelation-corrected (g from the full series)`, too_short_if: `N_eff < ${CONVERGENCE.min_n_eff}` },
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
    if (L != null && opts.discard_ps >= L) throw new Error(`discard_ps ${opts.discard_ps} ≥ the ${L} ps production length of ${m.id}; nothing would remain. Use a value below ${L}.`);
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
export interface PlanOpts { target_uncertainty_kcal?: number; min_run_ps?: number; detail?: boolean }
/** Compact by default: the recommendation, the run-to-run arithmetic and the suggested edit. `detail: true` adds the per-length table, formulas and every assumption. */
export function planSampling(m: Manifest, idx: IndexEntry[], opts: PlanOpts = {}) {
  const full = planSamplingFull(m, idx, opts);
  if (opts.detail) return full;
  return { label: full.label, run: full.run, target_uncertainty_kcal: full.target_uncertainty_kcal, recommendation: full.recommendation,
    run_to_run: { planned_on: full.run_to_run.planned_on, n_now: full.run_to_run.n_now, sd_used: full.run_to_run.sd_used, sem_of_mean_now: full.run_to_run.sem_of_mean_now, n_needed: full.run_to_run.n_needed, n_needed_range: full.run_to_run.n_needed_range, additional_runs: full.run_to_run.additional_runs, target_met: full.run_to_run.target_met },
    within_run: { corrected_sem_now: full.within_run.this_run.corrected_sem, verdict: full.within_run.this_run.verdict, expected_length_for_target_ps: full.within_run.expected_length_for_target_ps, expected_length_note: full.within_run.expected_length_note },
    recommended_run_ps: full.recommended_run_ps, suggested_edits: full.suggested_edits, rerun_note: full.rerun_note, assumptions: full.assumptions,
    detail: "compact by default; call with detail: true for the per-length SEM table, strata, formulas and method" };
}
function planSamplingFull(m: Manifest, idx: IndexEntry[], opts: PlanOpts = {}) {
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
  // The SD itself is estimated from nNow runs: relative SE ≈ 1/√(2(n−1)); n_needed ∝ SD², so carry that through as a range rather than one number.
  const sdRel = nNow != null && nNow > 1 ? 1 / Math.sqrt(2 * (nNow - 1)) : null;
  const nNeededRange = s != null && sdRel != null ? { low: Math.ceil((s * Math.max(0, 1 - sdRel) / T) ** 2), high: Math.ceil((s * (1 + sdRel) / T) ** 2), sd_relative_se: round(sdRel, 2), note: `plug-in estimate: SD ${round(s, 2)} from ${nNow} runs has relative SE ≈ ${round(sdRel, 2)}; n_needed scales with SD², so ±1 SE on the SD spans this range` } : null;
  const additional = nNeeded != null && nNow != null ? Math.max(0, nNeeded - nNow) : null;
  const semAfter = s != null && nNow != null && nNeeded != null ? s / Math.sqrt(Math.max(nNow, nNeeded)) : null;
  const targetMet = semNow != null ? semNow <= T : false;
  const stratumRow = (x: Stratum) => ({ n: x.n, sd: x.sd != null ? round(x.sd) : null, sem_of_mean: x.sd != null && x.n ? round(x.sd / Math.sqrt(x.n)) : null });
  // within-run
  const expSem = (Lps: number) => round(projectedSem(SD, g, dPs, Lps));
  // The projection assumes stationarity. On a drifting or too-short series the autocorrelation truncates early and τ is not an estimate of anything (a 2 ps drifting run "reaches" the target at 2 ps); say so instead of printing a number.
  const stationary = unc.verdict === "no drift detected";
  const lengthForTarget = stationary ? round(g * dPs * (SD / T) ** 2, 1) : null;
  const lengthNote = stationary ? null : `not projected: this run's convergence verdict is '${unc.verdict}', so its τ and SD are not a stationary estimate; the per-length table below is shown for scale only`;
  const Lrec = Math.max(minPs, L0);
  const spreadOverWithin = s != null ? round(s / unc.corrected_sem, 1) : null;
  // suggested edits: data for propose_change; nothing is proposed here
  const dt = Number(prod.cntrl.dt), nstlimNow = Number(prod.cntrl.nstlim), ntwx = Number(prod.cntrl.ntwx) || null;
  const nstlimNew = Math.round(Lrec / dt);
  const mmInterval = Number(mm.params?.interval) || 1;
  // Two possible edits for propose_change: bring a short run up to the stratum minimum, or — when the run is already long enough but the target is not met —
  // extend this run alone to the projected length. The primary recommendation stays "more independent runs"; the extension is labelled as the single-run route.
  const extendAlone = !targetMet && nstlimNew === nstlimNow && lengthForTarget != null && lengthForTarget > L0 ? Math.round(lengthForTarget / dt) : null;
  const suggested = nstlimNew !== nstlimNow ? {
    run_id: m.id, stage: prod.name, purpose: "join the ≥ min_run_ps stratum" as const,
    edits: { nstlim: String(nstlimNew), ...(prod.cntrl.ig !== "-1" ? { ig: "-1" } : {}) },
    reason: `extend production from ${L0} to ${Lrec} ps (${nstlimNew} steps at dt=${dt}) so the run joins the ≥ ${minPs} ps stratum`,
    expected_frames_written: ntwx ? Math.floor(nstlimNew / ntwx) : null,
    expected_frames_analysed: ntwx ? Math.floor(Math.floor(nstlimNew / ntwx) / mmInterval) : null,
    note: "Data for propose_change; nothing has been proposed. ntwx is unchanged, so the frame cadence Δ is unchanged and the analysed frame count scales with length.",
  } : extendAlone != null ? {
    run_id: m.id, stage: prod.name, purpose: "extend this run alone to the projected length" as const,
    edits: { nstlim: String(extendAlone) },
    reason: `extend production from ${L0} to ≈ ${lengthForTarget} ps (${extendAlone} steps at dt=${dt}) so one run alone reaches ±${T} (expected, stationary); more independent runs is the primary recommendation`,
    expected_frames_written: ntwx ? Math.floor(extendAlone / ntwx) : null,
    expected_frames_analysed: ntwx ? Math.floor(Math.floor(extendAlone / ntwx) / mmInterval) : null,
    note: "Data for propose_change; nothing has been proposed. This is the single-run route; the run-to-run recommendation above is the primary one.",
  } : null;
  const rerunNote = suggested ? null : `This run is already ≥ ${Lrec} ps${targetMet ? " and the target is met" : ""}; independent samples need no &cntrl edit — generate_rerun_bundle with seed='fresh' (ig=-1) for each new run.`;
  const recommendation = plannedOn == null
    ? `expected: no run-to-run estimate — this is the only run of its prepared system. Within this run the corrected SEM is ${unc.corrected_sem} kcal/mol at ${L0} ps; ${lengthForTarget != null ? `one run would reach ±${T} at ≈ ${lengthForTarget} ps (expected, stationary)` : `no single-run length is projected (verdict: ${unc.verdict})`}. Seed-to-seed spread cannot be estimated from one run: at least 3 independent runs (ig=-1) of ≥ ${Lrec} ps are needed before an ensemble uncertainty can be quoted.`
    : targetMet
      ? `expected: target ±${T} kcal/mol on the ensemble mean is already met on the ${plannedOn} stratum (n=${nNow}, SD ${round(s!, 2)}, SEM of mean ${round(semNow!, 2)}); 0 more runs needed.`
      : `expected: ${additional} more independent run${additional === 1 ? "" : "s"} (ig=-1) of ≥ ${Lrec} ps each → n=${nNeeded}${nNeededRange ? ` (plug-in estimate; ±1 SE on the SD gives n = ${nNeededRange.low}–${nNeededRange.high})` : ""}, SEM of the ensemble mean ≈ ${round(semAfter!, 2)} ≤ ${T} kcal/mol. ${lengthForTarget != null ? `Extending this run alone reaches ±${T} at ≈ ${lengthForTarget} ps (expected)` : `No single-run length is projected for this run (verdict: ${unc.verdict})`}; run-to-run SD ${round(s!, 2)} is ${spreadOverWithin}× this run's corrected SEM, ${spreadOverWithin! >= 2 ? "so seed spread, not frame noise, limits the estimate" : spreadOverWithin! >= 1.2 ? "so seed spread and frame noise are comparable" : "so the run-to-run spread is not distinguishable from this run's frame noise"}.`;
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
      sd_used: s != null ? round(s) : null, n_now: nNow, sem_of_mean_now: semNow != null ? round(semNow) : null, n_needed: nNeeded, n_needed_range: nNeededRange, additional_runs: additional,
      expected_sem_of_mean_after: semAfter != null ? round(semAfter) : null, target_met: targetMet, sign_claim: signClaim(st ?? ens.all) },
    within_run: { this_run: { production_ps: L0, per_frame_sd: unc.per_frame_sd, g: unc.statistical_inefficiency_g, tau_ps: unc.integrated_autocorrelation_time_ps, frame_interval_ps: round(dPs, 3), corrected_sem: unc.corrected_sem, n_eff: unc.n_eff, verdict: unc.verdict },
      formula: "expected SEM(L) = SD · √(g·Δ/L) = SD · √((Δ + 2τ)/L), N = L/Δ frames",
      at_current_length: { length_ps: L0, expected_sem: expSem(L0) },
      expected_sem_by_length: PLAN_LENGTHS_PS.map(Lps => ({ length_ps: Lps, expected_frames_analysed: Math.round(Lps / dPs), expected_sem: expSem(Lps) })),
      expected_length_for_target_ps: lengthForTarget, expected_length_note: lengthNote, spread_over_within: spreadOverWithin },
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
/** Compact by default: the brief and the numbers that decide things. `detail: true` returns the full record (per-frame stats, block averaging, run list, provenance). */
export function explainResult(m: Manifest, idx: IndexEntry[], detail = false) {
  const full = explainResultFull(m, idx);
  if (detail || "error" in full) return full;
  const f = full as Exclude<typeof full, { error: string }>;
  return { brief: f.brief, value_kcal_mol: f.value_kcal_mol,
    uncertainty_to_quote: f.run_to_run.all.sd != null ? { run_to_run_sd: round(f.run_to_run.all.sd), n: f.run_to_run.all.n, production_ps: [...new Set(f.run_to_run.all.runs.map(r => r.production_ps))].sort((a, b) => a - b), long_stratum: f.run_to_run.long.n >= 2 ? { min_ps: f.run_to_run.long.min_ps, n: f.run_to_run.long.n, sd: f.run_to_run.long.sd != null ? round(f.run_to_run.long.sd) : null } : null } : null,
    within_run: f.uncertainty ? { corrected_sem: f.uncertainty.corrected_sem, naive_sem: f.uncertainty.per_frame_sem, n_eff: f.uncertainty.n_eff, verdict: f.uncertainty.verdict } : null,
    which_uncertainty_to_quote: f.which_uncertainty_to_quote, this_run_vs_ensemble: f.this_run_vs_ensemble, sign_claim: f.sign_claim.all_runs, entropy_term: f.entropy_term, warning_note: f.warning_note ?? null,
    detail: "compact by default; call with detail: true for per-frame statistics, block averaging, the run list, seeds, the MMPBSA residual by term and provenance" };
}
function explainResultFull(m: Manifest, idx: IndexEntry[]) {
  const mm = m.results.mmgbsa; if (!mm) return { error: "no MM-GBSA result in this run" };
  const prod = m.stages.find(s => s.role === "production");
  const ens = ensemble(idx, m.id);
  const pf = mm.per_frame ?? null;
  const unc = pf ? uncertaintyFromFrames(pf, prod?.length_ps ?? null) : null;
  const resid = pf ? internalResidual(pf, mm.delta_total_kcal_mol) : null;
  // MM-GBSA's largest caveat, read from _MMPBSA_info (entropy=0): no −TΔS term, and single-trajectory means no strain energy either.
  const entropyNote = mm.params?.entropy === "0" ? "No entropy term (entropy=0) and a single trajectory (no ligand/receptor strain): this is an effective interaction energy for ranking poses or ligands, not an absolute binding free energy." : null;
  const spreadSd = ens.all.sd;
  // Name the stratum: explain_result quotes the all-runs SD; plan_sampling plans on the ≥ LONG_RUN_MIN_PS ps stratum when it has ≥ 3 runs. Say both so the two tools do not appear to disagree.
  const stratumNote = ens.long.sd != null && ens.long.n < ens.all.n ? `; the ≥ ${LONG_RUN_MIN_PS} ps stratum alone gives ±${ens.long.sd.toFixed(2)}, n=${ens.long.n}, which is what plan_sampling plans on` : "";
  const ratio = unc && spreadSd != null ? spreadSd / unc.corrected_sem : null;
  const dominates = ratio == null ? "" : ratio >= 2 ? "so seed-to-seed variation, not frame noise, dominates" : ratio >= 1.2 ? "so seed-to-seed variation and frame noise are comparable" : "so the run-to-run spread is not distinguishable from this run's frame noise";
  const byLen = new Map<number, IndexEntry[]>(); for (const r of ens.all.runs.map(x => idx.find(y => y.id === x.id)!).filter(Boolean)) byLen.set(r.production_ps, [...(byLen.get(r.production_ps) ?? []), r]);
  const matchedSd = [...byLen.entries()].filter(([, rs]) => rs.length >= 3).map(([ps, rs]) => `${ps} ps: n=${rs.length}, SD ±${stratum(rs).sd?.toFixed(2)}`);
  const which = unc && spreadSd != null
    ? `Quote ±${spreadSd.toFixed(2)} kcal/mol — the observed run-to-run spread over all ${ens.all.n} runs of this system at mixed production lengths${stratumNote}${matchedSd.length ? `; matched-length SD where ≥ 3 runs share a length: ${matchedSd.join("; ")}` : ""} — as the spread to quote for a single run's ΔG. Within this run the correlation-corrected SEM is ${unc.corrected_sem} (N_eff ≈ ${unc.n_eff} of ${unc.n_frames} frames); the naive per-frame SEM ${unc.per_frame_sem} is ${(unc.corrected_sem / unc.per_frame_sem).toFixed(1)}× too small. Run-to-run spread is ${ratio!.toFixed(1)}× the corrected SEM, ${dominates}.`
    : unc ? `Within this run the correlation-corrected SEM is ${unc.corrected_sem}; it does not estimate run-to-run uncertainty — no other runs of this system exist to estimate that spread.` : "per-frame data not archived for this run; only MMPBSA.py's naive SEM is available.";
  // Where this run sits among its peers: rank, z-score vs the ensemble mean, and the ensemble mean ± SEM as the protocol-level estimate.
  const peersSorted = [...ens.all.runs].sort((a, b) => a.delta_g - b.delta_g);
  const vsEnsemble = ens.all.n > 1 && ens.all.mean != null && ens.all.sd != null ? {
    rank_most_negative: peersSorted.findIndex(r => r.id === m.id) + 1, n: ens.all.n,
    z_vs_ensemble_mean: round((mm.delta_total_kcal_mol - ens.all.mean) / ens.all.sd, 2),
    ensemble_mean: round(ens.all.mean, 2), ensemble_sem: round(ens.all.sd / Math.sqrt(ens.all.n), 2),
    note: `the ensemble mean ± SEM is the estimate for this protocol conditional on this short-run ensemble (${[...new Set(ens.all.runs.map(r => r.production_ps))].sort((a, b) => a - b).join("–")} ps from one prepared start; seed variation, not a survey of conformational space); this run's value is one draw from the run-to-run spread` } : null;
  const brief = [
    spreadSd != null
      ? `ΔG = ${round(mm.delta_total_kcal_mol, 1)} ± ${round(spreadSd, 1)} kcal/mol for this run (single-trajectory MM-GBSA, ${mm.frames} frames of ${prod?.length_ps ?? "?"} ps; ± = run-to-run SD over ${ens.all.n} independent runs of the same prepared system; archived value ${mm.delta_total_kcal_mol}).`
      : `ΔG = ${mm.delta_total_kcal_mol} kcal/mol, single-trajectory MM-GBSA over ${mm.frames} frames of a ${prod?.length_ps ?? "?"} ps production run.`,
    spreadSd != null ? `Quote ±${spreadSd.toFixed(2)} kcal/mol (run-to-run SD over all ${ens.all.n} independent runs${stratumNote}); the within-run SEM (${unc ? unc.corrected_sem : mm.frame_sem}) is not the uncertainty to report.` : `Only one run of this system: the within-run SEM ${unc ? unc.corrected_sem : mm.frame_sem} does not estimate run-to-run uncertainty; no spread can be quoted until ≥ 3 independent runs exist.`,
    ...(vsEnsemble ? [`This run is ${vsEnsemble.rank_most_negative} of ${vsEnsemble.n} (most negative first), z = ${vsEnsemble.z_vs_ensemble_mean} vs the ensemble mean ${vsEnsemble.ensemble_mean} ± ${vsEnsemble.ensemble_sem} (SEM, n=${vsEnsemble.n}) — the protocol's estimate conditional on this short-run ensemble (seed variation over picoseconds from one prepared start).`] : []),
    unc ? `Convergence: ${unc.verdict} by the halves test over ${prod?.length_ps ?? "?"} ps (N_eff ≈ ${unc.n_eff}, halves ${unc.halves.first} → ${unc.halves.second}); this tests drift within the archived window, not equilibration on longer timescales.` : "Convergence: per-frame data not archived, cannot judge.",
    signClaim(ens.all),
  ].join(" ");
  return {
    brief, this_run_vs_ensemble: vsEnsemble,
    value_kcal_mol: mm.delta_total_kcal_mol,
    what_it_is: `Single-trajectory MM-GBSA (igb=${mm.igb}, saltcon=${mm.saltcon}) binding free energy, averaged over ${mm.frames} frames (every ${mm.params?.interval ?? "?"}th of ${mm.params?.endframe ?? "?"}) of the ${prod?.length_ps} ps production stage.${entropyNote ? " " + entropyNote : ""}`,
    entropy_term: mm.params?.entropy == null ? null : mm.params.entropy === "0" ? "not computed (entropy=0 in _MMPBSA_info)" : `computed (entropy=${mm.params.entropy})`,
    per_frame_std: mm.frame_std, per_frame_sem: mm.frame_sem, sd_convention: mm.sd_convention,
    uncertainty: unc, which_uncertainty_to_quote: which,
    stochasticity: { requested_seed: prod?.requested_seed, realized_seed: prod?.realized_seed, thermostat: `ntt=${prod?.cntrl.ntt} gamma_ln=${prod?.cntrl.gamma_ln}`,
      note: "ig=-1 draws a wallclock seed; pmemd wrote the realized seed to the .out. Two runs with different seeds are different samples of the same ensemble — differing ΔG is expected, not a bug." },
    run_to_run: ens,
    sign_claim: { all_runs: signClaim(ens.all), long_runs: signClaim(ens.long, `≥ ${LONG_RUN_MIN_PS} ps`) },
    warnings: mm.warnings, internal_term_residual: resid,
    warning_note: mm.warnings.length ? (resid ? `MMPBSA.py's warning is consistent with the internal-term residual quantified in internal_term_residual: ${resid.total.mean} ± ${resid.total.sd} kcal/mol per frame (${(resid.fraction_of_delta_g * 100).toFixed(3)} % of ΔG), from ${resid.dominant_term} — the only internal term that does not cancel. MMPBSA.py's exact trigger condition is not recorded in the artifacts, so this is the residual that accompanies the warning, not a proven cause. Recorded verbatim, quantified, not suppressed.` : "MMPBSA.py emits this when complex − receptor − ligand internal terms do not cancel exactly in single-trajectory mode; per-frame data not archived, so the size of the residual is unknown.") : undefined,
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
  if (a.id === b.id) throw new Error(`run_a and run_b are the same run (${a.id}); pick two different runs (list_runs)`);
  const ka = systemKey(a), kb = systemKey(b);
  // net charge is compared at the precision it is displayed (1e-3 e): antechamber writes −0.000001 for a neutral ligand
  const eq = (k: keyof SystemKey) => k === "net_charge" ? Math.abs((ka[k] ?? 0) - (kb[k] ?? 0)) < 1e-3 : JSON.stringify(ka[k]) === JSON.stringify(kb[k]);
  const systemDiff = (Object.keys(ka) as (keyof SystemKey)[]).filter(k => !eq(k)).map(k => ({ field: k, a: ka[k], b: kb[k] }));
  const same = systemFingerprint(ka) === systemFingerprint(kb);
  const stages = a.stages.map(s => s.name).filter(n => b.stages.some(t => t.name === n));
  const stageDiffs = stages.map(n => {
    const sa = a.stages.find(s => s.name === n)!, sb = b.stages.find(s => s.name === n)!;
    const keys = [...new Set([...Object.keys(sa.cntrl), ...Object.keys(sb.cntrl)])].filter(k => sa.cntrl[k] !== sb.cntrl[k]);
    const changes = keys.map(k => { const c = paramClass(k); return { key: k, meaning: SEMANTIC[k] ?? null, class: c, material: same && isMaterial(c), a: sa.cntrl[k] ?? null, b: sb.cntrl[k] ?? null }; });
    return { stage: n, length_ps: { a: sa.length_ps, b: sb.length_ps }, changes };
  }).filter(d => d.changes.length);
  const classes = new Set(stageDiffs.flatMap(d => d.changes.map(c => c.class)));
  // Materiality is a within-system notion: across different complexes every parameter difference is moot, so none is flagged material.
  const material = same ? [...classes].filter(isMaterial) : [];
  const seeds = { a: a.stages.map(s => s.realized_seed), b: b.stages.map(s => s.realized_seed) };
  const ea = ia.find(r => r.id === a.id);
  // ΔΔG only between runs of the same prepared system; across different complexes the difference is meaningless and is not reported.
  const dg = { a: a.results.mmgbsa?.delta_total_kcal_mol, b: b.results.mmgbsa?.delta_total_kcal_mol,
    diff: same && a.results.mmgbsa && b.results.mmgbsa ? +(a.results.mmgbsa.delta_total_kcal_mol - b.results.mmgbsa.delta_total_kcal_mol).toFixed(4) : null };
  const spread = same && ea ? ensemble(ia, a.id) : null;
  const sdAll = spread?.all.sd ?? null;
  // The difference of two independent draws has spread √2·SD; a |ΔΔG| within 2·√2·SD is consistent with sampling noise. Stated, not implied.
  const sdDiff = sdAll != null ? Math.SQRT2 * sdAll : null;
  const noise = dg.diff != null && sdDiff != null ? { sd_of_difference: round(sdDiff, 2), ratio: round(Math.abs(dg.diff) / sdDiff, 1), consistent_with_sampling_noise: Math.abs(dg.diff) <= 2 * sdDiff } : null;
  const vsSpread = dg.diff != null && sdAll != null && noise ? `|ΔΔG| = ${Math.abs(dg.diff).toFixed(2)} kcal/mol vs the expected spread of a two-run difference √2·SD = ${noise.sd_of_difference} (run-to-run SD ${sdAll.toFixed(2)}, n=${spread!.all.n}): ${noise.ratio}σ → ${noise.consistent_with_sampling_noise ? "consistent with sampling noise" : "larger than sampling noise alone would give (> 2σ)"}` : null;
  // Descriptive, not evaluative: state what differs and give the reader the scale to judge ΔΔG against. No claim about which run is "better" or converged — that is reported per run by explain_result.
  const verdict = !same ? "different complexes — ΔG not compared" : noise ? (noise.consistent_with_sampling_noise ? `ΔΔG consistent with sampling noise (${noise.ratio}σ of a two-run difference)` : `ΔΔG larger than sampling noise alone (${noise.ratio}σ of a two-run difference)`) : "no run-to-run spread to judge ΔΔG against";
  const interpretation = !same
    ? "Different prepared systems (see the system table). The two ΔG values describe different complexes and are not compared here."
    : material.length === 0
      ? `Same prepared system and protocol; only ${[...classes].join(" and ") || "seeds"} differ, so the two ΔG values are independent samples of the same protocol.`
      : material.every(c => c === "sampling_length")
        ? `Same prepared system and physics; the runs differ in production length (${stageDiffs.map(d => `${d.stage}: ${d.length_ps.a} vs ${d.length_ps.b} ps`).join("; ")}), so they are different-length samples of the same protocol. Whether either run is converged is reported per run (drift verdict in explain_result).`
        : `Same prepared system; the protocol differs in ${material.join(", ")} parameters (see stage changes). The ΔG difference combines that change with seed-to-seed sampling; the run-to-run spread is the scale to judge it against.`;
  return { a: a.id, b: b.id, same_system: same, system: systemDiff, stages: stageDiffs, stages_compared: stages.length, differing_classes: [...classes], material_classes: material,
    realized_seeds: seeds, delta_g: dg, delta_g_vs_noise: noise, run_to_run_spread: spread, verdict, interpretation, scale: vsSpread };
}

// ---- proposals (bounded edits, human-approved) -----------------------
export interface ProposalChange { key: string; before: string | null; after: string; class: ParamClass; material: boolean; meaning: string | null }
export interface Proposal { id: string; run: string; stage: string; edits: Record<string, string>; reason: string; before: Report; after: Report; mdin_after: string; status: "pending" | "approved" | "rejected"; changes: ProposalChange[]; material_classes: ParamClass[]; fork?: ForkMeta }
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
let proposalSeq = 0;
export function makeProposal(m: Manifest, stage: string, edits: Record<string, string>, reason: string): Proposal {
  const s = m.stages.find(x => x.name === stage); if (!s) throw new Error(`no stage '${stage}' in ${m.id}; stages: ${m.stages.map(x => `${x.name} (${x.role})`).join(", ")}`);
  // Agents sometimes send edits double-encoded ("{\"dt\":\"0.001\"}") or as a bare string; accept the JSON form, reject the rest with the shape spelled out.
  let e: unknown = edits;
  if (typeof e === "string") { try { e = JSON.parse(e); } catch { /* fall through to the shape error */ } }
  if (!e || typeof e !== "object" || Array.isArray(e) || Object.keys(e).length === 0) throw new Error(`edits must be a non-empty object of &cntrl key → value, e.g. {"dt":"0.001"}; got ${JSON.stringify(edits)}`);
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(e as Record<string, unknown>)) {
    const val = String(v).trim();
    if (!/^[-+0-9.eEdD]+$|^'[^'\n]*'$|^"[^"\n]*"$/.test(val)) throw new Error(`value for ${k} must be a single number or a quoted string (got ${JSON.stringify(v)}); one key per entry`);
    clean[k] = val;
  }
  const bad = Object.keys(clean).filter(k => !EDITABLE.has(k.toLowerCase()));
  if (bad.length) throw new Error(`not an editable &cntrl key: ${bad.join(", ")}. Editable: ${[...EDITABLE].join(", ")}`);
  // Cheap shape guards that are not physics rules (those stay in the oracle-pinned validator): step and cadence counts must be positive integers.
  for (const [k, v] of Object.entries(clean)) {
    if (COUNT_KEYS.has(k.toLowerCase()) && !(/^\d+$/.test(v) && Number(v) > 0)) throw new Error(`${k} must be a positive integer (got ${v})`);
  }
  const after = applyEdits(s.mdin, clean);
  // The controlled diff: each edited key's archived value → new value, with its class, so the human and the agent both see what changes.
  const changes = Object.entries(clean).map(([k, v]) => { const c = paramClass(k); return { key: k, before: s.cntrl[k] ?? null, after: v, class: c, material: isMaterial(c), meaning: SEMANTIC[k] ?? null }; });
  // Unique even when two proposals land in the same millisecond (agents dispatch tool calls in parallel).
  return { id: `p${Date.now().toString(36)}${(++proposalSeq).toString(36)}`, run: m.id, stage, edits: clean, reason, before: checkAmberIn(s.mdin), after: checkAmberIn(after), mdin_after: after, status: "pending",
    changes, material_classes: [...new Set(changes.filter(c => c.material).map(c => c.class))] };
}
const COUNT_KEYS = new Set(["nstlim", "ntwx", "ntpr", "ntwr"]);

// ---- rerun bundle ---------------------------------------------------
/** Files leap.in loads (ligand mol2/frcmod, cleaned protein PDB), from the leap.in text itself. */
export function leapInputs(m: Manifest): string[] { return m.system.leap_in.match(/(?:loadmol2|loadamberparams|loadpdb)\s+(\S+)/g)?.map(x => x.split(/\s+/)[1]) ?? []; }
/** What a rerun still needs from outside the bundle: every leap.in input not actually shipped in `have` (all of them when nothing is shipped). */
export function bundleGaps(m: Manifest, have: Record<string, string> = {}): string[] { return leapInputs(m).filter(n => !(n in have)); }
export function rerunBundle(m: Manifest, opts: { seed: "pinned" | "fresh"; target: "local" | "slurm"; approved: Proposal[]; buildFiles?: Record<string, string> }) {
  // The browser's WebMCP does not enforce the JSON schema's enums; an off-enum value must not silently become "fresh"/"local".
  if (opts.seed !== "pinned" && opts.seed !== "fresh") throw new Error(`seed must be 'pinned' or 'fresh', got ${JSON.stringify(opts.seed)}`);
  if (opts.target !== "local" && opts.target !== "slurm") throw new Error(`target must be 'local' or 'slurm', got ${JSON.stringify(opts.target)}`);
  const files: Record<string, string> = {};
  // Archived build inputs (ligand mol2/frcmod …) travel with the bundle; what was never archived is named in the README, not papered over.
  for (const [name, text] of Object.entries(opts.buildFiles ?? {})) files[`build/${name}`] = text;
  const gaps = bundleGaps(m, opts.buildFiles ?? {});
  for (const s of m.stages) {
    let text = s.mdin;
    // Approved proposals compose: the store lists newest first, so apply oldest → newest, each on top of the previous.
    for (const p of [...opts.approved].reverse().filter(p => p.stage === s.name)) text = applyEdits(text, p.edits);
    if (opts.seed === "pinned" && s.realized_seed !== undefined && /\big\s*=/.test(text)) text = applyEdits(text, { ig: String(s.realized_seed) });
    files[`md/${s.name}.in`] = text;
  }
  files["build/leap.in"] = m.system.leap_in;
  const pm = opts.target === "slurm" ? "srun pmemd.MPI" : "${PMEMD:-pmemd}";
  const lines = ["#!/usr/bin/env bash", "# Generated by runcard from run " + m.id, "set -euo pipefail", "cd \"$(dirname \"$0\")/md\"",
    "# Expects comp_oct.top / comp_oct.crd from build/leap.in (tleap -f leap.in) in md/", ""];
  if (opts.target === "slurm") lines.splice(1, 0, "#SBATCH --job-name=" + m.id, "#SBATCH --nodes=1", "#SBATCH --time=04:00:00");   // after the shebang, or sbatch refuses the script
  let prev = "comp_oct.crd";
  for (const s of m.stages) {
    const isMin = s.role === "minimization";
    const ref = s.cntrl.ntr === "1" ? ` -ref ${prev}` : "";
    lines.push(`echo "[md] ${s.name}" >&2`, `${pm} -O -i ${s.name}.in -o ${s.name}.out -p comp_oct.top -c ${prev} -r ${s.name}.rst${isMin ? "" : ` -x ${s.name}.nc`}${ref}`, "");
    prev = `${s.name}.rst`;
  }
  files["run.sh"] = lines.join("\n");
  // Lineage, derived from the edits actually applied (never from a proposal's intent): every approved proposal is listed; fork metadata is
  // grouped by fork id with the stages that were and were not approved, so a partially approved or doubled-up fork is stated, not hidden.
  const forkIds = [...new Set(opts.approved.filter(p => p.fork).map(p => p.fork!.id))];
  const forks = forkIds.map(fid => { const meta = opts.approved.find(p => p.fork?.id === fid)!.fork!; const applied = opts.approved.filter(p => p.fork?.id === fid).map(p => p.stage);
    return { ...meta, stages_applied: applied, stages_not_applied: meta.stages.filter(s => !applied.includes(s)) }; });
  const lineage = { kind: opts.approved.length ? "extend" as const : opts.seed === "pinned" ? "reproduce" as const : "replicate" as const, parent: m.id, seed: opts.seed,
    edits_applied: opts.approved.map(p => ({ stage: p.stage, edits: p.edits, fork: p.fork?.id ?? null })), forks,
    complete: forks.length <= 1 && forks.every(f => f.stages_not_applied.length === 0) };
  const forkSection = ["## Fork", `- kind: **${lineage.kind}** (parent card: ${m.id}; seed policy ${opts.seed})`,
    ...forks.flatMap(f => [
      `- fork ${f.id}${f.question ? ` — question: ${f.question}` : ""}`,
      ...(f.treatment ? [`  - treatment: ${f.treatment.key}${f.treatment.meaning ? ` (${f.treatment.meaning})` : ""} → ${f.treatment.to} on ${f.stages_applied.join(", ") || "(no stage)"}; before: ${Object.entries(f.treatment.from).map(([s, v]) => `${s}=${v}`).join(", ")}`] : []),
      ...(f.stages_not_applied.length ? [`  - ⚠ partially approved: ${f.stages_not_applied.join(", ")} NOT changed — this bundle is not the controlled extension as proposed`] : []),
      ...(f.runs_per_condition ? [`  - ensemble: this bundle is ONE member of the ${f.runs_per_condition} planned for this condition; with seed policy ${opts.seed === "fresh" ? `fresh (ig=-1) each execution draws a new seed — run it ${f.runs_per_condition} times in separate copies (outputs share names)` : "pinned every execution replays the same seed — use seed='fresh' for the other members"}`] : []),
      ...(f.controls.length ? ["  - controls intended to be held: " + f.controls.join("; ")] : [])]),
    ...(forks.length > 1 ? [`- ⚠ ${forks.length} forks combined in one bundle; the result answers neither question alone`] : []),
    ...opts.approved.filter(p => !p.fork).map(p => `- plain edit: ${p.stage} ${(p.changes ?? []).map(c => `${c.key} ${c.before ?? "(unset)"} → ${c.after}`).join(", ") || JSON.stringify(p.edits)} — ${p.reason}`),
    "- lineage is recorded in this bundle's manifest.json (`parent`, `fork`); tools/extract_run.py copies it onto the child card when the rerun directory is extracted", ""];
  files["README.md"] = [`# Rerun bundle: ${m.title} (${m.id})`, "",
    `Seed policy: **${opts.seed}** — ${opts.seed === "pinned" ? "each stage's ig is set to the seed pmemd actually used in the original run (exact replay on the same build; different hardware/compilers may still diverge)." : "ig=-1 as in the original; this is an independent sample, expect ΔG within the run-to-run spread, not equal."}`,
    `Target: ${opts.target}`, "", ...forkSection, "## Environment", `- ${m.environment.pmemd ?? m.stages[0].engine}`, ...Object.entries(m.environment.conda_lock).map(([k, v]) => `- ${k}=${v}`), "",
    "## Approved changes", ...(opts.approved.length ? opts.approved.map(p => `- ${p.stage}: ${JSON.stringify(p.edits)} — ${p.reason}`) : ["- none"]), "",
    "## What this bundle is", gaps.length
      ? `A rerun recipe, not a self-contained archive: leap.in also loads **${gaps.join(", ")}**, not included here — ${gaps.every(g => m.system.build_inputs?.present.includes(g)) ? "archived with the card but not fetched into this bundle" : "not archived with the run"}; it must come from the original build/ directory. Included: ${Object.keys(opts.buildFiles ?? {}).join(", ") || "none"}.`
      : `Self-contained: every file leap.in loads is included under build/ (${Object.keys(opts.buildFiles ?? {}).join(", ")}).`, "",
    "## Steps", `1. \`cd build && tleap -f leap.in\`${gaps.length ? ` (after adding ${gaps.join(", ")})` : ""}`,
    "2. copy comp_oct.top / comp_oct.crd into md/", "3. `bash run.sh`", "", "## Force fields", ...m.system.force_fields.map(f => `- leaprc.${f}`)].join("\n");
  files["manifest.json"] = JSON.stringify({ ...m, parent: m.id, fork: lineage, stages: m.stages.map(s => ({ ...s, mdin: undefined })) }, null, 1);
  return files;
}
export function zipBundle(files: Record<string, string>): Uint8Array {
  const o: Record<string, Uint8Array> = {}; for (const [k, v] of Object.entries(files)) o[k] = strToU8(v);
  return zipSync(o, { level: 6 });
}

// ---- confidence ladder: what the archived evidence establishes, rung by rung -------------
// recomputable → repeatable → independently replicated → robust to analysis-window choices (the narrow, earned form of 'robust to reasonable choices') → externally supported.
// Every rung is computed from the manifest; "verified" means the check ran here on archived data, "expected" means the
// artefacts to do it exist but nothing was executed, "not assessed" means no evidence of that kind is on the card.
export type RungStatus = "verified" | "partly established" | "expected" | "not established" | "not assessed";
export interface Rung { rung: string; status: RungStatus; short: string; evidence: string; to_climb: string | null }
export function confidenceLadder(m: Manifest, idx: IndexEntry[], detail = true) {
  const full = confidenceLadderFull(m, idx);
  if (detail) return full;
  return { run: full.run, rungs: full.rungs.map(r => ({ rung: r.rung, status: r.status, short: r.short, to_climb: r.to_climb })), verified_of_assessable: full.verified_of_assessable, summary: full.summary, detail: "compact by default; call with detail: true for each rung's evidence (numbers, windows, source files) and the method" };
}
export function confidenceLadderFull(m: Manifest, idx: IndexEntry[]) {
  const mm = m.results.mmgbsa; const pf = mm?.per_frame ?? null;
  const me = idx.find(r => r.id === m.id) ?? null;
  const prod = m.stages.find(s => s.role === "production");
  const unc = pf ? uncertaintyFromFrames(pf, prod?.length_ps ?? null) : null;
  const rungs: Rung[] = [];
  // 1 recomputable — re-derived here: mean and population SD of the archived per-frame energies vs the mmgbsa.dat summary
  if (!mm) rungs.push({ rung: "recomputable", status: "not established", short: "no MM-GBSA result", evidence: "no MM-GBSA result in this run", to_climb: null });
  else if (!pf) rungs.push({ rung: "recomputable", status: "not established", short: "per-frame energies not archived", evidence: "per-frame energies were not archived; only mmgbsa.dat's summary is on the card", to_climb: "archive _MMPBSA_*_gb.mdout.0 and re-extract" });
  else {
    const meanPf = mean(pf.delta_total), sdPf = sd(pf.delta_total, 0); const tol = 5e-5;
    const ok = Math.abs(meanPf - mm.delta_total_kcal_mol) < tol && Math.abs(sdPf - mm.frame_std) < tol;
    rungs.push({ rung: "recomputable", status: ok ? "verified" : "not established", short: ok ? `mean and SD of the ${pf.n} archived per-frame energies reproduce mmgbsa.dat` : "archived per-frame energies do not reproduce mmgbsa.dat",
      evidence: `mean of the ${pf.n} archived per-frame energies = ${round(meanPf)} vs mmgbsa.dat ${mm.delta_total_kcal_mol}; population SD ${round(sdPf)} vs ${mm.frame_std} (both re-derived here, tolerance ${tol}; source ${pf.source.join(", ")})${ok ? "" : " — mismatch"}`, to_climb: null });
  }
  // 2 repeatable — a pinned-seed replay is possible only if every stochastic stage's realized seed, the environment lock and leap.in are archived; never verified here
  const dyn = m.stages.filter(s => s.role !== "minimization"); const unseeded = dyn.filter(s => s.realized_seed == null).map(s => s.name);
  const pins = Object.keys(m.environment.conda_lock).length;
  const missing = [...(unseeded.length ? [`realized seed missing for ${unseeded.join(", ")}`] : []), ...(pins ? [] : ["no environment lock"]), ...(m.system.leap_in ? [] : ["no leap.in"])];
  rungs.push(missing.length
    ? { rung: "repeatable", status: "not established", short: `cannot be replayed exactly: ${missing.join("; ")}`, evidence: `cannot be replayed exactly: ${missing.join("; ")}`, to_climb: "archive the missing seeds / lock / build inputs" }
    : { rung: "repeatable", status: "expected", short: `seeds, environment lock, leap.in${m.system.build_inputs?.present.length ? " and its inputs" : ""} archived for a pinned replay — not executed here${m.system.build_inputs?.missing.length ? `; ${m.system.build_inputs.missing.join(", ")} not archived` : ""}`, evidence: `realized seeds for ${dyn.length}/${dyn.length} dynamics stages, ${pins} environment pins, leap.in${m.system.build_inputs?.present.length ? ` and ${m.system.build_inputs.present.join(", ")}` : ""} are archived; generate_rerun_bundle seed='pinned' replays the run on the same build. Not executed here${m.system.build_inputs?.missing.length ? `, and the bundle is a recipe: ${m.system.build_inputs.missing.join(", ")} must come from the original build/ directory` : ""}`, to_climb: "run the pinned bundle, extract the result as a card, compare" });
  // 3 independently replicated — ≥ 3 runs of the same prepared system AND the same production protocol, with distinct realized seeds
  const peers = me ? idx.filter(r => sameSystem(r, me)) : [];
  const sameProto = me?.protocol ? peers.filter(r => r.protocol === me.protocol) : [];
  const seeded = sameProto.filter(r => r.seed != null); const distinct = new Set(seeded.map(r => r.seed)).size;
  if (!me) rungs.push({ rung: "independently replicated", status: "not established", short: "run not in the site index", evidence: "run not in the site index", to_climb: null });
  else if (!me.protocol) rungs.push({ rung: "independently replicated", status: "not established", short: "no protocol key in the run index", evidence: "the run index carries no protocol key (rebuild with tools/build_index.py)", to_climb: null });
  else if (sameProto.length >= 3 && distinct === sameProto.length && distinct >= 3) {
    const st = stratum(sameProto); const lengths = [...new Set(sameProto.map(r => r.production_ps))].sort((a, b) => a - b);
    const long = stratum(sameProto.filter(r => r.production_ps >= LONG_RUN_MIN_PS));
    // Two levels, stated separately: seed replication (distinct seeds, any length) is earned by the cohort; replication AT THIS RUN'S LENGTH
    // (≥ 3 runs of the same production length) is what "verified" means for this card. Anything less is "partly established", and the rung says which part.
    const myPs = me.production_ps; const atMyLen = sameProto.filter(r => r.production_ps === myPs);
    const verifiedHere = atMyLen.length >= 3; const sdHere = verifiedHere ? stratum(atMyLen).sd : null;
    rungs.push({ rung: "independently replicated", status: verifiedHere ? "verified" : "partly established",
      short: `seed-replicated ✓ (${st.n} same-protocol runs, ${lengths[0]}–${lengths[lengths.length - 1]} ps) · at this run's length (${myPs} ps): ${atMyLen.length} of 3 needed ${verifiedHere ? "✓" : "✗"}`,
      evidence: `${st.n} runs of the same prepared system and production protocol with distinct realized seeds (production ${lengths.join(", ")} ps — same protocol at different lengths, not identical replicates): mean ${st.mean?.toFixed(2)}, run-to-run SD ±${st.sd?.toFixed(2)} kcal/mol${long.n >= 2 && long.n < st.n ? ` (≥ ${LONG_RUN_MIN_PS} ps: n=${long.n}, SD ±${long.sd?.toFixed(2)})` : ""}. What this earns: the sign and the spread are robust to the seed. Replication of this run's number at its own length (${myPs} ps): ${atMyLen.length} run${atMyLen.length === 1 ? "" : "s"}${verifiedHere ? ` (SD ±${sdHere?.toFixed(2)})` : " — fewer than the 3 needed"}. ${signClaim(st).split("; the observed")[0].replace(/\.?$/, ".")}`,
      to_climb: verifiedHere ? null : `${3 - atMyLen.length} more independent run${3 - atMyLen.length === 1 ? "" : "s"} at ${myPs} ps (fork_experiment kind='replicate')` });
  } else rungs.push({ rung: "independently replicated", status: "not established", short: `${sameProto.length} run${sameProto.length === 1 ? "" : "s"} of this system and protocol on this site; 3 needed`,
    evidence: `${peers.length} run${peers.length === 1 ? "" : "s"} of this prepared system on this site, ${sameProto.length} with the same production protocol${seeded.length && distinct < sameProto.length ? ", not all with distinct seeds" : ""}; at least 3 independent runs (ig=-1, same protocol) are needed`, to_climb: "fork_experiment kind='replicate' (plan_sampling gives the number of runs)" });
  // 4 robust to reasonable analysis choices — analysis-window sensitivity only: each window's ΔG must sit within 2 corrected SEMs (of that window) of the archived value
  if (pf && mm) {
    const n = pf.delta_total.length;
    const windows: { label: string; opts: RecomputeOpts }[] = [
      { label: "discard first 10 %", opts: { start_frame: Math.floor(n * 0.1) + 1 } }, { label: "discard first 25 %", opts: { start_frame: Math.floor(n * 0.25) + 1 } },
      { label: "discard first 50 %", opts: { start_frame: Math.floor(n * 0.5) + 1 } }, { label: "every 2nd frame", opts: { interval: 2 } }];
    const rows = windows.map(w => { try { const r = recomputeResult(m, w.opts); return { window: w.label, delta_g: r.delta_g.mean, diff: r.vs_archived.diff, sigma: r.vs_archived.diff_in_corrected_sem }; } catch { return null; } });
    const ok = rows.filter((x): x is NonNullable<typeof x> => !!x && Number.isFinite(x.diff) && Number.isFinite(x.sigma));
    if (ok.length < windows.length) rungs.push({ rung: "robust to analysis-window choices", status: "not established", short: `only ${ok.length} of ${windows.length} windows could be re-analysed`, evidence: `only ${ok.length} of ${windows.length} analysis windows could be re-analysed (too few frames)`, to_climb: "longer sampling (plan_sampling)" });
    else {
      const maxSigma = Math.max(...ok.map(r => Math.abs(r.sigma)));
      const spread = ok.map(r => `${r.window}: ${r.delta_g.toFixed(2)} (Δ ${r.diff >= 0 ? "+" : ""}${r.diff.toFixed(2)}, ${Math.abs(r.sigma).toFixed(1)} σ)`).join("; ");
      // A run that is drifting or too short is not stationary, so window agreement cannot establish robustness — the rung says so instead of contradicting the drift verdict.
      const stationary = unc?.verdict === "no drift detected";
      const passed = stationary && maxSigma <= 2;
      rungs.push({ rung: "robust to analysis-window choices", status: passed ? "verified" : "not established",
        short: !stationary ? `not stationary (${unc?.verdict}); window agreement cannot establish robustness` : passed ? `${ok.length} analysis windows agree within 2 corrected SEMs` : "the analysis window moves ΔG by more than its statistical uncertainty",
        evidence: `${!stationary ? `this run's drift verdict is '${unc?.verdict}', so the windows are not draws from a stationary series. ` : ""}${ok.length} analysis windows re-analysed — ${spread}; largest shift ${maxSigma.toFixed(1)} corrected SEM of its window (criterion ≤ 2 on a stationary run)${maxSigma <= 2 ? "" : " — the window choice moves ΔG by more than its statistical uncertainty"}. Analysis-window sensitivity only: force field, protonation, box and the MM-GBSA model (igb, saltcon) were not varied`,
        to_climb: passed ? "vary a modelling choice in a controlled extension (fork_experiment kind='extend')" : "longer sampling (plan_sampling) until the series is stationary and the window choice stops mattering" });
    }
  } else rungs.push({ rung: "robust to analysis-window choices", status: "not established", short: "per-frame energies not archived", evidence: "per-frame energies not archived; windows cannot be re-analysed", to_climb: null });
  // 5 externally supported — nothing of that kind is on the card; never claimed
  rungs.push({ rung: "externally supported", status: "not assessed", short: "no experimental or literature value linked", evidence: "no experimental or literature value is linked to this card", to_climb: "link an external reference with its own provenance (not part of this site)" });
  const verified = rungs.filter(r => r.status === "verified").length; const partly = rungs.filter(r => r.status === "partly established").length;
  return { run: m.id, rungs, verified_of_assessable: `${verified} of 4`, summary: `${verified} of 4 assessable rungs verified (${rungs.filter(r => r.status === "verified").map(r => r.rung).join(", ") || "none"})${partly ? `, ${partly} partly established (${rungs.filter(r => r.status === "partly established").map(r => `${r.rung}: ${r.short}`).join("; ")})` : ""}; repeatable is at best expected (nothing is executed here); external support is not assessed.`,
    method: "recomputable: mean and population SD of the archived per-frame energies vs mmgbsa.dat (tolerance 5e-5); repeatable: realized seeds for every dynamics stage + environment lock + leap.in archived (never executed here); replicated: verified = ≥ 3 same-fingerprint, same-protocol, distinct-seed runs at THIS run's production length; partly established = seed-replicated across the cohort but not at this length; robust: drift verdict 'no drift detected' AND ΔG over equilibration-discard (10/25/50 %) and stride-2 windows within 2 corrected SEMs of the archived value — analysis-window sensitivity only; external: not assessed. A passing input sanity check is not a rung." };
}

// ---- fork this experiment: reproduce / replicate / extend ------------------------------
export type ForkKind = "reproduce" | "replicate" | "extend";
export interface ForkMeta { id: string; kind: ForkKind; parent: string; question: string | null; treatment: { key: string; meaning: string | null; class: ParamClass; from: Record<string, string>; to: string } | null; stages: string[]; controls: string[]; runs_per_condition?: number | null }
let forkSeq = 0;
/** Conditions held fixed in a controlled extension, as strings a reader can check against the stage inputs. */
function controlsHeld(m: Manifest, treatmentKey: string | null): string[] {
  const prod = m.stages.find(s => s.role === "production"); const c = prod?.cntrl ?? {};
  const mm = m.results.mmgbsa;
  const keys = ["dt", "cut", "ntc", "ntf", "ntt", "gamma_ln", "temp0", "ntp", "barostat", "pres0", "nstlim", "ntwx"].filter(k => k !== treatmentKey && c[k] != null);
  return [`force fields ${m.system.force_fields.join(" + ")}`, `system ${m.system.ligand.resname ?? "?"} (${m.system.ligand.atoms ?? "?"} atoms, ${m.system.ligand.charge_method ?? "?"} charges) in ${m.system.solvent.model ?? "?"} ${m.system.solvent.box ?? ""} ${m.system.solvent.buffer_A ?? "?"} Å`,
    ...keys.map(k => `${k}=${c[k]} (${paramClass(k)})`), ...(mm ? [`MM-GBSA igb=${mm.igb}, saltcon=${mm.saltcon}, ${mm.frames} frames (every ${mm.params?.interval ?? "?"}th)`] : [])];
}
/** Which stages a treatment applies to: thermodynamic state → equilibration + production (the heating ramp is a schedule, left alone); everything else → production. */
export function forkStages(m: Manifest, key: string): string[] {
  const cls = paramClass(key);
  const dyn = m.stages.filter(s => s.role !== "minimization" && s.cntrl[key] != null);
  const picked = cls === "thermodynamic_state" ? dyn.filter(s => s.role !== "heating") : dyn.filter(s => s.role === "production");
  return picked.map(s => s.name);
}
export function forkExperiment(m: Manifest, idx: IndexEntry[], opts: { kind: ForkKind; treatment?: { key: string; value: string }; question?: string; stages?: string[] }) {
  const kinds: ForkKind[] = ["reproduce", "replicate", "extend"];
  if (!kinds.includes(opts.kind)) throw new Error(`kind must be one of ${kinds.join(", ")}, got ${JSON.stringify(opts.kind)}`);
  const ens = idx.some(r => r.id === m.id) ? ensemble(idx, m.id) : null;
  const id = `f${Date.now().toString(36)}${(++forkSeq).toString(36)}`;
  const approval = "NOTHING is applied until a person clicks Approve in the Proposals panel; the bundle is generated afterwards.";
  const controlsNote = "controls listed are those intended to be held (production &cntrl physics / thermodynamic state / sampling, system, force fields, MM-GBSA model); the bundle carries the complete inputs, and diff_runs on the child card is the check";
  if (opts.kind === "reproduce") return { fork_id: id, kind: opts.kind, parent: m.id, tests: "repeatability — if the rerun is executed and its result compared with the archived one, the same setup and seed regenerate the same trajectory on the same build; this does not show the result is stable",
    seed_policy: "pinned: each stage's ig set to the seed pmemd actually used", controls_held: controlsHeld(m, null), controls_note: controlsNote, proposals: [], next: { tool: "generate_rerun_bundle", input: { run_id: m.id, seed: "pinned", target: "local" } }, note: "No parameter changes, so no approval is needed; the bundle is generated directly. Different hardware or compilers may still diverge." };
  if (opts.kind === "replicate") {
    let plan: ReturnType<typeof planSampling> | null = null; try { plan = planSampling(m, idx, {}); } catch { plan = null; }
    return { fork_id: id, kind: opts.kind, parent: m.id, tests: "independent replication — once executed and extracted, an independent-seed run of the same protocol joins the run-to-run spread, which is the uncertainty to quote",
      seed_policy: "fresh: ig=-1, an independent sample of the same protocol", controls_held: controlsHeld(m, null), controls_note: controlsNote, proposals: [],
      runs_recommended: plan ? { additional_runs: plan.run_to_run.additional_runs, min_run_ps: plan.recommended_run_ps, target_uncertainty_kcal: plan.target_uncertainty_kcal, now: ens ? `${ens.all.n} run${ens.all.n === 1 ? "" : "s"} on this site` : null } : null,
      next: { tool: "generate_rerun_bundle", input: { run_id: m.id, seed: "fresh", target: "local" } }, note: "No parameter changes; no approval needed. Expect ΔG within the run-to-run spread, not equal." };
  }
  // extend: one treatment variable, controls fixed, validated, pending human approval
  const t = opts.treatment;
  if (!t || typeof t !== "object" || !t.key) throw new Error(`extend needs treatment {key, value}, e.g. {"key":"temp0","value":"310.0"}`);
  const key = String(t.key).toLowerCase(); const cls = paramClass(key);
  if (!isMaterial(cls) || cls === "other") throw new Error(`${key} is not a treatment variable (class ${cls}); an extension changes one physics, thermodynamic_state, sampling_length or restraints parameter`);
  const to = String(t.value ?? "").trim(); const num = Number(to.replace(/[dD]/, "e"));
  if (!to || !Number.isFinite(num)) throw new Error(`treatment value must be a finite number written as a string (e.g. "310.0"), got ${JSON.stringify(t.value)}`);
  // Which stages may receive the treatment: dynamics stages that set the key; the heating ramp is a schedule, so it is excluded for thermodynamic-state keys.
  const allowed = forkStages(m, key);
  if (!allowed.length) throw new Error(`no dynamics stage of ${m.id} sets ${key}; stages: ${m.stages.map(s => `${s.name} (${s.role})`).join(", ")}`);
  let stages = allowed;
  if (opts.stages != null) {
    if (!Array.isArray(opts.stages) || !opts.stages.length) throw new Error(`stages must be a non-empty list drawn from ${allowed.join(", ")}`);
    stages = [...new Set(opts.stages.map(String))];
    const bad = stages.filter(n => !allowed.includes(n));
    if (bad.length) throw new Error(`stages ${bad.join(", ")} cannot receive ${key} (${cls}); allowed: ${allowed.join(", ")}${cls === "thermodynamic_state" ? " (the heating ramp is left alone; minimization has no dynamics)" : ""}`);
  }
  const from: Record<string, string> = {}; for (const n of stages) from[n] = m.stages.find(x => x.name === n)!.cntrl[key] ?? "(unset)";
  const unchanged = stages.filter(n => from[n] === to);
  if (unchanged.length) throw new Error(`${key} is already ${to} in ${unchanged.join(", ")}; every treated stage must change`);
  const question = opts.question?.trim() || null;
  let plan: ReturnType<typeof planSampling> | null = null; try { plan = planSampling(m, idx, {}); } catch { plan = null; }
  const runsPerCondition = plan ? Math.max(3, plan.run_to_run.n_needed ?? 3) : null;
  const meta: ForkMeta = { id, kind: "extend", parent: m.id, question, treatment: { key, meaning: SEMANTIC[key] ?? null, class: cls, from, to }, stages, controls: controlsHeld(m, key), runs_per_condition: runsPerCondition };
  const proposals: Proposal[] = stages.map(n => ({ ...makeProposal(m, n, { [key]: to }, question ?? `extend: ${key} ${from[n]} → ${to}`), fork: meta }));
  const heat = m.stages.find(s => s.role === "heating"); const first = m.stages.find(s => s.name === stages[0]);
  return { fork_id: id, kind: "extend" as const, parent: m.id, question, tests: "a controlled extension — one variable changed, the listed controls held; once executed and extracted, its card links back to this run as a child",
    treatment: meta.treatment, stages_changed: stages,
    stages_unchanged_note: cls === "thermodynamic_state" && heat && heat.cntrl[key] != null && !stages.includes(heat.name)
      ? `${heat.name} keeps its ${key} ramp to ${heat.cntrl[key]} (a schedule, not a condition): the system is heated as before, then jumps to ${to} at the start of ${stages[0]} and equilibrates there${first?.length_ps != null ? ` for ${first.length_ps} ps` : ""} before production — a jump followed by equilibration, not a preparation at ${to} throughout`
      : null,
    controls_held: meta.controls, controls_note: controlsNote,
    proposals: proposals.map(p => ({ id: p.id, stage: p.stage, before: verdictOf(p.before), after: verdictOf(p.after), findings: p.after.findings.filter(f => f.level !== "PASS").map(f => `${f.level} ${f.rule}: ${f.detail}`) })),
    seed_policy: "fresh (ig=-1) recommended: MD is chaotic, so compare the extension as an ensemble against the parent's run-to-run spread, not one trajectory against one; seed='pinned' replays the parent's seed draw instead",
    sampling: plan ? (() => {
      // A controlled comparison needs controls at the treated length: count the parent's same-protocol runs at recommended_run_ps and say how many more are needed.
      const me = idx.find(r => r.id === m.id); const Lrec = plan!.recommended_run_ps;
      const matchedControls = me ? idx.filter(r => sameSystem(r, me) && r.protocol === me.protocol && r.production_ps === Lrec) : [];
      const needControls = Math.max(0, (runsPerCondition ?? 3) - matchedControls.length);
      return { runs_per_condition: runsPerCondition, min_run_ps: Lrec, parent_run_to_run_sd: plan!.run_to_run.sd_used,
        control: { matched_length_ps: Lrec, parent_runs_at_that_length: matchedControls.map(r => r.id), additional_control_runs_needed: needControls,
          note: needControls ? `the parent's ${plan!.run_to_run.n_now ?? "?"} runs span several production lengths; a controlled comparison at ${Lrec} ps needs ${runsPerCondition} control runs at ${Lrec} ps too — ${matchedControls.length} exist, so plan ${needControls} more control runs (fork_experiment kind='replicate') or stratify the comparison by production length` : `${matchedControls.length} parent runs at ${Lrec} ps serve as the matched control` },
        note: `one bundle = one member: with seed='fresh' (ig=-1) each execution draws a new seed, so run the bundle ${runsPerCondition} times (in separate copies — outputs share names) to build the treated ensemble` }; })() : null,
    next_steps: [`approve ${proposals.length} proposal${proposals.length === 1 ? "" : "s"} in the Proposals panel (human)`, "generate_rerun_bundle seed='fresh' target='local'|'slurm'", "run it elsewhere; extract the result as a child card"],
    note: approval, _proposals: proposals };
}
