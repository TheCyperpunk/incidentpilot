# IncidentPilot

Evidence-first incident response workflow for a controlled hackathon simulation.

## Current implementation

- Next.js incident command center and responsive evidence-first UI.
- Server-side investigation run API, event polling, human approval, simulated rollback, verification, and postmortem view.
- Validated structured OpenAI triage boundary. It uses strict JSON-schema output, server-only API credentials, and `store: false`; a deterministic, explicitly labeled simulation is used only until `OPENAI_API_KEY` is set.
- Supabase PostgreSQL migration containing the agreed workflow schema and project-scoped Row Level Security.
- Server-only Supabase health endpoint at `/api/supabase-health` for connection verification.
- GitHub App server integration that validates one configured, allowlisted repository and creates an installation token only for the private runner request.
- A separate, compiling Docker Codex runner that requires an allowlisted repository, an immutable commit SHA, a shared secret, and a `CODEX_API_KEY` only inside the runner.

## Run the demo

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`, select **Investigate incident**, wait for the evidence to complete, approve the simulated rollback, then open the postmortem.

## Configure Supabase

1. Create a project and copy `.env.example` values into `.env.local`.
2. Link the project with the Supabase CLI.
3. Apply `supabase/migrations/202609190001_initial_incidentpilot.sql` using `supabase db push`.
4. The app uses Supabase-backed investigation records and project-scoped Row Level Security.

## Enable live OpenAI triage

Add these server-only values to `.env.local`, then restart the development server:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_TRIAGE_MODEL=gpt-5.6-luna
```

Never prefix the API key with `NEXT_PUBLIC_` or place it in browser code. When configured, failed live requests return an explicit error; the app does not silently relabel a failed live request as simulation output.

## Configure the Codex runner

The runner is not exposed publicly and must be deployed on a private network, separate from Vercel. See [runner/README.md](runner/README.md). Do not pass the runner's `CODEX_API_KEY`, GitHub credentials, installation token, or Supabase secret key to the browser or repository process.

## Enable real GitHub App investigation

Create a GitHub App that is installed on the personal account or organization repositories you want IncidentPilot to inspect. Grant **Repository permissions → Contents: Read-only**; do not grant write permissions, Actions, or organization administration. Configure the App's OAuth callback URL as `http://localhost:3000/api/github/callback` during local development.

Place these values in the **Next.js server** environment (not `NEXT_PUBLIC_` and not the runner):

```ini
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\n...\\n-----END RSA PRIVATE KEY-----"
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_OAUTH_CALLBACK_URL=http://localhost:3000/api/github/callback
CODEX_RUNNER_URL=http://private-runner:8787
RUNNER_SHARED_SECRET=a-long-random-secret
```

For local development only, you can replace `GITHUB_APP_PRIVATE_KEY` with
`GITHUB_APP_PRIVATE_KEY_PATH=C:/absolute/path/to/private-key.pem`. Keep the
file outside the repository and use a managed server-side secret in deployment.

Set `RUNNER_ALLOWED_OWNERS=your-user,your-organization`, plus `CODEX_API_KEY` and the same `RUNNER_SHARED_SECRET`, **only in the runner's environment**. Restart Next.js after adding variables. Then open **Repositories**, authorize GitHub, choose a personal account or organization, and select its installed repository. The App validates the selection, resolves a full SHA at investigation time, and labels the resulting root-cause evidence as **isolated Codex runner**. If any integration variable is absent, the UI explicitly remains a controlled simulation.
