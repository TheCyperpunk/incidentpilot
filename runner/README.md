# IncidentPilot Codex runner

This service is deliberately separate from Next.js. It accepts an allowlisted repository and pinned commit, checks it out into a disposable directory, runs Codex with network access disabled, then deletes the directory.

Create `runner/.env` with `CODEX_API_KEY` and `RUNNER_SHARED_SECRET`. The runner loads this local file at startup. Limit access with `RUNNER_ALLOWED_OWNERS=owner-one,organization-two` or `RUNNER_ALLOWED_REPOSITORY=owner/repository`. To allow any repository available to the installed GitHub App, explicitly set `RUNNER_ALLOW_ANY_OWNER=true`; use that option only for repositories you own and trust. Use a dedicated, spend-limited API key only for this local trusted-runner environment. The runner receives a short-lived GitHub App installation token from the private Next.js server for one request; it never writes that token to disk or logs it. Each request must be GitHub-App validated.

The runner accepts one investigation at a time and aborts the Codex turn after `RUNNER_TIMEOUT_MS` (default: 180000 milliseconds). The Next.js endpoint has a per-user cooldown controlled by `INVESTIGATION_COOLDOWN_MS` (default: 300000 milliseconds).

Build with `docker build -t incidentpilot-runner ./runner` and run with `docker run --rm -p 8787:8787 --env-file runner/.env incidentpilot-runner`.

Only run repositories you own and trust. It is not a public execution service.
