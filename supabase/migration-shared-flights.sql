-- ============================================================================
-- Shared flights — one flight, up to three owners
-- Run in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run more than once. Adds a column; touches no existing data.
-- ============================================================================
--
-- `participants` records who was on the flight and what each of them put in:
--
--   [{"member_id":"parsa","fuel_added":40,"fuel_cost":304.80},
--    {"member_id":"ali_r","fuel_added":0,"fuel_cost":0}]
--
-- The fuel DUTY (25 gal per Hobbs hour) splits evenly across the participants.
-- The fuel CREDIT does not — each member is credited only what they added, so
-- an uneven fill is recorded as it happened.
--
-- flight_logs.fuel_added / fuel_cost stay the whole-flight totals: the app
-- writes them as the sum of the participants, and the generated fuel_burned
-- column still depends on fuel_added.
--
-- Rows predating this column have participants = null and are read as a solo
-- flight by member_id, so no backfill is needed.

alter table public.flight_logs
  add column if not exists participants jsonb;

comment on column public.flight_logs.participants is
  'Who flew and what each put in: [{member_id, fuel_added, fuel_cost}]. '
  'Null means a solo flight by member_id. Duty splits evenly across entries; '
  'fuel credit follows each entry''s own fuel_added.';

-- Postgres does not allow a subquery inside a CHECK constraint, so this guards
-- the container only: an array of one to three entries. The per-entry shape is
-- the app's job (see lToRow in src/supabaseClient.js). For the stricter
-- guarantee you would need a BEFORE INSERT/UPDATE trigger, which may use
-- subqueries freely.
alter table public.flight_logs
  drop constraint if exists participants_shape;
alter table public.flight_logs
  add constraint participants_shape check (
    participants is null
    or (
      jsonb_typeof(participants) = 'array'
      and jsonb_array_length(participants) between 1 and 3
    )
  );

create index if not exists flight_logs_participants_idx
  on public.flight_logs using gin (participants);
