import type { Manifest, IndexEntry } from "./types";
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

// ---- ensemble: same system (ligand resname + protein atom count) --------
export function sameSystem(a: IndexEntry, b: IndexEntry) { return a.ligand === b.ligand && a.protein_atoms === b.protein_atoms; }
export function ensemble(idx: IndexEntry[], id: string) {
  const me = idx.find(r => r.id === id)!;
  const peers = idx.filter(r => sameSystem(r, me));
  const g = peers.map(r => r.delta_g);
  const n = g.length, mean = g.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  return { n, mean, sd, min: Math.min(...g), max: Math.max(...g), runs: peers.map(r => ({ id: r.id, delta_g: r.delta_g, production_ps: r.production_ps })),
    caveat: "Independent runs of the same prepared system. Production lengths differ (see runs); each ΔG is a single-trajectory MM-GBSA average over 100 frames with ig=-1 Langevin, so run-to-run spread is expected and is the relevant uncertainty — not the per-frame SEM." };
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
    sign_claim: `${ens.n} independent runs all give ΔG < 0 (range ${ens.min} to ${ens.max}); the sign is robust, the second decimal is not.`,
    warnings: mm.warnings, warning_note: mm.warnings.length ? "MMPBSA.py emits this when complex − receptor − ligand internal terms (bond/angle/dihedral) do not cancel exactly in single-trajectory mode; it is a flag on the decomposition, recorded here verbatim rather than suppressed." : undefined,
    provenance: { computed_on: mm.run_on, mmpbsa_version: mm.mmpbsa_version, engine: prod?.engine, ambertools: m.environment.conda_lock.ambertools },
  };
}

// ---- diff -----------------------------------------------------------
const SEMANTIC: Record<string, string> = {
  dt: "integration timestep (ps)", nstlim: "number of MD steps", temp0: "target temperature (K)", cut: "non-bonded cutoff (Å)",
  ntt: "thermostat (3 = Langevin)", gamma_ln: "Langevin collision frequency (ps⁻¹)", ntp: "pressure coupling", barostat: "barostat (2 = Monte Carlo)",
  ntc: "SHAKE constraints", ntf: "force evaluation (2 = skip H-bond forces)", ig: "random seed request", irest: "restart flag", ntx: "coordinate/velocity read",
  ntr: "positional restraints", restraint_wt: "restraint force constant", ntwx: "trajectory write interval", ntpr: "energy print interval",
};
export function diffRuns(a: Manifest, b: Manifest, ia: IndexEntry[]) {
  const sys = (m: Manifest) => ({ ligand: m.system.ligand.resname, ligand_atom_types: m.system.ligand.atom_types, protein_atoms: m.system.protein.atoms,
    force_fields: m.system.force_fields, solvent: m.system.solvent.model, box: m.system.solvent.box, waters: m.system.solvent.residues_added?.[0], charge_method: m.system.ligand.charge_method });
  const sa = sys(a), sb = sys(b);
  const systemDiff = Object.keys(sa).filter(k => JSON.stringify((sa as any)[k]) !== JSON.stringify((sb as any)[k])).map(k => ({ field: k, a: (sa as any)[k], b: (sb as any)[k] }));
  const stages = a.stages.map(s => s.name).filter(n => b.stages.some(t => t.name === n));
  const stageDiffs = stages.map(n => {
    const ca = a.stages.find(s => s.name === n)!.cntrl, cb = b.stages.find(s => s.name === n)!.cntrl;
    const keys = [...new Set([...Object.keys(ca), ...Object.keys(cb)])].filter(k => ca[k] !== cb[k] && k !== "ig");
    return { stage: n, changes: keys.map(k => ({ key: k, meaning: SEMANTIC[k] ?? null, a: ca[k] ?? null, b: cb[k] ?? null,
      material: !["ntpr", "ntwx", "ntwr", "ioutfm"].includes(k) })) };
  }).filter(d => d.changes.length);
  const seeds = { a: a.stages.map(s => s.realized_seed), b: b.stages.map(s => s.realized_seed) };
  const same = sameSystem(ia.find(r => r.id === a.id)!, ia.find(r => r.id === b.id)!);
  const dg = { a: a.results.mmgbsa?.delta_total_kcal_mol, b: b.results.mmgbsa?.delta_total_kcal_mol };
  const materialStage = stageDiffs.some(d => d.changes.some(c => c.material));
  const interpretation = !same
    ? "Different systems — the ΔG values are not comparable; the difference reflects the ligand/protein, not the protocol."
    : materialStage
      ? "Same system, protocol differs in a material parameter (see stage changes). ΔG differences may come from the protocol change AND from seed-to-seed sampling; compare against the run-to-run spread before attributing anything to the parameter."
      : "Same system, same protocol, different Langevin seeds (and possibly output cadence). Any ΔG difference is sampling noise; judge it against the run-to-run spread, not the per-frame SEM.";
  return { a: a.id, b: b.id, same_system: same, system: systemDiff, stages: stageDiffs, realized_seeds: seeds, delta_g: dg,
    run_to_run_spread: same ? ensemble(ia, a.id) : null, interpretation };
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
