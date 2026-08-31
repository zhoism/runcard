import type { Manifest, IndexEntry } from "./types";
import type { Proposal } from "./runs";
import { confidenceLadderFull, ensemble, explainResult, validateAll } from "./runs";
import type { EvidenceBriefSnapshot, InvestigationState } from "./investigation";

export interface EvidenceBriefInput {
  manifest: Manifest;
  index: IndexEntry[];
  cardUrl: string;
  manifestUrl: string;
  generatedAt: string;
  includeSession: boolean;
  investigation?: InvestigationState;
  proposals?: Proposal[];
}

const md = (value: unknown) => String(value ?? "").replace(/([\\`*_{}<>#|])/g, "\\$1").replaceAll("[", "\\[").replaceAll("]", "\\]").replace(/\r?\n/g, " ");
/** Inside a code span Markdown takes backslashes literally, so escape nothing and just neutralise backticks. */
const code = (value: unknown) => String(value ?? "").replace(/`/g, "'").replace(/\r?\n/g, " ");
const n = (value: number | null | undefined, digits = 2) => value == null ? "not available" : value.toFixed(digits);
const section = (title: string, body: string[]) => [`## ${title}`, "", ...body, ""];

export function safeBriefFilename(runId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) throw new Error("run_id must contain only letters, numbers, dots, underscores, and hyphens");
  return `${runId}-evidence-brief.md`;
}

/** A deterministic Markdown snapshot. The caller supplies time, URLs and optional run-scoped session state. */
export function buildEvidenceBrief(input: EvidenceBriefInput): EvidenceBriefSnapshot {
  const { manifest: m, index, cardUrl, manifestUrl, generatedAt, includeSession } = input;
  const filename = safeBriefFilename(m.id);
  const mm = m.results.mmgbsa;
  const production = m.stages.find(s => s.role === "production");
  const explanation = explainResult(m, index, true) as any;
  const ladder = confidenceLadderFull(m, index);
  const validation = validateAll(m);
  const ens = ensemble(index, m.id);
  const investigation = includeSession && input.investigation?.runId === m.id ? input.investigation : undefined;
  const proposals = includeSession ? (input.proposals ?? []).filter(p => p.run === m.id) : [];
  const included: string[] = ["record", "result_and_scope", "evidence_checks"];
  const lines: string[] = [`# Evidence brief: ${md(m.title)}`, ""];

  lines.push(...section("Record", [
    `- Run: \`${code(m.id)}\` — ${md(m.title)}`,
    `- Card: [${md(cardUrl)}](${cardUrl})`,
    `- Published manifest: [${md(manifestUrl)}](${manifestUrl})`,
    `- Report generated: ${md(generatedAt)}. This is the report time, not the simulation execution time.`,
    `- Extraction/source identity: ${m.source ? `${md(m.source.run_dir)}; extracted ${md(m.source.extracted)}` : "not recorded"}.`,
  ]));

  const result: string[] = mm ? [
    `- Archived result: **${n(mm.delta_total_kcal_mol)} kcal/mol** from single-trajectory MM-GBSA (igb=${md(mm.igb)}, saltcon=${md(mm.saltcon)}), over ${mm.frames ?? "an unknown number of"} frames${production?.length_ps != null ? ` from ${production.length_ps} ps of production` : ""}.`,
    ens.all.sd != null
      ? `- Run-to-run population: sample SD **${n(ens.all.sd)} kcal/mol** across n=${ens.all.n} independent runs of the same prepared system at ${[...new Set(ens.all.runs.map(r => r.production_ps))].sort((a, b) => a - b).join(", ")} ps. This is a short, mixed-length ensemble, not a survey of conformational space.`
      : `- Run-to-run population: not available. This is the only run of its prepared system, so between-run variation cannot be estimated.`,
    explanation.uncertainty ? `- Within-run population: naive frame SEM ${n(explanation.uncertainty.per_frame_sem, 3)} kcal/mol; autocorrelation-corrected SEM ${n(explanation.uncertainty.corrected_sem, 3)} kcal/mol (N_eff ≈ ${md(explanation.uncertainty.n_eff)}). These do not replace the run-to-run spread.` : `- Within-run uncertainty: per-frame evidence was not available for a corrected estimate.`,
    `- Window qualification: ${md(explanation.uncertainty?.verdict ?? "not assessed")}. This tests the archived window and does not establish longer-timescale equilibration or physical accuracy.`,
    explanation.entropy_term ? `- Entropy: ${md(explanation.entropy_term)}. ${md(explanation.what_it_is)}` : `- Scope: ${md(explanation.what_it_is ?? explanation.brief)}`,
    ...(mm.warnings ?? []).map(w => `- Archived MM-GBSA warning: ${md(w)}${explanation.warning_note ? ` ${md(explanation.warning_note)}` : ""}`),
  ] : ["- No MM-GBSA result was archived for this run."];
  lines.push(...section("Result and scope", result));

  const checks = [
    `- Input sanity checks performed while preparing this report: **${validation.verdict}** across ${validation.stages.length} stages. PASS means the stored inputs passed the implemented rules; it is not convergence or physical validation.`,
    ...ladder.rungs.map(r => `- **${md(r.rung)} — ${md(r.status)}.** ${md(r.short)}${r.to_climb ? ` Missing/next evidence: ${md(r.to_climb)}` : ""}`),
  ];
  lines.push(...section("Evidence checks", checks));

  if (investigation?.reanalysis) {
    included.push("current_reanalysis");
    const r = investigation.reanalysis.value;
    lines.push(...section("Current reanalysis", [
      `- Completed ${md(investigation.reanalysis.completedAt)} via ${md(investigation.reanalysis.source)}.`,
      `- Frames ${r.window.start_frame}–${r.window.end_frame}${r.window.interval > 1 ? `, every ${r.window.interval}th` : ""} (${r.window.frames_used} used): **${n(r.delta_g.mean)} ± ${n(r.delta_g.corrected_sem)} kcal/mol**, ${md(r.delta_g.verdict)}.`,
      `- Difference from the unchanged archive: ${n(r.vs_archived.diff)} kcal/mol (${n(r.vs_archived.diff_in_corrected_sem)} corrected SEM). MMPBSA.py was not rerun.`,
    ]));
  }

  if (investigation?.samplingPlan) {
    included.push("next_sampling_plan");
    const p: any = investigation.samplingPlan.value;
    const range = p.run_to_run?.n_needed_range;
    lines.push(...section("Next sampling plan", [
      `- **Expected, not measured.** Target SEM of the ensemble mean: ±${n(p.target_uncertainty_kcal)} kcal/mol.`,
      `- ${md(p.recommendation)}`,
      ...(range ? [`- Plug-in estimation range: n=${range.low}–${range.high}; ${md(range.note)}`] : []),
      ...((p.assumptions ?? []).map((a: string) => `- Assumption: ${md(a)}`)),
    ]));
  }

  if (proposals.length || investigation?.bundle) {
    included.push("proposals_and_prepared_bundle");
    const proposalLines = proposals.length ? proposals.map(p => `- Proposal \`${code(p.id)}\` (${md(p.stage)}): **${md(p.status)}** — ${md(p.reason)}; ${p.changes.map(c => `${md(c.key)} ${md(c.before ?? "unset")} → ${md(c.after)}`).join(", ")}.`) : ["- No proposals were generated in this session."];
    const bundle = investigation?.bundle?.value;
    const bundleLines = bundle ? [
      `- Bundle snapshot: \`${code(bundle.name)}\`, prepared ${md(bundle.generatedAt)}. Prepared does not mean the simulation was run.`,
      `- Applied proposal IDs at generation: ${bundle.appliedProposalIds.length ? bundle.appliedProposalIds.map(x => `\`${code(x)}\``).join(", ") : "none"}. Later approval changes do not alter this snapshot.`,
      `- Changed stages in this bundle: ${bundle.changedStages.length ? bundle.changedStages.map(x => md(x.stage)).join(", ") : "none"}.`,
      ...bundle.forks.map(f => `- Fork \`${code(f.id)}\`: **${f.complete ? "complete" : "incomplete / partially approved"}**; applied ${f.appliedStages.map(md).join(", ") || "no stages"}${f.missingStages.length ? `; missing intended stages ${f.missingStages.map(md).join(", ")}` : ""}.`),
      ...(bundle.combinesMultipleForks ? ["- Warning: this bundle combines multiple fork questions, so its result would not answer either question alone."] : []),
      `- Build inputs: ${bundle.selfContained ? "self-contained" : `incomplete; missing ${bundle.missingInputs.map(md).join(", ")}`}.`,
    ] : ["- No rerun bundle was prepared in this session."];
    lines.push(...section("Proposals and prepared bundle", [...proposalLines, ...bundleLines]));
  }

  included.push("sources_and_limits");
  const artifacts = new Set<string>();
  for (const s of mm?.per_frame?.source ?? []) artifacts.add(s);
  if (mm?.trajectory) artifacts.add(mm.trajectory);
  if (mm?.per_frame?.reproduces?.checked_against) artifacts.add(mm.per_frame.reproduces.checked_against);
  for (const a of Object.values(m.analyses)) if (a.png) artifacts.add(a.png);
  if (m.environment.conda_lock_file) artifacts.add(m.environment.conda_lock_file);
  lines.push(...section("Sources and limits", [
    `- Source artifacts named by the manifest: ${artifacts.size ? [...artifacts].map(x => `\`${code(x)}\``).join(", ") : "none listed"}. These are artifact identities, not invented download links.`,
    `- The card and published manifest are the hosted sources for this report.`,
    `- Preparing this report performed deterministic checks over archived data. It did not run molecular dynamics, rerun MMPBSA.py, validate against experiment, establish a cause for differences, approve a proposal, or complete a follow-up simulation.`,
  ]));

  return { runId: m.id, filename, markdown: lines.join("\n").trimEnd() + "\n", generatedAt, includedSections: included, includeSession };
}
