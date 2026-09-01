import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildEvidenceBrief, safeBriefFilename } from "../src/lib/evidenceBrief";
import { emptyInvestigation, type BundleSnapshot } from "../src/lib/investigation";
import { forkExperiment, makeProposal, planSampling, recomputeResult, rerunBundle } from "../src/lib/runs";

const load = (id: string) => JSON.parse(readFileSync(`public/runs/${id}/manifest.json`, "utf8"));
const index = JSON.parse(readFileSync("public/runs/index.json", "utf8"));
const generatedAt = "2026-08-31T12:00:00.000Z";
const urls = (id: string) => ({ cardUrl: `https://runcard.test/#/run/${id}`, manifestUrl: `https://runcard.test/runs/${id}/manifest.json` });

describe("evidence brief", () => {
  it("separates the archive from a run-scoped reanalysis and sampling plan", () => {
    const m = load("1l2y-rep4"), investigation = emptyInvestigation(m.id);
    investigation.reanalysis = { runId: m.id, source: "webmcp", completedAt: generatedAt, value: recomputeResult(m, { start_frame: 21 }) };
    investigation.samplingPlan = { runId: m.id, source: "webmcp", completedAt: generatedAt, value: planSampling(m, index, { target_uncertainty_kcal: 0.25 }) };
    const out = buildEvidenceBrief({ manifest: m, index, generatedAt, includeSession: true, investigation, proposals: [], ...urls(m.id) });
    expect(out.markdown).toContain("Archived result:"); expect(out.markdown).toContain("## Current reanalysis"); expect(out.markdown).toContain("unchanged archive");
    expect(out.markdown).toContain("## Next sampling plan"); expect(out.markdown).toContain("Expected, not measured");
    expect(out.includedSections).toContain("current_reanalysis"); expect(out.filename).toBe("1l2y-rep4-evidence-brief.md");
  });

  it("does not invent run-to-run variation for the single-run system", () => {
    const m = load("3htb-jz4"), other = load("1l2y-rep4"), wrongRun = emptyInvestigation(other.id);
    wrongRun.reanalysis = { runId: other.id, source: "webmcp", completedAt: generatedAt, value: recomputeResult(other, { start_frame: 21 }) };
    const out = buildEvidenceBrief({ manifest: m, index, generatedAt, includeSession: true, investigation: wrongRun, proposals: [makeProposal(other, "product", { nstlim: "20000" }, "other run")], ...urls(m.id) });
    expect(out.markdown).toContain("Run-to-run population: not available"); expect(out.markdown).toContain("only run of its prepared system");
    expect(out.markdown).not.toMatch(/Run-to-run population: sample SD/);
    expect(out.markdown).not.toContain("## Current reanalysis"); expect(out.markdown).not.toContain("other run");
  });

  it("include_session=false excludes transient work", () => {
    const m = load("1l2y-rep4"), investigation = emptyInvestigation(m.id);
    investigation.reanalysis = { runId: m.id, source: "console", completedAt: generatedAt, value: recomputeResult(m, { interval: 2 }) };
    const out = buildEvidenceBrief({ manifest: m, index, generatedAt, includeSession: false, investigation, proposals: [makeProposal(m, "product", { nstlim: "20000" }, "longer")], ...urls(m.id) });
    expect(out.markdown).not.toContain("## Current reanalysis"); expect(out.markdown).not.toContain("## Proposals and prepared bundle");
    expect(out.includedSections).toEqual(["record", "result_and_scope", "evidence_checks", "sources_and_limits"]);
  });

  it("distinguishes pending proposals from the bundle's partial applied snapshot", () => {
    const m = load("1l2y-rep4"); const fork: any = forkExperiment(m, index, { kind: "extend", treatment: { key: "temp0", value: "310.0" }, question: "Does binding weaken?" });
    const [approved, pending] = fork._proposals; approved.status = "approved";
    const files = rerunBundle(m, { seed: "fresh", target: "local", approved: [approved] });
    const bundle: BundleSnapshot = { runId: m.id, name: "partial.zip", files, seed: "fresh", target: "local", generatedAt, appliedProposalIds: [approved.id], appliedProposals: [structuredClone(approved)], changedStages: [{ stage: approved.stage, file: `md/${approved.stage}.in`, changes: approved.changes, fork: approved.fork.id }], forks: [{ id: approved.fork.id, question: approved.fork.question, intendedStages: approved.fork.stages, appliedStages: [approved.stage], missingStages: [pending.stage], complete: false }], combinesMultipleForks: false, selfContained: false, missingInputs: ["protein_clean.pdb"] };
    const investigation = emptyInvestigation(m.id); investigation.bundle = { runId: m.id, source: "page", completedAt: generatedAt, value: bundle };
    const out = buildEvidenceBrief({ manifest: m, index, generatedAt, includeSession: true, investigation, proposals: [approved, pending], ...urls(m.id) });
    expect(out.markdown).toContain("Proposal `" + approved.id + "` (" + approved.stage + "): **approved**");
    expect(out.markdown).toContain("Proposal `" + pending.id + "` (" + pending.stage + "): **pending**");
    expect(out.markdown).toContain("Applied proposal IDs at generation: `" + approved.id + "`"); expect(out.markdown).not.toContain("Applied proposal IDs at generation: `" + pending.id + "`");
    expect(out.markdown).toContain("incomplete / partially approved"); expect(out.markdown).toContain("missing intended stages " + pending.stage);
    expect(out.markdown).toContain("incomplete; missing protein\\_clean.pdb");
  });

  it("uses a deterministic timestamp and rejects unsafe filenames", () => {
    const m = load("1l2y-rep4"); const a = buildEvidenceBrief({ manifest: m, index, generatedAt, includeSession: true, ...urls(m.id) }); const b = buildEvidenceBrief({ manifest: m, index, generatedAt, includeSession: true, ...urls(m.id) });
    expect(a).toEqual(b); expect(() => safeBriefFilename("../escape")).toThrow(/run_id/);
  });

  it("never prints a backslash-escaped artifact or tool name (RC-005 B)", () => {
    // The brief is copied into other documents, so a literal \_ is not just ugly — it is not the name of the
    // file. Underscored identifiers must arrive as code spans instead. Checked for every run and both session
    // modes, because the offending text came from three different tools' prose, not one template.
    for (const id of ["1l2y-rep4", "1l2y-rep4-ice1", "3htb-jz4", "1l2y-regression"]) {
      for (const includeSession of [false, true]) {
        const b = buildEvidenceBrief({ manifest: load(id), index, includeSession } as any);
        const bad = b.markdown.split("\n").filter(l => /\\_/.test(l));
        expect(bad, `${id} session=${includeSession}`).toEqual([]);
        expect(b.markdown).toMatch(/`_MMPBSA_info`/);
      }
    }
  });
});
