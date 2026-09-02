import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { makeProposal } from "../src/lib/runs";

const A = JSON.parse(readFileSync("public/runs/1l2y-regression/manifest.json", "utf8"));
// store.ts reads location and window at import time; give it the stubs webmcp.test.ts uses, fresh for every test.
async function fresh() { vi.resetModules(); vi.stubGlobal("location", { hash: "" }); vi.stubGlobal("window", { addEventListener: vi.fn() }); return await import("../src/store"); }

describe("setProposalStatus: approve, reject, undo", () => {
  it("Approve stamps when it happened; Undo returns an approved proposal to pending and clears the stamp", async () => {
    const st = await fresh(); const p = makeProposal(A, "product", { dt: "0.001" }, "halve dt"); st.set({ proposals: [p] });
    expect(p.status).toBe("pending"); expect(p.decided_t).toBeUndefined();
    expect(st.setProposalStatus(p.id, "approved")).toBe(true);
    const a = st.get().proposals[0]; expect(a.status).toBe("approved"); expect(a.decided_t).toBeTypeOf("number"); expect(Date.now() - a.decided_t!).toBeLessThan(5000);
    expect(st.setProposalStatus(p.id, "pending")).toBe(true);
    const u = st.get().proposals[0]; expect(u.status).toBe("pending"); expect(u.decided_t).toBeUndefined(); expect(u.edits).toEqual(p.edits);
  });
  it("Undo returns a rejected proposal to pending too, and it can then be approved", async () => {
    const st = await fresh(); const p = makeProposal(A, "product", { dt: "0.001" }, "halve dt"); st.set({ proposals: [p] });
    expect(st.setProposalStatus(p.id, "rejected")).toBe(true); expect(st.get().proposals[0].status).toBe("rejected");
    expect(st.setProposalStatus(p.id, "pending")).toBe(true); expect(st.get().proposals[0].status).toBe("pending");
    expect(st.setProposalStatus(p.id, "approved")).toBe(true); expect(st.get().proposals[0].status).toBe("approved");
  });
  it("a pending proposal cannot be undone: nothing changes and the store says so", async () => {
    const st = await fresh(); const p = makeProposal(A, "product", { dt: "0.001" }, "halve dt"); st.set({ proposals: [p] });
    expect(st.setProposalStatus(p.id, "pending")).toBe(false);
    expect(st.get().proposals[0]).toBe(p);
  });
  it("an edit that fails validation still cannot be approved, so there is nothing to undo either", async () => {
    const st = await fresh(); const p = makeProposal(A, "product", { dt: "0.004" }, "too long a step"); st.set({ proposals: [p] });
    expect(p.after.hasFail).toBe(true);
    expect(st.setProposalStatus(p.id, "approved")).toBe(false); expect(st.get().proposals[0]).toBe(p);
    expect(st.setProposalStatus(p.id, "pending")).toBe(false);
    expect(st.setProposalStatus(p.id, "rejected")).toBe(true); expect(st.get().proposals[0].status).toBe("rejected");
  });
  it("Undo touches only the named proposal; an unknown id changes nothing", async () => {
    const st = await fresh(); const p = makeProposal(A, "product", { dt: "0.001" }, "a"); const q = { ...makeProposal(A, "heat", { ig: "7" }, "b"), id: "other" }; st.set({ proposals: [p, q] });
    st.setProposalStatus(p.id, "approved"); st.setProposalStatus(q.id, "approved");
    expect(st.setProposalStatus(p.id, "pending")).toBe(true);
    expect(st.get().proposals.map(x => x.status)).toEqual(["pending", "approved"]);
    expect(st.setProposalStatus("no-such-id", "pending")).toBe(false);
  });
});
