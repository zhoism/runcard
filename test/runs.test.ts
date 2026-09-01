import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { applyEdits, makeProposal, diffRuns, ensemble, explainResult, rerunBundle, bundleGaps, systemKey, systemFingerprint, signClaim, paramClass, LONG_RUN_MIN_PS, uncertaintyFromFrames, internalResidual, loadRun, loadIndex, RunLoadError, recomputeResult, planSampling, MIN_WINDOW_FRAMES, PLAN_LENGTHS_PS, confidenceLadder, confidenceLadderFull, forkExperiment, forkStages, cohorts, forkNetwork, forkNetworks } from "../src/lib/runs";
import { mean, sd, round } from "../src/lib/stats";
// mmgbsa.dat prints DELTA TOTAL to 4 dp and the per-frame series is archived at the same precision, so a correct
// reconstruction still differs from the printed value by up to 5e-5 from that printing alone. toBeCloseTo(_, 4)
// tests |diff| < 5e-5, i.e. exactly on that boundary, and rejects sound runs at random. Compare at 4 dp instead,
// to one unit in the last place — the same check tools/extract_run.py gates extraction on and the ladder reports.
const reproduces4dp = (got: number, printed: number, id?: string) =>
  expect(Math.abs(round(got) - printed), id).toBeLessThanOrEqual(1e-4 + 1e-9);
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
  it("fingerprint: equal across the 13 1L2Y runs, different for 3HTB, and index ≡ manifest", () => {
    const fps = new Set(idx.filter((r: any) => r.id.startsWith("1l2y")).map((r: any) => systemFingerprint(r.system)));
    expect(fps.size).toBe(1); expect(systemFingerprint(systemKey(C))).not.toBe([...fps][0]);
    for (const r of idx) expect(systemFingerprint(r.system)).toBe(systemFingerprint(systemKey(load(r.id))));
  });
  it("ensemble: all 13 1L2Y runs, long stratum ≥ 10 ps is smaller, all ΔG < 0", () => {
    const e = ensemble(idx, "1l2y-regression"); expect(e.all.n).toBe(13); expect(e.all.max).toBeLessThan(0);
    expect(LONG_RUN_MIN_PS).toBe(10); expect(e.long.n).toBe(9); expect(e.long.runs.every(r => r.production_ps >= 10)).toBe(true);
    expect(explainResult(A, idx, true).run_to_run.all.n).toBe(13);
  });
  it("composition_source names, per field, exactly the values read from artifacts instead of the build pipeline", () => {
    // "A number is a claim": a composition value that did not come from the s*.json the build pipeline validated
    // has to say which file in the run it did come from. Per field, not all-or-nothing — a run with a partial
    // pipeline (s2 but no s3) takes some fields from each, and one shared source line would be a false trace.
    const FIELDS = ["protein_atoms", "ligand_atoms", "atom_types", "net_charge", "solvated_atoms", "dry_atoms"];
    const at = (m: any, f: string) => ({ protein_atoms: m.system.protein.atoms, ligand_atoms: m.system.ligand.atoms,
      atom_types: m.system.ligand.atom_types, net_charge: m.system.ligand.net_charge,
      solvated_atoms: m.system.solvent.solvated_atoms, dry_atoms: m.system.solvent.dry_atoms }[f]);
    let sawDerived = 0;
    for (const r of idx) {
      const cs = load(r.id).system.composition_source;
      if (cs === undefined) continue;
      sawDerived++;
      expect(Array.isArray(cs), `${r.id}: composition_source must be per-field, not a flat source list`).toBe(false);
      for (const [field, src] of Object.entries(cs)) {
        expect(FIELDS, `${r.id}: unknown composition field`).toContain(field);
        expect(typeof src, `${r.id}.${field}`).toBe("string");
        // a source may only be claimed for a value that is actually on the card
        expect(at(load(r.id), field), `${r.id}.${field} is sourced but null`).not.toBeNull();
      }
    }
    expect(sawDerived, "the ICE replicates carry artifact-derived composition").toBe(4);
    // runs built by the pipeline claim no artifact source, because none of their composition came from one
    expect(load("1l2y-rep4").system.composition_source).toBeUndefined();
  });
  it("cohorts: index groups by prepared system + protocol; largest cohort first, longest run first and marked start_here; single run keeps its title and has no SD", () => {
    const cs = cohorts(idx); expect(cs).toHaveLength(2);
    const [a, b] = cs;
    expect(a.n).toBe(13); expect(a.title).toBe("1L2Y + MOL"); expect(a.runs[0].id).toBe("1l2y-rep4"); expect(a.runs.map(r => r.id)).toHaveLength(13);
    expect(a.lengths_ps).toEqual([2, 5, 10, 20, 30]); expect(a.sd).toBeCloseTo(0.645, 2); expect(a.mean).toBeCloseTo(ensemble(idx, "1l2y-rep4").all.mean!, 6); expect(a.start_here).toBe("1l2y-rep4");
    for (let i = 1; i < a.runs.length; i++) expect(a.runs[i - 1].production_ps >= a.runs[i].production_ps).toBe(true);
    expect(b.n).toBe(1); expect(b.title).toBe("3HTB + JZ4"); expect(b.sd).toBeNull(); expect(b.mean).toBeCloseTo(-27.4121, 4); expect(b.lengths_ps).toEqual([5]); expect(b.start_here).toBeNull();
    expect(cohorts([])).toEqual([]);
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
      reproduces4dp(mean(mm.per_frame.delta_total), mm.delta_total_kcal_mol, r.id);
      reproduces4dp(sd(mm.per_frame.delta_total, 0), mm.frame_std, r.id);
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
    const e = explainResult(A, idx, true) as any;
    expect(e.uncertainty.corrected_sem).toBeGreaterThan(0); expect(e.which_uncertainty_to_quote).toMatch(/Quote ±0\.64 kcal\/mol — the observed run-to-run spread .* mixed production lengths/); expect(e.which_uncertainty_to_quote).toMatch(/matched-length SD .*: 5 ps: n=3, SD ±/);
    expect(e.warning_note).toMatch(/kcal\/mol per frame/); expect(e.sign_claim.all_runs).toMatch(/^all 13/i);
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
    const e: any = await loadRun("qa-net").catch(x => x); expect(e.message).toMatch(/not an unknown run id — retry/); expect(e.message).not.toMatch(/list_runs/);   // a transport failure must not say "check your ids"
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
      reproduces4dp(out.delta_g.mean, mm.delta_total_kcal_mol, r.id);
      reproduces4dp(out.delta_g.per_frame_sd, mm.frame_std, r.id);
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
    const p = planSampling(A, idx, { target_uncertainty_kcal: 0.25, detail: true }); const e = ensemble(idx, A.id);
    expect(p.label).toBe("expected"); expect(p.run_to_run.planned_on).toBe("long");
    expect(p.run_to_run.n_needed).toBe(Math.ceil((e.long.sd! / 0.25) ** 2)); expect(p.run_to_run.n_needed).toBe(8);
    // the four ICE replicates take the ≥10 ps stratum to n=9, past the 8 this target needs, so it is now met
    expect(p.run_to_run.additional_runs).toBe(0); expect(p.run_to_run.target_met).toBe(true);
    expect(p.recommendation).toMatch(/^expected: target ±0\.25 kcal\/mol on the ensemble mean is already met on the long stratum \(n=9/);
    expect(p.recommended_run_ps).toBe(10);
    expect(p.suggested_edits).toMatchObject({ run_id: A.id, stage: "product" });
    expect(Number(p.suggested_edits!.edits.nstlim) * Number(A.stages.find((s: any) => s.role === "production").cntrl.dt)).toBeCloseTo(10, 9);
    expect(p.suggested_edits!.edits).not.toHaveProperty("ig");
    expect(p.suggested_edits!.expected_frames_analysed).toBe(200);
    expect(p.within_run.expected_sem_by_length.map((r: any) => r.length_ps)).toEqual(PLAN_LENGTHS_PS);
    expect(p.assumptions.some((a: string) => /Nothing was run/.test(a))).toBe(true);
  });
  it("a target that is already met asks for 0 more runs and no edit for a run that is already long enough", () => {
    const p = planSampling(B, idx, { target_uncertainty_kcal: 0.5, detail: true });
    expect(p.run_to_run.target_met).toBe(true); expect(p.run_to_run.additional_runs).toBe(0);
    expect(p.recommendation).toMatch(/already met/); expect(p.suggested_edits).toBeNull(); expect(p.rerun_note).toMatch(/seed='fresh'/);
  });
  it("single run of its system: no run-to-run plan, within-run projection only, nstlim for 10 ps", () => {
    const p = planSampling(C, idx, { detail: true });
    expect(p.target_uncertainty_kcal).toBe(0.25); expect(p.run_to_run.planned_on).toBeNull(); expect(p.run_to_run.n_needed).toBeNull();
    expect(p.recommendation).toMatch(/only run of its prepared system/); expect(p.within_run.expected_length_for_target_ps).toBeGreaterThan(0);
    expect(p.suggested_edits!.edits.nstlim).toBe("5000");
  });
  it("the within-run projection reproduces this run's corrected SEM at its current length, for every run", () => {
    for (const r of idx) { const p = planSampling(load(r.id), idx, { detail: true }); expect(p.within_run.at_current_length.expected_sem, r.id).toBeCloseTo(p.within_run.this_run.corrected_sem, 3); }
  });
  it("rejects non-positive targets and lengths", () => {
    expect(() => planSampling(A, idx, { target_uncertainty_kcal: 0, detail: true })).toThrow(/> 0/);
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
    expect(signClaim(ensemble(idx, "1l2y-rep4").all)).toMatch(/observed seed-to-seed SD is ±0\.6 kcal\/mol in this short, mixed-length ensemble \(2–30 ps/);
    expect(() => ensemble(idx, "nope")).toThrow(/list_runs/);
  });
  it("explain_result names the stratum, gates the 'dominates' clause on the ratio", () => {
    const e = explainResult(B, idx, true) as any;
    expect(e.which_uncertainty_to_quote).toMatch(/≥ 10 ps stratum alone gives ±0\.67, n=9/);
    expect(e.which_uncertainty_to_quote).toMatch(/dominates|comparable|not distinguishable/);
    const e3 = explainResult(load("1l2y-rep3"), idx, true) as any; expect(e3.which_uncertainty_to_quote).not.toMatch(/1\.0× the corrected SEM, so seed-to-seed variation, not frame noise, dominates/);
  });
  it("recompute_result: discard_ps beyond the run names the argument and the length", () => {
    expect(() => recomputeResult(A, { discard_ps: 100 })).toThrow(/discard_ps 100 ≥ the 5 ps production length/);
  });
});

