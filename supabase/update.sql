-- =====================================================================
-- 업데이트용 SQL (2026-11: 입실·퇴실, 관리 전용 연락처)
-- 이미 setup.sql을 실행한 저장소에 이 파일 전체를 붙여 넣고 Run 하세요.
-- 기존 행사·출석 기록·행사 만들기 비밀번호는 그대로 둡니다. 여러 번 실행해도 됩니다.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- 테이블 ----------
create table if not exists app_settings (
  key   text primary key,
  value text not null
);

create table if not exists events (
  id              uuid primary key default gen_random_uuid(),
  admin_hash      text not null,                 -- 관리 열쇠(토큰)의 해시. 토큰 원문은 저장하지 않음
  config          jsonb not null,                -- 행사 설정(문구·색·테마·위촉장 설정)
  roster          jsonb not null,                -- 명단 [{no, dept, rank, name}] (누구나 읽음. 전화번호는 아래 phones 칸에 따로)
  current_session uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '10 days'
);

create table if not exists sessions (            -- 회차(“새 회차 시작”마다 하나)
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  label      text not null,
  started_at timestamptz not null default now()
);
create index if not exists sessions_event on sessions(event_id);

create table if not exists attendance (
  session_id uuid not null references sessions(id) on delete cascade,
  event_id   uuid not null references events(id) on delete cascade,
  person_no  int  not null,
  at         timestamptz not null default now(),
  primary key (session_id, person_no)            -- 한 회차에 한 사람 한 번
);
create index if not exists attendance_event on attendance(event_id);

-- 입실·퇴실과 연락처 (나중에 추가된 칸. 예전에 만든 저장소에도 이 SQL을 다시 실행하면 붙는다)
alter table events     add column if not exists phones jsonb not null default '{}'::jsonb;  -- {연번: 전화번호} 관리 열쇠로만 읽음
alter table sessions   add column if not exists mode text not null default 'in';             -- 'in' 입실 받는 중, 'out' 퇴실 받는 중
alter table attendance add column if not exists out_at timestamptz;                           -- 퇴실 시각
alter table attendance alter column at drop not null;                                         -- 입실 없이 퇴실만 한 경우 비어 있음

create table if not exists assets (              -- 올린 이미지(로고·배경·직인 등). 브라우저에서 줄여 data URL로 저장
  event_id uuid not null references events(id) on delete cascade,
  key      text not null,
  data     text not null,
  primary key (event_id, key)
);

-- 테이블은 바깥에서 직접 못 읽고 못 쓰게 막는다. 모든 일은 아래 함수로만 한다.
alter table app_settings enable row level security;
alter table events       enable row level security;
alter table sessions     enable row level security;
alter table attendance   enable row level security;
alter table assets       enable row level security;
revoke all on app_settings, events, sessions, attendance, assets from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app_settings, events, sessions, attendance, assets from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on app_settings, events, sessions, attendance, assets from authenticated';
  end if;
end $$;

-- ---------- 보관 기간 ----------
-- 행사(명단·출석 기록·이미지)는 마지막으로 쓴 날(만들기·출석·새 회차·설정 저장)부터 이 기간이 지나면 지워진다.
-- 기간을 바꾸려면 아래 '10 days'만 고쳐 다시 실행한다. (예: '14 days', '1 month')
create or replace function _keep() returns interval
language sql immutable as $$ select interval '10 days' $$;
alter table events alter column expires_at set default now() + interval '10 days';
-- 예전 설정(3개월)으로 만든 행사도 새 기간에 맞춘다
update events set expires_at = least(expires_at, greatest(updated_at, created_at) + _keep());

-- ---------- 내부 도우미 ----------
create or replace function _purge() returns void
language sql security definer set search_path = public, extensions as $$
  delete from events where expires_at < now();
$$;

create or replace function _admin(p_id uuid, p_token text) returns events
language plpgsql security definer set search_path = public, extensions as $$
declare e events;
begin
  select * into e from events where id = p_id;
  if e.id is null then raise exception '행사를 찾을 수 없습니다'; end if;
  if p_token is null or e.admin_hash <> encode(digest(p_token, 'sha256'), 'hex') then
    raise exception '관리 권한이 없습니다';
  end if;
  return e;
