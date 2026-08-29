export const GB_TERMS = ["BOND", "ANGLE", "DIHED", "VDWAALS", "EEL", "1-4 VDW", "1-4 EEL", "EGB", "ESURF"] as const;
export type GbTerm = typeof GB_TERMS[number];
export interface PerFrame { n: number; terms: Record<GbTerm, number[]>; delta_total: number[]; source: string[]; esurf_formula: string; reproduces: { delta_total_mean: boolean; sd_ddof0: boolean; checked_against: string } }
export interface Stage {
  name: string; role: string; mdin: string; cntrl: Record<string, string>;
  restart_from: string; length_ps: number | null; requested_seed?: string;
  realized_seed?: number; wall_s?: number; engine?: string; finished?: boolean;
  envelope?: { rst: boolean; finished: boolean; crashes: string[] };
}
export interface Manifest {
  id: string; title: string; schema: string; engine: string;
  source?: { run_dir: string; extracted: string };
  system: {
    protein: { atoms: number | null; source_pdb: string | null };
    ligand: { resname: string | null; atoms: number | null; atom_types: string[] | null; charge_method: string | null; net_charge: number | null; frcmod_missing: string[] | null };
    solvent: { box: string | null; model: string | null; buffer_A: number | null; residues_added: number[] | null; solvated_atoms: number | null; dry_atoms: number | null };
    force_fields: string[]; leap_in: string;
    /** Files leap.in loads (ligand mol2/frcmod, cleaned protein PDB). `present` are archived under public/runs/<id>/build/ and shipped in rerun bundles; `missing` were not in the run directory. */
    build_inputs?: { present: string[]; missing: string[]; note?: string };
  };
  stages: Stage[];
  results: {
    mmgbsa?: {
      delta_total_kcal_mol: number; frame_std: number; frame_sem: number; sd_convention?: string;
      frames: number | null; frames_header_text?: string | null; frames_note?: string;
      igb: string; saltcon: string; params?: Record<string, string>; trajectory: string; run_on: string | null; mmpbsa_version: string | null; warnings: string[];
      per_frame?: PerFrame | null;
    };
    plip?: { frame: { policy: string; index: number; nframes: number } | null; ligand: Record<string, unknown> | null; interactions: Record<string, { residue: string; dist?: number }[]>; source?: string };
  };
  analyses: Record<string, { png: string; ok: boolean | null }>;
  structure: string | null;
  environment: { conda_lock: Record<string, string>; pmemd: string | null; conda_lock_file: string };
  pipeline: { stage_envelopes: Record<string, boolean>; skills: string[] };
}
export interface SystemKey { ligand: string | null; ligand_atoms: number | null; atom_types: string[]; charge_method: string | null; net_charge: number | null; protein_atoms: number | null; force_fields: string[]; solvent: string | null; box: string | null; buffer_A: number | null }
/** `protocol`: production-stage physics / thermodynamic-state / restraint parameters + MM-GBSA model, joined (tools/build_index.py); `seed`: the production stage's realized seed. Both drive the "independently replicated" rung. */
export interface IndexEntry { id: string; title: string; ligand: string; protein_atoms: number; production_ps: number; delta_g: number; plip: boolean; engine: string; system: SystemKey; protocol?: string; seed?: number | null }
