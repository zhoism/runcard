#!/usr/bin/env python3
"""Turn a pipeline run directory into public/runs/<id>/manifest.json (+ assets).

Everything in the manifest is read from an artifact on disk; nothing is typed
in. Usage: python3 tools/extract_run.py <run_dir> <id> [--title ...]
"""
import json, re, shutil, sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def rd(p): return Path(p).read_text(errors="replace")
def jl(p): return json.loads(rd(p)) if Path(p).exists() else None

def strip_comments(text):
    # Fortran '!' starts a comment only outside quotes (restraintmask='!:WAT' is a mask, not a comment).
    return "\n".join(re.sub(r"""('[^']*'|"[^"]*")|!.*""", lambda m: m.group(1) or "", ln) for ln in text.splitlines())

def parse_cntrl(text):
    m = re.search(r"&cntrl\b(.*?)/", strip_comments(text), re.S | re.I)
    kv = {}
    if m:
        for k, v in re.findall(r"(\w+)\s*=\s*('[^']*'|\"[^\"]*\"|[^\s,/]+)", m.group(1)):
            kv[k.lower()] = v.strip("'\"")
    return kv

def outfile_facts(out_path):
    if not out_path.exists(): return {}
    t = rd(out_path)
    f = {}
    m = re.search(r"Setting random seed to\s+(\d+)", t)
    if m: f["realized_seed"] = int(m.group(1))
    m = re.search(r"Total wall time:\s+(\d+)\s+seconds", t)
    if m: f["wall_s"] = int(m.group(1))
    m = re.search(r"^\s+(Amber \d+ PMEMD)\s+(\d{4})\s*$", t, re.M)
    if m: f["engine"] = f"{m.group(1)} ({m.group(2)})"
    m = re.search(r"Release\s+(\d+)", t)
    if m: f["engine_release"] = m.group(1)
    f["finished"] = "Total wall time" in t or "FINAL RESULTS" in t
    return f

def stage_role(name, c):
    if c.get("imin") == "1": return "minimization"
    if name.startswith("heat"): return "heating"
    if name.startswith("dens") or name.startswith("equil"): return "equilibration"
    if name.startswith("prod"): return "production"
    return "dynamics"

