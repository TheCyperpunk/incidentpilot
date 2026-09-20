import { getLatestCommit, getRepositoryForInstallation, githubIntegrationConfigured } from "@/lib/github-app";
import { getSentryTelemetry, TelemetryMetric } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SelectedRepository = { full_name: string; default_branch: string; installation_id: string | null };

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return Response.json({ error: "Sign in before viewing observability data" }, { status: 401 });

  const { data: project, error: projectError } = await supabase
    .from("projects").select("id").eq("owner_id", userId).maybeSingle();
  if (projectError) return Response.json({ error: projectError.message }, { status: 500 });

  let repository: SelectedRepository | null = null;
  if (project) {
    const { data, error } = await supabase
      .from("repositories")
      .select("full_name, default_branch, installation_id")
      .eq("project_id", project.id)
      .eq("is_selected", true)
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    repository = data;
  }

  const sentry = await getSentryTelemetry();
  const metrics: TelemetryMetric[] = [...sentry.metrics];
  let deployment = {
    repository: repository?.full_name ?? null,
    branch: repository?.default_branch ?? null,
    commitSha: null as string | null,
    commitMessage: null as string | null,
    committedAt: null as string | null,
    source: repository ? "github_pending" : "not_connected",
  };

  if (repository?.installation_id && githubIntegrationConfigured()) {
    try {
      const validatedRepository = await getRepositoryForInstallation(repository.installation_id, repository.full_name);
      const latestCommit = await getLatestCommit(validatedRepository);
      deployment = {
        repository: validatedRepository.fullName,
        branch: validatedRepository.defaultBranch,
        commitSha: latestCommit.sha,
        commitMessage: latestCommit.message,
        committedAt: latestCommit.committedAt,
        source: "github",
      };
      metrics.push({
        label: "Latest repository commit",
        value: latestCommit.sha.slice(0, 12),
        detail: `Committed ${new Date(latestCommit.committedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
        source: "github",
      });
    } catch (error) {
      deployment.source = "unavailable";
      metrics.push({ label: "Latest repository commit", value: "Unavailable", detail: error instanceof Error ? error.message : "GitHub could not be reached", source: "unavailable" });
    }
  } else {
    metrics.push({
      label: "Latest repository commit",
      value: "Not connected",
      detail: repository ? "GitHub App installation is unavailable" : "Select a GitHub repository first",
      source: "not_connected",
    });
  }

  metrics.push({
    label: "Database CPU",
    value: "Not connected",
    detail: "Connect a database monitoring provider to report CPU safely",
    source: "not_connected",
  });

  return Response.json({ metrics, sentry: { status: sentry.status, updatedAt: sentry.updatedAt }, deployment }, {
    headers: { "Cache-Control": "no-store" },
  });
}
