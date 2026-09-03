// WebMCP tool registry. Every tool is a pure function over the run manifests
// plus the page store; the same table drives document.modelContext.registerTool
// and the in-page Tool Console (so a human can call exactly what an agent can).
import { loadIndex, loadRun, validateStage, validateAll, explainResult, diffRuns, makeProposal, rerunBundle, bundleGaps, ensemble, recomputeResult, planSampling, verdictOf, confidenceLadder, forkExperiment, forkNetwork } from "./lib/runs";
import { get, set, logCall, navigate, updateInvestigation } from "./store";
import { investigateRun } from "./lib/investigate";
import { checkAmberIn } from "./lib/amberCheck";
import { buildEvidenceBrief, safeBriefFilename } from "./lib/evidenceBrief";
import type { BundleSnapshot, EvidenceBriefSnapshot, InvocationSource } from "./lib/investigation";

export interface Tool { name: string; description: string; inputSchema: object; readOnly: boolean; run: (input: any) => Promise<unknown> }
const S = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: props, required });
const str = (description: string, extra: object = {}) => ({ type: "string", description, ...extra });

export const TOOLS: Tool[] = [
  { name: "list_runs", readOnly: true, description: "When do I need an inventory of available simulation runs? Returns each run's owner, id, title, system summary, production length, MM-GBSA ΔG, and PLIP availability. It leaves nothing on the page.",
    inputSchema: S({}), run: async () => loadIndex() },
  { name: "get_run_manifest", readOnly: true, description: "When do I need the complete record for one run? Returns its validated system, stages and parameters, realized seed and timing, results, environment, and pipeline envelopes. It navigates the page; leaves nothing.",
    inputSchema: S({ run_id: str("run id from list_runs") }, ["run_id"]),
    run: async ({ run_id }) => { const m = await loadRun(run_id); navigate(`/run/${run_id}`); return { ...m, stages: m.stages.map(s => ({ ...s, mdin: undefined })) }; } },
  { name: "get_stage_input", readOnly: true, description: "When do I need the exact input for a simulation stage? Returns the verbatim AMBER mdin text, stage role, and restart source. It leaves nothing on the page.",
    inputSchema: S({ run_id: str("run id"), stage: str("stage name, e.g. min1, heat, density, product") }, ["run_id", "stage"]),
    run: async ({ run_id, stage }) => { const m = await loadRun(run_id); const s = m.stages.find(x => x.name === stage); if (!s) throw new Error(`no stage ${stage}; have ${m.stages.map(x => x.name).join(", ")}`); return { stage: s.name, role: s.role, restart_from: s.restart_from, mdin: s.mdin }; } },
  { name: "validate_stage", readOnly: true, description: "When should I check whether AMBER input is physically sane? Returns PASS, WARN, or FAIL findings for one stored stage, every stage, or supplied mdin text across timestep, SHAKE, cutoff, thermostat, ramp, restart, barostat, seed, wrapping, and numeric checks. It leaves nothing on the page.",
    inputSchema: S({ run_id: str("run id (omit if passing mdin_text)"), stage: str("stage name (omit if passing mdin_text)"), mdin_text: str("raw AMBER .in text to validate instead of a stored stage") }),
    run: async ({ run_id, stage, mdin_text }) => { if (mdin_text) { return { stage: "(supplied text)", ...checkAmberIn(mdin_text) }; } if (!run_id) throw new Error("run_id or mdin_text required"); const m = await loadRun(run_id); return stage ? validateStage(m, stage) : validateAll(m); } },
  { name: "explain_result", readOnly: true, description: "When do I need to understand a run's ΔG and uncertainty? Returns the meaning, deciding statistics, drift, supported sign claim, warnings, seeds, peer spread, and provenance; for evidence rungs use confidence_ladder, for automode that picks its own tools use investigate_run, and for a new analysis window use recompute_result. It leaves nothing on the page.",
    inputSchema: S({ run_id: str("run id"), detail: { type: "boolean", description: "false: brief and deciding numbers; true: full statistics, seeds, warnings, provenance" } }, ["run_id"]), run: async ({ run_id, detail }) => explainResult(await loadRun(run_id), await loadIndex(), detail === true) },
  { name: "diff_runs", readOnly: true, description: "When should I compare two runs? Returns a semantic diff of system preparation, stage parameters, seeds, ΔG, sampling spread, and whether differences reflect protocol, system, or noise. It navigates the page; leaves nothing.",
    inputSchema: S({ run_a: str("first run id"), run_b: str("second run id") }, ["run_a", "run_b"]),
    run: async ({ run_a, run_b }) => { const [a, b, i] = await Promise.all([loadRun(run_a), loadRun(run_b), loadIndex()]); navigate(`/compare/${run_a}/${run_b}`); return diffRuns(a, b, i); } },
  { name: "propose_change", readOnly: false, description: "When should I propose one &cntrl edit to one stage? Returns a pending, before-and-after validated proposal; for a controlled reproduce, replicate, or one-variable extension use fork_experiment. It leaves the proposal on the page, and nothing is applied until a person clicks Approve.",
    inputSchema: S({ run_id: str("run id"), stage: str("stage name"), edits: { type: "object", description: "map of &cntrl key → new value, as strings", additionalProperties: { type: "string" } }, reason: str("one sentence: why this change") }, ["run_id", "stage", "edits", "reason"]),
    run: async ({ run_id, stage, edits, reason }) => { const p = makeProposal(await loadRun(run_id), stage, edits, reason); set(s => ({ proposals: [p, ...s.proposals] })); navigate(`/run/${run_id}`); return { proposal_id: p.id, status: p.status, changes: p.changes, material_classes: p.material_classes, before: p.before, after: p.after, mdin_after: p.mdin_after, note: p.after.hasFail ? "Cannot be approved: the edited stage FAILS validation (see after.findings). Revise the edit and propose again." : "Awaiting human approval in the Proposals panel." }; } },
  { name: "list_proposals", readOnly: true, description: "When should I inspect proposed edits and their status? Returns every page proposal as pending, approved, or rejected; only approved proposals enter rerun bundles. It leaves nothing on the page.",
    inputSchema: S({}), run: async () => get().proposals.map(p => ({ id: p.id, run: p.run, stage: p.stage, edits: p.edits, reason: p.reason, status: p.status, after_verdict: verdictOf(p.after) })) },
  { name: "generate_rerun_bundle", readOnly: false, description: "When do I need files to reproduce or rerun this simulation? Returns a local or SLURM bundle with stage inputs, archived build inputs, environment pins, lineage, scripts, README, approved edits, and any gaps; pinned seeds replay the run, while fresh seeds sample independently. It leaves a downloadable bundle on the page.",
    inputSchema: S({ run_id: str("run id"), seed: str("pinned or fresh", { enum: ["pinned", "fresh"] }), target: str("local or slurm", { enum: ["local", "slurm"] }) }, ["run_id", "seed", "target"]),
    run: async ({ run_id, seed, target }) => { const m = await loadRun(run_id); const approved = get().proposals.filter(p => p.run === run_id && p.status === "approved");
      // Archived build inputs travel with the bundle; a file that fails to fetch is reported as a gap, not silently dropped.
      const buildFiles: Record<string, string> = {};
      for (const name of m.system.build_inputs?.present ?? []) { try { const r = await fetch(`/runs/${run_id}/build/${name}`); if (r.ok) buildFiles[name] = await r.text(); } catch { /* reported via gaps */ } }
      const files = rerunBundle(m, { seed, target, approved, buildFiles }); const gaps = bundleGaps(m, buildFiles);
      const generatedAt = new Date().toISOString(); const name = `${run_id}-rerun-${seed}-${target}.zip`;
      const changedStages = approved.map(p => ({ stage: p.stage, file: `md/${p.stage}.in`, changes: p.changes, fork: p.fork?.id ?? null }));
      const forkIds = [...new Set(approved.flatMap(p => p.fork?.id ? [p.fork.id] : []))];
      const forks = forkIds.map(id => { const meta = approved.find(p => p.fork?.id === id)!.fork!; const appliedStages = [...new Set(approved.filter(p => p.fork?.id === id).map(p => p.stage))]; const missingStages = meta.stages.filter(stage => !appliedStages.includes(stage)); return { id, question: meta.question, intendedStages: [...meta.stages], appliedStages, missingStages, complete: missingStages.length === 0 }; });
      const snapshot: BundleSnapshot = { runId: run_id, name, files, seed, target, generatedAt, appliedProposalIds: approved.map(p => p.id), appliedProposals: approved.map(p => structuredClone(p)), changedStages, forks, combinesMultipleForks: forks.length > 1, selfContained: gaps.length === 0, missingInputs: gaps };
      navigate(`/run/${run_id}`);
      return { files: Object.keys(files), self_contained: gaps.length === 0, still_needed_from_original_build: gaps, applied_proposals: approved.map(p => p.id), changed_stages: changedStages, generated_at: generatedAt, readme: files["README.md"], run_sh: files["run.sh"], _bundle: snapshot }; } },
  { name: "get_ensemble", readOnly: true, description: "When do I need variation across independent peers of the same prepared system? Returns run-level ΔG statistics for all peers and peers at least 10 ps; for children forked from this run use fork_network. It leaves nothing on the page.",
    inputSchema: S({ run_id: str("run id") }, ["run_id"]), run: async ({ run_id }) => ensemble(await loadIndex(), run_id) },
  { name: "recompute_result", readOnly: false, description: "When should I re-analyse a different frame window or stride? Returns browser-computed ΔG statistics, drift, terms, and change from the archive without rerunning MMPBSA.py; for what the archived number means use explain_result. It leaves the reanalysis on the page and does not change archived inputs or results.",
    inputSchema: S({ run_id: str("run id"), start_frame: { type: "integer", description: "first frame, 1-based (default 1)" }, end_frame: { type: "integer", description: "last frame, inclusive (default: all)" }, interval: { type: "integer", description: "keep every k-th frame (default 1)" }, discard_ps: { type: "number", description: "drop the first X ps as equilibration (instead of start_frame)" } }, ["run_id"]),
    run: async ({ run_id, ...w }) => { const r = recomputeResult(await loadRun(run_id), w); navigate(`/run/${run_id}`); return r; } },
  { name: "plan_sampling", readOnly: false, description: "When should I estimate additional sampling for a target ΔG uncertainty? Returns an expected, not measured, plan from peer variation and within-run autocorrelation, including additional runs, projected lengths, limiting factor, assumptions, and a possible nstlim value. It leaves the sampling plan on the page and proposes no change.",
    inputSchema: S({ run_id: str("run id"), target_uncertainty_kcal: { type: "number", description: "target SEM of the ensemble-mean ΔG, kcal/mol (default 0.25)" }, min_run_ps: { type: "number", description: "minimum production length for new runs, ps (default 10)" }, detail: { type: "boolean", description: "false: recommendation and arithmetic; true: adds SEM table, strata, and formulas" } }, ["run_id"]),
    run: async ({ run_id, ...o }) => planSampling(await loadRun(run_id), await loadIndex(), o) },
  { name: "confidence_ladder", readOnly: true, description: "When do I need to assess the evidence behind a result? Returns statuses and next steps for recomputable, repeatable, independently replicated, analysis-window robust, and externally supported rungs; for what the number means use explain_result, and for automode that picks its own tools use investigate_run. It leaves nothing on the page.",
    inputSchema: S({ run_id: str("run id"), detail: { type: "boolean", description: "false: rung status and reason; true: evidence, windows, source files, and method" } }, ["run_id"]), run: async ({ run_id, detail }) => confidenceLadder(await loadRun(run_id), await loadIndex(), detail === true) },
  { name: "fork_network", readOnly: true, description: "When do I need results from children forked from this run? Returns fork lineage, engines, lengths, ΔG values, cohort spread, and agreement or tension with the parent; for independent peers of the same prepared system use get_ensemble. It leaves nothing on the page.",
    inputSchema: S({ run_id: str("run id — usually the parent") }, ["run_id"]), run: async ({ run_id }) => forkNetwork(await loadIndex(), run_id) },
  { name: "fork_experiment", readOnly: false, description: "When should I design a controlled fork instead of one stage edit? Returns reproduce with pinned seeds to establish repeatability, replicate with independent seeds to establish independent replication, or extend to test one variable with controls held; for one edit to one stage use propose_change. It leaves pending proposals on the page, and nothing is applied until a person clicks Approve.",
    inputSchema: S({ run_id: str("run id"), kind: str("reproduce, replicate or extend", { enum: ["reproduce", "replicate", "extend"] }), treatment: { type: "object", description: "extend only: the one variable to change", properties: { key: str("&cntrl key, e.g. temp0"), value: str("new value as a string, e.g. 310.0") }, required: ["key", "value"] }, question: str("extend only: the scientific question, one sentence"), stages: { type: "array", items: { type: "string" }, description: "extend only: override which stages receive the treatment" } }, ["run_id", "kind"]),
    run: async ({ run_id, ...o }) => { const r = forkExperiment(await loadRun(run_id), await loadIndex(), o); const { _proposals, ...out } = r as any; if (_proposals?.length) set(s => ({ proposals: [..._proposals, ...s.proposals] })); navigate(`/run/${run_id}`); return out; } },
  { name: "investigate_run", readOnly: false, description: "When should automode diagnose a run and choose its own tools? Returns an adaptive read-only-tool trace, quoted result and uncertainty, bottleneck evidence rung, and one next action; for what the number means use explain_result, and for evidence rungs use confidence_ladder. It creates nothing—no proposal, bundle, or input change—and leaves only the trace on the page.",
    inputSchema: S({ run_id: str("id of the run to investigate") }, ["run_id"]),
    run: async ({ run_id }: any) => {
      const [m, idx] = await Promise.all([loadRun(run_id), loadIndex()]);
      navigate(`#/run/${run_id}`);
      return investigateRun(m, idx);
    } },
  { name: "export_evidence_brief", readOnly: false, description: "When should I prepare a shareable evidence brief? Returns qualified Markdown for one run, with optional session reanalysis, plans, proposals, and bundles. It leaves a copy/download brief on the page but does not approve, download, post, email, write repository files, run MD, or validate against experiment.",
    inputSchema: S({ run_id: str("run id from list_runs"), include_session: { type: "boolean", description: "include this visit's reanalysis, plan, proposals, and bundle (default true)" } }, ["run_id"]),
    run: async (input) => {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("input must be an object");
      const { run_id, include_session = true } = input;
      if (typeof run_id !== "string") throw new Error("run_id must be a string");
      safeBriefFilename(run_id);
      if (typeof include_session !== "boolean") throw new Error("include_session must be a boolean");
      const [m, idx] = await Promise.all([loadRun(run_id), loadIndex()]);
      if (!idx.some(r => r.id === run_id)) throw new Error(`no run '${run_id}' in the run index. Call list_runs for valid run ids.`);
      const origin = window.location.origin; const base = `${origin}${window.location.pathname}`;
      const report = buildEvidenceBrief({ manifest: m, index: idx, cardUrl: `${base}#/run/${encodeURIComponent(run_id)}`, manifestUrl: `${origin}/runs/${encodeURIComponent(run_id)}/manifest.json`, generatedAt: new Date().toISOString(), includeSession: include_session, investigation: get().investigations[run_id], proposals: get().proposals });
      navigate(`/run/${run_id}`);
      return { run_id: report.runId, filename: report.filename, markdown: report.markdown, generated_at: report.generatedAt, included_sections: report.includedSections, _brief: report };
    } },
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
      case "diff_runs": return `${out.same_system ? "same prepared system" : "different systems"}; material: ${out.material_classes?.join(", ") || "none"}; ${out.same_system ? `ΔΔG ${f(out.delta_g?.diff)}${out.delta_g_vs_noise ? ` (${out.delta_g_vs_noise.ratio}σ of a two-run difference: ${out.delta_g_vs_noise.consistent_with_sampling_noise ? "sampling noise" : "beyond sampling noise"})` : ""}` : "ΔΔG n/a (different complexes)"}; compare view opened`;
      case "get_ensemble": return `n=${out.all.n}, mean ${f(out.all.mean)}, SD ${f(out.all.sd)} (≥${out.long.min_ps} ps: n=${out.long.n}, SD ${f(out.long.sd)})`;
      case "propose_change": return `${out.status}: ${(out.changes ?? []).map((c: any) => `${c.key} ${c.before ?? "(unset)"} → ${c.after}`).join(", ")}${out.material_classes?.length ? ` (material: ${out.material_classes.join(", ")})` : ""}; before ${verdict(out.before)} → after ${verdict(out.after)}; ${out.after?.hasFail ? "cannot be approved (fails validation)" : "awaiting your Approve"}`;
      case "list_proposals": return `${out.length} proposals (${out.filter((p: any) => p.status === "pending").length} pending)`;
      case "generate_rerun_bundle": return `${out.files.length} files, ${out.applied_proposals.length} approved edit${out.applied_proposals.length === 1 ? "" : "s"} applied; ${out.self_contained ? "self-contained" : `still needs ${out.still_needed_from_original_build.join(", ")} from the original build`}; download on the page`;
      case "recompute_result": { const w = out.window; return `frames ${w.start_frame}–${w.end_frame}${w.interval > 1 ? ` every ${w.interval}th` : ""} (${w.frames_used}): ΔG ${f(out.delta_g.mean)} ± ${f(out.delta_g.corrected_sem)}, ${out.delta_g.verdict}; Δ vs archived ${f(out.vs_archived.diff)}; shown on the page`; }
      case "confidence_ladder": return `${out.verified_of_assessable} rungs verified — ${out.rungs.map((r: any) => `${r.rung.split(" ")[0]}: ${r.status}`).join(", ")}`;
      case "fork_experiment": return out.kind === "extend"
        ? `extend ${out.treatment.key} → ${out.treatment.to} on ${out.stages_changed.join(", ")}: ${out.proposals.length} proposal${out.proposals.length === 1 ? "" : "s"} (${out.proposals.map((p: any) => `${p.stage} ${p.before}→${p.after}`).join(", ")}); ${out.proposals.some((p: any) => p.after === "FAIL") ? "cannot be approved (fails validation)" : "awaiting your Approve"}`
        : `${out.kind}: seed ${out.seed_policy.split(":")[0]}${out.runs_recommended ? (String(out.runs_recommended.why ?? "").startsWith("sized") ? `, ${out.runs_recommended.additional_runs} more run${out.runs_recommended.additional_runs === 1 ? "" : "s"} ≥ ${out.runs_recommended.min_run_ps} ps recommended for ±${out.runs_recommended.target_uncertainty_kcal}` : `, no run-to-run estimate yet (${out.runs_recommended.now ?? "single run"}); at least ${out.runs_recommended.minimum_runs ?? 3} independent runs needed (${out.runs_recommended.additional_runs} more)`) : ""}; next generate_rerun_bundle`;
      case "plan_sampling": { const r = out.run_to_run, Lp = out.within_run.expected_length_for_target_ps, T = out.target_uncertainty_kcal;
        const one = Lp != null ? `one run alone would need ≈ ${f(Lp, 0)} ps` : `single-run length not projected (${out.within_run.this_run.verdict})`;
        return r.planned_on
        ? `expected: ${r.additional_runs} more run${r.additional_runs === 1 ? "" : "s"} ≥ ${out.recommended_run_ps} ps for ±${T} (${r.planned_on} stratum: n=${r.n_now}, SD ${f(r.sd_used)}); ${one}`
        : `expected: only run of its system, no run-to-run estimate; ${one} for ±${T}; ≥ 3 independent runs of ≥ ${out.recommended_run_ps} ps before an ensemble uncertainty can be quoted`; }
      case "investigate_run": return `${out.summary} Next: ${out.next?.rationale ?? "nothing outstanding"} (created nothing)`;
      case "export_evidence_brief": return `${out.filename} prepared with ${out.included_sections.length} sections; copy/download available on the page`;
    }
  } catch { /* fall through */ }
  return JSON.stringify(out).slice(0, 160);
}

