-- UNMET initial schema: accounts, synced data and Row Level Security.
-- PREPARED, NOT APPLIED. Review docs/auth-architecture.md before running it against a project.
--
-- Principles
--  * Every user-data row carries user_id, and RLS limits every table to (select auth.uid()) = user_id.
--    The database decides who you are from the signed session token, never from a value the
--    browser sends.
--  * Client record ids are kept exactly (stacked habits point at event ids), so primary keys are
--    (user_id, id) and ids are restricted to characters that are safe inside HTML attributes.
--  * client_updated_at = when the user made the change (conflict resolution, clamped so a device
--    with a wrong clock can't win forever); server_updated_at = set by the database (pull cursor).
--  * Deletions are soft (deleted_at) so other devices learn about them.
--  * Journal rows can only be written while the user has turned journal sync on (enforced here,
--    not just in the app).
--  * Fields this schema doesn't model yet are kept in `extra` (size-limited) so nothing a device
--    stores is lost in the cloud.

create schema if not exists private;
revoke all on schema private from public;

-- ---------- Shared trigger: server timestamps, clamped client timestamps, immutable owner ----------
create or replace function private.before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot be changed' using errcode = '42501';
  end if;
  new.server_updated_at := now();
  if new.client_updated_at is null or new.client_updated_at > now() + interval '5 minutes' then
    new.client_updated_at := now();
  end if;
  return new;
end $$;

-- ---------- Tables ----------
create table public.profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  first_name         text check (char_length(first_name) <= 100),
  goal_tracks        text[] not null default '{}' check (cardinality(goal_tracks) <= 20),
  onboarded          boolean not null default false,
  theme              text check (theme in ('light', 'dark')),
  lang               text check (lang in ('en', 'ar')),
  calendar_view      text check (calendar_view in ('day', 'week')),
  journal_sync       boolean not null default false,          -- opt-in; see journal policies
  client_updated_at  timestamptz not null default now(),
  server_updated_at  timestamptz not null default now()
);

create table public.events (
  user_id            uuid not null references auth.users (id) on delete cascade,
  id                 text not null check (id ~ '^[A-Za-z0-9_.:@-]{1,100}$'),
  series_id          text not null check (series_id ~ '^[A-Za-z0-9_.:@-]{1,100}$'),
  title              text not null check (char_length(title) between 1 and 500),
  type               text not null check (type in ('once', 'weekly')),
  date               date,
  day_of_week        smallint check (day_of_week between 0 and 6),
  start_date         date,
  end_date           date,
  exclude_dates      date[] not null default '{}' check (cardinality(exclude_dates) <= 1000),
  start_time         time not null,
  end_time           time not null,
  source             text not null default 'manual' check (char_length(source) <= 20),
  extra              jsonb not null default '{}' check (jsonb_typeof(extra) = 'object' and pg_column_size(extra) <= 8192),
  client_updated_at  timestamptz not null,
  server_updated_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  primary key (user_id, id),
  check ((type = 'once' and date is not null) or (type = 'weekly' and day_of_week is not null))
);

create table public.habits (
  user_id            uuid not null references auth.users (id) on delete cascade,
  id                 text not null check (id ~ '^[A-Za-z0-9_.:@-]{1,100}$'),
  name               text not null check (char_length(name) between 1 and 500),
  schedule_type      text not null default 'independent' check (schedule_type in ('independent', 'stacked')),
  days               smallint[] check (days is null or (cardinality(days) <= 7 and days <@ array[0,1,2,3,4,5,6]::smallint[])),
  time               time,                                     -- null = no set time
  duration_min       smallint check (duration_min between 1 and 600),
  stack_event_ids    text[] not null default '{}' check (cardinality(stack_event_ids) <= 200),
  offset_minutes     smallint check (offset_minutes between -720 and 720),
  stack_after        text check (char_length(stack_after) <= 500),  -- legacy free-text anchor
  created_on         date,
  extra              jsonb not null default '{}' check (jsonb_typeof(extra) = 'object' and pg_column_size(extra) <= 8192),
  client_updated_at  timestamptz not null,
  server_updated_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  primary key (user_id, id)
);

-- One row per habit per local calendar day, so devices completing different days never conflict
-- and streaks are recomputed from the same history everywhere.
create table public.habit_completions (
  user_id            uuid not null,
  habit_id           text not null,
  day                date not null,
  done               boolean not null,
  client_updated_at  timestamptz not null,
  server_updated_at  timestamptz not null default now(),
  primary key (user_id, habit_id, day),
  foreign key (user_id, habit_id) references public.habits (user_id, id) on delete cascade
);

