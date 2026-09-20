import { githubUserToken, listUserInstallationRepositories } from "@/lib/github-oauth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ installationId: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") return Response.json({ error: "Sign in before viewing repositories" }, { status: 401 });
  try {
    const { installationId } = await params;
    return Response.json({ repositories: await listUserInstallationRepositories(await githubUserToken(), installationId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load repositories" }, { status: 400 });
  }
}
