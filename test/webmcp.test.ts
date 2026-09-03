import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const setupGlobals = (modelContext?: object) => {
  const location = { hash: "", origin: "https://runcard.test", pathname: "/" };
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", { addEventListener: vi.fn(), location, modelContext: undefined });
  vi.stubGlobal("navigator", { modelContext });
  vi.stubGlobal("document", { modelContext: undefined });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = url === "/runs/index.json" ? "public/runs/index.json" : `public${url}`;
    try { return new Response(readFileSync(path), { status: 200, headers: { "content-type": "application/json" } }); }
    catch { return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } }); }
  }));
};

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("WebMCP registration (mocked browser API)", () => {
  it("reports unsupported without the API and still exposes the real table", async () => {
    setupGlobals(); const web = await import("../src/webmcp"); const store = await import("../src/store"); await web.registerWebMCP();
    expect(web.TOOLS).toHaveLength(17); expect(web.TOOLS.at(-1)?.name).toBe("export_evidence_brief"); expect(web.TOOLS.map(t => t.name)).toContain("investigate_run"); expect(store.get().webmcp).toBe("unsupported"); expect(store.get().tools).toEqual(web.TOOLS.map(t => t.name));
  });

  it("reports registration failure", async () => {
    setupGlobals({ registerTool: vi.fn(async () => { throw new Error("registration denied"); }) }); const web = await import("../src/webmcp"); const store = await import("../src/store"); const err = vi.spyOn(console, "error").mockImplementation(() => {}); await web.registerWebMCP();
    expect(store.get().webmcp).toBe("error"); expect(err).toHaveBeenCalled(); err.mockRestore();
  });

  it("executes the registered definition and attributes run-scoped state to WebMCP", async () => {
    const registered: any[] = []; setupGlobals({ registerTool: vi.fn(async (tool: any) => { registered.push(tool); }) }); const web = await import("../src/webmcp"); const store = await import("../src/store"); await web.registerWebMCP();
    expect(registered.map(t => t.name)).toEqual(web.TOOLS.map(t => t.name));
    const recompute = registered.find(t => t.name === "recompute_result"); const raw = await recompute.execute({ inputParams: { run_id: "1l2y-rep4", start_frame: 21 } }); const out = JSON.parse(raw);
    expect(out.window.start_frame).toBe(21); expect(store.get().investigations["1l2y-rep4"].reanalysis?.source).toBe("webmcp"); expect(store.get().calls[0].source).toBe("webmcp");
    const exportTool = registered.find(t => t.name === "export_evidence_brief"); const report = JSON.parse(await exportTool.execute({ inputParams: { run_id: "1l2y-rep4", include_session: true } }));
    expect(report.markdown).toBe(store.get().investigations["1l2y-rep4"].brief?.value.markdown); expect(report.included_sections).toContain("current_reanalysis");
    expect(JSON.parse(await exportTool.execute({ inputParams: { run_id: "1l2y-rep4", include_session: "yes" } })).error).toMatch(/boolean/);
    store.navigate("/run/3htb-jz4"); expect(store.get().investigations["3htb-jz4"]).toBeUndefined(); expect(store.get().investigations["1l2y-rep4"].reanalysis?.value.window.start_frame).toBe(21);
  });
});

describe("WebMCP registration payload", () => {
  it("keeps tool and schema descriptions concise while preserving write boundaries", async () => {
    setupGlobals(); const { TOOLS } = await import("../src/webmcp");
    for (const tool of TOOLS) {
      expect(tool.description.length, `${tool.name} description length`).toBeLessThanOrEqual(450);
      expect(tool.description, `${tool.name} question/answer split`).toContain("? ");
      if (!tool.readOnly) expect(tool.description, `${tool.name} page write`).toMatch(/\bpage\b/i);
    }
    expect(TOOLS.reduce((total, tool) => total + tool.description.length, 0)).toBeLessThanOrEqual(5_500);
    expect(TOOLS.find(tool => tool.name === "propose_change")?.description).toContain("Approve");
    expect(TOOLS.find(tool => tool.name === "fork_experiment")?.description).toContain("Approve");

    const checkSchemaDescriptions = (value: unknown, path: string) => {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (typeof node.description === "string") {
        expect(node.description.length, `${path} schema description length`).toBeLessThanOrEqual(90);
      }
      for (const [key, child] of Object.entries(node)) checkSchemaDescriptions(child, `${path}.${key}`);
    };
    for (const tool of TOOLS) checkSchemaDescriptions(tool.inputSchema, tool.name);
  });
});

