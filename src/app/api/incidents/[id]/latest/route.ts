import { InvestigationAccessError, getLatestInvestigation } from "@/lib/investigation-store";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id !== "INC-2048") return Response.json({ error: "Incident not found" }, { status: 404 });
  try {
    const run = await getLatestInvestigation(id);
    if (!run) return Response.json({ error: "No investigation has been started" }, { status: 404 });
    return Response.json(run);
  } catch (error) {
    const status = error instanceof InvestigationAccessError ? 401 : 500;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load investigation" }, { status });
  }
}
