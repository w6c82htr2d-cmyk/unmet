-- Row Level Security and integrity tests for supabase/migrations. Synthetic users only.
-- Each check runs SQL *as* a signed-in user (role authenticated + JWT claims, the way Supabase's API
-- does it) or as an anonymous visitor, and records whether the database allowed it.
set client_min_messages = warning;
create schema t;
create table t.results (n serial, name text, ok boolean, detail text);
grant usage on schema t to anon, authenticated, service_role;

-- Run a statement as whoever the current role is; report 'ok:<rows>' or the SQLSTATE it failed with.
create function t.try(sql text) returns text language plpgsql as $$
declare n bigint;
begin
  execute sql;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return sqlstate;
end $$;
create function t.val(sql text) returns text language plpgsql as $$
declare v text;
begin
  execute sql into v;
  return v;
exception when others then
  return 'ERR:' || sqlstate;
end $$;
grant execute on function t.try(text), t.val(text) to anon, authenticated, service_role;

create function t.act_as(uid uuid) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('request.jwt.claims', '', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
end $$;

-- Records a result with the owner's rights, so it works while a test is acting as a user.
create function t.check(name text, ok boolean, detail text default '') returns void language sql security definer as $$
  insert into t.results (name, ok, detail) values (name, coalesce(ok, false), detail);
$$;
grant execute on function t.check(text, boolean, text) to anon, authenticated, service_role;

-- Fixtures: two synthetic accounts. A = aaaa…, B = bbbb…
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@example.invalid'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@example.invalid');
-- B's data, inserted directly (as the database owner)
insert into public.events (user_id, id, series_id, title, type, day_of_week, start_time, end_time, client_updated_at)
  values ('bbbbbbbb-0000-4000-8000-000000000002', 'evB', 'evB', 'B private class', 'weekly', 1, '08:00', '09:00', now());
insert into public.habits (user_id, id, name, client_updated_at)
  values ('bbbbbbbb-0000-4000-8000-000000000002', 'hB', 'B private habit', now());
insert into public.habit_completions (user_id, habit_id, day, done, client_updated_at)
  values ('bbbbbbbb-0000-4000-8000-000000000002', 'hB', '2026-10-30', true, now());
