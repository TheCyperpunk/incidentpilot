import { InvestigationAccessError, assertInvestigationAccess, createInvestigation } from "@/lib/investigation-store";
import { acquireInvestigationSlot, InvestigationLimitError } from "@/lib/investigation-guard";
import { getSentryTelemetry } from "@/lib/observability";
import { LiveTriageError, generateTriage } from "@/lib/triage";

export const runtime = "nodejs";
// The isolated runner may execute repository tests. Deploy this endpoint only
// where a four-minute request duration is supported; production should move it
// behind a durable job queue before handling high incident volume.
export const maxDuration = 240;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id !== "INC-2048") return Response.json({ error: "Incident not found" }, { status: 404 });
  let release: (() => void) | undefined;
  try {
    const userId = await assertInvestigationAccess();
    release = acquireInvestigationSlot(userId);
    const sentry = await getSentryTelemetry();
    const triage = await generateTriage(sentry.metrics.map((metric) => `${metric.label}: ${metric.value}. ${metric.detail}`));
    return Response.json(await createInvestigation(id, triage), { status: 201 });
  } catch (error) {
    const status = error instanceof InvestigationAccessError ? 401 : error instanceof InvestigationLimitError ? 429 : error instanceof LiveTriageError ? 502 : 500;
    const headers = error instanceof InvestigationLimitError ? { "retry-after": String(error.retryAfterSeconds) } : undefined;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to start investigation" }, { status, headers });
  } finally {
    release?.();
  }
}
