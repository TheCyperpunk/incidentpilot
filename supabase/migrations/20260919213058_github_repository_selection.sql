-- A project may retain several GitHub repositories, but an incident uses the
-- selected repository. This stores only GitHub identifiers, never OAuth or
-- installation access tokens. Existing project-owner RLS policies continue to
-- govern this column because it lives on the already-protected repositories table.
alter table public.repositories
  add column if not exists is_selected boolean not null default false;

-- Enforce one active repository per IncidentPilot project. A partial index lets
-- users keep historical connections without making them selectable by default.
create unique index if not exists repositories_one_selected_per_project_idx
  on public.repositories (project_id)
  where is_selected;
