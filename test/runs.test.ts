import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyEdits, makeProposal, diffRuns, ensemble, explainResult, rerunBundle, systemKey, systemFingerprint, signClaim, paramClass, LONG_RUN_MIN_PS, uncertaintyFromFrames, internalResidual } from "../src/lib/runs";
import { mean, sd } from "../src/lib/stats";
import { execFileSync } from "node:child_process";
const load = (id: string) => JSON.parse(readFileSync(`public/runs/${id}/manifest.json`, "utf8"));
const idx = JSON.parse(readFileSync("public/runs/index.json", "utf8"));
const A = load("1l2y-regression"), B = load("1l2y-rep4"), C = load("3htb-jz4");

describe("applyEdits", () => {
  it("replaces an existing key in place and appends a missing one", () => {
    const out = applyEdits("t\n &cntrl\n  dt=0.002, cut=9.0,\n /\n", { dt: "0.001", iwrap: "1" });
    expect(out).toContain("dt=0.001,"); expect(out).toContain("cut=9.0"); expect(out).toContain("iwrap=1,");
  });
  it("does not touch a key inside a quoted mask", () => {
    const out = applyEdits(" &cntrl\n restraintmask='!:WAT', dt=0.002,\n /\n", { dt: "0.004" });
    expect(out).toContain("restraintmask='!:WAT'"); expect(out).toContain("dt=0.004");
  });
});
describe("proposal", () => {
  it("validates before/after; a bad edit is caught by the validator", () => {
    const p = makeProposal(A, "product", { dt: "0.004" }, "test");
    expect(p.before.hasFail).toBe(false); expect(p.after.hasFail).toBe(true);
  });
  it("rejects non-editable keys", () => { expect(() => makeProposal(A, "product", { restraintmask: "x" }, "")).toThrow(); });
});
describe("diff/ensemble", () => {
  it("same system → seed/length explanation; different system → not comparable", () => {
    const d = diffRuns(A, B, idx); expect(d.same_system).toBe(true); expect(d.stages.find(s => s.stage === "product")!.changes.some(c => c.key === "nstlim")).toBe(true);
    expect(d.material_classes).toEqual(["sampling_length"]); expect(d.interpretation).toMatch(/production length/);
    const e = diffRuns(A, C, idx); expect(e.same_system).toBe(false); expect(e.system.some(s => s.field === "ligand")).toBe(true);
  });
  it("fingerprint: equal across the 9 1L2Y runs, different for 3HTB, and index ≡ manifest", () => {
    const fps = new Set(idx.filter((r: any) => r.id.startsWith("1l2y")).map((r: any) => systemFingerprint(r.system)));
    expect(fps.size).toBe(1); expect(systemFingerprint(systemKey(C))).not.toBe([...fps][0]);
    for (const r of idx) expect(systemFingerprint(r.system)).toBe(systemFingerprint(systemKey(load(r.id))));
  });
  it("ensemble: all 9 1L2Y runs, long stratum ≥ 10 ps is smaller, all ΔG < 0", () => {
    const e = ensemble(idx, "1l2y-regression"); expect(e.all.n).toBe(9); expect(e.all.max).toBeLessThan(0);
    expect(LONG_RUN_MIN_PS).toBe(10); expect(e.long.n).toBe(5); expect(e.long.runs.every(r => r.production_ps >= 10)).toBe(true);
    expect(explainResult(A, idx).run_to_run.all.n).toBe(9);
  });
  it("sign claim is computed from the data", () => {
    const st = (g: number[]) => ({ n: g.length, mean: 0, sd: 0, min: Math.min(...g), max: Math.max(...g), negative: g.filter(x => x < 0).length, runs: [] });
    expect(signClaim(st([-1, -2, -3]))).toMatch(/^all 3 independent runs give ΔG < 0/);
    expect(signClaim(st([-1, 2, -3]))).toMatch(/^2 of 3 runs/); expect(signClaim(st([1, 2]))).toMatch(/^none/); expect(signClaim(st([-1]))).toMatch(/n < 3/);
  });
  it("materiality by class", () => {
    expect(paramClass("nstlim")).toBe("sampling_length"); expect(paramClass("ntwx")).toBe("output_cadence"); expect(paramClass("dt")).toBe("physics"); expect(paramClass("ig")).toBe("stochastic");
  });
  it("index.json is what tools/build_index.py produces", () => {
    const out = execFileSync("python3", ["-c", "import sys; sys.path.insert(0,'tools'); import build_index, json; print(json.dumps([build_index.entry(json.load(open(f'public/runs/{m}/manifest.json'))) for m in sorted(__import__('os').listdir('public/runs')) if __import__('os').path.isdir(f'public/runs/{m}')]))"]).toString();
    expect(JSON.parse(out)).toEqual(idx);
  });
});
describe("bundle", () => {
  it("pinned seed writes the realized ig; fresh keeps -1; approved edit lands", () => {
    const p = { ...makeProposal(A, "product", { nstlim: "50000" }, "longer"), status: "approved" as const };
    const f = rerunBundle(A, { seed: "pinned", target: "local", approved: [p] });
    expect(f["md/product.in"]).toMatch(/ig=\d{4,}/); expect(f["md/product.in"]).toContain("nstlim=50000");
    const g = rerunBundle(A, { seed: "fresh", target: "slurm", approved: [] });
    expect(g["md/product.in"]).toContain("ig=-1"); expect(g["run.sh"]).toContain("#SBATCH"); expect(g["run.sh"].split("\n").filter(l => l.includes("pmemd")).length).toBeGreaterThanOrEqual(6);
  });
});

