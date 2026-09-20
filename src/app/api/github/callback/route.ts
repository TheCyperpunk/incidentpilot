import { completeGitHubAuthorization } from "@/lib/github-oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return Response.redirect(new URL("/settings/github?error=missing_authorization", url));
  try {
    await completeGitHubAuthorization(code, state);
    return Response.redirect(new URL("/settings/github?connected=1", url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub authorization failed";
    return Response.redirect(new URL(`/settings/github?error=${encodeURIComponent(message)}`, url));
  }
}
