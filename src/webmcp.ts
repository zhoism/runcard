// WebMCP tool registry. Every tool is a pure function over the run manifests
// plus the page store; the same table drives document.modelContext.registerTool
// and the in-page Tool Console (so a human can call exactly what an agent can).
import { loadIndex, loadRun, validateStage, validateAll, explainResult, diffRuns, makeProposal, rerunBundle, ensemble } from "./lib/runs";
import { get, set, logCall, navigate } from "./store";

export interface Tool { name: string; description: string; inputSchema: object; readOnly: boolean; run: (input: any) => Promise<unknown> }
const S = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: props, required });
const str = (description: string, extra: object = {}) => ({ type: "string", description, ...extra });

export const TOOLS: Tool[] = [
  { name: "list_runs", readOnly: true, description: "List every simulation run on this site: id, title, ligand, protein size, production length (ps), MM-GBSA ΔG (kcal/mol), and whether a PLIP contact profile exists.",
    inputSchema: S({}), run: async () => loadIndex() },
  { name: "get_run_manifest", readOnly: true, description: "Full validated record of one run: system (protein, ligand atom types and charge method, solvent, force fields), the ordered stage graph with every &cntrl parameter and the realized Langevin seed and wall time pmemd reported, results, environment lock, and pipeline stage envelopes. Also navigates the page to that run.",
    inputSchema: S({ run_id: str("run id from list_runs") }, ["run_id"]),
    run: async ({ run_id }) => { const m = await loadRun(run_id); navigate(`/run/${run_id}`); return { ...m, stages: m.stages.map(s => ({ ...s, mdin: undefined })), leap_in: undefined }; } },
  { name: "get_stage_input", readOnly: true, description: "The exact AMBER .in (mdin) text of one stage of a run, plus what it restarts from.",
    inputSchema: S({ run_id: str("run id"), stage: str("stage name, e.g. min1, heat, density, product") }, ["run_id", "stage"]),
    run: async ({ run_id, stage }) => { const m = await loadRun(run_id); const s = m.stages.find(x => x.name === stage); if (!s) throw new Error(`no stage ${stage}; have ${m.stages.map(x => x.name).join(", ")}`); return { stage: s.name, role: s.role, restart_from: s.restart_from, mdin: s.mdin }; } },
  { name: "validate_stage", readOnly: true, description: "Run the AMBER physics validator on one stage of a run, or on arbitrary mdin text you supply. Checks: dt ≤ 2 fs with SHAKE (1 fs without), SHAKE ntc/ntf coherence, cutoff 8–12 Å, Langevin gamma_ln range, temp0 vs &wt ramp end, irest/ntx restart coherence, barostat/ntp coherence, fixed seeds, iwrap on long runs, non-finite numbers. Returns PASS/WARN/FAIL findings with the reason for each.",
    inputSchema: S({ run_id: str("run id (omit if passing mdin_text)"), stage: str("stage name (omit if passing mdin_text)"), mdin_text: str("raw AMBER .in text to validate instead of a stored stage") }),
    run: async ({ run_id, stage, mdin_text }) => { if (mdin_text) { const { checkAmberIn } = await import("./lib/amberCheck"); return { stage: "(supplied text)", ...checkAmberIn(mdin_text) }; } if (!run_id) throw new Error("run_id or mdin_text required"); const m = await loadRun(run_id); return stage ? validateStage(m, stage) : validateAll(m); } },
  { name: "explain_result", readOnly: true, description: "What the MM-GBSA ΔG of a run means and how much to trust it: method, frames, per-frame SD/SEM and why SEM understates uncertainty, the requested vs realized random seed, the run-to-run spread across independent runs of the same system (n, mean, SD, range), the sign claim that is actually supported, any MMPBSA warnings verbatim, and provenance (versions, dates).",
    inputSchema: S({ run_id: str("run id") }, ["run_id"]), run: async ({ run_id }) => explainResult(await loadRun(run_id), await loadIndex()) },
  { name: "diff_runs", readOnly: true, description: "Semantic diff of two runs: whether they are the same prepared system (ligand, atom types, protein, solvent, force fields), which &cntrl parameters differ per stage with each parameter's meaning and whether it is scientifically material, the realized seeds, both ΔG values, the run-to-run spread, and an interpretation of whether a ΔG difference is protocol, system, or sampling noise. Also opens the compare view.",
    inputSchema: S({ run_a: str("first run id"), run_b: str("second run id") }, ["run_a", "run_b"]),
    run: async ({ run_a, run_b }) => { const [a, b, i] = await Promise.all([loadRun(run_a), loadRun(run_b), loadIndex()]); navigate(`/compare/${run_a}/${run_b}`); return diffRuns(a, b, i); } },
  { name: "propose_change", readOnly: false, description: "Propose a bounded edit to one stage's &cntrl parameters (e.g. {\"dt\":\"0.001\"} or {\"nstlim\":\"50000\",\"iwrap\":\"1\"}). The proposal is validated before and after and shown to the human in the Proposals panel; NOTHING is applied until a person clicks Approve. Returns the proposal id and both validation reports. Only &cntrl keys are editable; masks and file paths are not.",
    inputSchema: S({ run_id: str("run id"), stage: str("stage name"), edits: { type: "object", description: "map of &cntrl key → new value, as strings", additionalProperties: { type: "string" } }, reason: str("one sentence: why this change") }, ["run_id", "stage", "edits", "reason"]),
    run: async ({ run_id, stage, edits, reason }) => { const p = makeProposal(await loadRun(run_id), stage, edits, reason); set(s => ({ proposals: [p, ...s.proposals] })); navigate(`/run/${run_id}`); return { proposal_id: p.id, status: p.status, before: p.before, after: p.after, note: "Awaiting human approval in the Proposals panel." }; } },
  { name: "list_proposals", readOnly: true, description: "Proposals made on this page and their status (pending / approved / rejected). Only approved proposals are applied to a rerun bundle.",
    inputSchema: S({}), run: async () => get().proposals.map(p => ({ id: p.id, run: p.run, stage: p.stage, edits: p.edits, reason: p.reason, status: p.status, after_verdict: p.after.hasFail ? "FAIL" : p.after.hasWarn ? "WARN" : "PASS" })) },
  { name: "generate_rerun_bundle", readOnly: false, description: "Build a reproduction bundle for a run: all stage .in files (with any APPROVED proposals applied), leap.in, run.sh for a local machine or a SLURM cluster, the environment pins, and a README. seed='pinned' writes the seed pmemd actually used so the run replays exactly on the same build; seed='fresh' keeps ig=-1 for an independent sample. The bundle appears on the page as a download for the human; the tool returns the file list and the README.",
    inputSchema: S({ run_id: str("run id"), seed: str("pinned or fresh", { enum: ["pinned", "fresh"] }), target: str("local or slurm", { enum: ["local", "slurm"] }) }, ["run_id", "seed", "target"]),
    run: async ({ run_id, seed, target }) => { const m = await loadRun(run_id); const approved = get().proposals.filter(p => p.run === run_id && p.status === "approved"); const files = rerunBundle(m, { seed, target, approved }); set({ bundle: { name: `${run_id}-rerun-${seed}-${target}.zip`, files } }); navigate(`/run/${run_id}`); return { files: Object.keys(files), applied_proposals: approved.map(p => p.id), readme: files["README.md"], run_sh: files["run.sh"] }; } },
  { name: "get_ensemble", readOnly: true, description: "Run-to-run statistics for every run of the same prepared system as run_id: n, mean, SD, min, max of ΔG and each run's production length.",
    inputSchema: S({ run_id: str("run id") }, ["run_id"]), run: async ({ run_id }) => ensemble(await loadIndex(), run_id) },
];

export async function callTool(name: string, input: unknown): Promise<string> {
  const t = TOOLS.find(t => t.name === name); if (!t) throw new Error(`unknown tool ${name}`);
  try { const out = await t.run(input ?? {}); const s = JSON.stringify(out); logCall(name, input, true, s.slice(0, 120)); return s; }
  catch (e: any) { logCall(name, input, false, String(e?.message ?? e)); return JSON.stringify({ error: String(e?.message ?? e) }); }
}

export async function registerWebMCP() {
  const mc: any = (document as any).modelContext ?? (navigator as any).modelContext;
  if (!mc?.registerTool) { set({ webmcp: "unsupported", tools: TOOLS.map(t => t.name) }); return; }
  try {
    for (const t of TOOLS) {
      await mc.registerTool({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly },
        execute: async (a: any) => callTool(t.name, a?.inputParams ?? a) });
    }
    set({ webmcp: "registered", tools: TOOLS.map(t => t.name) });
  } catch (e) { console.error("WebMCP registration failed", e); set({ webmcp: "error", tools: TOOLS.map(t => t.name) }); }
}
