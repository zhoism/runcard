import { describe, expect, it, vi } from "vitest";

// Landing.tsx imports webmcp.ts, which reads window/location at import time; the same stubs webmcp.test.ts uses.
async function load() {
  vi.resetModules();
  const location = { hash: "", origin: "https://runcard.test", pathname: "/" };
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", { addEventListener: vi.fn(), location, modelContext: undefined });
  vi.stubGlobal("navigator", { modelContext: undefined });
  vi.stubGlobal("document", { modelContext: undefined });
  const { TOOL_GROUPS } = await import("../src/Landing");
  const { TOOLS } = await import("../src/webmcp");
  return { TOOL_GROUPS, TOOLS };
}

describe("landing page", () => {
  it("its tool table names every registered tool exactly once — the header pill counts TOOLS, so the grid must agree", async () => {
    const { TOOL_GROUPS, TOOLS } = await load();
    const listed = TOOL_GROUPS.flatMap(g => g.items);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(TOOLS.map(t => t.name).sort());
  });
  it("files the two tools that can prepare a change to a scientific input under Change", async () => {
    const { TOOL_GROUPS } = await load();
    const change = TOOL_GROUPS.find(g => g.name === "Change")!.items;
    expect(change).toContain("propose_change"); expect(change).toContain("fork_experiment");
    expect(TOOL_GROUPS.find(g => g.name === "Plan")!.items).toContain("investigate_run");
  });
});
