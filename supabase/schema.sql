-- ============================================================================
-- Seneca Syndicate — full clean setup
-- Bookings (reservations) + Flight Logs (Hobbs / fuel records).
-- Run in Supabase: SQL Editor > New query > paste > Run.
-- The DROP lines make this a true reset; remove them if you want create-only.
-- ============================================================================
drop table if exists public.flight_log_audit cascade;
drop table if exists public.flight_logs      cascade;
drop table if exists public.booking_audit    cascade;
drop table if exists public.bookings         cascade;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- shared updated_at helper
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

-- ===========================================================================
-- 1) bookings — reservations (one row per booking, may span multiple days)
-- ===========================================================================
create table public.bookings (
  id          uuid primary key default gen_random_uuid(),
  member_id   text not null,                 -- 'parsa' | 'ali_r' | 'ali_b'
  start_date  date not null,
  start_time  time not null,
  end_date    date not null,
  end_time    time not null,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint end_after_start check ((end_date + end_time) > (start_date + start_time)),
  constraint bookings_no_overlap exclude using gist (
    tsrange((start_date + start_time), (end_date + end_time), '[)') with &&
  )
);
create index bookings_span_idx on public.bookings (start_date, end_date);
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- 2) flight_logs — the record-keeping core (cost-sharing + maintenance)
--    One row per flight. The DB computes hobbs_time, tach_time, fuel_burned.
-- ===========================================================================
create table public.flight_logs (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid references public.bookings(id) on delete set null,
  member_id    text not null,                 -- pilot in command who filed the log
  flight_date  date not null default current_date,

  -- who was aboard and what each put in:
  --   [{"member_id":"parsa","fuel_added":40,"fuel_cost":304.80}, ...]
  -- Fuel duty (25 gal per Hobbs hour) splits evenly across these entries;
  -- fuel credit does not — each member is credited their own fuel_added.
  -- Null means a solo flight by member_id.
  participants jsonb,

  hobbs_start  numeric(7,1),                  -- meter readings (cumulative)
  hobbs_end    numeric(7,1),
  tach_start   numeric(7,1),                  -- retired: kept for historical rows, no longer written
  tach_end     numeric(7,1),                  -- retired: kept for historical rows, no longer written

  fuel_start   numeric(5,1),                  -- gallons on board at start
  fuel_end     numeric(5,1),                  -- gallons on board at end
  fuel_added   numeric(6,1),                  -- whole-flight total (sum of participants)
  fuel_cost    numeric(8,2),                  -- whole-flight total (sum of participants)

  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- computed automatically; null until both ends are entered
  hobbs_time  numeric(7,1) generated always as (hobbs_end - hobbs_start) stored,
  tach_time   numeric(7,1) generated always as (tach_end - tach_start) stored,
  fuel_burned numeric(7,1) generated always as ((fuel_start + coalesce(fuel_added,0)) - fuel_end) stored,

  constraint hobbs_ok check (hobbs_start is null or hobbs_end is null or hobbs_end >= hobbs_start),
  -- CHECK cannot contain a subquery, so this guards the container only;
  -- the per-entry shape is enforced by the app.
  constraint participants_shape check (
    participants is null
    or (
      jsonb_typeof(participants) = 'array'
      and jsonb_array_length(participants) between 1 and 3
    )
  ),
  constraint tach_ok  check (tach_start  is null or tach_end  is null or tach_end  >= tach_start)
);
create index flight_logs_date_idx   on public.flight_logs (flight_date desc);
create index flight_logs_member_idx on public.flight_logs (member_id);
create index flight_logs_participants_idx on public.flight_logs using gin (participants);
create trigger flight_logs_touch before update on public.flight_logs
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- 3) audit logs — automatic who/what/when history for both tables
-- ===========================================================================
create table public.booking_audit (
  id bigint generated always as identity primary key,
  booking_id uuid, action text not null check (action in ('create','update','delete')),
  member_id text, snapshot jsonb, created_at timestamptz not null default now()
);
create index booking_audit_time_idx on public.booking_audit (created_at desc);

create table public.flight_log_audit (
  id bigint generated always as identity primary key,
  flight_log_id uuid, action text not null check (action in ('create','update','delete')),
  member_id text, snapshot jsonb, created_at timestamptz not null default now()
);
create index flight_log_audit_time_idx on public.flight_log_audit (created_at desc);

create or replace function public.log_booking_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE') then
    insert into public.booking_audit(booking_id, action, member_id, snapshot)
    values (old.id, 'delete', old.member_id, to_jsonb(old)); return old;
  else
    insert into public.booking_audit(booking_id, action, member_id, snapshot)
    values (new.id, case tg_op when 'INSERT' then 'create' else 'update' end, new.member_id, to_jsonb(new)); return new;
  end if;
end; $$;
create trigger bookings_audit after insert or update or delete on public.bookings
  for each row execute function public.log_booking_change();

create or replace function public.log_flight_log_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE') then
    insert into public.flight_log_audit(flight_log_id, action, member_id, snapshot)
    values (old.id, 'delete', old.member_id, to_jsonb(old)); return old;
  else
    insert into public.flight_log_audit(flight_log_id, action, member_id, snapshot)
    values (new.id, case tg_op when 'INSERT' then 'create' else 'update' end, new.member_id, to_jsonb(new)); return new;
  end if;
end; $$;
create trigger flight_logs_audit after insert or update or delete on public.flight_logs
  for each row execute function public.log_flight_log_change();

-- ===========================================================================
-- 4) Row Level Security (publishable key / anon role — see README "Security")
-- ===========================================================================
alter table public.bookings         enable row level security;
alter table public.flight_logs      enable row level security;
alter table public.booking_audit    enable row level security;
alter table public.flight_log_audit enable row level security;

create policy bookings_anon_all   on public.bookings    for all    to anon using (true) with check (true);
create policy flightlogs_anon_all on public.flight_logs for all    to anon using (true) with check (true);
create policy booking_audit_read  on public.booking_audit    for select to anon using (true);
create policy flight_audit_read   on public.flight_log_audit for select to anon using (true);

-- ===========================================================================
-- 5) Realtime — live updates for bookings and flight logs
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='flight_logs') then
    alter publication supabase_realtime add table public.flight_logs;
  end if;
end $$;
