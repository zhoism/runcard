// WebMCP tool registry. Every tool is a pure function over the run manifests
// plus the page store; the same table drives document.modelContext.registerTool
// and the in-page Tool Console (so a human can call exactly what an agent can).
import { loadIndex, loadRun, validateStage, validateAll, explainResult, diffRuns, makeProposal, rerunBundle, ensemble, recomputeResult, planSampling, verdictOf } from "./lib/runs";
import { get, set, logCall, navigate } from "./store";
import { checkAmberIn } from "./lib/amberCheck";

export interface Tool { name: string; description: string; inputSchema: object; readOnly: boolean; run: (input: any) => Promise<unknown> }
const S = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: props, required });
const str = (description: string, extra: object = {}) => ({ type: "string", description, ...extra });

export const TOOLS: Tool[] = [
  { name: "list_runs", readOnly: true, description: "Which simulation runs are on this site? Lists every run: id, title, ligand, protein size, production length (ps), MM-GBSA ΔG (kcal/mol), and whether a PLIP contact profile exists.",
    inputSchema: S({}), run: async () => loadIndex() },
  { name: "get_run_manifest", readOnly: true, description: "What exactly was simulated in one run? The full validated record: system (protein, ligand atom types and charge method, solvent, force fields), the ordered stage graph with every &cntrl parameter and the realized Langevin seed and wall time pmemd reported, results, environment lock, and pipeline stage envelopes. Also navigates the page to that run.",
    inputSchema: S({ run_id: str("run id from list_runs") }, ["run_id"]),
    run: async ({ run_id }) => { const m = await loadRun(run_id); navigate(`/run/${run_id}`); return { ...m, stages: m.stages.map(s => ({ ...s, mdin: undefined })) }; } },
  { name: "get_stage_input", readOnly: true, description: "What was the exact input for one stage? The verbatim AMBER .in (mdin) text of that stage, plus what it restarts from.",
    inputSchema: S({ run_id: str("run id"), stage: str("stage name, e.g. min1, heat, density, product") }, ["run_id", "stage"]),
    run: async ({ run_id, stage }) => { const m = await loadRun(run_id); const s = m.stages.find(x => x.name === stage); if (!s) throw new Error(`no stage ${stage}; have ${m.stages.map(x => x.name).join(", ")}`); return { stage: s.name, role: s.role, restart_from: s.restart_from, mdin: s.mdin }; } },
  { name: "validate_stage", readOnly: true, description: "Is this stage's input physically sane? Runs the AMBER validator on one stage of a run (or every stage if stage is omitted), or on arbitrary mdin text you supply. Checks: dt ≤ 2 fs with SHAKE (1 fs without), SHAKE ntc/ntf coherence, cutoff 8–12 Å, Langevin gamma_ln range, temp0 vs &wt ramp end, irest/ntx restart coherence, barostat/ntp coherence, fixed seeds, iwrap on long runs, non-finite numbers. Returns PASS/WARN/FAIL findings with the reason for each.",
    inputSchema: S({ run_id: str("run id (omit if passing mdin_text)"), stage: str("stage name (omit if passing mdin_text)"), mdin_text: str("raw AMBER .in text to validate instead of a stored stage") }),
    run: async ({ run_id, stage, mdin_text }) => { if (mdin_text) { return { stage: "(supplied text)", ...checkAmberIn(mdin_text) }; } if (!run_id) throw new Error("run_id or mdin_text required"); const m = await loadRun(run_id); return stage ? validateStage(m, stage) : validateAll(m); } },
  { name: "explain_result", readOnly: true, description: "What does this run's ΔG mean and how much should I trust it? Starts with a three-sentence brief, then the numbers computed from the archived per-frame energies: naive per-frame SEM vs the autocorrelation-corrected SEM (statistical inefficiency g, N_eff, block-averaging plateau), first-half vs second-half drift with a stated verdict, which uncertainty to quote and why, the requested vs realized random seed, the run-to-run spread across independent runs of the same system (all runs and runs ≥ 10 ps: n, mean, SD, range), the sign claim actually supported, any MMPBSA warning verbatim plus the size of the internal-term residual that triggered it, and provenance (versions, dates, source files).",
    inputSchema: S({ run_id: str("run id") }, ["run_id"]), run: async ({ run_id }) => explainResult(await loadRun(run_id), await loadIndex()) },
  { name: "diff_runs", readOnly: true, description: "Why do two runs differ? Semantic diff: whether they are the same prepared system (ligand, atom types, protein, solvent, force fields), which &cntrl parameters differ per stage with each parameter's meaning and whether it is scientifically material, the realized seeds, both ΔG values, the run-to-run spread, and an interpretation of whether a ΔG difference is protocol, system, or sampling noise. Also opens the compare view.",
    inputSchema: S({ run_a: str("first run id"), run_b: str("second run id") }, ["run_a", "run_b"]),
    run: async ({ run_a, run_b }) => { const [a, b, i] = await Promise.all([loadRun(run_a), loadRun(run_b), loadIndex()]); navigate(`/compare/${run_a}/${run_b}`); return diffRuns(a, b, i); } },
  { name: "propose_change", readOnly: false, description: "Propose a bounded edit to one stage's &cntrl parameters (e.g. {\"dt\":\"0.001\"} or {\"nstlim\":\"50000\",\"iwrap\":\"1\"}). The proposal is validated before and after and shown to the human in the Proposals panel; NOTHING is applied until a person clicks Approve. Returns the proposal id and both validation reports. Only &cntrl keys are editable; masks and file paths are not.",
    inputSchema: S({ run_id: str("run id"), stage: str("stage name"), edits: { type: "object", description: "map of &cntrl key → new value, as strings", additionalProperties: { type: "string" } }, reason: str("one sentence: why this change") }, ["run_id", "stage", "edits", "reason"]),
    run: async ({ run_id, stage, edits, reason }) => { const p = makeProposal(await loadRun(run_id), stage, edits, reason); set(s => ({ proposals: [p, ...s.proposals] })); navigate(`/run/${run_id}`); return { proposal_id: p.id, status: p.status, before: p.before, after: p.after, note: p.after.hasFail ? "Cannot be approved: the edited stage FAILS validation (see after.findings). Revise the edit and propose again." : "Awaiting human approval in the Proposals panel." }; } },
  { name: "list_proposals", readOnly: true, description: "Which proposals exist on this page and what is their status? Lists them (pending / approved / rejected). Only approved proposals are applied to a rerun bundle.",
    inputSchema: S({}), run: async () => get().proposals.map(p => ({ id: p.id, run: p.run, stage: p.stage, edits: p.edits, reason: p.reason, status: p.status, after_verdict: verdictOf(p.after) })) },
  { name: "generate_rerun_bundle", readOnly: false, description: "How do I rerun this simulation? Builds a reproduction bundle: all stage .in files (with any APPROVED proposals applied), leap.in, run.sh for a local machine or a SLURM cluster, the environment pins, and a README. seed='pinned' writes the seed pmemd actually used so the run replays exactly on the same build; seed='fresh' keeps ig=-1 for an independent sample. The bundle appears on the page as a download for the human; the tool returns the file list and the README.",
    inputSchema: S({ run_id: str("run id"), seed: str("pinned or fresh", { enum: ["pinned", "fresh"] }), target: str("local or slurm", { enum: ["local", "slurm"] }) }, ["run_id", "seed", "target"]),
    run: async ({ run_id, seed, target }) => { const m = await loadRun(run_id); const approved = get().proposals.filter(p => p.run === run_id && p.status === "approved"); const files = rerunBundle(m, { seed, target, approved }); set({ bundle: { name: `${run_id}-rerun-${seed}-${target}.zip`, files } }); navigate(`/run/${run_id}`); return { files: Object.keys(files), applied_proposals: approved.map(p => p.id), readme: files["README.md"], run_sh: files["run.sh"] }; } },
  { name: "get_ensemble", readOnly: true, description: "How much does ΔG vary across independent runs of this system? Run-to-run statistics for every run of the same prepared system as run_id (same ligand, atom types, charges, protein, force fields, solvent, box): n, mean, SD, min, max of ΔG for all runs and for runs ≥ 10 ps, with each run's production length.",
    inputSchema: S({ run_id: str("run id") }, ["run_id"]), run: async ({ run_id }) => ensemble(await loadIndex(), run_id) },
  { name: "recompute_result", readOnly: true, description: "What is ΔG if I drop the first 20 frames as equilibration, or use every other frame? Re-analyses the archived per-frame MM-GBSA energies in the browser over a window you choose (start_frame/end_frame, 1-based; interval; or discard_ps to drop the first X ps): mean ΔG, per-frame SD, autocorrelation-corrected SEM, N_eff, block averaging and drift verdict for that window, per-term means, and the difference from the archived value in corrected-SEM units. MMPBSA.py is not rerun; the full window reproduces mmgbsa.dat exactly. Shows the result under the ΔG card.",
    inputSchema: S({ run_id: str("run id"), start_frame: { type: "integer", description: "first frame, 1-based (default 1)" }, end_frame: { type: "integer", description: "last frame, inclusive (default: all)" }, interval: { type: "integer", description: "keep every k-th frame (default 1)" }, discard_ps: { type: "number", description: "drop the first X ps as equilibration (instead of start_frame)" } }, ["run_id"]),
    run: async ({ run_id, ...w }) => { const r = recomputeResult(await loadRun(run_id), w); set({ reanalysis: { run: run_id, start_frame: r.window.start_frame, end_frame: r.window.end_frame, interval: r.window.interval, frames_used: r.window.frames_used, start_ps: r.window.start_ps, end_ps: r.window.end_ps, mean: r.delta_g.mean, corrected_sem: r.delta_g.corrected_sem, verdict: r.delta_g.verdict } }); navigate(`/run/${run_id}`); return r; } },
  { name: "plan_sampling", readOnly: true, description: "How much more sampling do I need to reach ±X kcal/mol on ΔG? Expected, not measured: from the run-to-run SD across independent runs of this system, the number of additional runs (ig=-1) for the SEM of the ensemble mean to reach the target; from this run's per-frame SD and autocorrelation time, the expected corrected SEM of one run at 5–100 ps and the length at which one run reaches the target; which of the two limits the answer; and the nstlim an agent can pass to propose_change (this tool proposes nothing). Every projection is labelled expected with its assumptions.",
    inputSchema: S({ run_id: str("run id"), target_uncertainty_kcal: { type: "number", description: "target SEM of the ensemble-mean ΔG, kcal/mol (default 0.25)" }, min_run_ps: { type: "number", description: "minimum production length for new runs, ps (default 10)" } }, ["run_id"]),
    run: async ({ run_id, ...o }) => planSampling(await loadRun(run_id), await loadIndex(), o) },
];