// The whole "agent proposes, human approves" boundary rests on one filter in generate_rerun_bundle:
// rerunBundle itself applies whatever array it is handed. These drive the real store through callTool.
describe("approval gate: store → callTool → bundle", () => {
  const propose = (web: any, run_id: string, stage: string, edits: object, reason: string) =>
    web.callTool("propose_change", { run_id, stage, edits, reason }, "webmcp").then(JSON.parse);
  const bundle = (web: any, run_id: string) =>
    web.callTool("generate_rerun_bundle", { run_id, seed: "fresh", target: "local" }, "webmcp").then(JSON.parse);
  const filesOf = (store: any, run_id: string) => store.get().investigations[run_id].bundle!.value.files;

  it("applies only proposals that are approved AND belong to that run", async () => {
    setupGlobals(); const web = await import("../src/webmcp"); const store = await import("../src/store");
    const mine = await propose(web, "1l2y-rep4", "product", { nstlim: "5000" }, "extend production");
    const other = await propose(web, "1l2y-regression", "product", { nstlim: "7000" }, "a different run");
    expect(mine.status).toBe("pending"); expect(other.status).toBe("pending");

    store.setProposalStatus(other.proposal_id, "approved"); // approved, but on the OTHER run
    expect((await bundle(web, "1l2y-rep4")).applied_proposals).toEqual([]);
    const before = filesOf(store, "1l2y-rep4")["md/product.in"];
    expect(before).toContain("nstlim=15000"); // the archived value, untouched
    expect(before).not.toContain("nstlim=7000"); // the other run's approved edit never leaks in
    expect(before).not.toContain("nstlim=5000"); // this run's edit is still only pending

    store.setProposalStatus(mine.proposal_id, "approved");
    expect((await bundle(web, "1l2y-rep4")).applied_proposals).toEqual([mine.proposal_id]);
    const after = filesOf(store, "1l2y-rep4")["md/product.in"];
    expect(after).toContain("nstlim=5000"); expect(after).not.toContain("nstlim=7000");
  });

  it("never applies a rejected proposal", async () => {
    setupGlobals(); const web = await import("../src/webmcp"); const store = await import("../src/store");
    const p = await propose(web, "1l2y-rep4", "product", { nstlim: "5000" }, "extend production");
    store.setProposalStatus(p.proposal_id, "rejected");
    expect((await bundle(web, "1l2y-rep4")).applied_proposals).toEqual([]);
    expect(filesOf(store, "1l2y-rep4")["md/product.in"]).toContain("nstlim=15000");
  });

  it("a proposal is stamped with who made it and when, so the page can show it as a comment", async () => {
    setupGlobals(); const web = await import("../src/webmcp"); const store = await import("../src/store");
    const before = Date.now();
    const p = await web.callTool("propose_change", { run_id: "1l2y-rep4", stage: "product", edits: { dt: "0.001" }, reason: "halve the timestep" }, "webmcp").then(JSON.parse);
    const stored = store.get().proposals.find((x: any) => x.id === p.proposal_id)!;
    expect(stored.source).toBe("webmcp"); expect(stored.t).toBeGreaterThanOrEqual(before);
    const q = await web.callTool("propose_change", { run_id: "1l2y-rep4", stage: "product", edits: { cut: "10.0" }, reason: "longer cutoff" }, "console").then(JSON.parse);
    expect(store.get().proposals.find((x: any) => x.id === q.proposal_id)!.source).toBe("console");
    expect(store.get().proposals.find((x: any) => x.id === p.proposal_id)!.source).toBe("webmcp"); // the first stamp is never overwritten
  });
  it("setProposalStatus changes exactly the named proposal and ignores unknown ids", async () => {
    setupGlobals(); const web = await import("../src/webmcp"); const store = await import("../src/store");
    const p1 = await propose(web, "1l2y-rep4", "product", { nstlim: "5000" }, "longer production");
    const p2 = await propose(web, "1l2y-rep4", "density", { nstlim: "30000" }, "longer equilibration");
    store.setProposalStatus(p1.proposal_id, "approved");
    expect(store.get().proposals.map((p: any) => [p.id, p.status])).toEqual([[p2.proposal_id, "pending"], [p1.proposal_id, "approved"]]);
    store.setProposalStatus("p-does-not-exist", "approved");
    expect(store.get().proposals.filter((p: any) => p.status === "approved")).toHaveLength(1);
  });

  it("a fork's stages reach the bundle only as each one is approved", async () => {
    setupGlobals(); const web = await import("../src/webmcp"); const store = await import("../src/store");
    const fork = JSON.parse(await web.callTool("fork_experiment", { run_id: "1l2y-rep4", kind: "extend", treatment: { key: "temp0", value: "310.0" }, question: "Does binding weaken at 310 K?" }, "webmcp"));
    expect(fork.stages_changed).toEqual(["density", "product"]);
    expect(store.get().proposals.map((p: any) => p.status)).toEqual(["pending", "pending"]);

    expect((await bundle(web, "1l2y-rep4")).applied_proposals).toEqual([]);
    expect(filesOf(store, "1l2y-rep4")["md/density.in"]).toContain("temp0=300.0");

    store.setProposalStatus(store.get().proposals.find((p: any) => p.stage === "density")!.id, "approved");
    await bundle(web, "1l2y-rep4");
    const snap = store.get().investigations["1l2y-rep4"].bundle!.value;
    expect(snap.files["md/density.in"]).toContain("temp0=310.0");
    expect(snap.files["md/product.in"]).toContain("temp0=300.0"); // the unapproved stage is untouched
    expect(snap.files["md/heat.in"]).toContain("temp0=300.0"); // the heating ramp is never treated
    expect(snap.forks[0].complete).toBe(false);
    expect(snap.files["README.md"]).toMatch(/partially approved/);
  });

  it("cannot approve an edit that fails validation, but can still reject it", async () => {
    setupGlobals(); const web = await import("../src/webmcp"); const store = await import("../src/store");
    const p = await propose(web, "1l2y-rep4", "product", { dt: "0.004" }, "too big a timestep");
    expect(p.after.hasFail).toBe(true);
    store.setProposalStatus(p.proposal_id, "approved");
    expect(store.get().proposals[0].status).toBe("pending");
    store.setProposalStatus(p.proposal_id, "rejected");
    expect(store.get().proposals[0].status).toBe("rejected");
  });

  it("keeps the page's downloadable snapshot identical to what the tool reported", async () => {
    setupGlobals(); const web = await import("../src/webmcp"); const store = await import("../src/store");
    const out = await bundle(web, "1l2y-rep4");
    // 15 since the MM-GBSA step landed: the 13 that reproduced the trajectory, plus analysis/mmgbsa.in and
    // run_analysis.sh, which are what make the bundle able to reproduce the card's headline ΔG at all.
    expect(out.files).toHaveLength(15); expect(out.self_contained).toBe(true);
    expect(out.files).toEqual(expect.arrayContaining(["analysis/mmgbsa.in", "run_analysis.sh"]));
    expect(out._bundle).toBeUndefined(); expect(out._brief).toBeUndefined(); // internals never reach the agent
    const snap = store.get().investigations["1l2y-rep4"].bundle!.value;
    expect(Object.keys(snap.files)).toEqual(out.files);
    expect(snap.selfContained).toBe(true); expect(snap.missingInputs).toEqual([]);
  });
});

