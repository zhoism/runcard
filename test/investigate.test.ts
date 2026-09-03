import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { investigateRun } from "../src/lib/investigate";
import { ensemble, confidenceLadderFull } from "../src/lib/runs";

const load = (id: string) => JSON.parse(readFileSync(`public/runs/${id}/manifest.json`, "utf8"));
const idx = JSON.parse(readFileSync("public/runs/index.json", "utf8"));

describe("automode (investigate_run)", () => {
  it("chases the bottleneck rung, so different evidence produces different investigations", () => {
    // This is the property that makes automode reasoning rather than a script. If these three collapse to the
    // same trace, the feature is a fixed sequence wearing a costume and the claim on the page is false.
    const done = investigateRun(load("1l2y-rep4-ice1"), idx);   // every assessable rung earned: the four SANDER reruns at 30 ps replicate each other
    const single = investigateRun(load("3htb-jz4"), idx);       // one run: nothing can be replicated
    const drift = investigateRun(load("1l2y-regression"), idx); // drifting: robustness cannot be established

    expect(done.bottleneck!.rung).toBe("repeatable");
    expect(single.bottleneck!.rung).toBe("independently replicated");
    expect(drift.bottleneck!.rung).toBe("robust to analysis-window choices");
    // rep4 itself: replication is engine-aware, so its 4 SANDER forks are cross-engine and it stands at 2 of 3 on PMEMD
    const rep4 = investigateRun(load("1l2y-rep4"), idx);
    expect(rep4.bottleneck!.rung).toBe("independently replicated"); expect(rep4.next!.input).toMatchObject({ kind: "replicate" });
    expect(rep4.next!.rationale).toMatch(/1 more independent run at 30 ps on Amber 26 PMEMD/);

    const traces = [done, single, drift].map(r => r.steps.map(s => s.tool).join(">"));
    expect(new Set(traces).size, "three runs must not produce one trace").toBe(3);
    expect(done.next!.input).toMatchObject({ kind: "reproduce" });
    expect(single.next!.input).toMatchObject({ kind: "replicate" });
    expect(drift.next!.tool).toBe("plan_sampling");
  });

  it("creates nothing — the recommendation is words, never a queued change", () => {
    for (const id of ["1l2y-rep4", "3htb-jz4", "1l2y-regression"]) {
      const r = investigateRun(load(id), idx);
      expect(r.created).toMatch(/^nothing/);
      expect(r.next!.needs_a_human).toBe(true);
      // no shape anywhere in the output that a caller could mistake for an applied or pending change
      const s = JSON.stringify(r);
      expect(s, id).not.toMatch(/"status"\s*:\s*"(pending|approved)"/);
      // as JSON keys, not substrings: the ladder's own prose mentions generate_rerun_bundle by name
      expect(s, id).not.toMatch(/"(mdin_after|_bundle|_proposals|edits)"\s*:/);
      // and no step claims a tool that writes ran: the trace names what it computed
      expect(r.steps.map(x => x.tool), id).not.toContain("generate_rerun_bundle");
    }
  });

  it("every number it states is the number the tool it credits would state", () => {
    // automode re-narrates other tools' findings, so it is exactly where a second, disagreeing copy of a
    // number would appear. The run-to-run SD is the one it quotes most loudly.
    const m = load("1l2y-rep4");
    const r = investigateRun(m, idx);
    const sd = ensemble(idx, "1l2y-rep4").all.sd!;
    expect(r.headline).toContain(`±${sd.toFixed(2)}`);
    expect(r.headline).toContain(m.results.mmgbsa.delta_total_kcal_mol.toFixed(2));
    expect(r.ladder.verified_of_assessable).toBe(confidenceLadderFull(m, idx).verified_of_assessable);
  });

  it("a single-run system is told the 3-run floor, not a null sizing", () => {
    const r = investigateRun(load("3htb-jz4"), idx);
    const plan = r.steps.find(s => s.tool === "plan_sampling")!;
    expect(plan.found).toMatch(/no run-to-run estimate exists yet \(1 run\); 2 more comparable independent runs/);
    expect(plan.found).not.toMatch(/\?|null|undefined|NaN/);
  });

  it("never recommends a rung this site cannot assess", () => {
    for (const r of idx.map((e: any) => investigateRun(load(e.id), idx))) {
      expect(r.bottleneck?.rung).not.toBe("externally supported");
      expect(r.bottleneck?.movable_by).not.toBe("not assessable here");
    }
  });

  it("agrees with the bundle tool about what the bundle ships (RC-006B, batch 08)", () => {
    // generate_rerun_bundle reported self_contained:true while automode, on the same page, said the three
    // archived build inputs "must come from the original build directory" — bundleGaps was called bare, which
    // means "nothing is shipped". Automode fetches nothing, but the manifest's build_inputs.present already
    // says what extract_run.py found archived under build/; the two tools must read that one fact the same way.
    const m = load("1l2y-rep4");
    expect(m.system.build_inputs.present.sort()).toEqual(["MOL.frcmod", "MOL.mol2", "protein_clean.pdb"]);
    // on one engine rep4's replication verifies and the bottleneck is repeatable, which is the branch under test
    const oneEngine = idx.map((r: any) => ({ ...r, engine: "Amber 26 PMEMD (2026)" }));
    const r = investigateRun(m, oneEngine);
    // the step is named for what ran — the gap check, in memory — never for the tool that would have written a bundle
    expect(r.steps.map(s => s.tool)).not.toContain("generate_rerun_bundle");
    const step = r.steps.find(s => s.tool === "bundleGaps (read-only check)")!;
    expect(step.why).toMatch(/without writing a bundle/);
    expect(step.found).toContain("self-contained");
    expect(step.found).not.toContain("must come from the original build directory");

    // and the honesty survives: an input that genuinely was never archived is still named as a gap
    const gappy = load("1l2y-rep4");
    gappy.system.build_inputs = { present: ["MOL.frcmod", "protein_clean.pdb"], missing: ["MOL.mol2"] };
    const g = investigateRun(gappy, oneEngine).steps.find(s => s.tool === "bundleGaps (read-only check)")!;
    expect(g.found).toContain("MOL.mol2");
    expect(g.found).not.toContain("MOL.frcmod");
  });
});
