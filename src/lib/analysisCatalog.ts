// What each cpptraj analysis shows, in one line, and which family it belongs to. These describe the
// kind of plot, never a number from a run — the numbers stay in the run's own files.
export type AnalysisCategory = "structure" | "dynamics" | "ensemble" | "energy" | "other";
export interface AnalysisInfo { name: string; category: AnalysisCategory; shows: string }
export const ANALYSIS_CATEGORIES: AnalysisCategory[] = ["structure", "dynamics", "ensemble", "energy"];
export const ANALYSIS_CATALOG: Record<string, AnalysisInfo> = {
  rmsd:    { name: "Backbone RMSD", category: "structure", shows: "How far the backbone has moved from the starting structure over time. A climb that flattens is normal settling; a steady climb is not." },
  rg:      { name: "Radius of gyration", category: "structure", shows: "How compact the protein is over time. A stable band says the fold is not unravelling." },
  sasa:    { name: "Solvent-accessible surface", category: "structure", shows: "Surface exposed to solvent over time. Sudden jumps can mean partial unfolding or a pocket opening." },
  distmat: { name: "Cα–Cα distance matrix", category: "structure", shows: "Average pairwise distances between backbone atoms: a fingerprint of the overall shape." },
  rmsf:    { name: "Per-residue RMSF", category: "dynamics", shows: "Which residues move most. Peaks mark flexible loops or termini, not necessarily a problem." },
  dssp:    { name: "Secondary structure (DSSP)", category: "dynamics", shows: "Helix, sheet or coil per residue over time, and when that changes." },
  hbond:   { name: "Hydrogen bonds", category: "dynamics", shows: "Hydrogen bonds present per frame. Flickering is normal for a weak or transient contact." },
  cluster: { name: "Clustering", category: "ensemble", shows: "Frames grouped into recurring shapes. A few dominant clusters mean the trajectory settled somewhere consistent." },
  pca:     { name: "Principal components (Cα)", category: "ensemble", shows: "The motion projected onto its two largest directions of variance; nearby points are structurally similar." },
  fel:     { name: "Free-energy landscape", category: "ensemble", shows: "Population density over the first two principal components drawn as a free-energy surface. Basins are the states visited most." },
  thermo:  { name: "Temperature trace", category: "energy", shows: "Temperature from the engine's output over the heating steps: a ramp that levels off at the target and stays there." },
  mmgbsa:  { name: "MM-GBSA ΔG", category: "energy", shows: "The binding free energy from MM-GBSA on the archived frames, as one bar; the per-frame series is in the card above." },
};
export function analysisInfo(key: string): AnalysisInfo { return ANALYSIS_CATALOG[key] ?? { name: key, category: "other", shows: "" }; }
