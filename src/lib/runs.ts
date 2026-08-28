import type { Manifest, IndexEntry, SystemKey } from "./types";
import { checkAmberIn, type Report } from "./amberCheck";
import { zipSync, strToU8 } from "fflate";

const cache = new Map<string, Promise<Manifest>>();
export async function loadIndex(): Promise<IndexEntry[]> {
  const r = await fetch("/runs/index.json"); return r.json();
}
export function loadRun(id: string): Promise<Manifest> {
  if (!cache.has(id)) cache.set(id, fetch(`/runs/${id}/manifest.json`).then(r => { if (!r.ok) throw new Error(`no run ${id}`); return r.json(); }));
  return cache.get(id)!;
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
  if (st.negative === st.n) return `${st.n === 1 ? "the single run gives" : `all ${st.n} independent runs give`} ΔG < 0 (${range}); the sign is ${st.n >= 3 ? "robust" : "not yet established (n < 3)"}, the second decimal is not.`;
  if (st.negative === 0) return `none of the ${st.n} runs gives ΔG < 0 (${range}).`;
  return `${st.negative} of ${st.n} runs give ΔG < 0 (${range}); the sign is not robust across runs.`;
}

// ---- explain --------------------------------------------------------
export function explainResult(m: Manifest, idx: IndexEntry[]) {
  const mm = m.results.mmgbsa; if (!mm) return { error: "no MM-GBSA result in this run" };
  const prod = m.stages.find(s => s.role === "production");
  const ens = ensemble(idx, m.id);
  return {
    value_kcal_mol: mm.delta_total_kcal_mol,
    what_it_is: `Single-trajectory MM-GBSA (igb=${mm.igb}, saltcon=${mm.saltcon}) binding free energy, averaged over ${mm.frames} frames of the ${prod?.length_ps} ps production stage.`,
    per_frame_std: mm.frame_std, per_frame_sem: mm.frame_sem,
    sem_caveat: "The per-frame SEM assumes independent frames; frames from one short trajectory are correlated, so it understates the uncertainty.",
    stochasticity: { requested_seed: prod?.requested_seed, realized_seed: prod?.realized_seed, thermostat: `ntt=${prod?.cntrl.ntt} gamma_ln=${prod?.cntrl.gamma_ln}`,
      note: "ig=-1 draws a wallclock seed; pmemd wrote the realized seed to the .out. Two runs with different seeds are different samples of the same ensemble — differing ΔG is expected, not a bug." },
    run_to_run: ens,
    sign_claim: { all_runs: signClaim(ens.all), long_runs: signClaim(ens.long) },
    warnings: mm.warnings, warning_note: mm.warnings.length ? "MMPBSA.py emits this when complex − receptor − ligand internal terms (bond/angle/dihedral) do not cancel exactly in single-trajectory mode; it is a flag on the decomposition, recorded here verbatim rather than suppressed." : undefined,
    provenance: { computed_on: mm.run_on, mmpbsa_version: mm.mmpbsa_version, engine: prod?.engine, ambertools: m.environment.conda_lock.ambertools, source_run_dir: m.source?.run_dir },
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
  const interpretation = !same
    ? "Different prepared systems — the ΔG values are not comparable; the difference reflects the ligand/protein, not the protocol."
    : material.length === 0
      ? `Same system, same protocol; only ${[...classes].join(" and ") || "seeds"} differ. Any ΔG difference is sampling noise. ${vsSpread ?? ""}`.trim()
      : material.every(c => c === "sampling_length")
        ? `Same system and physics; the runs differ in production length (${stageDiffs.map(d => `${d.stage}: ${d.length_ps.a} vs ${d.length_ps.b} ps`).join("; ")}). A longer run is a better-converged sample of the same ensemble, not a different experiment. ${vsSpread ?? ""}`.trim()
        : `Same system, protocol differs in ${material.join(", ")} parameters (see stage changes). A ΔG difference may come from the protocol change AND from seed-to-seed sampling; judge it against the run-to-run spread before attributing anything to the parameter. ${vsSpread ?? ""}`.trim();
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
  return out;
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
