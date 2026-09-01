import type { Proposal, forkExperiment, planSampling, recomputeResult } from "./runs";
import type { Investigation } from "./investigate";

export type InvocationSource = "webmcp" | "console" | "page";

export interface Captured<T> {
  runId: string;
  source: InvocationSource;
  completedAt: string;
  value: T;
}

export type ReanalysisOutcome = ReturnType<typeof recomputeResult>;
export type SamplingOutcome = ReturnType<typeof planSampling>;
export type ForkOutcome = Omit<ReturnType<typeof forkExperiment>, "_proposals">;

export interface BundleSnapshot {
  runId: string;
  name: string;
  files: Record<string, string>;
  seed: "pinned" | "fresh";
  target: "local" | "slurm";
  generatedAt: string;
  appliedProposalIds: string[];
  appliedProposals: Proposal[];
  changedStages: { stage: string; file: string; changes: Proposal["changes"]; fork: string | null }[];
  forks: { id: string; question: string | null; intendedStages: string[]; appliedStages: string[]; missingStages: string[]; complete: boolean }[];
  combinesMultipleForks: boolean;
  selfContained: boolean;
  missingInputs: string[];
}

export interface EvidenceBriefSnapshot {
  runId: string;
  filename: string;
  markdown: string;
  generatedAt: string;
  includedSections: string[];
  includeSession: boolean;
}

export interface InvestigationState {
  runId: string;
  reanalysis?: Captured<ReanalysisOutcome>;
  samplingPlan?: Captured<SamplingOutcome>;
  forks: Record<string, Captured<ForkOutcome>>;
  bundle?: Captured<BundleSnapshot>;
  brief?: Captured<EvidenceBriefSnapshot>;
  automode?: Captured<Investigation>;
}

export const emptyInvestigation = (runId: string): InvestigationState => ({ runId, forks: {} });
