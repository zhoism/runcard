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
    # pmemd prints "Total wall time: N seconds"; sander prints "| Elapsed(s) = N" / "| Total time".
    m = re.search(r"Total wall time:\s+(\d+)\s+seconds", t)
    if m: f["wall_s"] = int(m.group(1))
    else:
        m = re.search(r"^\|\s*Elapsed\(s\)\s*=\s*([\d.]+)", t, re.M)
        if m: f["wall_s"] = int(float(m.group(1)))
    m = re.search(r"^\s+(Amber \d+ [A-Z][A-Za-z.]*)\s+(\d{4})\s*$", t, re.M)
    if m: f["engine"] = f"{m.group(1)} ({m.group(2)})"
    m = re.search(r"Release\s+(\d+)", t)
    if m: f["engine_release"] = m.group(1)
    f["finished"] = "Total wall time" in t or "FINAL RESULTS" in t or "Elapsed(s)" in t
    return f


GB_TERMS = ["BOND", "ANGLE", "DIHED", "VDWAALS", "EEL", "1-4 VDW", "1-4 EEL", "EGB", "ESURF"]

def parse_gb_mdout(path):
    """Per-frame energy terms from an MMPBSA.py _MMPBSA_<part>_gb.mdout.0 file: one dict of lists, 100 entries each."""
    t = rd(path)
    blocks = re.split(r"^Processing frame \d+\s*$", t, flags=re.M)[1:]
    terms = {k: [] for k in GB_TERMS}
    for b in blocks:
        kv = dict((k.strip(), float(v)) for k, v in re.findall(r"(BOND|ANGLE|DIHED|VDWAALS|EEL|EGB|1-4 VDW|1-4 EEL|RESTRAINT|ESURF)\s*=\s*(-?[\d.]+)", b))
        for k in GB_TERMS: terms[k].append(kv[k])
    return terms

def parse_surf(path):
    """SASA (Å²) per frame from _MMPBSA_<part>_gb_surf.dat.0 (header '#Frame SA_00001', then 'frame  SASA')."""
    return [float(ln.split()[1]) for ln in rd(path).splitlines() if ln.strip() and not ln.startswith("#")]

def parse_mmpbsa_info(path):
    t = rd(path); info = {}
    for k in ("startframe", "endframe", "interval", "surften", "surfoff", "igb", "saltcon", "receptor_mask", "ligand_mask", "molsurf", "entropy"):
        m = re.search(rf"^INPUT\['{k}'\]\s*=\s*(.+)$", t, re.M)
        if m: info[k] = m.group(1).strip().strip("'")
    m = re.search(r"^numframes\s*=\s*(\d+)", t, re.M)
    if m: info["numframes"] = int(m.group(1))
    return info

def gb_radii(run):
    """The GB radii set the archived MM-GBSA actually used, read from the prmtop MMPBSA.py was handed.
    _MMPBSA_info names it (FILES.complex_prmtop, relative to analysis/mmgbsa); the prmtop's
    %FLAG RADIUS_SET line carries the set's name with its token in parentheses — "modified Bondi
    radii (mbondi)". mbondi vs mbondi2 moved this repo's 1L2Y ΔG by 0.47 kcal/mol when the generated
    rerun script hardcoded the wrong one, so this is read from the artifact or left absent, never guessed.
    Returns (token, source_relpath) or (None, None)."""
    mmdir = run / "analysis/mmgbsa"
    top = None
    info = mmdir / "_MMPBSA_info"
    if info.exists():
        m = re.search(r"^FILES\.complex_prmtop\s*=\s*'(.+)'$", rd(info), re.M)
        if m and (mmdir / m.group(1)).exists(): top = (mmdir / m.group(1)).resolve()
    if top is None and (run / "analysis/comp_dry.top").exists(): top = run / "analysis/comp_dry.top"
    if top is None: return None, None
    m = re.search(r"%FLAG RADIUS_SET\s*\n%FORMAT\([^)]*\)\s*\n(.+)", rd(top))
    tok = re.search(r"\(([a-z0-9]+)\)\s*$", m.group(1).strip()) if m else None
    try: src = str(top.resolve().relative_to(run.resolve()))
    except ValueError: src = top.name
    return (tok.group(1) if tok else None), src

