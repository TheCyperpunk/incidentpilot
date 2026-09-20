import { InvestigationAccessError, approveInvestigation } from "@/lib/investigation-store";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    return Response.json(await approveInvestigation(runId));
  } catch (error) {
    const status = error instanceof InvestigationAccessError ? 401 : 409;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to approve mitigation" }, { status });
  }
}
