import { useSyncExternalStore } from "react";
import type { Proposal } from "./lib/runs";
import { emptyInvestigation, type InvestigationState, type InvocationSource } from "./lib/investigation";
export interface ToolCall { t: number; tool: string; input: unknown; ok: boolean; summary: string; source: InvocationSource }
interface State { route: string; proposals: Proposal[]; calls: ToolCall[]; investigations: Record<string, InvestigationState>; webmcp: "unsupported" | "registering" | "registered" | "error"; tools: string[]; console: { tool: string; input: string; /** make the call at once as a page action instead of waiting for Call */ run?: boolean } | null; /** a request from elsewhere on the page to open one stage's proposal thread */ openStage: string | null }
let state: State = { route: location.hash.slice(1), proposals: [], calls: [], investigations: {}, webmcp: "unsupported", tools: [], console: null, openStage: null };
const subs = new Set<() => void>();
export const get = () => state;
export function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; subs.forEach(f => f());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => sel(state));
}
// In-page anchors (#network-…, #trust) share the hash with the router: a hash that names an element on the page scrolls
// to it and the route hash is put back, so a reload lands on the page, not on a fragment the router cannot serve.
window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1);
  if (h && !h.startsWith("/")) { const el = document.getElementById(h); if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); history.replaceState(null, "", `#${state.route}`); return; } }
  set({ route: h }); // "" is the landing (bare URL), "/" is Projects
});
export const navigate = (r: string) => { location.hash = r; };
export function logCall(tool: string, input: unknown, ok: boolean, summary: string, source: InvocationSource) {
  set(s => ({ calls: [{ t: Date.now(), tool, input, ok, summary, source }, ...s.calls].slice(0, 50) }));
}
export function updateInvestigation(runId: string, update: (current: InvestigationState) => InvestigationState) {
  set(s => ({ investigations: { ...s.investigations, [runId]: update(s.investigations[runId] ?? emptyInvestigation(runId)) } }));
}
/** How long after Approve or Reject the page offers Undo. */
export const UNDO_WINDOW_MS = 15_000;
/** An edit that fails validation can never be approved — the Approve button is disabled, and this makes
    that a property of the store rather than of the markup. Rejecting a failing edit stays allowed.
    "pending" is Undo: it returns an approved or rejected proposal to pending and clears the decision stamp;
    a proposal that is already pending has nothing to undo. Returns whether anything changed. Only the page
    calls this — no tool can approve, reject or undo. */
export function setProposalStatus(id: string, status: Proposal["status"]): boolean {
  let changed = false;
  set(s => ({ proposals: s.proposals.map(p => {
    if (p.id !== id || p.status === status || (status === "approved" && p.after.hasFail)) return p;
    changed = true;
    return status === "pending" ? { ...p, status, decided_t: undefined } : { ...p, status, decided_t: Date.now() };
  }) }));
  return changed;
}