update public.profiles set journal_sync = true where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';
insert into public.journal_entries (user_id, id, kind, day, body, client_updated_at)
  values ('bbbbbbbb-0000-4000-8000-000000000002', 'morning:2026-10-30', 'morning', '2026-10-30', '{"priorities":[{"text":"B secret"}]}', now());

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  b constant uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  r text;
begin
  -- Signup trigger
  perform t.check('new accounts get a profile and a beta entitlement',
    (select count(*) from public.profiles where user_id in (a, b)) = 2
    and (select count(*) from public.entitlements where user_id in (a, b) and state = 'beta') = 2);

  -- ===== As user A =====
  perform t.act_as(a);
  r := t.try(format($q$insert into public.events (user_id, id, series_id, title, type, day_of_week, start_time, end_time, client_updated_at) values (%L, 'evA', 'clsA', 'Classes', 'weekly', 0, '08:00', '10:50', now())$q$, a));
  perform t.check('A can create own event', r = 'ok:1', r);
  r := t.try(format($q$insert into public.habits (user_id, id, name, schedule_type, stack_event_ids, offset_minutes, client_updated_at) values (%L, 'hA', 'Review notes', 'stacked', '{evA}', 10, now())$q$, a));
  perform t.check('A can create own stacked habit', r = 'ok:1', r);
  r := t.try(format($q$insert into public.habit_completions (user_id, habit_id, day, done, client_updated_at) values (%L, 'hA', '2026-10-25', true, now())$q$, a));
  perform t.check('A can record own completion', r = 'ok:1', r);
  r := t.try(format($q$insert into public.goals (user_id, id, text, subtasks, client_updated_at) values (%L, 'gA', 'Midterm', '[{"id":"st0","text":"Review"}]', now())$q$, a));
  perform t.check('A can create own goal', r = 'ok:1', r);
  r := t.try(format($q$insert into public.habits (user_id, id, name, client_updated_at) values (%L, 'hB', 'Same id as B', now())$q$, a));
  perform t.check('ids are per user: A can use an id B also uses, without touching B''s row', r = 'ok:1', r);
  r := t.try(format($q$insert into public.habits (user_id, id, name, client_updated_at) values (%L, 'hA', 'Read v2', now()) on conflict (user_id, id) do update set name = excluded.name, client_updated_at = excluded.client_updated_at$q$, a));
  perform t.check('A can upsert own row (sync pattern)', r = 'ok:1', r);

  r := t.val('select count(*) from public.habits');
  perform t.check('A sees only own habits', r = '2', r);
  r := t.val(format('select count(*) from public.habits where user_id = %L', b));
  perform t.check('A cannot read B''s habits', r = '0', r);
  r := t.val(format('select count(*) from public.events where user_id = %L', b));
  perform t.check('A cannot read B''s events', r = '0', r);
  r := t.val(format('select count(*) from public.habit_completions where user_id = %L', b));
  perform t.check('A cannot read B''s completions', r = '0', r);
  r := t.val(format('select count(*) from public.journal_entries where user_id = %L', b));
  perform t.check('A cannot read B''s journal', r = '0', r);
  r := t.val(format('select count(*) from public.profiles where user_id = %L', b));
  perform t.check('A cannot read B''s profile', r = '0', r);

  r := t.try(format($q$insert into public.habits (user_id, id, name, client_updated_at) values (%L, 'planted', 'x', now())$q$, b));
  perform t.check('A cannot create rows in B''s account (browser-supplied user_id is not trusted)', r = '42501', r);
  r := t.try(format($q$update public.habits set name = 'hacked' where user_id = %L$q$, b));
  perform t.check('A cannot update B''s habits', r = 'ok:0', r);
  r := t.try(format($q$delete from public.habits where user_id = %L$q$, b));
  perform t.check('A cannot delete B''s habits', r = 'ok:0', r);
  r := t.try(format($q$update public.habits set user_id = %L where id = 'hA'$q$, b));
  perform t.check('A cannot move own row into B''s account', r = '42501', r);
  r := t.try(format($q$update public.profiles set journal_sync = true where user_id = %L$q$, b));
  perform t.check('A cannot change B''s settings', r = 'ok:0', r);
  r := t.try(format($q$delete from public.profiles where user_id = %L$q$, a));
  perform t.check('A cannot delete profiles directly (only by deleting the account)', r = '42501', r);

  -- Journals: off by default
  r := t.try(format($q$insert into public.journal_entries (user_id, id, kind, day, body, client_updated_at) values (%L, 'morning:2026-10-30', 'morning', '2026-10-30', '{"priorities":[]}', now())$q$, a));
  perform t.check('journal sync OFF by default: A cannot upload a journal entry', r = '42501', r);
  r := t.try(format('update public.profiles set journal_sync = true where user_id = %L', a));
  perform t.check('A can turn journal sync on', r = 'ok:1', r);
  r := t.try(format($q$insert into public.journal_entries (user_id, id, kind, day, body, client_updated_at) values (%L, 'morning:2026-10-30', 'morning', '2026-10-30', '{"priorities":[]}', now())$q$, a));
  perform t.check('with journal sync on, A can upload own entry', r = 'ok:1', r);
  r := t.try(format('update public.profiles set journal_sync = false where user_id = %L', a));
  r := t.try($q$update public.journal_entries set body = '{"priorities":[{"text":"x"}]}' where id = 'morning:2026-10-30'$q$);
  perform t.check('after turning journal sync off, A cannot upload changes', r = '42501', r);
  r := t.val('select count(*) from public.journal_entries');
  perform t.check('after turning it off, A can still read own synced entries', r = '1', r);
  r := t.try($q$delete from public.journal_entries where id = 'morning:2026-10-30'$q$);
  perform t.check('A can always delete own synced journal entries', r = 'ok:1', r);

  -- Entitlements: read own only, never write
  r := t.val('select string_agg(state, '','') from public.entitlements');
  perform t.check('A reads only own entitlement', r = 'beta', r);
  r := t.try(format($q$update public.entitlements set state = 'active' where user_id = %L$q$, a));
  perform t.check('A cannot grant itself a subscription', r = '42501', r);
  r := t.try(format($q$insert into public.entitlements (user_id, state) values (%L, 'active')$q$, a));
  perform t.check('A cannot insert an entitlement', r = '42501', r);

  -- Integrity checks (data validation in the database)
  r := t.try(format($q$insert into public.habits (user_id, id, name, client_updated_at) values (%L, '"><img src=x>', 'x', now())$q$, a));
  perform t.check('ids that could break out of HTML attributes are rejected', r = '23514', r);
  r := t.try(format($q$insert into public.events (user_id, id, series_id, title, type, start_time, end_time, client_updated_at) values (%L, 'e2', 'e2', 'x', 'weekly', '08:00', '09:00', now())$q$, a));
  perform t.check('a weekly event without a weekday is rejected', r = '23514', r);
  r := t.try(format($q$insert into public.habits (user_id, id, name, days, client_updated_at) values (%L, 'h9', 'x', '{1,9}', now())$q$, a));
  perform t.check('invalid weekdays are rejected', r = '23514', r);
  r := t.try(format($q$insert into public.habits (user_id, id, name, client_updated_at) values (%L, 'h8', %L, now())$q$, a, repeat('x', 501)));
  perform t.check('over-long names are rejected', r = '23514', r);
  r := t.try(format($q$insert into public.goals (user_id, id, text, extra, client_updated_at) values (%L, 'g9', 'x', jsonb_build_object('big', repeat('x', 20000)), now())$q$, a));
  perform t.check('oversized extra data is rejected', r = '23514', r);
  r := t.try(format($q$insert into public.habit_completions (user_id, habit_id, day, done, client_updated_at) values (%L, 'no-such-habit', '2026-10-25', true, now())$q$, a));
  perform t.check('completions must belong to one of your habits', r = '23503', r);

  -- Timestamps
  r := t.try(format($q$insert into public.goals (user_id, id, text, client_updated_at, server_updated_at) values (%L, 'gT', 'clock test', now() + interval '3 years', '2000-01-01')$q$, a));
  r := t.val($q$select (client_updated_at < now() + interval '6 minutes' and server_updated_at > now() - interval '1 minute')::text from public.goals where id = 'gT'$q$);
  perform t.check('future client clocks are clamped; server time is set by the database', r = 'true', r);
  reset role;

  -- ===== Signed-in role but no user in the token =====
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  set local role authenticated;
  r := t.val('select count(*) from public.habits');
  perform t.check('a token without a user sees nothing', r = '0', r);
  r := t.try($q$insert into public.habits (user_id, id, name, client_updated_at) values ('bbbbbbbb-0000-4000-8000-000000000002', 'x1', 'x', now())$q$);
  perform t.check('a token without a user cannot write', r = '42501', r);
  reset role;

  -- ===== Anonymous visitor (public API key, no session) =====
  perform t.act_as(null);
  r := t.try('select * from public.habits');
  perform t.check('anonymous visitors cannot read any table', r = '42501', r);
  r := t.try('select * from public.journal_entries');
  perform t.check('anonymous visitors cannot read journals', r = '42501', r);
  r := t.try($q$insert into public.habits (user_id, id, name, client_updated_at) values ('aaaaaaaa-0000-4000-8000-000000000001', 'x2', 'x', now())$q$);
  perform t.check('anonymous visitors cannot write', r = '42501', r);
  reset role;

  -- ===== Server side (service role) =====
  set local role service_role;
  r := t.val('select count(*) from public.habits');
  perform t.check('the service role (server functions only) can see all rows', r::int >= 3, r);
  reset role;

  -- ===== Account deletion =====
  delete from auth.users where id = b;
  perform t.check('deleting an account removes all of its data',
    (select count(*) from public.habits where user_id = b) = 0
    and (select count(*) from public.habit_completions where user_id = b) = 0
    and (select count(*) from public.journal_entries where user_id = b) = 0
    and (select count(*) from public.events where user_id = b) = 0
    and (select count(*) from public.profiles where user_id = b) = 0
    and (select count(*) from public.entitlements where user_id = b) = 0);
  perform t.check('deleting one account leaves other accounts untouched',
    (select count(*) from public.habits where user_id = a) = 2);
end $$;

-- Report
\pset format unaligned
\pset tuples_only on
select case when ok then 'PASS  ' else 'FAIL  ' end || name || case when ok or detail = '' then '' else '  — got ' || detail end from t.results order by n;
select '';
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from t.results;
do $$ begin
  if exists (select 1 from t.results where not ok) then raise exception 'RLS tests failed'; end if;
end $$;