function recordOutcome(name: string, input: any, out: any, source: InvocationSource) {
  const runId = typeof input?.run_id === "string" ? input.run_id : null;
  if (!runId) return;
  const completedAt = new Date().toISOString();
  // A proposal is a comment on the page: it needs an author and a time. makeProposal is pure, so the stamp happens here.
  set(s => s.proposals.some(p => !p.source) ? { proposals: s.proposals.map(p => p.source ? p : { ...p, source, t: Date.now() }) } : {});
  if (name === "recompute_result") updateInvestigation(runId, current => ({ ...current, reanalysis: { runId, source, completedAt, value: out } }));
  if (name === "plan_sampling") updateInvestigation(runId, current => ({ ...current, samplingPlan: { runId, source, completedAt, value: out } }));
  if (name === "investigate_run") updateInvestigation(runId, current => ({ ...current, automode: { runId, source, completedAt, value: out } }));
  if (name === "fork_experiment" && typeof out?.fork_id === "string") updateInvestigation(runId, current => ({ ...current, forks: { ...current.forks, [out.fork_id]: { runId, source, completedAt, value: out } } }));
  if (name === "generate_rerun_bundle" && out?._bundle) updateInvestigation(runId, current => ({ ...current, bundle: { runId, source, completedAt: out._bundle.generatedAt, value: out._bundle as BundleSnapshot } }));
  if (name === "export_evidence_brief" && out?._brief) updateInvestigation(runId, current => ({ ...current, brief: { runId, source, completedAt: out._brief.generatedAt, value: out._brief as EvidenceBriefSnapshot } }));
}

