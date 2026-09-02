/** What the prepared systems are, in words a visitor can read. Reference facts about the PDB entries and the ligands,
    not measurements: nothing here is a number the page argues from. Keyed by the PDB id the run titles carry. */
export interface SystemInfo { pdb: string; protein: string; protein_note: string; ligands: Record<string, string> }
export const SYSTEM_CATALOG: Record<string, SystemInfo> = {
  "1L2Y": { pdb: "1L2Y", protein: "Trp-cage", protein_note: "a 20-residue designed miniprotein", ligands: { MOL: "indole" } },
  "3HTB": { pdb: "3HTB", protein: "T4 lysozyme L99A/M102Q", protein_note: "an engineered cavity mutant", ligands: { JZ4: "2-propylphenol" } },
};
/** "Trp-cage, a 20-residue designed miniprotein (PDB 1L2Y), with indole bound." — null when the title names no catalogued PDB id. */
export function describeSystem(title: string, ligand: string): { name: string; sentence: string; protein: string; ligand: string } | null {
  const pdb = Object.keys(SYSTEM_CATALOG).find(k => title.toUpperCase().includes(k));
  if (!pdb) return null;
  const s = SYSTEM_CATALOG[pdb]; const lig = s.ligands[ligand] ?? ligand;
  return { name: `${s.protein} · ${lig}`, sentence: `${s.protein}, ${s.protein_note} (PDB ${pdb}), with ${lig} bound.`, protein: s.protein, ligand: lig };
}
