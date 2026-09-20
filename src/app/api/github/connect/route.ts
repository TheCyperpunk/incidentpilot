import { beginGitHubAuthorization, githubOAuthConfigured } from "@/lib/github-oauth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") return Response.json({ error: "Sign in before connecting GitHub" }, { status: 401 });
  if (!githubOAuthConfigured()) return Response.json({ error: "GitHub OAuth is not configured" }, { status: 503 });
  return Response.redirect(await beginGitHubAuthorization());
}
