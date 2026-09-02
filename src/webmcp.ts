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
  { name: "list_runs", readOnly: true, description: "Which simulation runs are on this site? Lists every run: owner (whose card it is; a profile lives at #/u/<owner>), id, title, ligand, protein size, production length (ps), MM-GBSA ΔG (kcal/mol), and whether a PLIP contact profile exists.",
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
  { name: "explain_result", readOnly: true, description: "What does this run's ΔG mean and how much should I trust it? Compact by default (brief + the deciding numbers; detail: true for the full record). Starts with a brief, then the numbers computed from the archived per-frame energies: naive per-frame SEM vs the autocorrelation-corrected SEM (statistical inefficiency g, N_eff, block-averaging plateau), first-half vs second-half drift with a stated verdict, which uncertainty to quote and why, the requested vs realized random seed, the run-to-run spread across independent runs of the same system (all runs and runs ≥ 10 ps: n, mean, SD, range), the sign claim actually supported, any MMPBSA warning verbatim plus the size of the internal-term residual that triggered it, and provenance (versions, dates, source files).",
    inputSchema: S({ run_id: str("run id"), detail: { type: "boolean", description: "false (default): the brief and the deciding numbers; true: the full record (per-frame statistics, block averaging, run list, seeds, residual by term, provenance)" } }, ["run_id"]), run: async ({ run_id, detail }) => explainResult(await loadRun(run_id), await loadIndex(), detail === true) },
  { name: "diff_runs", readOnly: true, description: "Why do two runs differ? Semantic diff: whether they are the same prepared system (ligand, atom types, protein, solvent, force fields), which &cntrl parameters differ per stage with each parameter's meaning and whether it is scientifically material, the realized seeds, both ΔG values, the run-to-run spread, and an interpretation of whether a ΔG difference is protocol, system, or sampling noise. Also opens the compare view.",
    inputSchema: S({ run_a: str("first run id"), run_b: str("second run id") }, ["run_a", "run_b"]),
    run: async ({ run_a, run_b }) => { const [a, b, i] = await Promise.all([loadRun(run_a), loadRun(run_b), loadIndex()]); navigate(`/compare/${run_a}/${run_b}`); return diffRuns(a, b, i); } },
  { name: "propose_change", readOnly: false, description: "Propose a bounded edit to one stage's &cntrl parameters (e.g. {\"dt\":\"0.001\"} or {\"nstlim\":\"50000\",\"iwrap\":\"1\"}). The proposal is validated before and after and shown to the human in the Proposals panel; NOTHING is applied until a person clicks Approve. Returns the proposal id and both validation reports. Only &cntrl keys are editable; masks and file paths are not.",
    inputSchema: S({ run_id: str("run id"), stage: str("stage name"), edits: { type: "object", description: "map of &cntrl key → new value, as strings", additionalProperties: { type: "string" } }, reason: str("one sentence: why this change") }, ["run_id", "stage", "edits", "reason"]),
    run: async ({ run_id, stage, edits, reason }) => { const p = makeProposal(await loadRun(run_id), stage, edits, reason); set(s => ({ proposals: [p, ...s.proposals] })); navigate(`/run/${run_id}`); return { proposal_id: p.id, status: p.status, changes: p.changes, material_classes: p.material_classes, before: p.before, after: p.after, mdin_after: p.mdin_after, note: p.after.hasFail ? "Cannot be approved: the edited stage FAILS validation (see after.findings). Revise the edit and propose again." : "Awaiting human approval in the Proposals panel." }; } },
  { name: "list_proposals", readOnly: true, description: "Which proposals exist on this page and what is their status? Lists them (pending / approved / rejected). Only approved proposals are applied to a rerun bundle.",
    inputSchema: S({}), run: async () => get().proposals.map(p => ({ id: p.id, run: p.run, stage: p.stage, edits: p.edits, reason: p.reason, status: p.status, after_verdict: verdictOf(p.after) })) },
  { name: "generate_rerun_bundle", readOnly: false, description: "How do I rerun this simulation? Builds a reproduction bundle: all stage .in files (with any APPROVED proposals applied), leap.in plus the archived build inputs it loads (ligand mol2/frcmod, cleaned protein PDB — the README names any that were not archived), run.sh for a local machine or a SLURM cluster, the environment pins, the parent card's manifest with lineage, and a README. seed='pinned' writes the seed pmemd actually used so the run replays exactly on the same build; seed='fresh' keeps ig=-1 for an independent sample. The bundle appears on the page as a download for the human; the tool returns the file list, what still has to come from outside the bundle, and the README.",
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
  { name: "get_ensemble", readOnly: true, description: "How much does ΔG vary across independent runs of this system? Run-to-run statistics for every run of the same prepared system as run_id (same ligand, atom types, charges, protein, force fields, solvent, box): n, mean, SD, min, max of ΔG for all runs and for runs ≥ 10 ps, with each run's production length.",
    inputSchema: S({ run_id: str("run id") }, ["run_id"]), run: async ({ run_id }) => ensemble(await loadIndex(), run_id) },
  { name: "recompute_result", readOnly: false, description: "What is ΔG if I drop the first 20 frames as equilibration, or use every other frame? Re-analyses the archived per-frame MM-GBSA energies in the browser over a window you choose (start_frame/end_frame, 1-based; interval; or discard_ps to drop the first X ps): mean ΔG, per-frame SD, autocorrelation-corrected SEM, N_eff, block averaging and drift verdict for that window, per-term means, and the difference from the archived value in corrected-SEM units. MMPBSA.py is not rerun; the full window reproduces mmgbsa.dat exactly. Shows the result under the ΔG card.",
    inputSchema: S({ run_id: str("run id"), start_frame: { type: "integer", description: "first frame, 1-based (default 1)" }, end_frame: { type: "integer", description: "last frame, inclusive (default: all)" }, interval: { type: "integer", description: "keep every k-th frame (default 1)" }, discard_ps: { type: "number", description: "drop the first X ps as equilibration (instead of start_frame)" } }, ["run_id"]),
    run: async ({ run_id, ...w }) => { const r = recomputeResult(await loadRun(run_id), w); navigate(`/run/${run_id}`); return r; } },
  { name: "plan_sampling", readOnly: false, description: "How much more sampling do I need to reach ±X kcal/mol on ΔG? Expected, not measured: from the run-to-run SD across independent runs of this system, the number of additional runs (ig=-1) for the SEM of the ensemble mean to reach the target; from this run's per-frame SD and autocorrelation time, the expected corrected SEM of one run at 5–100 ps and the length at which one run reaches the target; which of the two limits the answer; and the nstlim an agent can pass to propose_change (this tool proposes nothing). Every projection is labelled expected with its assumptions.",
    inputSchema: S({ run_id: str("run id"), target_uncertainty_kcal: { type: "number", description: "target SEM of the ensemble-mean ΔG, kcal/mol (default 0.25)" }, min_run_ps: { type: "number", description: "minimum production length for new runs, ps (default 10)" }, detail: { type: "boolean", description: "false (default): recommendation, run-to-run arithmetic, suggested edit; true: adds the per-length SEM table, strata, formulas" } }, ["run_id"]),
    run: async ({ run_id, ...o }) => planSampling(await loadRun(run_id), await loadIndex(), o) },
  { name: "confidence_ladder", readOnly: true, description: "How far up the ladder of confidence does this result stand? Five rungs, each computed from the archived data and labelled verified / expected / not established / not assessed: recomputable (per-frame energies reproduce mmgbsa.dat), repeatable (seeds and environment pinned for an exact replay — expected, not executed), independently replicated (≥ 3 runs with the same system and production protocol and distinct seeds; run-to-run spread; sign claim), robust to analysis-window choices (the narrow, earned form of 'robust to reasonable choices': on a stationary run, ΔG over equilibration-discard and stride windows stays within 2 corrected SEMs; force field, protonation, box and MM-GBSA model are not varied), externally supported (never claimed here). Each rung says what would climb to the next. A passing input check is not a rung.",
    inputSchema: S({ run_id: str("run id"), detail: { type: "boolean", description: "false (default): each rung's status and one-line reason; true: adds the evidence (numbers, windows, source files) and the method" } }, ["run_id"]), run: async ({ run_id, detail }) => confidenceLadder(await loadRun(run_id), await loadIndex(), detail === true) },
  { name: "fork_network", readOnly: true, description: "Which runs were forked from this one, and do they agree with it? The runs re-executed from this run's rerun bundle (parent/fork lineage in their manifests), each with owner, engine, production length and ΔG; the fork mean ± SD; where the parent sits relative to that mean in units of the cohort's run-to-run SD; and a status: agree (within 2 SDs), tension (beyond 2 SDs — reported, not smoothed over, with whether an engine change confounds it), or sign-only. Call it on a fork's parent; on a run with no forks it says so and names fork_experiment as the way to start one.",
    inputSchema: S({ run_id: str("run id — usually the parent") }, ["run_id"]), run: async ({ run_id }) => forkNetwork(await loadIndex(), run_id) },
  { name: "fork_experiment", readOnly: false, description: "Fork this experiment. kind='reproduce': rerun the original as exactly as possible (pinned seeds; establishes repeatable). kind='replicate': same protocol, independent seeds (establishes independently replicated; says how many runs plan_sampling wants). kind='extend': ask a nearby scientific question by changing ONE treatment variable (a &cntrl key of class physics / thermodynamic_state / sampling_length / restraints, e.g. {\"key\":\"temp0\",\"value\":\"310.0\"}) while every other condition is held; returns the controlled diff (treatment before → after per stage, controls held, validation before/after) and creates one pending proposal per affected stage — NOTHING is applied until a person clicks Approve; then generate_rerun_bundle writes the bundle with the parent link. Thermodynamic-state treatments apply to equilibration + production (the heating ramp is left alone); others to production only, unless stages is given.",
    inputSchema: S({ run_id: str("run id"), kind: str("reproduce, replicate or extend", { enum: ["reproduce", "replicate", "extend"] }), treatment: { type: "object", description: "extend only: the one variable to change", properties: { key: str("&cntrl key, e.g. temp0"), value: str("new value as a string, e.g. 310.0") }, required: ["key", "value"] }, question: str("extend only: the scientific question, one sentence"), stages: { type: "array", items: { type: "string" }, description: "extend only: override which stages receive the treatment" } }, ["run_id", "kind"]),
    run: async ({ run_id, ...o }) => { const r = forkExperiment(await loadRun(run_id), await loadIndex(), o); const { _proposals, ...out } = r as any; if (_proposals?.length) set(s => ({ proposals: [..._proposals, ...s.proposals] })); navigate(`/run/${run_id}`); return out; } },
  { name: "investigate_run", readOnly: false, description: "Automode. Investigate one run end to end and tell me what to do about it. Reads the confidence ladder, works out which rung is actually holding this run back, and chases that rung with the read-only tools that bear on it — so the trace differs from run to run and changes when a run's evidence changes. It is not a fixed sequence: a run whose replication rung is closed is investigated differently from a single-run system, and differently again from a run that is drifting. Returns the ordered trace (each step: which tool, why it was chosen, what it found), the run's headline number with the uncertainty that should actually be quoted, the bottleneck rung and whether archived data or an off-site run could move it, and one recommended next action. It creates NOTHING: no proposal is queued, no bundle written, no scientific input changed. The recommendation is named for a person or an agent to act on deliberately.",
    inputSchema: S({ run_id: str("id of the run to investigate") }, ["run_id"]),
    run: async ({ run_id }: any) => {
      const [m, idx] = await Promise.all([loadRun(run_id), loadIndex()]);
      navigate(`#/run/${run_id}`);
      return investigateRun(m, idx);
    } },
  { name: "export_evidence_brief", readOnly: false, description: "Prepare a qualified Markdown evidence brief for one run. It returns the report to the caller and makes the same snapshot available for human copy/download on the page. include_session=false excludes transient reanalysis, plans, proposals and bundles. It does not approve, download, copy, post, email, write repository files, run MD, or validate against experiment.",
    inputSchema: S({ run_id: str("run id from list_runs"), include_session: { type: "boolean", description: "include this visit's run-scoped reanalysis, sampling plan, proposals and prepared bundle (default true)" } }, ["run_id"]),
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
