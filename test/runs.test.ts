import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { applyEdits, makeProposal, diffRuns, ensemble, explainResult, rerunBundle, systemKey, systemFingerprint, signClaim, paramClass, LONG_RUN_MIN_PS, uncertaintyFromFrames, internalResidual, loadRun, loadIndex, RunLoadError, recomputeResult, planSampling, MIN_WINDOW_FRAMES, PLAN_LENGTHS_PS } from "../src/lib/runs";
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
  it("RC-003: a duration edit re-derives the '<n> ps' in the title from nstlim·dt; other edits leave the title byte-identical", () => {
    const prod = A.stages.find((s: any) => s.role === "production"); const first = (t: string) => t.split("\n")[0];
    expect(first(prod.mdin)).toMatch(/5\.0 ps/);
    const longer = applyEdits(prod.mdin, { nstlim: "5000" });
    expect(first(longer)).toBe(first(prod.mdin).replace("5.0 ps", "10.0 ps")); expect(longer).toMatch(/nstlim=5000,/); expect(longer).toMatch(/dt=0\.002/);
    expect(longer.split("\n").slice(1).join("\n")).toBe(prod.mdin.replace(/nstlim=2500/, "nstlim=5000").split("\n").slice(1).join("\n"));
    expect(first(applyEdits(prod.mdin, { dt: "0.001" }))).toMatch(/2\.5 ps/);          // 2500 × 0.001
    expect(applyEdits(prod.mdin, { ig: "702337" }).split("\n")[0]).toBe(first(prod.mdin));   // seed pin: title untouched
    expect(applyEdits("t\n &cntrl\n  nstlim=10, dt=0.002,\n /\n", { nstlim: "20" })).toMatch(/^t\n/);   // no ps token: untouched
    const heat = A.stages.find((s: any) => s.name === "heat");                                     // its title states no duration → untouched
    expect(first(applyEdits(heat.mdin, { nstlim: String(Number(heat.cntrl.nstlim) * 2) }))).toBe(first(heat.mdin));
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
    expect(signClaim(st([-1, -2, -3]))).toMatch(/^all 3 independent runs give ΔG < 0/i);
    expect(signClaim(st([-1, 2, -3]))).toMatch(/^2 of 3 runs/); expect(signClaim(st([1, 2]))).toMatch(/^none/i); expect(signClaim(st([-1]))).toMatch(/n < 3/);
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
  it("RC-003: an approved nstlim=5000 proposal yields a product.in that says 10.0 ps, nstlim=5000, dt=0.002, pinned ig; no approved edit → archived mdin verbatim", () => {
    const prod = A.stages.find((s: any) => s.role === "production");
    const p = { ...makeProposal(A, "product", { nstlim: "5000" }, "extend to 10 ps"), status: "approved" as const };
    expect(p.mdin_after.split("\n")[0]).toMatch(/10\.0 ps/);
    const withEdit = rerunBundle(A, { seed: "pinned", target: "local", approved: [p] })["md/product.in"];
    expect(withEdit.split("\n")[0]).toMatch(/10\.0 ps/); expect(withEdit).not.toMatch(/5\.0 ps/);
    expect(withEdit).toMatch(/nstlim=5000,/); expect(withEdit).toMatch(/dt=0\.002/); expect(withEdit).toMatch(new RegExp(`ig=${prod.realized_seed}\\b`));
    expect(rerunBundle(A, { seed: "fresh", target: "local", approved: [] })["md/product.in"]).toBe(prod.mdin);
    expect(rerunBundle(A, { seed: "pinned", target: "local", approved: [] })["md/product.in"].split("\n")[0]).toBe(prod.mdin.split("\n")[0]);
  });
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
    expect(e.warning_note).toMatch(/kcal\/mol per frame/); expect(e.sign_claim.all_runs).toMatch(/^all 9/i);
  });
});

