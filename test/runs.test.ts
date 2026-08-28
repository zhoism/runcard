import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyEdits, makeProposal, diffRuns, ensemble, explainResult, rerunBundle } from "../src/lib/runs";
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
    const e = diffRuns(A, C, idx); expect(e.same_system).toBe(false); expect(e.system.some(s => s.field === "ligand")).toBe(true);
  });
  it("ensemble counts the 9 1L2Y runs and all ΔG < 0", () => {
    const e = ensemble(idx, "1l2y-regression"); expect(e.n).toBe(9); expect(e.max).toBeLessThan(0);
    expect(explainResult(A, idx).run_to_run.n).toBe(9);
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
