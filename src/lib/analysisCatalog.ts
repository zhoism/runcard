// What each cpptraj analysis shows, in one clause, and which family it belongs to. The visible caption on the
// page is name + family; the sentence goes into the figure's tooltip and one collapsed key under the gallery. It
// describes the kind of plot, never a number from a run — the numbers stay in the run's own files.
export type AnalysisCategory = "structure" | "dynamics" | "ensemble" | "energy" | "other";
export interface AnalysisInfo { name: string; category: AnalysisCategory; shows: string }
export const ANALYSIS_CATEGORIES: AnalysisCategory[] = ["structure", "dynamics", "ensemble", "energy"];
export const ANALYSIS_CATALOG: Record<string, AnalysisInfo> = {
  rmsd:    { name: "Backbone RMSD", category: "structure", shows: "Backbone RMSD to the starting structure against time" },
  rg:      { name: "Radius of gyration", category: "structure", shows: "Radius of gyration of the protein against time" },
  sasa:    { name: "Solvent-accessible surface", category: "structure", shows: "Solvent-accessible surface area against time" },
  distmat: { name: "Cα–Cα distance matrix", category: "structure", shows: "Time-averaged pairwise Cα–Cα distance matrix" },
  rmsf:    { name: "Per-residue RMSF", category: "dynamics", shows: "Per-residue RMSF about the average structure" },
  dssp:    { name: "Secondary structure (DSSP)", category: "dynamics", shows: "DSSP secondary-structure assignment per residue against time" },
  hbond:   { name: "Hydrogen bonds", category: "dynamics", shows: "Hydrogen bonds present per frame" },
  cluster: { name: "Clustering", category: "ensemble", shows: "Frame population of each trajectory cluster" },
  pca:     { name: "Principal components (Cα)", category: "ensemble", shows: "Cα coordinate projection onto the first two principal components" },
  fel:     { name: "Free-energy landscape", category: "ensemble", shows: "Free-energy surface over the first two principal components" },
  thermo:  { name: "Temperature trace", category: "energy", shows: "Temperature from the engine output during heating" },
  mmgbsa:  { name: "MM-GBSA ΔG", category: "energy", shows: "MM-GBSA binding free energy averaged over the archived frames" },
};
export function analysisInfo(key: string): AnalysisInfo { return ANALYSIS_CATALOG[key] ?? { name: key, category: "other", shows: "" }; }