/** One readable line per call for the Tool Calls panel, so a human can follow what the agent learned without reading JSON. */
function summarize(name: string, out: any): string {
  const f = (x: unknown, d = 2) => typeof x === "number" ? x.toFixed(d) : "—";
  const verdict = (r: any) => verdictOf({ hasFail: !!r?.hasFail, hasWarn: !!r?.hasWarn });
  try {
    switch (name) {
      case "list_runs": return `${out.length} runs`;
      case "get_run_manifest": return `${out.title} — ${out.stages.length} stages, ΔG ${f(out.results?.mmgbsa?.delta_total_kcal_mol)} kcal/mol; page opened`;
      case "get_stage_input": return `${out.stage} (${out.role}), restarts from ${out.restart_from || "initial coordinates"}, ${out.mdin.length} chars`;
      case "validate_stage": return out.stages
        ? `${out.run}: ${out.verdict} — ${out.stages.map((s: any) => `${s.stage} ${verdict(s)}`).join(", ")}`
        : `${out.stage}: ${verdict(out)} — ${out.findings.filter((x: any) => x.level !== "PASS").map((x: any) => `${x.level} ${x.rule}`).join(", ") || "no warnings"}`;
      case "explain_result": return out.brief ?? out.error ?? "";
      case "diff_runs": return `${out.same_system ? "same prepared system" : "different systems"}; material: ${out.material_classes?.join(", ") || "none"}; ${out.same_system ? `ΔΔG ${f(out.delta_g?.diff)}` : "ΔΔG n/a (different complexes)"}; compare view opened`;
      case "get_ensemble": return `n=${out.all.n}, mean ${f(out.all.mean)}, SD ${f(out.all.sd)} (≥${out.long.min_ps} ps: n=${out.long.n}, SD ${f(out.long.sd)})`;
      case "propose_change": return `${out.status}: before ${verdict(out.before)} → after ${verdict(out.after)}; ${out.after?.hasFail ? "cannot be approved (fails validation)" : "awaiting your Approve"}`;
      case "list_proposals": return `${out.length} proposals (${out.filter((p: any) => p.status === "pending").length} pending)`;
      case "generate_rerun_bundle": return `${out.files.length} files, ${out.applied_proposals.length} approved edit${out.applied_proposals.length === 1 ? "" : "s"} applied; download on the page`;
      case "recompute_result": { const w = out.window; return `frames ${w.start_frame}–${w.end_frame}${w.interval > 1 ? ` every ${w.interval}th` : ""} (${w.frames_used}): ΔG ${f(out.delta_g.mean)} ± ${f(out.delta_g.corrected_sem)}, ${out.delta_g.verdict}; Δ vs archived ${f(out.vs_archived.diff)}; shown on the page`; }
      case "plan_sampling": { const r = out.run_to_run, L = f(out.within_run.expected_length_for_target_ps, 0), T = out.target_uncertainty_kcal; return r.planned_on
        ? `expected: ${r.additional_runs} more run${r.additional_runs === 1 ? "" : "s"} ≥ ${out.recommended_run_ps} ps for ±${T} (${r.planned_on} stratum: n=${r.n_now}, SD ${f(r.sd_used)}); one run alone would need ≈ ${L} ps`
        : `expected: only run of its system, no run-to-run estimate; one run alone would need ≈ ${L} ps for ±${T}; ≥ 3 independent runs of ≥ ${out.recommended_run_ps} ps before an ensemble uncertainty can be quoted`; }
    }
  } catch { /* fall through */ }
  return JSON.stringify(out).slice(0, 160);
}

export async function callTool(name: string, input: unknown): Promise<string> {
  const t = TOOLS.find(t => t.name === name); if (!t) throw new Error(`unknown tool ${name}`);
  try { const out = await t.run(input ?? {}); logCall(name, input, true, summarize(name, out)); return JSON.stringify(out); }
  catch (e: any) { logCall(name, input, false, String(e?.message ?? e)); return JSON.stringify({ error: String(e?.message ?? e) }); }
}

export async function registerWebMCP() {
  const mc: any = (navigator as any).modelContext ?? (window as any).modelContext ?? (document as any).modelContext;
  if (!mc?.registerTool) { set({ webmcp: "unsupported", tools: TOOLS.map(t => t.name) }); return; }
  try {
    for (const t of TOOLS) {
      await mc.registerTool({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly },
        execute: async (a: any) => callTool(t.name, a?.inputParams ?? a) });
    }
    set({ webmcp: "registered", tools: TOOLS.map(t => t.name) });
  } catch (e) { console.error("WebMCP registration failed", e); set({ webmcp: "error", tools: TOOLS.map(t => t.name) }); }
}
