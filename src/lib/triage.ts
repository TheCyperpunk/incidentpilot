import OpenAI from "openai";
import { z } from "zod";

export const triageSchema = z.object({
  summary: z.string(),
  suspectedService: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  symptoms: z.array(z.string()).min(1),
  investigationTargets: z.array(z.string()).min(1),
  missingEvidence: z.array(z.string()),
});

export type TriageResult = z.infer<typeof triageSchema> & { provider: "openai" | "simulation" };

export class LiveTriageError extends Error {
  constructor() {
    super("Live OpenAI triage could not complete. The controlled simulation fallback was not used.");
    this.name = "LiveTriageError";
  }
}

const simulation: TriageResult = {
  provider: "simulation",
  summary: "Checkout API errors and latency rose immediately after v2.8.1. Database CPU and timeout logs make a query regression the leading hypothesis.",
  suspectedService: "checkout-api",
  severity: "high",
  symptoms: ["HTTP 500 spike", "P95 latency increase", "Database CPU increase"],
  investigationTargets: ["v2.8.1 commit diff", "checkout database queries", "checkout regression tests"],
  missingEvidence: ["Query execution plan from the degraded deployment"],
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "suspectedService", "severity", "symptoms", "investigationTargets", "missingEvidence"],
  properties: {
    summary: { type: "string" },
    suspectedService: { type: "string" },
    severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
    symptoms: { type: "array", items: { type: "string" } },
    investigationTargets: { type: "array", items: { type: "string" } },
    missingEvidence: { type: "array", items: { type: "string" } },
  },
} as const;

export async function generateTriage(): Promise<TriageResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return simulation;

  try {
    const client = new OpenAI({ apiKey, timeout: 15_000, maxRetries: 1 });
    const response = await client.responses.create({
      model: process.env.OPENAI_TRIAGE_MODEL?.trim() || "gpt-5.6-luna",
      // Incident details can be sensitive. The app persists the audit record in
      // Supabase, so this request does not need Responses API state retention.
      store: false,
      max_output_tokens: 900,
      reasoning: { effort: "low" },
      input: [
        {
          role: "developer",
          content: "You triage software incidents. Report hypotheses only, not verified root causes. Use only supplied evidence. Do not invent logs, tests, repository files, deployments, or remediation. Clearly identify missing evidence. Return only JSON that satisfies the requested schema.",
        },
        {
          role: "user",
          content: "Incident: Checkout API degradation. Service: checkout-api. Severity: high. Deployment: v2.8.1 at 14:01. At 14:03: error rate 18.4% (baseline 0.3%), p95 latency 850ms (baseline 180ms), DB CPU 94% (baseline 41%). Logs: database query timeout; checkout request failed.",
        },
      ],
      text: { format: { type: "json_schema", name: "incident_triage", strict: true, schema } },
    });

    if (!response.output_text) throw new Error("The model returned no structured output");
    return { ...triageSchema.parse(JSON.parse(response.output_text)), provider: "openai" };
  } catch {
    throw new LiveTriageError();
  }
}
