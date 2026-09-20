import { createClient } from "@/lib/supabase/server";
import { AgentEvent, InvestigationRun, RunStatus } from "@/lib/incident-types";
import { TriageResult } from "@/lib/triage";
import { getCommitSha, getInstallationToken, getRepositoryForInstallation, githubIntegrationConfigured } from "@/lib/github-app";
import { runRepositoryInvestigation, runnerConfigured } from "@/lib/runner-client";

const scriptedEvents: Array<{ type: string; message: string; detail: string }> = [
  { type: "context_loaded", message: "Incident context loaded", detail: "Metrics, logs, and deployment metadata were attached." },
  { type: "triage_started", message: "Triage started", detail: "Classifying severity and prioritising investigation targets." },
  { type: "evidence_collecting", message: "Evidence collection started", detail: "Comparing the healthy and degraded deployment snapshots." },
  { type: "runner_queued", message: "Repository investigation queued", detail: "The isolated Codex runner will inspect the pinned v2.8.1 commit." },
  { type: "repository_loaded", message: "Repository loaded", detail: "Pinned commit 7f3b2a1 checked out for inspection." },
  { type: "test_completed", message: "Regression test reproduced", detail: "The checkout query regression test completed with the expected failure." },
  { type: "root_cause_ready", message: "Root-cause hypothesis ready", detail: "Code, timing, logs, and test results point to the same query regression." },
];

const statusByEvent: RunStatus[] = ["queued", "triaging", "collecting_evidence", "code_investigating", "code_investigating", "code_investigating", "awaiting_approval"];

const rootCause: NonNullable<InvestigationRun["rootCause"]> = {
  file: "src/orders/repository.ts",
  function: "findCheckoutItems",
  summary: "The v2.8.1 checkout query removed the index-aware condition, causing an expensive orders scan under normal checkout traffic.",
  evidence: ["Deployment v2.8.1 preceded the spike by two minutes", "Database query timeout appears in checkout logs", "Database CPU rose from 41% to 94%", "Regression test reproduces the timeout"],
  confidence: "high",
  tests: [{ command: "npm test -- orders.repository", exitCode: 0, summary: "Regression scenario reproduced and diagnostic test completed." }],
  provider: "simulation",
};

export class InvestigationAccessError extends Error {}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") throw new InvestigationAccessError("Sign in is required before starting an investigation.");
  return { supabase, userId };
}

// Route handlers call this before any billable third-party work. The creation
// path checks again before database writes, preserving authorization at both
// boundaries.
export async function assertInvestigationAccess() {
  const { userId } = await authenticatedClient();
  return userId;
}

async function ensureIncident(externalKey: string) {
  const { supabase, userId } = await authenticatedClient();
  const { data: existingProject, error: projectLookupError } = await supabase
    .from("projects").select("id").eq("owner_id", userId).limit(1).maybeSingle();
  if (projectLookupError) throw projectLookupError;

  let projectId = existingProject?.id;
  if (!projectId) {
    const { data, error } = await supabase.from("projects")
      .insert({ owner_id: userId, name: "IncidentPilot workspace" }).select("id").single();
    if (error) throw error;
    projectId = data.id;
  }

  const { data: selectedRepository, error: selectedRepositoryError } = await supabase
    .from("repositories").select("id, full_name, default_branch, installation_id").eq("project_id", projectId).eq("is_selected", true).maybeSingle();
  if (selectedRepositoryError) throw selectedRepositoryError;
  const fullName = selectedRepository?.full_name ?? "demo/shop-api";
  const { data: existingRepo, error: repositoryLookupError } = await supabase
    .from("repositories").select("id, installation_id").eq("project_id", projectId).eq("provider", "github").eq("full_name", fullName).maybeSingle();
  if (repositoryLookupError) throw repositoryLookupError;

  let repositoryId = existingRepo?.id;
  if (!repositoryId) {
    const { data, error } = await supabase.from("repositories")
      .insert({ project_id: projectId, provider: "github", full_name: fullName, default_branch: selectedRepository?.default_branch ?? "main", installation_id: selectedRepository?.installation_id ?? null }).select("id").single();
    if (error) throw error;
    repositoryId = data.id;
  }

  const { data: existingIncident, error: incidentLookupError } = await supabase
    .from("incidents").select("id").eq("project_id", projectId).eq("external_key", externalKey).maybeSingle();
  if (incidentLookupError) throw incidentLookupError;
  if (existingIncident) {
    if (selectedRepository) {
      const { error } = await supabase.from("incidents").update({ repository_id: repositoryId }).eq("id", existingIncident.id);
      if (error) throw error;
    }
    return { supabase, incidentId: existingIncident.id, selectedRepository };
  }

  const { data, error } = await supabase.from("incidents").insert({
    project_id: projectId, repository_id: repositoryId, external_key: externalKey,
    title: "Checkout API degradation", service: "checkout-api", severity: "high",
    deployment_version: "v2.8.1", status: "investigating",
  }).select("id").single();
  if (error) throw error;
  return { supabase, incidentId: data.id, selectedRepository };
}

