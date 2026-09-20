import "dotenv/config";
import { Codex } from "@openai/codex-sdk";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";

const requestSchema = z.object({
  repositoryUrl: z.string().url().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/i),
  githubToken: z.string().min(1),
  incident: z.object({ id: z.string(), title: z.string(), service: z.string(), evidence: z.array(z.string()) }),
});
const resultSchema = { type: "object", additionalProperties: false, required: ["rootCause", "evidence", "confidence", "tests"], properties: {
  rootCause: { type: "object", additionalProperties: false, required: ["file", "function", "summary"], properties: { file: { type: "string" }, function: { type: "string" }, summary: { type: "string" } } },
  evidence: { type: "array", items: { type: "string" } }, confidence: { type: "string", enum: ["low", "medium", "high"] },
  tests: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["command", "exitCode", "summary"], properties: { command: { type: "string" }, exitCode: { type: "number" }, summary: { type: "string" } } } },
}} as const;

function send(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) { response.writeHead(status, { "content-type": "application/json", ...headers }); response.end(JSON.stringify(payload)); }
async function readBody(request: IncomingMessage): Promise<unknown> { let value = ""; for await (const chunk of request) { value += chunk; if (value.length > 64_000) throw new Error("Request body is too large"); } return JSON.parse(value); }
function run(command: string, args: string[], cwd?: string, env?: Record<string, string | undefined>): Promise<void> { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd, env: { ...process.env, ...env } as NodeJS.ProcessEnv, stdio: "pipe" }); let output = ""; child.stdout.on("data", (chunk) => { output += chunk.toString(); }); child.stderr.on("data", (chunk) => { output += chunk.toString(); }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed: ${output.slice(-1000)}`))); }); }
async function investigate(input: z.infer<typeof requestSchema>, signal: AbortSignal) {
  if (!process.env.CODEX_API_KEY) throw new Error("CODEX_API_KEY is not configured in the runner");
  const allowedOwners = (process.env.RUNNER_ALLOWED_OWNERS ?? "").split(",").map((owner) => owner.trim().toLowerCase()).filter(Boolean);
  const allowedRepository = process.env.RUNNER_ALLOWED_REPOSITORY?.trim().toLowerCase();
  const allowAnyOwner = process.env.RUNNER_ALLOW_ANY_OWNER?.trim().toLowerCase() === "true";
  if (!allowAnyOwner && !allowedRepository && allowedOwners.length === 0) throw new Error("Configure RUNNER_ALLOWED_OWNERS, RUNNER_ALLOWED_REPOSITORY, or explicitly set RUNNER_ALLOW_ANY_OWNER=true");
  const repositoryName = new URL(input.repositoryUrl).pathname.replace(/^\//, "").replace(/\.git$/, "").toLowerCase();
  const [owner] = repositoryName.split("/");
  if (!allowAnyOwner && ((allowedRepository && repositoryName !== allowedRepository) || (allowedOwners.length > 0 && !allowedOwners.includes(owner)))) throw new Error("Repository is not on the runner allowlist");
  const worktree = await mkdtemp(join(tmpdir(), "incidentpilot-"));
  try {
    // Do not put the installation token in a command argument or remote URL.
    // Git receives it as an ephemeral HTTP header only for this clone process.
    const basicAuth = Buffer.from(`x-access-token:${input.githubToken}`).toString("base64");
    await run("git", ["clone", "--no-checkout", input.repositoryUrl, worktree], undefined, {
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicAuth}`,
    });
    await run("git", ["checkout", "--detach", input.commitSha], worktree);
    await run("git", ["rev-parse", "--verify", `${input.commitSha}^{commit}`], worktree);
    const events: Array<{ type: string; message: string }> = [];
    const codex = new Codex({ apiKey: process.env.CODEX_API_KEY, env: { PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" } });
    const thread = codex.startThread({ workingDirectory: worktree, sandboxMode: "workspace-write", approvalPolicy: "never", networkAccessEnabled: false, webSearchMode: "disabled" });
    const prompt = `You are investigating ${input.incident.id}: ${input.incident.title}. Service: ${input.incident.service}. Evidence: ${input.incident.evidence.join(" | ")}. Inspect only the checked-out repository. Do not access production systems, network services, credentials, or files outside the repository. Do not modify source files. Inspect relevant code and run appropriate existing tests. The tests array must contain at least one result. If no safe, relevant existing test can be run, add one record with command "not run", exitCode -1, and a summary that explains why. Do not claim a fix is successful unless tests actually pass. Return only the requested structured result.`;
    const turn = await thread.run(prompt, { outputSchema: resultSchema, signal });
    events.push({ type: "repository_inspection", message: "Codex completed isolated repository inspection" });
    return { result: JSON.parse(turn.finalResponse), events, threadId: thread.id };
  } finally { await rm(worktree, { recursive: true, force: true }); }
}

const port = Number(process.env.PORT ?? 8787);
const timeoutMs = Math.max(1_000, Number(process.env.RUNNER_TIMEOUT_MS ?? 180_000));
let activeInvestigation = false;
createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true });
  if (request.method !== "POST" || request.url !== "/investigations") return send(response, 404, { error: "Not found" });
  if (!process.env.RUNNER_SHARED_SECRET || request.headers.authorization !== `Bearer ${process.env.RUNNER_SHARED_SECRET}`) return send(response, 401, { error: "Unauthorized" });
  if (activeInvestigation) return send(response, 429, { error: "The runner is already investigating another repository." }, { "retry-after": "60" });
  try {
    const input = requestSchema.parse(await readBody(request));
    activeInvestigation = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      send(response, 200, await investigate(input, controller.signal));
    } finally {
      clearTimeout(timer);
      activeInvestigation = false;
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    send(response, timedOut ? 504 : 400, { error: timedOut ? "Runner execution timed out." : error instanceof Error ? error.message : "Investigation failed" });
  }
}).listen(port, "0.0.0.0", () => console.log(`IncidentPilot runner listening on ${port}`));
