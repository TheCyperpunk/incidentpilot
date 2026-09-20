import "server-only";

import { z } from "zod";

const runnerResultSchema = z.object({
  result: z.object({
    rootCause: z.object({ file: z.string(), function: z.string(), summary: z.string() }),
    evidence: z.array(z.string()),
    confidence: z.enum(["low", "medium", "high"]),
    tests: z.array(z.object({ command: z.string(), exitCode: z.number(), summary: z.string() })).min(1),
  }),
  events: z.array(z.object({ type: z.string(), message: z.string() })),
  threadId: z.string(),
});

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function runnerConfigured() {
  return Boolean(process.env.CODEX_RUNNER_URL?.trim() && process.env.RUNNER_SHARED_SECRET?.trim());
}

export async function runRepositoryInvestigation(input: {
  repositoryUrl: string;
  commitSha: string;
  githubToken: string;
  incident: { id: string; title: string; service: string; evidence: string[] };
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240_000);
  try {
    const response = await fetch(`${required("CODEX_RUNNER_URL").replace(/\/$/, "")}/investigations`, {
      method: "POST",
      headers: { authorization: `Bearer ${required("RUNNER_SHARED_SECRET")}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
      cache: "no-store",
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body && typeof body === "object" && "error" in body ? String(body.error) : "Runner request failed";
      throw new Error(`Codex runner: ${message}`);
    }
    return runnerResultSchema.parse(body);
  } finally {
    clearTimeout(timeout);
  }
}
