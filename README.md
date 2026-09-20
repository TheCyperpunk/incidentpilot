# IncidentPilot

## Overview

IncidentPilot is an evidence-first incident investigation workspace. It gives an engineer a simple three-phase flow: connect available telemetry, select the one GitHub repository that may be inspected, and run a human-reviewed investigation against an immutable commit.

The project is designed to make an incident response more deliberate: provider data is labelled by source, repository evidence is collected in a separate runner, and any mitigation remains approval-gated.

Repository: [TheCyperpunk/incidentpilot](https://github.com/TheCyperpunk/incidentpilot)

## Problem Statement

During an incident, engineers often have to jump between monitoring dashboards, deployment history, source code, and chat messages. This makes it easy to act on an assumption instead of verified evidence. It is also unsafe to give an AI agent unrestricted access to every repository or production system.

## Solution

IncidentPilot turns investigation into a guided workflow:

1. Read connected observability data from Sentry.
2. Let the user explicitly select a GitHub App installation and one repository.
3. Pin the repository to a full Git commit SHA.
4. Use OpenAI to produce a structured triage hypothesis from supplied evidence only.
5. Send the selected, pinned repository to a separate Codex runner with network access disabled for code inspection and safe test reporting.
6. Save the evidence in Supabase and wait for a human approval decision.

## Features

- Three-step, responsive investigation workflow with a clear next action.
- Supabase authentication, persisted workspaces, and project-scoped Row Level Security.
- Read-only Sentry dashboard metrics for events, unresolved issues, and P95 latency.
- GitHub OAuth account/organization picker and GitHub App repository validation.
- One active repository per workspace, stored without persisting GitHub OAuth or installation tokens.
- Immutable Git commit resolution before inspection.
- OpenAI structured JSON triage with `store: false`; it reports hypotheses, not invented root causes.
- Private Codex runner that checks out a disposable repository workspace, disables network access for Codex, records a test result or explicit no-test reason, and removes the workspace afterward.
- Per-user investigation cooldown, one active runner job at a time, request timeouts, and `429` responses.
- Human approval gate. The rollback path is currently a clearly labelled simulation; it does not deploy to production.

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, Motion, Lucide icons.
- **Backend:** Next.js Route Handlers, Node.js, Zod validation.
- **Database:** Supabase PostgreSQL, Supabase Auth, Row Level Security.
- **APIs / Services:** OpenAI Responses API, OpenAI Codex SDK, GitHub OAuth, GitHub App API, Sentry API.
- **Hosting / Deployment:** Local development at present. The Next.js app and runner should be deployed separately; the runner must remain private.
- **Other Tools:** Docker, ESLint, GitHub, npm.

## Codex / OpenAI Usage

Codex and OpenAI were used as development and product-building tools during the hackathon for:

- Turning the incident-response idea into an evidence-first architecture.
- Building and refining the guided UI/UX.
- Debugging GitHub App, PEM-key, OAuth, Sentry, and local runner setup issues.
- Generating and validating structured triage output through the OpenAI Responses API.
- Running a constrained Codex investigation inside a disposable repository workspace.
- Improving error handling, rate limiting, documentation, and local setup instructions.

In the application itself, OpenAI triage receives only the collected provider evidence. The Codex runner is separate from the web application and is given only the selected repository, its pinned SHA, and a short-lived GitHub installation token for that request.

## Demo

### Live Demo

Not deployed yet. The project currently runs locally.

### Demo / Pitch Video

Not recorded yet. Before final submission, add a public video link here showing:

1. Signing in and connecting Sentry.
2. Selecting a GitHub repository.
3. Starting an investigation and showing the pinned commit SHA.
4. Reviewing OpenAI triage and Codex runner evidence.
5. Showing the human approval gate and simulated rollback status.

## Screenshots

Add final screenshots here before submission. Recommended captures:

- Guided investigation workspace with Sentry telemetry.
- Repository selection screen with an active repository.
- A completed investigation showing the immutable commit, Codex evidence, and `Awaiting Approval` state.

## How to Run Locally

### Prerequisites

- Node.js 22 or later
- Git
- A Supabase project
- A GitHub OAuth App and GitHub App with **Contents: Read-only** permission
- An OpenAI API key for triage and a separate spend-limited OpenAI key for the Codex runner
- Optional: a Sentry project and a read-only Sentry API token

### 1. Clone and install the web application

```bash
git clone https://github.com/TheCyperpunk/incidentpilot.git
cd incidentpilot
npm ci
```

Create the local environment file:

```powershell
# Windows PowerShell
Copy-Item .env.example .env.local
```

```bash
# macOS / Linux
cp .env.example .env.local
```

Fill in `.env.local` with your own server-side credentials. Never commit this file or use `NEXT_PUBLIC_` for private keys.

Apply the Supabase migrations in `supabase/migrations/` to your linked Supabase project, then start the web app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 2. Configure and start the private Codex runner

Create `runner/.env` with values similar to the following. Use the same `RUNNER_SHARED_SECRET` in this file and the root `.env.local`.

```ini
CODEX_API_KEY=your_separate_spend_limited_openai_key
RUNNER_SHARED_SECRET=your_long_random_shared_secret
RUNNER_ALLOWED_OWNERS=your-github-user,your-github-organization
PORT=8787
```

For local testing only, `RUNNER_ALLOW_ANY_OWNER=true` permits any repository accessible through the GitHub App. Prefer a specific owner or repository allowlist.

Start the runner in a second terminal:

```bash
cd runner
npm ci
npm start
```

Check that it is running:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

### 3. Run the workflow

1. Create an account or sign in.
2. Connect GitHub and select an installation plus one repository.
3. Return to the guided workspace and select **Start investigation**.
4. Review the OpenAI triage, pinned Git SHA, Codex runner evidence, and test record.
5. Approve only after reviewing the evidence. The current mitigation path is simulated.

## Additional Notes

- The runner must not be exposed publicly. In production, deploy it as a private service and restrict access to the Next.js application.
- Network access to `api.github.com:443` is required for repository validation, commit pinning, and investigation. A VPN, proxy, firewall, or offline connection can prevent those actions.
- Sentry metrics are real when configured. Database CPU and deployment-provider data intentionally remain marked as not connected until their providers are added.
- The application currently uses a single sample incident key (`INC-2048`). Connecting real alert ingestion and a real deployment provider are planned next steps.
- Rotate any credentials that were ever exposed in screenshots or chat before deployment.