create table public.goals (
  user_id            uuid not null references auth.users (id) on delete cascade,
  id                 text not null check (id ~ '^[A-Za-z0-9_.:@-]{1,100}$'),
  text               text not null check (char_length(text) between 1 and 2000),
  subtasks           jsonb not null default '[]' check (jsonb_typeof(subtasks) = 'array' and pg_column_size(subtasks) <= 65536),
  created_at         timestamptz,
  extra              jsonb not null default '{}' check (jsonb_typeof(extra) = 'object' and pg_column_size(extra) <= 8192),
  client_updated_at  timestamptz not null,
  server_updated_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  primary key (user_id, id)
);

-- Morning/evening entries use ids like 'morning:2026-10-30'; free-form entries keep their own ids.
create table public.journal_entries (
  user_id            uuid not null references auth.users (id) on delete cascade,
  id                 text not null check (id ~ '^[A-Za-z0-9_.:@-]{1,100}$'),
  kind               text not null check (kind in ('morning', 'evening', 'freeform')),
  day                date,
  body               jsonb not null check (jsonb_typeof(body) = 'object' and pg_column_size(body) <= 204800),
  client_updated_at  timestamptz not null,
  server_updated_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  primary key (user_id, id),
  check (kind = 'freeform' or day is not null)
);

-- Computed weekly metrics for "Your Week, Unmet" (Track 2). No journal text.
create table public.weekly_recaps (
  user_id            uuid not null references auth.users (id) on delete cascade,
  week_start         date not null,
  data               jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  client_updated_at  timestamptz not null,
  server_updated_at  timestamptz not null default now(),
  primary key (user_id, week_start)
);

-- Future subscription status (not used during beta). Readable by its owner, writable only by
-- server functions using the service role.
create table public.entitlements (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  state              text not null default 'beta' check (state in ('beta', 'trialing', 'active', 'grace', 'paused')),
  trial_started_at   timestamptz,
  trial_ends_at      timestamptz,
  server_updated_at  timestamptz not null default now()
);

-- ---------- Triggers ----------
create trigger before_write before insert or update on public.profiles          for each row execute function private.before_write();
create trigger before_write before insert or update on public.events            for each row execute function private.before_write();
create trigger before_write before insert or update on public.habits            for each row execute function private.before_write();
create trigger before_write before insert or update on public.habit_completions for each row execute function private.before_write();
create trigger before_write before insert or update on public.goals             for each row execute function private.before_write();
create trigger before_write before insert or update on public.journal_entries   for each row execute function private.before_write();
create trigger before_write before insert or update on public.weekly_recaps     for each row execute function private.before_write();

create or replace function private.touch_entitlement() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.server_updated_at := now();
  return new;
end $$;
create trigger touch before insert or update on public.entitlements for each row execute function private.touch_entitlement();

-- New account: create its profile and a 'beta' entitlement row.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.entitlements (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------- Indexes for "changed since" pulls ----------
create index events_user_changed            on public.events (user_id, server_updated_at);
create index habits_user_changed            on public.habits (user_id, server_updated_at);
create index habit_completions_user_changed on public.habit_completions (user_id, server_updated_at);
create index goals_user_changed             on public.goals (user_id, server_updated_at);
create index journal_entries_user_changed   on public.journal_entries (user_id, server_updated_at);
create index weekly_recaps_user_changed     on public.weekly_recaps (user_id, server_updated_at);

-- ---------- Privileges: nothing for anonymous visitors; signed-in users only via RLS ----------
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on
  public.events, public.habits, public.habit_completions, public.goals, public.journal_entries, public.weekly_recaps
  to authenticated;
grant select, insert, update on public.profiles to authenticated;     -- created by trigger; deleted with the account
grant select on public.entitlements to authenticated;                 -- written only by the service role

alter table public.profiles          enable row level security;
alter table public.events            enable row level security;
alter table public.habits            enable row level security;
alter table public.habit_completions enable row level security;
alter table public.goals             enable row level security;
alter table public.journal_entries   enable row level security;
alter table public.weekly_recaps     enable row level security;
alter table public.entitlements      enable row level security;

-- ---------- Policies ----------
create policy "own profile: read"   on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "own profile: insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own profile: update" on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

do $$
declare t text;
begin
  foreach t in array array['events', 'habits', 'habit_completions', 'goals', 'weekly_recaps'] loop
    execute format('create policy "own rows: read" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows: insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows: update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "own rows: delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- Journals: reading and deleting your own entries is always allowed; writing requires that you
-- turned journal sync on.
create or replace function private.journal_sync_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.journal_sync from public.profiles p where p.user_id = (select auth.uid())), false)
$$;
grant usage on schema private to authenticated;
grant execute on function private.journal_sync_enabled() to authenticated;

create policy "own journals: read"   on public.journal_entries for select to authenticated using ((select auth.uid()) = user_id);
create policy "own journals: insert" on public.journal_entries for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.journal_sync_enabled()));
create policy "own journals: update" on public.journal_entries for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select private.journal_sync_enabled()));
create policy "own journals: delete" on public.journal_entries for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own entitlement: read" on public.entitlements for select to authenticated using ((select auth.uid()) = user_id);
