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
    const rep4 = investigateRun(load("1l2y-rep4"), idx);        // every assessable rung earned
    const single = investigateRun(load("3htb-jz4"), idx);       // one run: nothing can be replicated
    const drift = investigateRun(load("1l2y-regression"), idx); // drifting: robustness cannot be established

    expect(rep4.bottleneck!.rung).toBe("repeatable");
    expect(single.bottleneck!.rung).toBe("independently replicated");
    expect(drift.bottleneck!.rung).toBe("robust to analysis-window choices");

    const traces = [rep4, single, drift].map(r => r.steps.map(s => s.tool).join(">"));
    expect(new Set(traces).size, "three runs must not produce one trace").toBe(3);
    expect(rep4.next!.input).toMatchObject({ kind: "reproduce" });
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
});