function statusFor(storedStatus: RunStatus, startedAt: string, completedAt?: string | null, approvedAt?: string): { status: RunStatus; eventCount: number } {
  if (storedStatus === "failed") return { status: "failed", eventCount: scriptedEvents.length };
  if (completedAt && !approvedAt) return { status: "awaiting_approval", eventCount: scriptedEvents.length };
  if (approvedAt) {
    const count = Math.min(3, Math.floor((Date.now() - new Date(approvedAt).getTime()) / 900) + 1);
    return { status: count === 1 ? "mitigating" : count === 2 ? "verifying" : "resolved", eventCount: scriptedEvents.length + count };
  }
  const eventCount = Math.min(scriptedEvents.length, Math.floor((Date.now() - new Date(startedAt).getTime()) / 850) + 1);
  return { status: statusByEvent[eventCount - 1], eventCount };
}

async function readRun(runId: string) {
  const { supabase } = await authenticatedClient();
  const { data: run, error: runError } = await supabase.from("investigation_runs")
    .select("id, incident_id, status, pinned_commit_sha, triage_json, root_cause_json, started_at, completed_at, created_at")
    .eq("id", runId).maybeSingle();
  if (runError) throw runError;
  if (!run) throw new Error("Investigation run not found");

  const [{ data: eventRows, error: eventsError }, { data: approval, error: approvalError }] = await Promise.all([
    supabase.from("agent_events").select("id, type, message, payload_json, created_at").eq("run_id", runId),
    supabase.from("approvals").select("approved_at").eq("run_id", runId).eq("status", "approved").maybeSingle(),
  ]);
  if (eventsError) throw eventsError;
  if (approvalError) throw approvalError;

  const startedAt = run.started_at ?? run.created_at;
  const progress = statusFor(run.status as RunStatus, startedAt, run.completed_at, approval?.approved_at ?? undefined);
  const storedEvents: AgentEvent[] = (eventRows ?? []).sort((a, b) => {
    const first = Number((a.payload_json as { sequence?: number }).sequence ?? 0);
    const second = Number((b.payload_json as { sequence?: number }).sequence ?? 0);
    return first - second;
  }).map((event) => ({
    id: event.id, type: event.type, message: event.message,
    detail: (event.payload_json as { detail?: string }).detail,
    createdAt: event.created_at,
  }));

  const mitigationEvents: AgentEvent[] = approval?.approved_at ? [
    { id: `${run.id}-mitigating`, type: "mitigation", message: "Rollback simulation started", detail: "Reverting checkout-api from v2.8.1 to v2.8.0.", createdAt: approval.approved_at },
    { id: `${run.id}-verifying`, type: "verification", message: "Recovery verification started", detail: "Checking error rate, latency, database CPU, and test status.", createdAt: approval.approved_at },
    { id: `${run.id}-resolved`, type: "resolved", message: "Incident resolved", detail: "Recovery thresholds were met in the simulation environment.", createdAt: approval.approved_at },
  ] : [];

  return {
    id: run.id, incidentId: run.incident_id, pinnedCommitSha: run.pinned_commit_sha ?? undefined, status: progress.status,
    events: [...storedEvents.slice(0, Math.min(progress.eventCount, scriptedEvents.length)), ...mitigationEvents.slice(0, Math.max(0, progress.eventCount - scriptedEvents.length))],
    triage: run.triage_json as InvestigationRun["triage"],
    rootCause: progress.eventCount >= scriptedEvents.length ? run.root_cause_json as InvestigationRun["rootCause"] : undefined,
    approvedAt: approval?.approved_at ?? undefined, createdAt: run.created_at,
  } satisfies InvestigationRun;
}