def per_frame_gb(mmdir, dat_text):
    """Reconstruct per-frame ΔG from the three per-part mdout files + SASA. Returns None unless it reproduces
    mmgbsa.dat's DELTA TOTAL mean (4 dp) and population SD (4 dp) — a number is a claim."""
    parts = {}
    for part in ("complex", "receptor", "ligand"):
        md_ = mmdir / f"_MMPBSA_{part}_gb.mdout.0"; sf = mmdir / f"_MMPBSA_{part}_gb_surf.dat.0"
        if not (md_.exists() and sf.exists()): return None, "per-part mdout/surf files absent"
        parts[part] = parse_gb_mdout(md_); parts[part]["_sasa"] = parse_surf(sf)
    info = parse_mmpbsa_info(mmdir / "_MMPBSA_info") if (mmdir / "_MMPBSA_info").exists() else {}
    surften = float(info.get("surften", 0.0072)); surfoff = float(info.get("surfoff", 0.0))
    n = len(parts["complex"]["BOND"])
    if any(len(parts[p][k]) != n for p in parts for k in GB_TERMS + ["_sasa"]): return None, "frame counts differ between parts"
    for p in parts:
        if all(v == 0.0 for v in parts[p]["ESURF"]):  # gbsa=0 in mmpbsa_py_energy: ESURF comes from cpptraj SASA
            parts[p]["ESURF"] = [surften * a + surfoff for a in parts[p]["_sasa"]]
    delta = {k: [parts["complex"][k][i] - parts["receptor"][k][i] - parts["ligand"][k][i] for i in range(n)] for k in GB_TERMS}
    total = [sum(delta[k][i] for k in GB_TERMS) for i in range(n)]
    mean = sum(total) / n; sd0 = (sum((x - mean) ** 2 for x in total) / n) ** 0.5
    m = re.search(r"DELTA TOTAL\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)", dat_text)
    want_mean, want_sd = float(m.group(1)), float(m.group(2))
    ok_mean, ok_sd = abs(round(mean, 4) - want_mean) < 1e-4 + 1e-9, abs(round(sd0, 4) - want_sd) < 1e-4 + 1e-9
    if not (ok_mean and ok_sd):
        return None, f"MISMATCH: per-frame mean {mean:.4f} vs dat {want_mean}; sd(ddof=0) {sd0:.4f} vs dat {want_sd}"
    r4 = lambda xs: [round(x, 4) for x in xs]
    return {
        "n": n, "terms": {k: r4(delta[k]) for k in GB_TERMS}, "delta_total": r4(total),
        "source": ["_MMPBSA_{complex,receptor,ligand}_gb.mdout.0", "_MMPBSA_{complex,receptor,ligand}_gb_surf.dat.0", "_MMPBSA_info"],
        "esurf_formula": f"surften*SASA+surfoff with surften={surften}, surfoff={surfoff}",
        "reproduces": {"delta_total_mean": True, "sd_ddof0": True, "checked_against": "mmgbsa.dat DELTA TOTAL"},
    }, info

def pdb_atoms(p):
    """Atom count of a PDB written by MMPBSA.py's topology split (dry, post-leap, hydrogens included)."""
    if not p.exists(): return None
    return sum(1 for l in rd(p).splitlines() if l.startswith(("ATOM", "HETATM"))) or None


