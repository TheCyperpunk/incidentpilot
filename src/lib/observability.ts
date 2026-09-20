import "server-only";

type SentryStatsPoint = [number, number] | [string, number];

export type TelemetryMetric = {
  label: string;
  value: string;
  detail: string;
  alert?: boolean;
  chart?: number[];
  source: "sentry" | "github" | "not_connected" | "unavailable";
};

export type SentryTelemetry = {
  metrics: TelemetryMetric[];
  status: "connected" | "not_configured" | "unavailable";
  updatedAt?: string;
};

const sentryBaseUrl = "https://sentry.io/api/0";

function chartFrom(points: unknown): number[] | undefined {
  if (!Array.isArray(points) || !points.length) return undefined;
  const values = points
    .map((point) => Array.isArray(point) ? Number(point[1]) : Number.NaN)
    .filter((value) => Number.isFinite(value));
  if (!values.length) return undefined;
  const highest = Math.max(...values, 1);
  return values.slice(-8).map((value) => Math.max(4, Math.round((value / highest) * 100)));
}

function token() {
  return process.env.SENTRY_AUTH_TOKEN?.trim();
}

function sentrySettings() {
  const org = process.env.SENTRY_ORG?.trim();
  const project = process.env.SENTRY_PROJECT?.trim();
  return org && project ? { org, project } : null;
}

async function sentryFetch(path: string) {
  const authToken = token();
  if (!authToken) throw new Error("SENTRY_AUTH_TOKEN is not configured");
  const response = await fetch(`${sentryBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${authToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Sentry request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

/** Read-only dashboard summary. The build-plugin token is deliberately never used here. */
export async function getSentryTelemetry(): Promise<SentryTelemetry> {
  const settings = sentrySettings();
  if (!settings || !token()) {
    return {
      status: "not_configured",
      metrics: [
        { label: "Sentry events (24h)", value: "Not connected", detail: "Add a read-only Sentry API token", source: "not_connected" },
        { label: "Open Sentry issues", value: "Not connected", detail: "No runtime telemetry token", source: "not_connected" },
        { label: "P95 latency", value: "No traces yet", detail: "Tracing is enabled; data will appear after traffic", source: "not_connected" },
      ],
    };
  }

  try {
    const [statsResponse, issuesResponse, latencyResponse] = await Promise.all([
      sentryFetch(`/projects/${encodeURIComponent(settings.org)}/${encodeURIComponent(settings.project)}/stats/?stat=received&since=${Math.floor(Date.now() / 1000) - 86_400}&until=${Math.floor(Date.now() / 1000)}&resolution=1h`),
      sentryFetch(`/organizations/${encodeURIComponent(settings.org)}/issues/?project=${encodeURIComponent(settings.project)}&query=is%3Aunresolved&statsPeriod=24h&limit=100`),
      sentryFetch(`/organizations/${encodeURIComponent(settings.org)}/events/?project=${encodeURIComponent(settings.project)}&field=p95(transaction.duration)&query=event.type%3Atransaction&statsPeriod=24h&per_page=1`),
    ]);

    const stats = Array.isArray(statsResponse) ? statsResponse as SentryStatsPoint[] : [];
    const eventCount = stats.reduce((total, point) => total + (Number(point[1]) || 0), 0);
    const issues = Array.isArray(issuesResponse) ? issuesResponse : [];
    const latencyData = latencyResponse && typeof latencyResponse === "object" && "data" in latencyResponse
      ? (latencyResponse as { data?: Array<Record<string, unknown>> }).data?.[0]
      : undefined;
    const latencyValue = latencyData ? Number(latencyData["p95(transaction.duration)"]) : Number.NaN;

    return {
      status: "connected",
      updatedAt: new Date().toISOString(),
      metrics: [
        { label: "Sentry events (24h)", value: eventCount.toLocaleString(), detail: "Received events", alert: eventCount > 0, chart: chartFrom(stats), source: "sentry" },
        { label: "Open Sentry issues", value: issues.length >= 100 ? "100+" : String(issues.length), detail: "Unresolved in the selected project", alert: issues.length > 0, source: "sentry" },
        Number.isFinite(latencyValue)
          ? { label: "P95 latency", value: `${Math.round(latencyValue)}ms`, detail: "Transactions in the last 24h", source: "sentry" }
          : { label: "P95 latency", value: "No traces yet", detail: "Sentry has not received transaction data", source: "unavailable" },
      ],
    };
  } catch (error) {
    return {
      status: "unavailable",
      metrics: [
        { label: "Sentry events (24h)", value: "Unavailable", detail: error instanceof Error ? error.message : "Sentry could not be reached", source: "unavailable" },
        { label: "Open Sentry issues", value: "Unavailable", detail: "Check the read-only token scopes", source: "unavailable" },
        { label: "P95 latency", value: "Unavailable", detail: "No verified performance result", source: "unavailable" },
      ],
    };
  }
}