end $$;

create or replace function _clean_roster(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'no',   (x->>'no')::int,
           'dept', left(trim(coalesce(x->>'dept','')), 60),
           'rank', left(trim(coalesce(x->>'rank','')), 40),
           'name', left(trim(coalesce(x->>'name','')), 40)) order by (x->>'no')::int), '[]'::jsonb)
  from jsonb_array_elements(p) x
  where trim(coalesce(x->>'name','')) <> '';
$$;

-- 명단에서 전화번호만 뽑는다 {"연번": "010-…"}. 숫자·+·- 만 남기고 20자까지
create or replace function _phones(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg((x->>'no'), left(regexp_replace(x->>'phone', '[^0-9+-]', '', 'g'), 20)), '{}'::jsonb)
  from jsonb_array_elements(p) x
  where trim(coalesce(x->>'name','')) <> '' and regexp_replace(coalesce(x->>'phone',''), '[^0-9]', '', 'g') <> '';
$$;

create or replace function _event_payload(e events) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', e.id,
    'config', e.config,
    'roster', e.roster,
    'session', (select jsonb_build_object('id', s.id, 'label', s.label, 'started_at', s.started_at, 'mode', s.mode)
                from sessions s where s.id = e.current_session),
    'assets', coalesce((select jsonb_agg(a.key) from assets a where a.event_id = e.id), '[]'::jsonb),
    'expires_at', e.expires_at);
$$;