def system_from_artifacts(run, mol2):
    """Composition read from a run's own files, for runs built outside the s*.json pipeline.

    Returns {field: (value, source_file)} so the caller can record provenance for exactly the fields it
    actually takes from here — a field filled from an artifact and a field filled by the build pipeline must
    not claim the same source. ligand atoms / gaff2 types / net charge come from the mol2 leap.in loads;
    protein and dry-complex atom counts from the topology split MMPBSA.py writes; solvated atoms from NATOM.
    Anything not present stays absent — solvent residues_added needs leap.log, which a bundle rerun does not
    produce, and guessing it would put a number on the card that no file in the run supports."""
    out = {}
    if mol2 and mol2.exists():
        t = rd(mol2)
        if "@<TRIPOS>ATOM" in t:
            rows = [l.split() for l in t.split("@<TRIPOS>ATOM")[1].split("@<TRIPOS>")[0].strip().splitlines()]
            rows = [r for r in rows if len(r) >= 9]
            if rows:
                out["ligand_atoms"] = (len(rows), mol2.name)
                out["atom_types"] = (sorted({r[5].split(".")[0] for r in rows}), mol2.name)
                # mol2 partial charges sum to the formal charge up to print precision; leap uses the integer
                out["net_charge"] = (round(sum(float(r[8]) for r in rows)), mol2.name)
    mmdir = run / "analysis/mmgbsa"
    rec, cx = pdb_atoms(mmdir / "_MMPBSA_receptor.pdb"), pdb_atoms(mmdir / "_MMPBSA_complex.pdb")
    if rec: out["protein_atoms"] = (rec, "_MMPBSA_receptor.pdb")
    if cx: out["dry_atoms"] = (cx, "_MMPBSA_complex.pdb")
    # every stage .out reports the same NATOM for a given topology; name the file actually read, not "the run"
    first = next(iter(sorted((run / "md").glob("*.out"))), None)
    if first:
        m = re.search(r"NATOM\s*=\s*(\d+)", rd(first))
        if m: out["solvated_atoms"] = (int(m.group(1)), f"{first.name} NATOM")
    return out


def stage_role(name, c):
    if c.get("imin") == "1": return "minimization"
    if name.startswith("heat"): return "heating"
    if name.startswith("dens") or name.startswith("equil"): return "equilibration"
    if name.startswith("prod"): return "production"
    return "dynamics"