// ---- loader boundary (RC-001): mocked fetch; ids are unique per test because loadRun caches successes ----
describe("loadRun / loadIndex with mocked fetch", () => {
  const html = () => new Response("<!doctype html><html><body>fallback</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const stub = (impl: (...a: any[]) => Promise<Response>) => { const f = vi.fn(impl); vi.stubGlobal("fetch", f); return f; };
  afterEach(() => vi.unstubAllGlobals());

  it("HTML fallback (dev server, HTTP 200) → RunLoadError naming the run and list_runs, not a JSON parser message", async () => {
    const f = stub(async () => html());
    const e = await loadRun("qa-html").catch(x => x);
    expect(e).toBeInstanceOf(RunLoadError); expect(e.runId).toBe("qa-html"); expect(e.status).toBe(200);
    expect(e.message).toMatch(/run 'qa-html' could not be loaded/); expect(e.message).toMatch(/HTML page instead of JSON/); expect(e.message).toMatch(/list_runs/);
    expect(e.message).not.toMatch(/Unexpected token/);
    expect(f).toHaveBeenCalledWith("/runs/qa-html/manifest.json");
  });
  it("HTTP 404 (static host) → RunLoadError with the status", async () => {
    stub(async () => json({ error: "nope" }, 404));
    const e = await loadRun("qa-404").catch(x => x);
    expect(e).toBeInstanceOf(RunLoadError); expect(e.status).toBe(404); expect(e.message).toMatch(/no such run \(HTTP 404/); expect(e.message).toMatch(/list_runs/);
  });
  it("HTTP 500 and network failure → readable errors", async () => {
    stub(async () => json({}, 500));
    await expect(loadRun("qa-500")).rejects.toThrow(/HTTP 500/);
    stub(async () => { throw new TypeError("Failed to fetch"); });
    await expect(loadRun("qa-net")).rejects.toThrow(/network error.*Failed to fetch/);
  });
  it("valid JSON that is not a manifest → readable error", async () => {
    stub(async () => json({ hello: "world" }));
    await expect(loadRun("qa-shape")).rejects.toThrow(/not a run manifest/);
  });
  it("a failed load is not cached: the next call refetches and can succeed", async () => {
    const f = stub(vi.fn().mockResolvedValueOnce(html()).mockResolvedValueOnce(json(A)));
    await expect(loadRun("qa-retry")).rejects.toBeInstanceOf(RunLoadError);
    const m = await loadRun("qa-retry"); expect(m.id).toBe(A.id); expect(m.stages.length).toBe(A.stages.length);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("a successful load is cached: one fetch for repeated calls", async () => {
    const f = stub(async () => json(B));
    const [x, y] = await Promise.all([loadRun("qa-cached"), loadRun("qa-cached")]);
    expect(await loadRun("qa-cached")).toBe(x); expect(x).toBe(y); expect(x.id).toBe(B.id); expect(f).toHaveBeenCalledTimes(1);
  });
  it("loadIndex: HTML fallback, HTTP error, and a non-list body are readable errors; a list loads", async () => {
    stub(async () => html()); await expect(loadIndex()).rejects.toThrow(/HTML page instead of JSON/);
    stub(async () => json({}, 404)); await expect(loadIndex()).rejects.toThrow(/run index could not be loaded: HTTP 404/);
    stub(async () => json({ not: "a list" })); await expect(loadIndex()).rejects.toThrow(/not a list of runs/);
    stub(async () => json(idx)); expect((await loadIndex()).length).toBe(idx.length);
  });
});

// ---- recompute_result: re-analysis over a frame window from the archived per-frame energies ----
describe("recomputeResult", () => {
  it("full window reproduces the archived mean and SD for every run, and equals uncertaintyFromFrames", () => {
    for (const r of idx) {
      const m = load(r.id); const mm = m.results.mmgbsa; const out = recomputeResult(m, {});
      expect(out.delta_g.mean, r.id).toBeCloseTo(mm.delta_total_kcal_mol, 4);
      expect(out.delta_g.per_frame_sd, r.id).toBeCloseTo(mm.frame_std, 4);
      expect(out.window).toMatchObject({ start_frame: 1, end_frame: 100, interval: 1, frames_used: 100, of_frames: 100, full: true, discarded_ps: 0 });
      expect(Math.abs(out.vs_archived.diff)).toBeLessThan(1e-3); expect(out.vs_archived.exact_when_full_window).toBe(true);
      expect(out.uncertainty).toEqual(uncertaintyFromFrames(mm.per_frame, r.production_ps));
      expect(out.terms_sum_of_means).toBeCloseTo(out.delta_g.mean, 3);
      expect(out.provenance.mmpbsa_rerun).toBe(false); expect(out.brief).toMatch(/MMPBSA.py not rerun/);
    }
  });
  it("discard_ps converts to a 1-based start frame at this run's cadence", () => {
    const pf = A.results.mmgbsa.per_frame;
    const a = recomputeResult(A, { discard_ps: 1 });                     // 5 ps / 100 frames = 0.05 ps per frame → drop 20
    expect(a.window).toMatchObject({ start_frame: 21, end_frame: 100, frames_used: 80, discarded_ps: 1, start_ps: 1.05, end_ps: 5 });
    expect(a.delta_g.mean).toBeCloseTo(mean(pf.delta_total.slice(20)), 4);
    expect(recomputeResult(B, { discard_ps: 6 }).window.start_frame).toBe(21); // 30 ps → 0.3 ps per frame
    expect(recomputeResult(A, { discard_ps: 0 }).window.start_frame).toBe(1);
    expect(a.brief).toMatch(/^Frames 21–100 \(1.05–5 ps of 5 ps, 80 frames\)/);
  });
  it("interval keeps every k-th frame and scales the frame interval", () => {
    const pf = A.results.mmgbsa.per_frame; const out = recomputeResult(A, { interval: 2 });
    expect(out.window).toMatchObject({ frames_used: 50, frame_interval_ps: 0.1, full: false }); expect(out.uncertainty.n_frames).toBe(50);
    expect(out.delta_g.mean).toBeCloseTo(mean(pf.delta_total.filter((_: number, i: number) => i % 2 === 0)), 4);
  });
  it("rejects bad windows with messages that name the limits", () => {
    expect(() => recomputeResult(A, { start_frame: 50, end_frame: 10 })).toThrow(/start_frame 50 > end_frame 10/);
    expect(() => recomputeResult(A, { end_frame: 101 })).toThrow(/end_frame 101 > 100 frames/);
    expect(() => recomputeResult(A, { interval: 0 })).toThrow(/interval 0 < 1/);
    expect(() => recomputeResult(A, { start_frame: 5, discard_ps: 1 })).toThrow(/not both/);
    expect(() => recomputeResult(A, { interval: 100 })).toThrow(/keeps 1 frame/);
    expect(() => recomputeResult(A, { start_frame: 98 })).toThrow(new RegExp(`keeps 3 frame\\(s\\) of 100; at least ${MIN_WINDOW_FRAMES}`));
    expect(() => recomputeResult(A, { start_frame: 1.5 })).toThrow(/integer/);
    expect(() => recomputeResult({ ...A, results: { ...A.results, mmgbsa: { ...A.results.mmgbsa, per_frame: null } } }, {})).toThrow(/per-frame/);
    expect(() => recomputeResult({ ...A, results: { ...A.results, mmgbsa: undefined } }, {})).toThrow(/no MM-GBSA/);
  });
});

// ---- plan_sampling: expected sampling for a target uncertainty ----
describe("planSampling", () => {
  it("plans on the ≥10 ps stratum: n_needed = ⌈(SD/target)²⌉, suggests nstlim for a 10 ps rerun, proposes nothing", () => {
    const p = planSampling(A, idx, { target_uncertainty_kcal: 0.25 }); const e = ensemble(idx, A.id);
    expect(p.label).toBe("expected"); expect(p.run_to_run.planned_on).toBe("long");
    expect(p.run_to_run.n_needed).toBe(Math.ceil((e.long.sd! / 0.25) ** 2)); expect(p.run_to_run.n_needed).toBe(11);
    expect(p.run_to_run.additional_runs).toBe(6); expect(p.run_to_run.target_met).toBe(false);
    expect(p.recommendation).toMatch(/^expected: 6 more independent runs/);
    expect(p.recommended_run_ps).toBe(10);
    expect(p.suggested_edits).toMatchObject({ run_id: A.id, stage: "product" });
    expect(Number(p.suggested_edits!.edits.nstlim) * Number(A.stages.find((s: any) => s.role === "production").cntrl.dt)).toBeCloseTo(10, 9);
    expect(p.suggested_edits!.edits).not.toHaveProperty("ig");
    expect(p.suggested_edits!.expected_frames_analysed).toBe(200);
    expect(p.within_run.expected_sem_by_length.map((r: any) => r.length_ps)).toEqual(PLAN_LENGTHS_PS);
    expect(p.assumptions.some((a: string) => /Nothing was run/.test(a))).toBe(true);
  });
  it("a target that is already met asks for 0 more runs and no edit for a run that is already long enough", () => {
    const p = planSampling(B, idx, { target_uncertainty_kcal: 0.5 });
    expect(p.run_to_run.target_met).toBe(true); expect(p.run_to_run.additional_runs).toBe(0);
    expect(p.recommendation).toMatch(/already met/); expect(p.suggested_edits).toBeNull(); expect(p.rerun_note).toMatch(/seed='fresh'/);
  });
  it("single run of its system: no run-to-run plan, within-run projection only, nstlim for 10 ps", () => {
    const p = planSampling(C, idx, {});
    expect(p.target_uncertainty_kcal).toBe(0.25); expect(p.run_to_run.planned_on).toBeNull(); expect(p.run_to_run.n_needed).toBeNull();
    expect(p.recommendation).toMatch(/only run of its prepared system/); expect(p.within_run.expected_length_for_target_ps).toBeGreaterThan(0);
    expect(p.suggested_edits!.edits.nstlim).toBe("5000");
  });
  it("the within-run projection reproduces this run's corrected SEM at its current length, for every run", () => {
    for (const r of idx) { const p = planSampling(load(r.id), idx, {}); expect(p.within_run.at_current_length.expected_sem, r.id).toBeCloseTo(p.within_run.this_run.corrected_sem, 3); }
  });
  it("rejects non-positive targets and lengths", () => {
    expect(() => planSampling(A, idx, { target_uncertainty_kcal: 0 })).toThrow(/> 0/);
    expect(() => planSampling(A, idx, { target_uncertainty_kcal: -1 })).toThrow(/> 0/);
    expect(() => planSampling(A, idx, { min_run_ps: 0 })).toThrow(/min_run_ps/);
  });
});

describe("review batch 2026-08-29 (workflow findings)", () => {
  it("two approved proposals on one stage compose, oldest first; both land in the .in", () => {
    const p1 = { ...makeProposal(A, "product", { dt: "0.001" }, "smaller step"), status: "approved" as const };
    const p2 = { ...makeProposal(A, "product", { nstlim: "5000" }, "longer"), status: "approved" as const };
    const f = rerunBundle(A, { seed: "fresh", target: "local", approved: [p2, p1] });   // store order: newest first
    expect(f["md/product.in"]).toMatch(/dt=0\.001/); expect(f["md/product.in"]).toMatch(/nstlim=5000/);
    expect(f["md/product.in"].split("\n")[0]).toMatch(/5\.0 ps/);                         // 5000 × 0.001, retitled from the composed text
  });
  it("proposal ids are unique within one millisecond", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeProposal(A, "product", { nstlim: "5000" }, "x").id));
    expect(ids.size).toBe(50);
  });
  it("SLURM run.sh keeps the shebang first, #SBATCH directives after it", () => {
    const lines = rerunBundle(A, { seed: "fresh", target: "slurm", approved: [] })["run.sh"].split("\n");
    expect(lines[0]).toBe("#!/usr/bin/env bash"); expect(lines[1]).toMatch(/^#SBATCH/);
  });
  it("rerunBundle rejects off-enum seed/target instead of silently defaulting", () => {
    expect(() => rerunBundle(A, { seed: "Pinned" as any, target: "local", approved: [] })).toThrow(/seed must be/);
    expect(() => rerunBundle(A, { seed: "fresh", target: undefined as any, approved: [] })).toThrow(/target must be/);
  });
  it("propose_change: empty, string-encoded, array and comma-smuggled edits are rejected with the shape spelled out; JSON-string form is accepted", () => {
    expect(() => makeProposal(A, "product", {} as any, "x")).toThrow(/non-empty object/);
    expect(() => makeProposal(A, "product", "dt=0.001" as any, "x")).toThrow(/non-empty object/);
    expect(() => makeProposal(A, "product", { nstlim: "5000, restraintmask='@CA'" }, "x")).toThrow(/single number or a quoted string/);
    expect(makeProposal(A, "product", JSON.stringify({ dt: "0.001" }) as any, "x").edits).toEqual({ dt: "0.001" });
    expect(() => makeProposal(A, "production", { dt: "0.001" }, "x")).toThrow(/product \(production\)/);
  });
  it("diff_runs: ΔΔG is null across different prepared systems", () => {
    expect(diffRuns(A, C, idx).same_system).toBe(false); expect(diffRuns(A, C, idx).delta_g.diff).toBeNull();
    expect(diffRuns(A, B, idx).delta_g.diff).toBeCloseTo(A.results.mmgbsa.delta_total_kcal_mol - B.results.mmgbsa.delta_total_kcal_mol, 4);
  });
  it("drift test is 2σ of the half-difference: se_of_diff ≈ 2 × full-series corrected SEM on a stationary series, threshold stated", () => {
    const u = uncertaintyFromFrames(B.results.mmgbsa.per_frame, 30);
    expect(u.halves.se_of_diff).toBeGreaterThan(1.5 * u.corrected_sem); expect(u.halves.se_of_diff).toBeLessThan(2.5 * u.corrected_sem);
    expect(u.verdict).toBe(u.halves.diff_in_sigma > 2 ? "drifting" : "no drift detected"); expect(u.thresholds.drifting_if).toMatch(/SEM₁² \+ SEM₂²/);
    for (const r of idx) { const m = load(r.id); const v = uncertaintyFromFrames(m.results.mmgbsa.per_frame, 30).verdict; expect(["drifting", "no drift detected", "too short to judge"]).toContain(v); }
  });
  it("block SEM at block 1 equals the naive per-frame SEM (same ddof)", () => {
    const u = uncertaintyFromFrames(B.results.mmgbsa.per_frame, 30);
    expect(u.block_averaging.sem_by_block[0].sem).toBeCloseTo(u.per_frame_sem, 4);
  });
  it("ensemble: single-run system gets a one-run caveat and stratum-aware sign claims; bad id names the recovery", () => {
    const e = ensemble(idx, "3htb-jz4"); expect(e.caveat).toMatch(/Only one run/); expect(e.caveat).not.toMatch(/mixes short and long/);
    expect(signClaim(e.long, "≥ 10 ps")).toBe("no runs ≥ 10 ps of this system"); expect(signClaim(e.all)).toMatch(/single run gives ΔG < 0 \(ΔG = -27/);
    expect(signClaim(ensemble(idx, "1l2y-rep4").all)).toMatch(/pinned to about ±0\.7 kcal\/mol/);
    expect(() => ensemble(idx, "nope")).toThrow(/list_runs/);
  });
  it("explain_result names the stratum, gates the 'dominates' clause on the ratio", () => {
    const e = explainResult(B, idx) as any;
    expect(e.which_uncertainty_to_quote).toMatch(/≥ 10 ps stratum alone gives ±0\.79, n=5/);
    expect(e.which_uncertainty_to_quote).toMatch(/dominates|comparable|not distinguishable/);
    const e3 = explainResult(load("1l2y-rep3"), idx) as any; expect(e3.which_uncertainty_to_quote).not.toMatch(/1\.0× the corrected SEM, so seed-to-seed variation, not frame noise, dominates/);
  });
  it("recompute_result: discard_ps beyond the run names the argument and the length", () => {
    expect(() => recomputeResult(A, { discard_ps: 100 })).toThrow(/discard_ps 100 ≥ the 5 ps production length/);
  });
});
