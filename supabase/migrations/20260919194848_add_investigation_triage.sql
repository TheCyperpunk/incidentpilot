-- Preserve the triage hypothesis that initiated a run. Root-cause evidence is
-- intentionally separate: triage is a hypothesis, not a verified conclusion.
alter table public.investigation_runs
  add column triage_json jsonb;