-- ---------- 공개 함수 (누구나) ----------
create or replace function create_event(p_password text, p_config jsonb, p_roster jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare pw text; tok text; new_id uuid; sid uuid; r jsonb;
begin
  perform _purge();
  select value into pw from app_settings where key = 'create_password';
  if pw is null or p_password is null or crypt(p_password, pw) <> pw then
    raise exception '행사 만들기 비밀번호가 맞지 않습니다';
  end if;
  r := _clean_roster(p_roster);
  if jsonb_array_length(r) = 0 then raise exception '명단이 비어 있습니다'; end if;
  if jsonb_array_length(r) > 2000 then raise exception '명단은 2000명까지입니다'; end if;
  tok := encode(gen_random_bytes(18), 'hex');
  insert into events(admin_hash, config, roster, phones, expires_at)
    values (encode(digest(tok, 'sha256'), 'hex'), p_config, r, _phones(p_roster), now() + _keep()) returning id into new_id;
  insert into sessions(event_id, label)
    values (new_id, coalesce(nullif(trim(p_config->>'first_session'), ''), '1회차')) returning id into sid;
  update events set current_session = sid where id = new_id;
  return jsonb_build_object('id', new_id, 'token', tok);
end $$;

create or replace function get_event(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events;
begin
  perform _purge();
  select * into e from events where id = p_id and expires_at >= now();
  if e.id is null then return null; end if;
  return _event_payload(e);
end $$;

create or replace function get_asset(p_id uuid, p_key text) returns text
language sql security definer set search_path = public, extensions as $$
  select data from assets where event_id = p_id and key = p_key;
$$;

create or replace function submit_attendance(p_id uuid, p_no int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events; p jsonb; s sessions; prev attendance; t timestamptz; dupblock boolean;
begin
  select * into e from events where id = p_id and expires_at >= now();
  if e.id is null then return jsonb_build_object('status', 'error', 'message', '행사를 찾을 수 없습니다'); end if;
  select x into p from jsonb_array_elements(e.roster) x where (x->>'no')::int = p_no;
  if p is null then return jsonb_build_object('status', 'error', 'message', '명단에 없는 이름입니다'); end if;
  select * into s from sessions where id = e.current_session;
  select * into prev from attendance where session_id = s.id and person_no = p_no;
  dupblock := coalesce((e.config->>'block_duplicate')::boolean, true);
  update events set expires_at = now() + _keep() where id = e.id;   -- 출석한 날도 쓴 날로 친다
  if s.mode = 'out' then
    -- 퇴실 받는 중
    if prev.out_at is not null then
      return p || jsonb_build_object('status', case when dupblock then 'dup' else 'ok' end, 'kind', 'out',
                                     'session', s.label, 'at', prev.out_at, 'in_at', prev.at);
    end if;
    insert into attendance(session_id, event_id, person_no, at, out_at) values (s.id, e.id, p_no, null, now())
      on conflict (session_id, person_no) do update set out_at = coalesce(attendance.out_at, excluded.out_at)
      returning out_at into t;
    return p || jsonb_build_object('status', 'ok', 'kind', 'out', 'session', s.label, 'at', t, 'in_at', prev.at);
  end if;
  -- 입실 받는 중
  if prev.at is not null then
    return p || jsonb_build_object('status', case when dupblock then 'dup' else 'ok' end, 'kind', 'in', 'session', s.label, 'at', prev.at);
  end if;
  insert into attendance(session_id, event_id, person_no, at) values (s.id, e.id, p_no, now())
    on conflict (session_id, person_no) do update set at = coalesce(attendance.at, excluded.at)
    returning at into t;
  return p || jsonb_build_object('status', 'ok', 'kind', 'in', 'session', s.label, 'at', t);
end $$;

create or replace function get_board(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events; s sessions;
begin
  select * into e from events where id = p_id and expires_at >= now();
  if e.id is null then return null; end if;
  select * into s from sessions where id = e.current_session;
  return jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'label', s.label, 'started_at', s.started_at, 'mode', s.mode),
    'updated_at', e.updated_at,
    'list', coalesce((select jsonb_agg(jsonb_build_object('no', a.person_no, 'at', a.at) order by a.at)
                      from attendance a where a.session_id = s.id and a.at is not null), '[]'::jsonb),
    'outs', coalesce((select jsonb_agg(jsonb_build_object('no', a.person_no, 'at', a.out_at) order by a.out_at)
                      from attendance a where a.session_id = s.id and a.out_at is not null), '[]'::jsonb));
end $$;

-- 위촉장 "출석한 사람만"일 때: 이 행사의 어느 회차든 출석했는지
-- "입실·퇴실 모두 한 사람만"(only_attendees = 'inout')이면 한 회차에서 입실과 퇴실을 모두 했는지
create or replace function check_attended(p_id uuid, p_no int) returns boolean
language sql security definer set search_path = public, extensions as $$
  select case when (select config->'cert'->>'only_attendees' from events where id = p_id) = 'inout'
    then exists(select 1 from attendance where event_id = p_id and person_no = p_no and at is not null and out_at is not null)
    else exists(select 1 from attendance where event_id = p_id and person_no = p_no and at is not null) end;
$$;

-- ---------- 관리 함수 (관리 열쇠가 있어야 함) ----------
create or replace function check_admin(p_id uuid, p_token text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _admin(p_id, p_token);
  return true;
exception when others then
  return false;
end $$;

create or replace function update_event(p_id uuid, p_token text, p_config jsonb, p_roster jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events; r jsonb; ph jsonb;
begin
  e := _admin(p_id, p_token);
  r := case when p_roster is null then e.roster else _clean_roster(p_roster) end;
  if jsonb_array_length(r) = 0 then raise exception '명단이 비어 있습니다'; end if;
  -- 새 명단에 전화번호가 하나도 없으면 예전 번호를 그대로 둔다
  ph := case when p_roster is null or _phones(p_roster) = '{}'::jsonb then e.phones else _phones(p_roster) end;
  update events set config = coalesce(p_config, config), roster = r, phones = ph, updated_at = now(),
         expires_at = now() + _keep()
   where id = p_id returning * into e;
  return _event_payload(e);
end $$;

create or replace function set_asset(p_id uuid, p_token text, p_key text, p_data text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _admin(p_id, p_token);
  if p_key !~ '^[a-z_]{1,30}$' then raise exception '잘못된 이미지 이름'; end if;
  if p_data is null or p_data = '' then
    delete from assets where event_id = p_id and key = p_key;
    return true;
  end if;
  if p_data !~ '^data:image/(png|jpeg|webp);base64,' then raise exception '이미지 형식이 아닙니다'; end if;
  if length(p_data) > 3000000 then raise exception '이미지가 너무 큽니다'; end if;
  insert into assets(event_id, key, data) values (p_id, p_key, p_data)
    on conflict (event_id, key) do update set data = excluded.data;
  update events set updated_at = now() where id = p_id;
  return true;
end $$;

create or replace function new_session(p_id uuid, p_token text, p_label text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare sid uuid; n int;
begin
  perform _admin(p_id, p_token);
  perform _purge();
  select count(*) + 1 into n from sessions where event_id = p_id;
  insert into sessions(event_id, label) values (p_id, coalesce(nullif(trim(p_label), ''), n || '회차'))
    returning id into sid;
  update events set current_session = sid, updated_at = now(),
         expires_at = now() + _keep() where id = p_id;
  return get_board(p_id);
end $$;

create or replace function rename_session(p_id uuid, p_token text, p_label text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _admin(p_id, p_token);
  update sessions set label = left(trim(p_label), 40)
   where id = (select current_session from events where id = p_id) and trim(p_label) <> '';
  update events set updated_at = now() where id = p_id;
  return get_board(p_id);
end $$;

create or replace function cancel_attendance(p_id uuid, p_token text, p_no int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _admin(p_id, p_token);
  if (select s.mode from sessions s join events e on e.current_session = s.id where e.id = p_id) = 'out' then
    update attendance set out_at = null
     where session_id = (select current_session from events where id = p_id) and person_no = p_no;
    delete from attendance where session_id = (select current_session from events where id = p_id) and person_no = p_no and at is null and out_at is null;
  else
    delete from attendance where session_id = (select current_session from events where id = p_id) and person_no = p_no;
  end if;
  return get_board(p_id);
end $$;

create or replace function export_all(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _admin(p_id, p_token);
  return jsonb_build_object(
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'started_at', started_at) order by started_at)
                          from sessions where event_id = p_id), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object('session_id', session_id, 'no', person_no, 'at', at, 'out_at', out_at) order by coalesce(at, out_at))
                            from attendance where event_id = p_id), '[]'::jsonb));
end $$;

-- 입실/퇴실 받기 바꾸기
create or replace function set_mode(p_id uuid, p_token text, p_mode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _admin(p_id, p_token);
  if p_mode not in ('in', 'out') then raise exception '잘못된 값'; end if;
  update sessions set mode = p_mode where id = (select current_session from events where id = p_id);
  update events set expires_at = now() + _keep() where id = p_id;
  return get_board(p_id);
end $$;

-- 전화번호 (관리 열쇠가 있어야만 읽힘)
create or replace function get_phones(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events;
begin
  e := _admin(p_id, p_token);
  return e.phones;
end $$;

create or replace function delete_event(p_id uuid, p_token text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _admin(p_id, p_token);
  delete from events where id = p_id;
  return true;
end $$;

-- ---------- 시간마다 자동 삭제 ----------
-- Supabase에서는 pg_cron으로 한 시간마다 기간이 지난 행사를 지운다.
-- pg_cron을 켤 수 없는 환경이면 건너뛰고, 행사를 열거나 만들 때마다 정리한다.
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron을 켜지 못해 자동 삭제 예약은 건너뜁니다: %', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $c$select cron.schedule('edu-attendance-purge', '17 * * * *', 'select public._purge()')$c$;
  end if;
exception when others then
  raise notice '자동 삭제 예약 실패(앱은 정상 동작): %', sqlerrm;
end $$;

-- ---------- 함수 실행 권한 ----------
revoke execute on all functions in schema public from public;
do $$
declare f text;
begin
  foreach f in array array[
    'create_event(text,jsonb,jsonb)', 'get_event(uuid)', 'get_asset(uuid,text)', 'submit_attendance(uuid,int)',
    'get_board(uuid)', 'check_attended(uuid,int)', 'check_admin(uuid,text)', 'update_event(uuid,text,jsonb,jsonb)',
    'set_asset(uuid,text,text,text)', 'new_session(uuid,text,text)', 'rename_session(uuid,text,text)',
    'cancel_attendance(uuid,text,int)', 'export_all(uuid,text)', 'delete_event(uuid,text)',
    'set_mode(uuid,text,text)', 'get_phones(uuid,text)']
  loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('grant execute on function %s to anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