describe("review batch 2026-08-29, part 2", () => {
  it("entropy: every manifest records entropy=0 from _MMPBSA_info and explain_result states the caveat", () => {
    for (const r of idx) expect(load(r.id).results.mmgbsa.params.entropy, r.id).toBe("0");
    const e = explainResult(B, idx, true) as any;
    expect(e.entropy_term).toMatch(/not computed/); expect(e.what_it_is).toMatch(/No entropy term .* not an absolute binding free energy/);
  });
  it("plan_sampling: a drifting run gets no single-run length projection, with the reason; a stationary run keeps it", () => {
    const pA = planSampling(A, idx, { detail: true }); expect(uncertaintyFromFrames(A.results.mmgbsa.per_frame, 5).verdict).toBe("drifting");
    expect(pA.within_run.expected_length_for_target_ps).toBeNull(); expect(pA.within_run.expected_length_note).toMatch(/drifting/);
    // the invariant under test is that a drifting run is never given a projected length — asserted on within_run
    // and on the recommendation never quoting one. The "No single-run length is projected" sentence only appears
    // while the run-to-run target is unmet; with n=9 on the long stratum it is met, so the clause is not reached.
    expect(pA.recommendation).not.toMatch(/≈ \d+(\.\d+)? ps \(expected\)/);
    const pB = planSampling(B, idx, { detail: true }); expect(pB.within_run.expected_length_for_target_ps).toBeGreaterThan(0); expect(pB.within_run.expected_length_note).toBeNull();
  });
});