def main():
    if sys.argv[1] == "--patch-radii":
        # Insert results.mmgbsa.radii into an existing manifest from the run dir's own artifacts,
        # touching nothing else — the full extractor rerun would legitimately refresh other fields
        # and drown this one-field change in diff noise. Same reader as extraction; still never typed.
        run = Path(sys.argv[2]).resolve(); rid = sys.argv[3]
        mf = ROOT / "public/runs" / rid / "manifest.json"
        manifest = json.loads(mf.read_text())
        tok, src = gb_radii(run)
        if not tok: print(f"{rid}: no radii recoverable — manifest untouched", file=sys.stderr); return
        mm = manifest["results"]["mmgbsa"]
        rebuilt = {}
        for k, v in mm.items():
            rebuilt[k] = v
            if k == "saltcon": rebuilt["radii"] = tok; rebuilt["radii_source"] = f"{src} %FLAG RADIUS_SET"
        manifest["results"]["mmgbsa"] = rebuilt
        mf.write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
        print(rid, "radii:", tok, "from", src)
        return
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
    # Composition normally comes from the build pipeline's s2/s3 validation JSON. A run executed outside that
    # pipeline (a replicate run on someone else's cluster from a rerun bundle) has no s*.json, and every
    # composition field would land null — which drops the run out of its own system's fingerprint and so out of
    # the replication rung it exists to serve. Read the same quantities from artifacts the run does carry.
    # Never inherit them from the parent card: a number on a card is read from that run's files or it is null.
    fb = system_from_artifacts(run, mol2)
    derived = {}
    def take(pipeline_value, field):
        """Prefer what the build pipeline validated; fall back to the run's own artifact and record which file
        it came from. `is not None`, not truthiness: a net charge of 0 is a value, not a missing one."""
        if pipeline_value is not None: return pipeline_value
        if field not in fb: return None
        value, src = fb[field]; derived[field] = src
        return value
    system = {
        "protein": {"atoms": take(v3.get("protein_atoms"), "protein_atoms"), "source_pdb": (build / "protein_in.pdb").name if build and (build/"protein_in.pdb").exists() else None},
        "ligand": {"resname": ligres.group(1) if ligres else None, "atoms": take(v2.get("atom_count"), "ligand_atoms"),
                   "atom_types": take(v2.get("atom_types"), "atom_types"), "charge_method": charge_method,
                   "net_charge": take(v2.get("charge_sum"), "net_charge"),
                   "frcmod_missing": v2.get("frcmod_missing")},
        "solvent": {"box": box.group(1) if box else None, "model": box.group(2) if box else None,
                    "buffer_A": float(box.group(3)) if box else None,
                    "residues_added": v3.get("solvent_residues_added"),
                    "solvated_atoms": take(v3.get("solvated_atoms"), "solvated_atoms"),
                    "dry_atoms": take(v3.get("dry_atoms"), "dry_atoms")},
        "force_fields": ffs, "leap_in": leap,
    }
    # per field, not all-or-nothing: a partial pipeline (s2 but no s3) fills some fields from artifacts and some
    # from validation, and a card that traced all of them to the same place would be claiming a false source
    if derived: system["composition_source"] = derived

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
        pf, info = per_frame_gb(run / "analysis/mmgbsa", t)
        if pf is None: print(f"  !! {rid}: per-frame ΔG not written — {info}", file=sys.stderr); info = {}
        nframes = pf["n"] if pf else info.get("numframes")
        if pf and info.get("numframes") not in (None, pf["n"]): print(f"  !! {rid}: mdout has {pf['n']} frames but _MMPBSA_info says {info['numframes']}", file=sys.stderr)
        results["mmgbsa"] = {
            "delta_total_kcal_mol": float(dt_.group(1)), "frame_std": float(dt_.group(2)), "frame_sem": float(dt_.group(3)),
            "sd_convention": "population (ddof=0), as MMPBSA.py 14.0 reports",
            "frames": nframes, "frames_header_text": fr.group(1) if fr else None,
            "frames_note": "frame count from the per-frame mdout blocks, cross-checked with _MMPBSA_info numframes; mmgbsa.dat's header prints (endframe-startframe)/interval+1 un-floored",
            "igb": gb.get("igb"), "saltcon": gb.get("saltcon"),
            **(lambda r, srcf: {"radii": r, "radii_source": f"{srcf} %FLAG RADIUS_SET"} if r else {})(*gb_radii(run)),
            "params": {k: info[k] for k in ("startframe", "endframe", "interval", "surften", "surfoff", "receptor_mask", "ligand_mask", "entropy") if k in info},   # entropy=0 → no −TΔS term: an interaction energy, not an absolute binding free energy
            "trajectory": "single (complex trajectory; receptor/ligand extracted)",
            "run_on": (re.search(r"Run on (.+)", t) or [None, None])[1],
            "mmpbsa_version": ver.group(1) if ver else None, "warnings": warns,
            "per_frame": pf,
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
    # a run that shipped its own lock ran under that environment, not the parent pipeline's; stamping
    # project-prime's pins onto an ICE replicate would put a version on the card that never ran it
    lock = next((p for p in (run / "env.lock.yml", run / "build/env.lock.yml") if p.exists()),
                ROOT.parent / "project-prime/env.lock.yml")
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
    # --- build inputs referenced by leap.in (ligand mol2/frcmod, cleaned protein PDB): archived next to the card when the run dir has them,
    #     so a rerun bundle can carry them; whatever is not in the run dir is recorded as missing, never invented ---
    refs = re.findall(r"(?:loadmol2|loadamberparams|loadpdb)\s+(\S+)", system.get("leap_in") or "")
    present, missing = [], []
    for name in refs:
        hit = next((f for f in run.rglob(name) if "analysis" not in f.parts and f.is_file() and f.stat().st_size > 0), None)
        if hit: (out / "build").mkdir(exist_ok=True); shutil.copy(hit, out / "build" / name); present.append(name)
        else: missing.append(name)
    system["build_inputs"] = {"present": present, "missing": missing, "note": "files leap.in loads; present ones are archived under build/ and shipped in rerun bundles; missing ones were not in the run directory"}
    # --- lineage: a rerun made from a runcard bundle carries the parent card's manifest.json (with `parent` and `fork`) in its root ---
    lin = run / "manifest.json"
    if lin.exists():
        try:
            pj = json.loads(rd(lin))
            if isinstance(pj, dict) and pj.get("parent"):
                manifest["parent"] = pj["parent"]; manifest["fork"] = pj.get("fork")
                print(f"  lineage: parent {pj['parent']} ({(pj.get('fork') or {}).get('kind')})", file=sys.stderr)
        except Exception as e:  # a malformed lineage file must not break extraction; the card just has no parent
            print(f"  !! {rid}: manifest.json in the run dir is not a runcard lineage file ({e})", file=sys.stderr)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    print(rid, len(stages), "stages", results.get("mmgbsa", {}).get("delta_total_kcal_mol"))

if __name__ == "__main__": main()
