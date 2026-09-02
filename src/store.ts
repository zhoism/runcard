import { useSyncExternalStore } from "react";
import type { Proposal } from "./lib/runs";
import { emptyInvestigation, type InvestigationState, type InvocationSource } from "./lib/investigation";
export interface ToolCall { t: number; tool: string; input: unknown; ok: boolean; summary: string; source: InvocationSource }
interface State { route: string; proposals: Proposal[]; calls: ToolCall[]; investigations: Record<string, InvestigationState>; webmcp: "unsupported" | "registering" | "registered" | "error"; tools: string[]; console: { tool: string; input: string } | null; /** a request from elsewhere on the page to open one stage's proposal thread */ openStage: string | null }
let state: State = { route: location.hash.slice(1) || "/", proposals: [], calls: [], investigations: {}, webmcp: "unsupported", tools: [], console: null, openStage: null };
const subs = new Set<() => void>();
export const get = () => state;
export function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; subs.forEach(f => f());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => sel(state));
}
window.addEventListener("hashchange", () => set({ route: location.hash.slice(1) || "/" }));
export const navigate = (r: string) => { location.hash = r; };
export function logCall(tool: string, input: unknown, ok: boolean, summary: string, source: InvocationSource) {
  set(s => ({ calls: [{ t: Date.now(), tool, input, ok, summary, source }, ...s.calls].slice(0, 50) }));
}
export function updateInvestigation(runId: string, update: (current: InvestigationState) => InvestigationState) {
  set(s => ({ investigations: { ...s.investigations, [runId]: update(s.investigations[runId] ?? emptyInvestigation(runId)) } }));
}
/** An edit that fails validation can never be approved — the Approve button is disabled, and this makes
    that a property of the store rather than of the markup. Rejecting a failing edit stays allowed. */
export function setProposalStatus(id: string, status: Proposal["status"]) {
  set(s => ({ proposals: s.proposals.map(p => p.id === id ? (status === "approved" && p.after.hasFail ? p : { ...p, status }) : p) }));
}
