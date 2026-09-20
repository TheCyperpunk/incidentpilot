import { getRepositoryForInstallation, githubIntegrationConfigured } from "@/lib/github-app";
import { githubUserToken, listUserInstallationRepositories } from "@/lib/github-oauth";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const selectionSchema = z.object({ installationId: z.string().regex(/^\d+$/), fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/) });

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") return Response.json({ error: "Sign in before viewing repository selection" }, { status: 401 });
  const { data: project, error } = await supabase.from("projects").select("id").eq("owner_id", userId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!project) return Response.json({ repository: null });
  const { data: repository, error: repositoryError } = await supabase.from("repositories").select("full_name, default_branch, installation_id").eq("project_id", project.id).eq("is_selected", true).maybeSingle();
  if (repositoryError) return Response.json({ error: repositoryError.message }, { status: 500 });
  return Response.json({ repository });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") return Response.json({ error: "Sign in before selecting a repository" }, { status: 401 });
  if (!githubIntegrationConfigured()) return Response.json({ error: "GitHub App credentials are not configured" }, { status: 503 });
  try {
    const selection = selectionSchema.parse(await request.json());
    const available = await listUserInstallationRepositories(await githubUserToken(), selection.installationId);
    if (!available.some((repository) => repository.fullName.toLowerCase() === selection.fullName.toLowerCase())) {
      return Response.json({ error: "That repository is not available to your GitHub App installation" }, { status: 403 });
    }
    const repository = await getRepositoryForInstallation(selection.installationId, selection.fullName);
    const { data: existingProject, error: projectLookupError } = await supabase.from("projects").select("id").eq("owner_id", userId).maybeSingle();
    if (projectLookupError) throw projectLookupError;
    let projectId = existingProject?.id;
    if (!projectId) {
      const { data: project, error } = await supabase.from("projects").insert({ owner_id: userId, name: "IncidentPilot workspace" }).select("id").single();
      if (error) throw error;
      projectId = project.id;
    }
    const { error: clearError } = await supabase.from("repositories").update({ is_selected: false }).eq("project_id", projectId).eq("is_selected", true);
    if (clearError) throw clearError;
    const { data: saved, error: saveError } = await supabase.from("repositories").upsert({ project_id: projectId, provider: "github", full_name: repository.fullName, default_branch: repository.defaultBranch, installation_id: repository.installationId, is_selected: true }, { onConflict: "project_id,provider,full_name" }).select("full_name, default_branch, installation_id").single();
    if (saveError) throw saveError;
    return Response.json({ repository: saved }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save repository selection" }, { status: 400 });
  }
}
