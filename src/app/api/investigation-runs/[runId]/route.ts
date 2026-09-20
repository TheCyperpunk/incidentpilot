import { InvestigationAccessError, getInvestigation } from "@/lib/investigation-store";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    return Response.json(await getInvestigation(runId));
  } catch (error) {
    const status = error instanceof InvestigationAccessError ? 401 : 404;
    return Response.json({ error: error instanceof Error ? error.message : "Investigation run not found" }, { status });
  }
}
