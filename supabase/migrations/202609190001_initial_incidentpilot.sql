-- IncidentPilot: durable incident workflow state.
-- Apply with `supabase db push` after linking this repository to a Supabase project.

create extension if not exists pgcrypto;

create type public.incident_status as enum ('investigating', 'awaiting_approval', 'mitigating', 'verifying', 'resolved', 'failed');
create type public.run_status as enum ('queued', 'triaging', 'collecting_evidence', 'code_investigating', 'root_cause_ready', 'awaiting_approval', 'mitigating', 'verifying', 'resolved', 'failed');
create type public.approval_status as enum ('pending', 'approved', 'rejected');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null default 'github',
  full_name text not null,
  default_branch text not null default 'main',
  installation_id text,
  created_at timestamptz not null default now(),
  unique(project_id, provider, full_name)
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  repository_id uuid references public.repositories(id) on delete set null,
  external_key text not null,
  title text not null,
  service text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status public.incident_status not null default 'investigating',
  deployment_version text,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(project_id, external_key)
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  type text not null,
  source text not null,
  summary text not null,
  payload_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.investigation_runs (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  status public.run_status not null default 'queued',
  pinned_commit_sha text,
  root_cause_json jsonb,
  failure_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.investigation_runs(id) on delete cascade,
  type text not null,
  message text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  run_id uuid references public.investigation_runs(id) on delete set null,
  action text not null,
  evidence_snapshot jsonb not null,
  status public.approval_status not null default 'pending',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.mitigation_runs (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  approval_id uuid not null references public.approvals(id) on delete restrict,
  action text not null,
  result_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.postmortems (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null unique references public.incidents(id) on delete cascade,
  markdown text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index evidence_incident_occurred_at_idx on public.evidence(incident_id, occurred_at);
create index runs_incident_created_at_idx on public.investigation_runs(incident_id, created_at desc);
create index events_run_created_at_idx on public.agent_events(run_id, created_at);

alter table public.projects enable row level security;
alter table public.repositories enable row level security;
alter table public.incidents enable row level security;
alter table public.evidence enable row level security;
alter table public.investigation_runs enable row level security;
alter table public.agent_events enable row level security;
alter table public.approvals enable row level security;
alter table public.mitigation_runs enable row level security;
alter table public.postmortems enable row level security;

create policy "project owners access projects" on public.projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "project owners access repositories" on public.repositories
  for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy "project owners access incidents" on public.incidents
  for all using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy "project owners access evidence" on public.evidence
  for all using (exists (select 1 from public.incidents i join public.projects p on p.id = i.project_id where i.id = incident_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.incidents i join public.projects p on p.id = i.project_id where i.id = incident_id and p.owner_id = auth.uid()));

create policy "project owners access runs" on public.investigation_runs
  for all using (exists (select 1 from public.incidents i join public.projects p on p.id = i.project_id where i.id = incident_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.incidents i join public.projects p on p.id = i.project_id where i.id = incident_id and p.owner_id = auth.uid()));

create policy "project owners access events" on public.agent_events
  for all using (exists (select 1 from public.investigation_runs r join public.incidents i on i.id = r.incident_id join public.projects p on p.id = i.project_id where r.id = run_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.investigation_runs r join public.incidents i on i.id = r.incident_id join public.projects p on p.id = i.project_id where r.id = run_id and p.owner_id = auth.uid()));

create policy "project owners access approvals" on public.approvals
  for all using (exists (select 1 from public.incidents i join public.projects p on p.id = i.project_id where i.id = incident_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.incidents i join public.projects p on p.id = i.project_id where i.id = incident_id and p.owner_id = auth.uid()));

create policy "project owners access mitigations" on public.mitigation_runs
  for all using (exists (select 1 from public.incidents i join public.projects p on p.id = i.project_id where i.id = incident_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.incidents i join public.projects p on p.id = i.project_id where i.id = incident_id and p.owner_id = auth.uid()));

create policy "project owners access postmortems" on public.postmortems
  for all using (exists (select 1 from public.incidents i join public.projects p on p.id = i.project_id where i.id = incident_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.incidents i join public.projects p on p.id = i.project_id where i.id = incident_id and p.owner_id = auth.uid()));