def main():
    run = Path(sys.argv[1]).resolve(); rid = sys.argv[2]
    title = sys.argv[4] if len(sys.argv) > 4 and sys.argv[3] == "--title" else rid
    out = ROOT / "public/runs" / rid; out.mkdir(parents=True, exist_ok=True)
    s2, s3, s4, s5, s6 = (jl(run / f"s{i}.json") for i in range(2, 7))
    md = run / "md"
    build = next((run / "build").glob("*"), None)
    prep = next((run / "prep").glob("*"), None)

    # --- stages, in run.sh order ---
    run_sh = rd(md / "run.sh") if (md / "run.sh").exists() else ""
    order = re.findall(r"-i (\w+)\.in", run_sh)
    restart_from = dict(re.findall(r"-i (\w+)\.in .*? -c (\S+)", run_sh))
    stages = []
    for name in order:
        text = rd(md / f"{name}.in")
        c = parse_cntrl(text)
        facts = outfile_facts(md / f"{name}.out")
        dt = float(c.get("dt", 0) or 0); nstlim = int(float(c.get("nstlim", 0) or 0))
        st = {
            "name": name, "role": stage_role(name, c), "mdin": text, "cntrl": c,
            "restart_from": restart_from.get(name, "").replace(".rst", ""),
            "length_ps": round(dt * nstlim, 3) if c.get("imin") != "1" else None,
            "requested_seed": c.get("ig"), **facts,
        }
        v = (s4 or {}).get("validation", {}).get("stages", {}).get(name)
        if v: st["envelope"] = v
        stages.append(st)

    # --- system ---
    leap = rd(build / "leap.in") if build and (build / "leap.in").exists() else ""
    ffs = re.findall(r"source\s+leaprc\.(\S+)", leap)
    box = re.search(r"solvate(\w+)\s+\S+\s+(\S+)\s+([\d.]+)", leap)
    ligres = re.search(r"^\S+\s*=\s*loadmol2\s+(\w+)\.mol2", leap, re.M)
    mol2 = next(build.glob("*.mol2"), None) if build else None
    charge_method = None
    if mol2:
        lines = rd(mol2).splitlines()
        charge_method = lines[4].strip() if len(lines) > 4 else None
    v3 = (s3 or {}).get("validation", {}); v2 = (s2 or {}).get("validation", {})
    system = {
        "protein": {"atoms": v3.get("protein_atoms"), "source_pdb": (build / "protein_in.pdb").name if build and (build/"protein_in.pdb").exists() else None},
        "ligand": {"resname": ligres.group(1) if ligres else None, "atoms": v2.get("atom_count"),
                   "atom_types": v2.get("atom_types"), "charge_method": charge_method,
                   "net_charge": v2.get("charge_sum"), "frcmod_missing": v2.get("frcmod_missing")},
        "solvent": {"box": box.group(1) if box else None, "model": box.group(2) if box else None,
                    "buffer_A": float(box.group(3)) if box else None,
                    "residues_added": v3.get("solvent_residues_added"),
                    "solvated_atoms": v3.get("solvated_atoms"), "dry_atoms": v3.get("dry_atoms")},
        "force_fields": ffs, "leap_in": leap,
    }

    # --- results ---
    results = {}
    mm = run / "analysis/mmgbsa/mmgbsa.dat"
    if mm.exists():
        t = rd(mm)
        dt_ = re.search(r"DELTA TOTAL\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)", t)
        fr = re.search(r"using ([\d.]+) complex frames", t)
        gb = parse_cntrl(rd(run / "analysis/mmgbsa/mmgbsa.in").replace("&gb", "&cntrl")) if (run/"analysis/mmgbsa/mmgbsa.in").exists() else {}
        warns = []
        if "INCONSISTENCIES EXIST WITHIN INTERNAL POTENTIAL" in t:
            warns.append("MMPBSA.py: INCONSISTENCIES EXIST WITHIN INTERNAL POTENTIAL TERMS. THE VALIDITY OF THESE RESULTS ARE HIGHLY QUESTIONABLE")
        ver = re.search(r"MMPBSA.py Version=(\S+)", t)
        results["mmgbsa"] = {
            "delta_total_kcal_mol": float(dt_.group(1)), "frame_std": float(dt_.group(2)), "frame_sem": float(dt_.group(3)),
            "frames": float(fr.group(1)) if fr else None, "igb": gb.get("igb"), "saltcon": gb.get("saltcon"),
            "trajectory": "single (complex trajectory; receptor/ligand extracted)",
            "run_on": (re.search(r"Run on (.+)", t) or [None, None])[1],
            "mmpbsa_version": ver.group(1) if ver else None, "warnings": warns,
        }
    analyses = {}
    for k, a in ((s5 or {}).get("outputs", {}).get("analyses", {})).items():
        png = Path(a.get("png", ""))
        if png.exists():
            shutil.copy(png, out / f"{k}.png"); analyses[k] = {"png": f"{k}.png", "ok": a.get("ok")}
    summ = run / "plip/interaction_summary.txt"
    if s6:
        o = s6.get("outputs", {})
        results["plip"] = {"frame": o.get("frame"), "ligand": o.get("ligand"),
                           "interactions": {k: v for k, v in o.get("interactions", {}).items() if v}}
    elif summ.exists():
        t = rd(summ)
        fr = re.search(r"frame: (\w+) \(index (\d+)/(\d+)\)", t)
        lig = re.search(r"ligand (\w+) \(chain (\w), pos (\d+)\)", t)
        inter = {k: [{"residue": r} for r in v.split(", ")] for k, _n, v in re.findall(r"^\s+(\w+)\s+(\d+)\s+(.+)$", t, re.M)}
        results["plip"] = {"frame": {"policy": fr.group(1), "index": int(fr.group(2)), "nframes": int(fr.group(3))} if fr else None,
                           "ligand": {"hetid": lig.group(1), "chain": lig.group(2), "position": lig.group(3)} if lig else None,
                           "interactions": inter, "source": "plip/interaction_summary.txt"}
    if "plip" in results:
        ip = run / "plip/interactions.png"
        if ip.exists(): shutil.copy(ip, out / "plip.png"); analyses["plip"] = {"png": "plip.png", "ok": True}

    # --- structure for the viewer: cluster medoid (dry complex) ---
    rep = run / "analysis/cluster/rep.c0.pdb"
    structure = None
    if rep.exists(): shutil.copy(rep, out / "structure.pdb"); structure = "structure.pdb"

    # --- environment ---
    lock = ROOT.parent / "project-prime/env.lock.yml"
    env = {}
    if lock.exists():
        for k in ("ambertools", "python", "numpy", "openmm", "parmed", "cpptraj"):
            m = re.search(rf"^\s+- {k}=(\S+)", rd(lock), re.M)
            if m: env[k] = m.group(1)
    eng = next((s.get("engine") for s in stages if s.get("engine")), None)
    manifest = {
        "id": rid, "title": title, "schema": "runcard/0.2", "engine": "amber",
        "source": {"run_dir": run.name, "extracted": date.today().isoformat()},
        "system": system, "stages": stages, "results": results, "analyses": analyses,
        "structure": structure,
        "environment": {"conda_lock": env, "pmemd": eng, "conda_lock_file": "env.lock.yml"},
        "pipeline": {"stage_envelopes": {f"s{i}": (x or {}).get("ok") for i, x in zip(range(2, 7), (s2, s3, s4, s5, s6)) if x is not None},
                     "skills": [x.get("skill") for x in (s2, s3, s4, s5, s6) if x]},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    print(rid, len(stages), "stages", results.get("mmgbsa", {}).get("delta_total_kcal_mol"))

if __name__ == "__main__": main()
