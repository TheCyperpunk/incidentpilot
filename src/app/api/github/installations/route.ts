import { githubUserToken, listUserInstallations } from "@/lib/github-oauth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") return Response.json({ error: "Sign in before viewing GitHub installations" }, { status: 401 });
  try {
    return Response.json({ installations: await listUserInstallations(await githubUserToken()) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load GitHub installations" }, { status: 401 });
  }
}