describe("confidence ladder", () => {
  it("rep4: recomputable and replicated verified, repeatable expected, external not assessed; robust computed over 4 windows", () => {
    const L = confidenceLadderFull(B, idx); const by = Object.fromEntries(L.rungs.map(r => [r.rung, r]));
    expect(L.rungs.map(r => r.rung)).toEqual(["recomputable", "repeatable", "independently replicated", "robust to analysis-window choices", "externally supported"]);
    expect(by["recomputable"].status).toBe("verified"); expect(by["recomputable"].evidence).toMatch(/re-derived here/); expect(L.summary).toMatch(/^3 of 4 assessable rungs verified \(recomputable, independently replicated, robust/); expect(L.summary).not.toMatch(/partly established/);
    expect(by["repeatable"].status).toBe("expected"); expect(by["repeatable"].evidence).toMatch(/3\/3 dynamics stages/);
    expect(by["independently replicated"].status).toBe("verified"); expect(by["independently replicated"].evidence).toMatch(/13 runs of the same prepared system and production protocol with distinct realized seeds/); expect(by["independently replicated"].short).toBe("seed-replicated ✓ (13 same-protocol runs, 2–30 ps) · at this run's length (30 ps): 6 of 3 needed ✓"); expect(by["independently replicated"].to_climb).toBeNull();
    // the matched-length spread is wider than the pooled one (±0.80 over six 30 ps runs vs ±0.64 pooled); the rung
    // must keep reporting it rather than letting the pooled number stand in for replication at this length
    expect(by["independently replicated"].evidence).toMatch(/Replication of this run's number at its own length \(30 ps\): 6 runs \(SD ±0\.80\)/);
    const reg = confidenceLadderFull(A, idx).rungs[2]; expect(reg.status).toBe("verified"); expect(reg.short).toMatch(/at this run's length \(5 ps\): 3 of 3 needed ✓/);
    // engine mix is disclosed wherever the runs counted at a length were not all produced by the same program: the
    // protocol key fixes &cntrl and the GB model, not the integrator, so counting a sander run in with pmemd runs
    // without saying so would rest the rung on an agreement the card never states.
    expect(by["independently replicated"].evidence).toMatch(/Engines at this length: Amber 24 SANDER \(2024\) \(4\), Amber 26 PMEMD \(2026\) \(2\) — the protocol key fixes &cntrl and the GB model, not the integrator/);
    expect(reg.evidence).not.toMatch(/Engines at this length/);  // 5 ps runs are all one engine; nothing to disclose
    const oneEngine = confidenceLadderFull(B, idx.map((r: any) => ({ ...r, engine: "Amber 26 PMEMD (2026)" })));
    expect(oneEngine.rungs[2].evidence).not.toMatch(/Engines at this length/);
    expect(["verified", "not established"]).toContain(by["robust to analysis-window choices"].status); expect(by["robust to analysis-window choices"].evidence).toMatch(/4 analysis windows re-analysed/); expect(by["robust to analysis-window choices"].evidence).toMatch(/criterion ≤ 2/);
    // The partly-established middle state is the thesis of this rung, and since the PACE-ICE replicates landed no
    // run on the site is in it any more — so it has to be constructed, or the branch (its "✗" short text and the
    // "N more runs" to_climb it generates) is executed by nothing. It is also the state every new system starts in.
    const twoAt30 = idx.filter((r: any) => r.production_ps !== 30 || ["1l2y-rep4", "1l2y-rep6"].includes(r.id));
    const partly = confidenceLadderFull(B, twoAt30).rungs[2];
    expect(partly.status).toBe("partly established");
    expect(partly.short).toBe("seed-replicated ✓ (9 same-protocol runs, 2–30 ps) · at this run's length (30 ps): 2 of 3 needed ✗");
    expect(partly.evidence).toMatch(/at its own length \(30 ps\): 2 runs — fewer than the 3 needed/);
    expect(partly.to_climb).toBe("1 more independent run at 30 ps (fork_experiment kind='replicate')");
    expect(confidenceLadderFull(B, twoAt30).summary).toMatch(/1 partly established \(independently replicated/);
    // singular/plural on the run it still needs
    const oneAt30 = idx.filter((r: any) => r.production_ps !== 30 || r.id === "1l2y-rep4");
    expect(confidenceLadderFull(B, oneAt30).rungs[2].to_climb).toBe("2 more independent runs at 30 ps (fork_experiment kind='replicate')");
    const noProto = confidenceLadderFull(B, idx.map((r: any) => ({ ...r, protocol: undefined }))); expect(noProto.rungs[2].status).toBe("not established"); expect(noProto.rungs[2].evidence).toMatch(/no protocol key/);
    expect(by["externally supported"].status).toBe("not assessed");
    expect(L.summary).toMatch(/of 4 assessable rungs verified/);
  });
  it("3htb: replicated is not established (n=1) and says so; every run's ladder has 5 rungs", () => {
    const L = confidenceLadderFull(C, idx); const rep = L.rungs.find(r => r.rung === "independently replicated")!;
    expect(rep.status).toBe("not established"); expect(rep.evidence).toMatch(/1 run of this prepared system on this site, 1 with the same production protocol/); expect(rep.to_climb).toMatch(/replicate/);
    for (const r of idx) expect(confidenceLadderFull(load(r.id), idx).rungs.length, r.id).toBe(5);
  });
});

describe("fork_experiment", () => {
  it("extend temp0 → 310 K applies to density + product, leaves the heating ramp, holds the controls, creates one pending proposal per stage", () => {
    const f = forkExperiment(B, idx, { kind: "extend", treatment: { key: "temp0", value: "310.0" }, question: "Does binding weaken at 310 K?" });
    expect(f.kind).toBe("extend"); expect(f.stages_changed).toEqual(["density", "product"]); expect(f.stages_unchanged_note).toMatch(/heat keeps its temp0 ramp/);
    expect(f.treatment!.from).toEqual({ density: "300.0", product: "300.0" }); expect(f.treatment!.to).toBe("310.0"); expect(f.treatment!.class).toBe("thermodynamic_state");
    expect(f.controls_held.join(" ")).toMatch(/dt=0\.002/); expect(f.controls_held.join(" ")).toMatch(/protein\.ff19SB/); expect(f.controls_held.join(" ")).not.toMatch(/temp0=/);
    expect(f.proposals.length).toBe(2); for (const p of f.proposals) { expect(p.after).toBe("PASS"); }
    const ps = (f as any)._proposals; expect(ps[0].fork.id).toBe(f.fork_id); expect(ps[0].status).toBe("pending"); expect(ps[1].mdin_after).toMatch(/temp0=310\.0/);
    expect(f.parent).toBe("1l2y-rep4"); expect(f.note).toMatch(/NOTHING is applied/);
    expect(f.sampling!.control.matched_length_ps).toBe(30); expect(f.sampling!.control.parent_runs_at_that_length.length).toBe(6); expect(f.sampling!.control.additional_control_runs_needed).toBe(f.sampling!.runs_per_condition! - 6); expect(f.sampling!.control.note).toMatch(/stratify the comparison by production length/);
  });
  it("extend: nstlim goes to production only; output-cadence keys and unchanged values are rejected; reproduce/replicate need no approval", () => {
    expect(forkStages(B, "nstlim")).toEqual(["product"]); expect(forkStages(B, "temp0")).toEqual(["density", "product"]);
    expect(() => forkExperiment(B, idx, { kind: "extend", treatment: { key: "ntwx", value: "10" } })).toThrow(/not a treatment variable/);
    expect(() => forkExperiment(B, idx, { kind: "extend", treatment: { key: "temp0", value: "300.0" } })).toThrow(/already 300\.0/);
    expect(() => forkExperiment(B, idx, { kind: "extend" })).toThrow(/treatment \{key, value\}/);
    expect(() => forkExperiment(B, idx, { kind: "nope" as any })).toThrow(/kind must be/);
    expect(() => forkExperiment(B, idx, { kind: "extend", treatment: { key: "temp0", value: "" } })).toThrow(/finite number/);
    expect(() => forkExperiment(B, idx, { kind: "extend", treatment: { key: "temp0", value: "NaN" } })).toThrow(/finite number/);
    expect(() => forkExperiment(B, idx, { kind: "extend", treatment: { key: "temp0", value: "310.0" }, stages: ["heat"] })).toThrow(/heat cannot receive temp0/);
    expect(() => forkExperiment(B, idx, { kind: "extend", treatment: { key: "temp0", value: "310.0" }, stages: ["min1"] })).toThrow(/cannot receive/);
    expect(forkExperiment(B, idx, { kind: "extend", treatment: { key: "temp0", value: "310.0" }, stages: ["product", "product"] }).stages_changed).toEqual(["product"]);
    expect(forkExperiment(B, idx, { kind: "reproduce" }).tests).toMatch(/if the rerun is executed and its result compared/);
    const r = forkExperiment(B, idx, { kind: "reproduce" }); expect(r.next).toEqual({ tool: "generate_rerun_bundle", input: { run_id: "1l2y-rep4", seed: "pinned", target: "local" } }); expect(r.proposals).toEqual([]);
    const p = forkExperiment(B, idx, { kind: "replicate" }); expect(p.next!.input.seed).toBe("fresh"); expect((p as any).runs_recommended.additional_runs).toBeGreaterThanOrEqual(0);
    expect((p as any).runs_recommended.why).toMatch(/sized from the observed run-to-run SD of 13 runs/);
  });
  it("replicate on a single-run site: no run-to-run estimate yet, 3 runs minimum, 2 more — never a null recommendation (RC-004 B)", () => {
    const p = forkExperiment(C, idx, { kind: "replicate" }) as any;
    expect(p.runs_recommended.now).toBe("1 run on this site");
    expect(p.runs_recommended.minimum_runs).toBe(3); expect(p.runs_recommended.additional_runs).toBe(2);
    expect(p.runs_recommended.why).toMatch(/no run-to-run estimate exists yet \(1 run\); at least 3 comparable independent runs/);
    expect(p.note).toMatch(/at least 3 comparable independent runs/);
    expect(p.note).not.toMatch(/within the run-to-run spread/);
  });
  it("an approved ig edit outranks the pinned seed instead of being silently overwritten", () => {
    const p = makeProposal(B, "product", { ig: "424242" }, "pin my own seed"); p.status = "approved";
    const pinned = rerunBundle(B, { seed: "pinned", target: "local", approved: [p] });
    expect(pinned["md/product.in"]).toMatch(/ig\s*=\s*424242/);
    expect(pinned["README.md"]).toMatch(/except where an approved change sets ig itself/);
    // every other stage still gets its realized seed
    const heat = B.stages.find(s => s.name === "heat")!;
    if (heat.realized_seed !== undefined) expect(pinned["md/heat.in"]).toMatch(new RegExp(`ig\\s*=\\s*${heat.realized_seed}`));
    // and without that approval the pinned seed still wins
    const plain = rerunBundle(B, { seed: "pinned", target: "local", approved: [] });
    expect(plain["md/product.in"]).not.toMatch(/ig\s*=\s*424242/);
  });
  it("an approved extension lands in the bundle with lineage: README ## Fork and manifest parent/fork; plain bundles record reproduce/replicate", () => {
    const f = forkExperiment(B, idx, { kind: "extend", treatment: { key: "temp0", value: "310.0" }, question: "Does binding weaken at 310 K?" });
    const approved = (f as any)._proposals.map((p: any) => ({ ...p, status: "approved" }));
    const files = rerunBundle(B, { seed: "fresh", target: "local", approved });
    expect(files["md/density.in"]).toMatch(/temp0=310\.0/); expect(files["md/product.in"]).toMatch(/temp0=310\.0/); expect(files["md/heat.in"]).toMatch(/temp0=300\.0/);
    expect(files["README.md"]).toMatch(/## Fork\n- kind: \*\*extend\*\* \(parent card: 1l2y-rep4; seed policy fresh\)\n- fork f\w+ — question: Does binding weaken at 310 K\?\n  - treatment: temp0 \(target temperature \(K\)\) → 310\.0 on density, product; before: density=300\.0, product=300\.0/);
    const mf = JSON.parse(files["manifest.json"]); expect(mf.parent).toBe("1l2y-rep4"); expect(mf.fork.kind).toBe("extend"); expect(mf.fork.forks[0].treatment.key).toBe("temp0"); expect(mf.fork.complete).toBe(true);
    expect(files["README.md"]).toMatch(/ONE member of the \d+ planned for this condition; with seed policy fresh \(ig=-1\) each execution draws a new seed — run it \d+ times/); expect(files["README.md"]).not.toMatch(/\$\{/);
    // partial approval and combined forks are stated, not hidden
    const half = rerunBundle(B, { seed: "fresh", target: "local", approved: [approved[1]] });
    expect(half["README.md"]).toMatch(/partially approved: density NOT changed/); expect(JSON.parse(half["manifest.json"]).fork.complete).toBe(false);
    const g = forkExperiment(B, idx, { kind: "extend", treatment: { key: "nstlim", value: "20000" } });
    const two = rerunBundle(B, { seed: "fresh", target: "local", approved: [...approved, ...(g as any)._proposals.map((p: any) => ({ ...p, status: "approved" }))] });
    expect(two["README.md"]).toMatch(/2 forks combined/); expect(JSON.parse(two["manifest.json"]).fork.forks.length).toBe(2);
    expect(JSON.parse(rerunBundle(B, { seed: "pinned", target: "local", approved: [] })["manifest.json"]).fork.kind).toBe("reproduce");
    expect(JSON.parse(rerunBundle(B, { seed: "fresh", target: "local", approved: [] })["manifest.json"]).fork.kind).toBe("replicate");
  });
});

describe("judge pass 46ca5ba fixes", () => {
  it("explain_result: brief rounds to the precision it defends, ranks the run in its ensemble, names the ensemble mean ± SEM", () => {
    const e = explainResult(B, idx, true) as any;
    expect(e.brief).toMatch(/^ΔG = -19\.2 ± 0\.6 kcal\/mol for this run/); expect(e.brief).toMatch(/archived value -19\.1953/);
    expect(e.this_run_vs_ensemble).toMatchObject({ rank_most_negative: 1, n: 13 }); expect(e.this_run_vs_ensemble.z_vs_ensemble_mean).toBeLessThan(-1.5);
    expect(e.brief).toMatch(/This run is 1 of 13 .* vs the ensemble mean -17\.85 ± 0\.18 \(SEM, n=13\)/);
    expect(e.run_to_run.caveat).toMatch(/from one prepared start/); expect(e.sign_claim.all_runs).toMatch(/robust to seed variation/);
    expect((explainResult(C, idx, true) as any).this_run_vs_ensemble).toBeNull();
  });
  it("plan_sampling: a run already ≥ min_run_ps whose target is not met gets an 'extend this run alone' suggested edit; a met target gets none", () => {
    // the default target is now met on the ≥10 ps stratum (n=9, SD 0.67), so name a tighter one to exercise the
    // unmet branch this test is about; the met branch is asserted below with target 0.5
    const p = planSampling(B, idx, { target_uncertainty_kcal: 0.15, detail: true }); expect(p.run_to_run.target_met).toBe(false);
    expect(p.suggested_edits).toMatchObject({ run_id: "1l2y-rep4", stage: "product", purpose: "extend this run alone to the projected length" });
    expect(Number(p.suggested_edits!.edits.nstlim) * 0.002).toBeCloseTo(p.within_run.expected_length_for_target_ps!, 0);
    expect(planSampling(B, idx, { target_uncertainty_kcal: 0.5, detail: true }).suggested_edits).toBeNull();
  });
  it("propose_change: counts must be positive integers; the controlled diff (before → after, class, material) is returned", () => {
    expect(() => makeProposal(A, "product", { nstlim: "-5" }, "x")).toThrow(/nstlim must be a positive integer/);
    expect(() => makeProposal(A, "product", { ntwx: "0" }, "x")).toThrow(/ntwx must be a positive integer/);
    const p = makeProposal(A, "product", { temp0: "600.0" }, "x");
    expect(p.changes).toEqual([{ key: "temp0", before: "300.0", after: "600.0", class: "thermodynamic_state", material: true, meaning: "target temperature (K)" }]);
    expect(p.material_classes).toEqual(["thermodynamic_state"]); expect(makeProposal(A, "product", { ntwx: "10" }, "x").material_classes).toEqual([]);
  });
  it("diff_runs: |ΔΔG| is judged against √2·SD with an explicit noise verdict; same run is refused; cross-system flags nothing material", () => {
    const d = diffRuns(A, B, idx); expect(d.delta_g_vs_noise!.sd_of_difference).toBeCloseTo(Math.SQRT2 * d.run_to_run_spread!.all.sd!, 2);
    expect(typeof d.delta_g_vs_noise!.consistent_with_sampling_noise).toBe("boolean"); expect(d.scale).toMatch(/expected spread of a two-run difference √2·SD/); expect(d.verdict).toMatch(/^ΔΔG (consistent with|larger than) sampling noise/); expect(d.interpretation).not.toMatch(/√2/);
    expect(() => diffRuns(A, A, idx)).toThrow(/same run/);
    const x = diffRuns(A, C, idx); expect(x.material_classes).toEqual([]); expect(x.delta_g_vs_noise).toBeNull(); expect(x.stages.flatMap(s => s.changes).every(c => !c.material)).toBe(true); expect(x.verdict).toMatch(/different complexes/); expect(x.system.find(s => s.field === "net_charge")).toBeUndefined();
  });
});

describe("Codex judge ff85e2f fixes", () => {
  it("every manifest archives the three leap.in inputs; a bundle with them is self-contained, without them it says what is still needed", () => {
    for (const r of idx) { const m = load(r.id); expect(m.system.build_inputs.missing, r.id).toEqual([]); expect(m.system.build_inputs.present.length, r.id).toBe(3); expect(bundleGaps(m)).toEqual(["MOL.mol2", "MOL.frcmod", "protein_clean.pdb"].map(x => r.id.startsWith("3htb") ? x.replace("MOL", "JZ4") : x)); expect(bundleGaps(m, { "MOL.mol2": "", "MOL.frcmod": "", "protein_clean.pdb": "", "JZ4.mol2": "", "JZ4.frcmod": "" })).toEqual([]); }
    const bf = { "MOL.mol2": "@<TRIPOS>MOLECULE\n", "MOL.frcmod": "remark\n", "protein_clean.pdb": "ATOM\n" };
    const full = rerunBundle(B, { seed: "fresh", target: "local", approved: [], buildFiles: bf });
    expect(Object.keys(full).filter(k => k.startsWith("build/")).sort()).toEqual(["build/MOL.frcmod", "build/MOL.mol2", "build/leap.in", "build/protein_clean.pdb"]);
    expect(full["README.md"]).toMatch(/Self-contained: every file leap.in loads is included/);
    const partial = rerunBundle(B, { seed: "fresh", target: "local", approved: [], buildFiles: { "MOL.mol2": "x", "MOL.frcmod": "y" } });
    expect(partial["README.md"]).toMatch(/A rerun recipe, not a self-contained archive: leap.in also loads \*\*protein_clean.pdb\*\*/);
    expect(rerunBundle(B, { seed: "fresh", target: "local", approved: [] })["README.md"]).toMatch(/\*\*MOL.mol2, MOL.frcmod, protein_clean.pdb\*\*, not included here — archived with the card but not fetched/);
  });
  it("plan_sampling: n_needed carries a plug-in range from the SD's own sampling uncertainty; ladder rung 4 is named for what it tests; singleton wording", () => {
    // as above: the plug-in range is only quoted while more runs are still called for, so plan against a tighter target
    const p = planSampling(A, idx, { target_uncertainty_kcal: 0.15, detail: true }); expect(p.run_to_run.n_needed_range).toMatchObject({ sd_relative_se: 0.25 });
    expect(p.run_to_run.n_needed_range!.low).toBeLessThanOrEqual(p.run_to_run.n_needed!); expect(p.run_to_run.n_needed_range!.high).toBeGreaterThanOrEqual(p.run_to_run.n_needed!);
    expect(p.recommendation).toMatch(/plug-in estimate; ±1 SE on the SD gives n = \d+–\d+/);
    expect(confidenceLadderFull(B, idx).rungs[3].rung).toBe("robust to analysis-window choices");
    const e = explainResult(C, idx, true) as any; expect(e.brief).toMatch(/does not estimate run-to-run uncertainty/); expect(e.brief).not.toMatch(/understates/);
    expect((explainResult(B, idx, true) as any).this_run_vs_ensemble.note).toMatch(/conditional on this short-run ensemble/);
  });
});


describe("compact by default, detail on request", () => {
  it("explain_result: compact carries the brief and the deciding numbers; detail:true is the full record and is much larger", () => {
    const c = explainResult(B, idx) as any, f = explainResult(B, idx, true) as any;
    expect(c.brief).toBe(f.brief); expect(c.uncertainty_to_quote).toMatchObject({ run_to_run_sd: 0.645, n: 13, production_ps: [2, 5, 10, 20, 30] }); expect(c.within_run.corrected_sem).toBe(f.uncertainty.corrected_sem);
    expect(typeof c.sign_claim).toBe("string"); expect(c.detail).toMatch(/detail: true/); expect(c.uncertainty).toBeUndefined(); expect(c.provenance).toBeUndefined();
    expect(JSON.stringify(c).length).toBeLessThan(JSON.stringify(f).length / 2); expect(f.uncertainty.block_averaging).toBeTruthy();
    expect((explainResult(C, idx) as any).uncertainty_to_quote).toBeNull();
  });
  it("plan_sampling and confidence_ladder: compact keeps what an agent acts on; detail adds tables/evidence", () => {
    const c = planSampling(A, idx, {}) as any, f = planSampling(A, idx, { detail: true }) as any;
    expect(c.recommendation).toBe(f.recommendation); expect(c.suggested_edits).toEqual(f.suggested_edits); expect(c.run_to_run.n_needed_range).toEqual(f.run_to_run.n_needed_range); expect(c.within_run.expected_sem_by_length).toBeUndefined(); expect(f.within_run.expected_sem_by_length.length).toBe(5);
    const l = confidenceLadder(B, idx, false) as any, lf = confidenceLadder(B, idx) as any;
    expect(l.rungs.length).toBe(5); expect(l.rungs[0].evidence).toBeUndefined(); expect(lf.rungs[0].evidence).toMatch(/re-derived here/); expect(l.summary).toBe(lf.summary);
  });
});

describe("the rerun bundle reproduces the number, not just the trajectory", () => {
  // The gap this closes: before it, "fork this experiment" handed back a bundle that could rerun the MD and
  // then leave you with no way to compute the ΔG the card is built on. Every setting below is read from the
  // run's own manifest, so a bundle is never carrying another system's masks.
  it("carries an MM-GBSA step whose every parameter comes from this run's manifest", () => {
    for (const id of ["1l2y-rep4", "3htb-jz4"]) {
      const m = load(id), mm = m.results.mmgbsa;
      const f = rerunBundle(m, { seed: "pinned", target: "local", approved: [] });
      expect(Object.keys(f), id).toEqual(expect.arrayContaining(["analysis/mmgbsa.in", "run_analysis.sh"]));
      const inp = f["analysis/mmgbsa.in"];
      expect(inp).toContain(`igb=${mm.igb}, saltcon=${mm.saltcon}`);
      expect(inp).toContain(`startframe=${mm.params.startframe}, endframe=${mm.params.endframe}, interval=${mm.params.interval}`);
      // the receptor mask must be this run's, never the other system's
      expect(f["run_analysis.sh"]).toContain(`-m '${mm.params.receptor_mask}'`);
      expect(f["run_analysis.sh"]).toContain(`trajin $MD/${m.stages.find((s: any) => s.role === "production").name}.nc`);
      expect(f["README.md"]).toContain(`receptor \`${mm.params.receptor_mask}\`, ligand \`${mm.params.ligand_mask}\``);
    }
    // and the two systems must not produce the same masks, or the manifest is not being read
    const a = rerunBundle(load("1l2y-rep4"), { seed: "pinned", target: "local", approved: [] })["run_analysis.sh"];
    const b = rerunBundle(load("3htb-jz4"), { seed: "pinned", target: "local", approved: [] })["run_analysis.sh"];
    expect(a).toContain("-m ':1-20'"); expect(b).toContain("-m ':1-163'");
  });
  it("says plainly that it was not executed, and what a fresh seed means for the number", () => {
    const pinned = rerunBundle(B, { seed: "pinned", target: "local", approved: [] })["README.md"];
    const fresh = rerunBundle(B, { seed: "fresh", target: "local", approved: [] })["README.md"];
    expect(pinned).toMatch(/should reproduce the archived -19\.1953 kcal\/mol on the same build/);
    expect(fresh).toMatch(/independent sample: expect a ΔG within the run-to-run spread, not the archived value/);
    for (const r of [pinned, fresh]) expect(r).toMatch(/Nothing here was executed by the page/);
  });
  it("reads the GB radii from the manifest, and refuses to guess when no artifact recorded them", () => {
    // Found by executing a generated bundle against 1l2y-rep4's archived trajectory: with the previously
    // hardcoded mbondi2 the chain reproduces -18.73, not the archived -19.1953 — a 0.47 kcal/mol error in
    // the exact number the bundle exists to reproduce. The archived analysis ran on mbondi topologies
    // (analysis/comp_dry.top %FLAG RADIUS_SET); with --radii=mbondi the same chain lands at -19.1939,
    // within reprocessing noise. Radii therefore come from the manifest, which read them from the artifact.
    const a = rerunBundle(load("1l2y-rep4"), { seed: "pinned", target: "local", approved: [] });
    expect(a["run_analysis.sh"]).toContain("--radii=mbondi\n");
    expect(a["run_analysis.sh"]).not.toContain("mbondi2");
    expect(a["README.md"]).toContain("GB radii mbondi (read from this run's archived topology)");
    // the ICE replicates archived no dry topology, so their manifests carry no radii claim: the script
    // must omit the flag and say so, in the script and the README both, never silently default
    const ice = rerunBundle(load("1l2y-rep4-ice1"), { seed: "pinned", target: "local", approved: [] });
    expect(ice["run_analysis.sh"]).not.toContain("--radii=");
    expect(ice["run_analysis.sh"]).toContain("# no --radii: the archived run's radii set is not recorded in its artifacts");
    expect(ice["README.md"]).toContain("GB radii unrecorded in this run's artifacts");
  });
  it("adds SLURM directives to the analysis job too, not just the MD job", () => {
    const f = rerunBundle(B, { seed: "pinned", target: "slurm", approved: [] });
    expect(f["run_analysis.sh"].split("\n")[1]).toBe("#SBATCH --job-name=1l2y-rep4-mmgbsa");
    expect(f["run.sh"]).toContain("#SBATCH --job-name=1l2y-rep4");
  });
});

describe("fork network", () => {
  it("1l2y-rep4 has four replicate forks on SANDER; the parent sits beyond 2 run-to-run SDs, reported as tension with the engine confound named", () => {
    const net = forkNetwork(idx, "1l2y-rep4");
    expect(net.forks.map(f => f.id)).toEqual(["1l2y-rep4-ice1", "1l2y-rep4-ice2", "1l2y-rep4-ice3", "1l2y-rep4-ice4"]);
    expect(net.forks.every(f => f.kind === "replicate" && f.seed === "fresh" && f.production_ps === 30)).toBe(true);
    expect(net.engines).toEqual({ parent: "Amber 26 PMEMD (2026)", forks: ["Amber 24 SANDER (2024)"] });
    const g = net.forks.map(f => f.delta_g); const mean = g.reduce((a, b) => a + b, 0) / 4;
    expect(net.fork_mean).toBeCloseTo(mean, 6);
    expect(net.parent_offset_kcal).toBeCloseTo(-19.1953 - mean, 6);
    expect(net.run_to_run_sd).toBeCloseTo(ensemble(idx, "1l2y-rep4").all.sd!, 9);
    expect(net.sign_agrees).toBe(true);
    expect(Math.abs(net.parent_offset_sd!)).toBeGreaterThan(2);
    expect(net.status).toBe("tension");
    expect(net.verdict).toMatch(/Beyond 2 SDs/); expect(net.verdict).toMatch(/engines differ/); expect(net.verdict).toMatch(/same sign/);
  });
  it("a run with no forks says so and points at fork_experiment; a fork itself has no network", () => {
    const net = forkNetwork(idx, "3htb-jz4");
    expect(net.n).toBe(0); expect(net.status).toBe("none"); expect(net.verdict).toMatch(/fork_experiment/);
    expect(forkNetwork(idx, "1l2y-rep4-ice1").n).toBe(0);
    expect(() => forkNetwork(idx, "nope")).toThrow(/no run 'nope'/);
  });
  it("forkNetworks lists exactly the parents that have forks on the site", () => {
    expect(forkNetworks(idx).map(n => [n.parent.id, n.n])).toEqual([["1l2y-rep4", 4]]);
  });
  it("agree: a parent within 2 SDs of its forks", () => {
    const fake = idx.map(r => r.id === "1l2y-rep4" ? { ...r, delta_g: -17.5 } : r);
    const net = forkNetwork(fake, "1l2y-rep4");
    expect(net.status).toBe("agree"); expect(net.verdict).toMatch(/Within 2 SDs/);
  });
});
