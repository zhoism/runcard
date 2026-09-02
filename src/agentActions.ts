// What an agent can do on a run, in a reader's words. One table drives the verbs on the agent rail and the
// "What an agent can do here" card on the landing page. Each row names the tool it really calls (src/webmcp.ts) and
// the input it sends for a run; nothing here is a mock. `prefill` marks the one that prepares a change to a scientific
// input: it is put into the console for a person to Call, and the proposals it creates then wait for Approve.
export interface AgentAction {
  id: string;
  verb: string;
  /** what the tool reads and returns, one sentence */
  does: string;
  tool: string;
  input: (runId: string) => Record<string, unknown>;
  /** prepare the call in the console instead of making it: the tool creates proposals that wait for a person's Approve */
  prefill?: boolean;
}

export const AGENT_ACTIONS: AgentAction[] = [
  { id: "explain", verb: "Explain the run", does: "What was simulated, the ΔG with the uncertainty that applies to it, the drift verdict and the archived warnings, in words.", tool: "explain_result", input: r => ({ run_id: r }) },
  { id: "trace", verb: "Trace a result to its source files", does: "Each rung of the confidence ladder with the numbers, windows and files it was read from.", tool: "confidence_ladder", input: r => ({ run_id: r, detail: true }) },
  { id: "recompute", verb: "Verify a metric by recomputing it", does: "ΔG recomputed in the browser from the archived per-frame energies and compared with the archived value; the archive is unchanged.", tool: "recompute_result", input: r => ({ run_id: r }) },
  { id: "ensemble", verb: "Check cohort comparability", does: "The independent runs of the same prepared system: n, mean, run-to-run SD, and which engines and lengths are mixed.", tool: "get_ensemble", input: r => ({ run_id: r }) },
  { id: "forks", verb: "Compare the replicates", does: "The runs forked from this one and whether they reproduce it beyond seed noise, with an engine change named when it confounds that.", tool: "fork_network", input: r => ({ run_id: r }) },
  { id: "plan", verb: "Recommend the next experiment", does: "How many more independent runs, at what length, to reach a target uncertainty on the ensemble mean; expected, not measured.", tool: "plan_sampling", input: r => ({ run_id: r }) },
  { id: "fork", verb: "Prepare a bounded fork", does: "One treatment variable changed, every other condition held and listed; becomes proposals pinned to the stages they touch, waiting for your Approve.", tool: "fork_experiment", input: r => ({ run_id: r, kind: "extend", treatment: { key: "temp0", value: "310.0" }, question: "Does binding weaken at 310 K?" }), prefill: true },
];
