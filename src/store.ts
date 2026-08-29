import { useSyncExternalStore } from "react";
import type { Proposal } from "./lib/runs";
export interface ToolCall { t: number; tool: string; input: unknown; ok: boolean; summary: string }
/** The last recompute_result call, shown as one line on that run's page (in memory only, like proposals). */
export interface Reanalysis { run: string; start_frame: number; end_frame: number; interval: number; frames_used: number; start_ps: number | null; end_ps: number | null; mean: number; corrected_sem: number; verdict: string }
interface State { route: string; proposals: Proposal[]; calls: ToolCall[]; bundle: { name: string; files: Record<string, string> } | null; reanalysis: Reanalysis | null; webmcp: "unsupported" | "registered" | "error"; tools: string[]; console: { tool: string; input: string } | null }
let state: State = { route: location.hash.slice(1) || "/", proposals: [], calls: [], bundle: null, reanalysis: null, webmcp: "unsupported", tools: [], console: null };
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
export function logCall(tool: string, input: unknown, ok: boolean, summary: string) {
  set(s => ({ calls: [{ t: Date.now(), tool, input, ok, summary }, ...s.calls].slice(0, 50) }));
}
export function setProposalStatus(id: string, status: Proposal["status"]) {
  set(s => ({ proposals: s.proposals.map(p => p.id === id ? { ...p, status } : p) }));
}
