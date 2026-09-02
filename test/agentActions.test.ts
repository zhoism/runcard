import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// The seven verbs on the page are the real tools: every row names a registered tool, sends an input its schema accepts,
// and runs on the demo run. The one that prepares a change to a scientific input is the one marked prefill.
const setupGlobals = () => {
  const location = { hash: "", origin: "https://runcard.test", pathname: "/" };
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", { addEventListener: vi.fn(), location, modelContext: undefined });
  vi.stubGlobal("navigator", { modelContext: undefined });
  vi.stubGlobal("document", { modelContext: undefined });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = url === "/runs/index.json" ? "public/runs/index.json" : `public${url}`;
    try { return new Response(readFileSync(path), { status: 200, headers: { "content-type": "application/json" } }); }
    catch { return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } }); }
  }));
};
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const DEMO = "1l2y-rep4";

describe("AGENT_ACTIONS are the tool table in a reader's words", () => {
  it("names registered tools and sends inputs their schemas accept", async () => {
    setupGlobals();
    const { TOOLS } = await import("../src/webmcp"); const { AGENT_ACTIONS } = await import("../src/agentActions");
    expect(AGENT_ACTIONS).toHaveLength(7);
    expect(new Set(AGENT_ACTIONS.map(a => a.id)).size).toBe(7);
    for (const a of AGENT_ACTIONS) {
      const t = TOOLS.find(x => x.name === a.tool); expect(t, a.tool).toBeDefined();
      const schema: any = t!.inputSchema; const input = a.input(DEMO);
      for (const k of Object.keys(input)) expect(Object.keys(schema.properties), `${a.tool}.${k}`).toContain(k);
      for (const k of schema.required ?? []) expect(Object.keys(input), `${a.tool} requires ${k}`).toContain(k);
      expect(a.verb).toMatch(/^[A-Z]/); expect(a.verb).not.toMatch(/[A-Z]{2,}/);   // sentence case, no tool names shouted
    }
  });

  it("prefills exactly the tool that prepares a change to a scientific input; the rest are made from the page", async () => {
    setupGlobals();
    const { AGENT_ACTIONS } = await import("../src/agentActions");
    expect(AGENT_ACTIONS.filter(a => a.prefill).map(a => a.tool)).toEqual(["fork_experiment"]);
  });

  it("every non-prefill action runs on the demo run without error", async () => {
    setupGlobals();
    const web = await import("../src/webmcp"); const { AGENT_ACTIONS } = await import("../src/agentActions");
    for (const a of AGENT_ACTIONS.filter(x => !x.prefill)) {
      const out = JSON.parse(await web.callTool(a.tool, a.input(DEMO), "page"));
      expect(out.error, `${a.tool}: ${out.error}`).toBeUndefined();
    }
  });

  it("the prefilled fork creates pending proposals on the stages it touches and nothing else", async () => {
    setupGlobals();
    const web = await import("../src/webmcp"); const store = await import("../src/store"); const { AGENT_ACTIONS } = await import("../src/agentActions");
    const fork = AGENT_ACTIONS.find(a => a.prefill)!;
    const out = JSON.parse(await web.callTool(fork.tool, fork.input(DEMO), "page"));
    expect(out.error).toBeUndefined(); expect(out.kind).toBe("extend");
    const ps = store.get().proposals.filter(p => p.run === DEMO);
    expect(ps.length).toBe(out.stages_changed.length); expect(ps.every(p => p.status === "pending")).toBe(true);
    expect(ps.every(p => p.fork?.id === out.fork_id)).toBe(true);
    expect(store.get().investigations[DEMO]?.forks[out.fork_id]).toBeDefined();
  });
});