export async function createInvestigation(externalKey: string, triage: TriageResult) {
  const { supabase, incidentId, selectedRepository } = await ensureIncident(externalKey);
  const liveRunner = Boolean(selectedRepository?.installation_id && githubIntegrationConfigured() && runnerConfigured());
  const { data: run, error: runError } = await supabase.from("investigation_runs").insert({
    incident_id: incidentId, status: "queued", pinned_commit_sha: "7f3b2a1", triage_json: triage,
    root_cause_json: liveRunner ? null : rootCause, started_at: new Date().toISOString(),
  }).select("id").single();
  if (runError) throw runError;

  let events = scriptedEvents.map((event) => ({ ...event }));
  if (liveRunner && selectedRepository?.installation_id) {
    try {
      const githubRepository = await getRepositoryForInstallation(selectedRepository.installation_id, selectedRepository.full_name);
      const commitSha = await getCommitSha(githubRepository, process.env.GITHUB_PINNED_COMMIT?.trim() || githubRepository.defaultBranch);
      const githubToken = await getInstallationToken(githubRepository.installationId);
      const output = await runRepositoryInvestigation({
        repositoryUrl: githubRepository.cloneUrl, commitSha, githubToken,
        incident: { id: externalKey, title: "Checkout API degradation", service: "checkout-api", evidence: ["Release +2m before impact", "Database timeout in logs", "5xx above threshold"] },
      });
      const liveRootCause = { ...output.result.rootCause, evidence: output.result.evidence, confidence: output.result.confidence, tests: output.result.tests, provider: "codex" as const };
      events = [
        { type: "context_loaded", message: "Incident context loaded", detail: "Metrics, logs, and deployment metadata were attached." },
        { type: "triage_started", message: "Triage started", detail: "Classifying severity and prioritising investigation targets." },
        { type: "repository_loaded", message: "Repository snapshot loaded", detail: `${githubRepository.fullName} checked out at immutable commit ${commitSha.slice(0, 12)}.` },
        ...output.events.map((event) => ({ type: event.type, message: event.message, detail: "Executed in the isolated Codex runner with network access disabled." })),
        { type: "root_cause_ready", message: "Root-cause hypothesis ready", detail: "Repository evidence and test output are available for human review." },
      ];
      const { error } = await supabase.from("investigation_runs").update({ status: "awaiting_approval", pinned_commit_sha: commitSha, root_cause_json: liveRootCause, completed_at: new Date().toISOString() }).eq("id", run.id);
      if (error) throw error;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Repository investigation failed";
      const { error: updateError } = await supabase.from("investigation_runs").update({ status: "failed", failure_reason: message, completed_at: new Date().toISOString() }).eq("id", run.id);
      if (updateError) throw updateError;
      events = [{ type: "runner_failed", message: "Repository investigation failed", detail: message }];
    }
  }

  const { error: eventsError } = await supabase.from("agent_events").insert(events.map((event, sequence) => ({
    run_id: run.id, type: event.type, message: event.message, payload_json: { detail: event.detail, sequence },
  })));
  if (eventsError) throw eventsError;
  return readRun(run.id);
}

export async function getInvestigation(runId: string) {
  return readRun(runId);
}

export async function getLatestInvestigation(externalKey: string) {
  const { supabase, userId } = await authenticatedClient();
  const { data: project, error: projectError } = await supabase
    .from("projects").select("id").eq("owner_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (projectError) throw projectError;
  if (!project) return null;

  const { data: incident, error: incidentError } = await supabase
    .from("incidents").select("id").eq("project_id", project.id).eq("external_key", externalKey).maybeSingle();
  if (incidentError) throw incidentError;
  if (!incident) return null;

  const { data: run, error: runError } = await supabase
    .from("investigation_runs").select("id").eq("incident_id", incident.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (runError) throw runError;
  return run ? readRun(run.id) : null;
}

export async function approveInvestigation(runId: string) {
  const current = await readRun(runId);
  if (!current.rootCause) throw new Error("Root cause is not ready for approval");
  if (current.approvedAt) return current;

  const { supabase, userId } = await authenticatedClient();
  const { data: run, error: runError } = await supabase.from("investigation_runs").select("incident_id").eq("id", runId).single();
  if (runError) throw runError;
  const now = new Date().toISOString();
  const { data: approval, error: approvalError } = await supabase.from("approvals").insert({
    incident_id: run.incident_id, run_id: runId, action: "controlled_simulation_rollback",
    evidence_snapshot: { rootCause: current.rootCause, approvedAt: now }, status: "approved", approved_by: userId, approved_at: now,
  }).select("id").single();
  if (approvalError) throw approvalError;
  const { error: mitigationError } = await supabase.from("mitigation_runs").insert({
    incident_id: run.incident_id, approval_id: approval.id, action: "controlled_simulation_rollback",
    result_json: { mode: "simulation", liveExecution: false, target: "v2.8.0" },
  });
  if (mitigationError) throw mitigationError;
  return readRun(runId);
}
