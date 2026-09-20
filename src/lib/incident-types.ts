export type RunStatus =
  | "queued"
  | "triaging"
  | "collecting_evidence"
  | "code_investigating"
  | "root_cause_ready"
  | "awaiting_approval"
  | "mitigating"
  | "verifying"
  | "resolved"
  | "failed";

export type AgentEvent = {
  id: string;
  type: string;
  message: string;
  detail?: string;
  createdAt: string;
};

export type InvestigationRun = {
  id: string;
  incidentId: string;
  pinnedCommitSha?: string;
  status: RunStatus;
  events: AgentEvent[];
  triage?: {
    summary: string;
    suspectedService: string;
    severity: "low" | "medium" | "high" | "critical";
    symptoms: string[];
    investigationTargets: string[];
    missingEvidence: string[];
    provider: "openai" | "simulation";
  };
  rootCause?: {
    file: string;
    function: string;
    summary: string;
    evidence: string[];
    confidence: "low" | "medium" | "high";
    tests: { command: string; exitCode: number; summary: string }[];
    provider: "codex" | "simulation";
  };
  approvedAt?: string;
  createdAt: string;
};