const publicOutput = (out: any) => {
  if (!out || typeof out !== "object" || Array.isArray(out)) return out;
  const { _bundle: _b, _brief: _r, ...publicValue } = out;
  return publicValue;
};

/** The schema's required fields, checked before the tool runs, so a missing run_id says "run_id is required" rather than
 *  whatever the tool tripped over first (a fetch of /runs/undefined/manifest.json). An empty string counts as missing:
 *  the console prefills run_b: "" on a compare page. */
function requireFields(t: Tool, input: unknown) {
  const required: string[] = (t.inputSchema as any).required ?? [];
  const missing = required.find(k => { const v = (input as any)?.[k]; return v === undefined || v === null || v === ""; });
  if (missing) throw new Error(`${missing} is required`);
}

export async function callTool(name: string, input: unknown, source: InvocationSource = "console"): Promise<string> {
  const t = TOOLS.find(t => t.name === name); if (!t) throw new Error(`unknown tool ${name}`);
  try { requireFields(t, input); const out = await t.run(input ?? {}); recordOutcome(name, input, out, source); const visible = publicOutput(out); logCall(name, input, true, summarize(name, visible), source); return JSON.stringify(visible); }
  catch (e: any) { logCall(name, input, false, String(e?.message ?? e), source); return JSON.stringify({ error: String(e?.message ?? e) }); }
}

export async function registerWebMCP() {
  const mc: any = (navigator as any).modelContext ?? (window as any).modelContext ?? (document as any).modelContext;
  if (!mc?.registerTool) { set({ webmcp: "unsupported", tools: TOOLS.map(t => t.name) }); return; }
  // The browser exposes WebMCP: say so at once, so the page never claims it is off while the 17 registrations resolve.
  set({ webmcp: "registering", tools: TOOLS.map(t => t.name) });
  try {
    for (const t of TOOLS) {
      await mc.registerTool({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly },
        execute: async (a: any) => callTool(t.name, a?.inputParams ?? a, "webmcp") });
    }
    set({ webmcp: "registered", tools: TOOLS.map(t => t.name) });
  } catch (e) { console.error("WebMCP registration failed", e); set({ webmcp: "error", tools: TOOLS.map(t => t.name) }); }
}
