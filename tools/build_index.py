#!/usr/bin/env python3
"""Derive public/runs/index.json from the manifests. Every field is copied from a manifest;
`system` carries the fields the page hashes into a same-system fingerprint (src/lib/runs.ts)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "public/runs"
# Who published each card: site metadata (there are no accounts), the one field not read from a run directory.
OWNERS = json.loads((RUNS / "owners.json").read_text())

# &cntrl keys that define the production protocol (mirrors PARAM_CLASS physics / thermodynamic_state / restraints in src/lib/runs.ts).
PROTOCOL_KEYS = ("dt", "cut", "ntc", "ntf", "ntb", "nmropt", "temp0", "tempi", "ntt", "gamma_ln", "ntp", "pres0", "barostat", "taup", "ntr", "restraint_wt", "restraintmask")

def protocol_key(prod, mm):
    """Same string ⇒ same production protocol (sampling length, output cadence and seed excluded); plus the MM-GBSA model."""
    if not prod: return None
    c = prod["cntrl"]
    parts = [f"{k}={c[k]}" for k in PROTOCOL_KEYS if k in c] + [f"igb={mm.get('igb')}", f"saltcon={mm.get('saltcon')}"]
    return "|".join(parts)

def entry(m):
    prod = next((s for s in m["stages"] if s["role"] == "production"), None)
    sy = m["system"]; mm = m["results"].get("mmgbsa") or {}
    return {
        "protocol": protocol_key(prod, mm), "seed": prod.get("realized_seed") if prod else None,
        "id": m["id"], "title": m["title"], "owner": OWNERS["runs"].get(m["id"], OWNERS["default"]), "ligand": sy["ligand"]["resname"], "protein_atoms": sy["protein"]["atoms"],
        "production_ps": prod["length_ps"] if prod else None, "delta_g": mm.get("delta_total_kcal_mol"),
        "plip": "plip" in m["results"], "engine": m["environment"].get("pmemd") or m["engine"],
        # lineage, so the home page can draw the fork network without opening every manifest
        "parent": m.get("parent"), "fork": ({k: m["fork"].get(k) for k in ("kind", "seed", "complete")} if m.get("fork") else None),
        "system": {
            "ligand": sy["ligand"]["resname"], "ligand_atoms": sy["ligand"]["atoms"], "atom_types": sorted(sy["ligand"]["atom_types"] or []),
            "charge_method": sy["ligand"]["charge_method"], "net_charge": sy["ligand"]["net_charge"],
            "protein_atoms": sy["protein"]["atoms"], "force_fields": sy["force_fields"],
            "solvent": sy["solvent"]["model"], "box": sy["solvent"]["box"], "buffer_A": sy["solvent"]["buffer_A"],
        },
    }

def main():
    ms = [json.loads(p.read_text()) for p in sorted(RUNS.glob("*/manifest.json"))]
    idx = [entry(m) for m in ms]
    (RUNS / "index.json").write_text(json.dumps(idx, indent=1, ensure_ascii=False) + "\n")
    print(f"index.json: {len(idx)} runs")

if __name__ == "__main__": main()