describe("per-frame ΔG (Tier B)", () => {
  it("every manifest's per-frame series reproduces mmgbsa.dat's mean and population SD to 4 dp", () => {
    for (const r of idx) {
      const mm = load(r.id).results.mmgbsa; expect(mm.per_frame, r.id).toBeTruthy();
      expect(mm.per_frame.n).toBe(100); expect(mm.frames).toBe(100); expect(mm.frames_header_text).toBe("100.8");
      expect(mean(mm.per_frame.delta_total)).toBeCloseTo(mm.delta_total_kcal_mol, 4);
      expect(sd(mm.per_frame.delta_total, 0)).toBeCloseTo(mm.frame_std, 4);
      expect(mm.per_frame.reproduces).toEqual({ delta_total_mean: true, sd_ddof0: true, checked_against: "mmgbsa.dat DELTA TOTAL" });
    }
  });
  it("uncertainty: corrected SEM ≥ naive, N_eff < N, thresholds stated", () => {
    const u = uncertaintyFromFrames(load("1l2y-rep4").results.mmgbsa.per_frame, 30);
    expect(u.per_frame_sem).toBeCloseTo(0.1711, 4); expect(u.corrected_sem).toBeGreaterThanOrEqual(u.per_frame_sem);
    expect(u.n_eff).toBeLessThanOrEqual(100); expect(u.frame_interval_ps).toBe(0.3); expect(u.thresholds.drifting_if).toContain("2");
    expect(["converged", "drifting", "no drift detected", "too short to judge"]).toContain(u.verdict);
  });
  it("internal residual: DIHED dominates on 1l2y-rep4, magnitude tiny vs ΔG", () => {
    const mm = load("1l2y-rep4").results.mmgbsa; const r = internalResidual(mm.per_frame, mm.delta_total_kcal_mol);
    expect(r.dominant_term).toBe("DIHED"); expect(r.total.max_abs).toBeLessThan(0.2); expect(r.fraction_of_delta_g).toBeLessThan(1e-3);
    expect(r.by_term.BOND.max_abs).toBeLessThanOrEqual(0.0002);
  });
  it("explain_result carries numbers, not adjectives", () => {
    const e = explainResult(A, idx) as any;
    expect(e.uncertainty.corrected_sem).toBeGreaterThan(0); expect(e.which_uncertainty_to_quote).toMatch(/Quote ±0\.66 kcal\/mol/);
    expect(e.warning_note).toMatch(/kcal\/mol per frame/); expect(e.sign_claim.all_runs).toMatch(/^all 9/);
  });
});