// AGENTS.md and CLAUDE.md are the same runcard under two filenames, because Codex-style tools look for
// AGENTS.md by convention and Claude Code looks for CLAUDE.md. Neither can be a pointer or a symlink: a
// pointer costs the reader the runcard, and a symlink renders as its target path in a raw file view. So both
// stand alone, and this test is what keeps them honest — they have drifted once already, when AGENTS.md was
// left saying propose_change was the only mutating tool after CLAUDE.md had been corrected.
describe("the two runcards do not drift", () => {
  it("AGENTS.md is CLAUDE.md, minus the Status pointer that only applies to the Claude Code entry point", () => {
    const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    const claude = read("CLAUDE.md"), agents = read("AGENTS.md");
    const body = (t: string) => t.split("\n").slice(1).join("\n").split("\n## Status\n")[0].trimEnd();
    expect(claude.split("\n")[0]).toBe("# CLAUDE.md — runcard");
    expect(agents.split("\n")[0]).toBe("# AGENTS.md — runcard");
    // the shared body must be byte-identical: run counts, the read-only tool invariant, the commands
    expect(body(agents)).toBe(body(claude));
    // and the shared body must be the substance, not a stub that trivially matches
    expect(body(agents).length).toBeGreaterThan(1500);
    expect(body(agents)).toMatch(/A number is a claim/);
  });
});

describe("callTool checks the schema's required fields before the tool runs", () => {
  it("names the missing field instead of whatever the tool would have tripped over", async () => {
    setupGlobals(); const web = await import("../src/webmcp"); const store = await import("../src/store");
    expect(JSON.parse(await web.callTool("explain_result", {}, "console"))).toEqual({ error: "run_id is required" });
    expect(JSON.parse(await web.callTool("diff_runs", { run_a: "1l2y-rep4", run_b: "" }, "console"))).toEqual({ error: "run_b is required" }); // the console prefills run_b: ""
    expect(store.get().calls[0]).toMatchObject({ tool: "diff_runs", ok: false, summary: "run_b is required" });
    expect(JSON.parse(await web.callTool("list_runs", undefined, "console"))).toHaveLength(14); // nothing required, nothing given
  });
});
