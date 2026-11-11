-- =====================================================================
-- QR 출석 + 위촉장 시스템 : Supabase 설정 SQL
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여 넣기
--        → 맨 아래 "행사 만들기 비밀번호" 줄의 비밀번호를 바꾸고 → Run
-- 여러 번 실행해도 됩니다(기존 행사·출석 기록은 지워지지 않음).
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
  roster          jsonb not null,                -- 명단 [{no, dept, rank, name}] (전화번호 등은 저장하지 않음)
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

create or replace function _event_payload(e events) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', e.id,
    'config', e.config,
    'roster', e.roster,
    'session', (select jsonb_build_object('id', s.id, 'label', s.label, 'started_at', s.started_at)
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
  insert into events(admin_hash, config, roster, expires_at)
    values (encode(digest(tok, 'sha256'), 'hex'), p_config, r, now() + _keep()) returning id into new_id;
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
declare e events; p jsonb; s sessions; prev timestamptz; t timestamptz;
begin
  select * into e from events where id = p_id and expires_at >= now();
  if e.id is null then return jsonb_build_object('status', 'error', 'message', '행사를 찾을 수 없습니다'); end if;
  select x into p from jsonb_array_elements(e.roster) x where (x->>'no')::int = p_no;
  if p is null then return jsonb_build_object('status', 'error', 'message', '명단에 없는 이름입니다'); end if;
  select * into s from sessions where id = e.current_session;
  select at into prev from attendance where session_id = s.id and person_no = p_no;
  if prev is not null then
    if coalesce((e.config->>'block_duplicate')::boolean, true) then
      return p || jsonb_build_object('status', 'dup', 'session', s.label, 'at', prev);
    end if;
    return p || jsonb_build_object('status', 'ok', 'session', s.label, 'at', prev);
  end if;
  insert into attendance(session_id, event_id, person_no) values (s.id, e.id, p_no)
    on conflict do nothing returning at into t;
  update events set expires_at = now() + _keep() where id = e.id;   -- 출석한 날도 쓴 날로 친다
  if t is null then
    select at into t from attendance where session_id = s.id and person_no = p_no;
    return p || jsonb_build_object('status', 'dup', 'session', s.label, 'at', t);
  end if;
  return p || jsonb_build_object('status', 'ok', 'session', s.label, 'at', t);
end $$;

create or replace function get_board(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events; s sessions;
begin
  select * into e from events where id = p_id and expires_at >= now();
  if e.id is null then return null; end if;
  select * into s from sessions where id = e.current_session;
  return jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'label', s.label, 'started_at', s.started_at),
    'updated_at', e.updated_at,
    'list', coalesce((select jsonb_agg(jsonb_build_object('no', a.person_no, 'at', a.at) order by a.at)
                      from attendance a where a.session_id = s.id), '[]'::jsonb));
end $$;

-- 위촉장 "출석한 사람만"일 때: 이 행사의 어느 회차든 출석했는지
create or replace function check_attended(p_id uuid, p_no int) returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists(select 1 from attendance where event_id = p_id and person_no = p_no);
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
declare e events; r jsonb;
begin
  e := _admin(p_id, p_token);
  r := case when p_roster is null then e.roster else _clean_roster(p_roster) end;
  if jsonb_array_length(r) = 0 then raise exception '명단이 비어 있습니다'; end if;
  update events set config = coalesce(p_config, config), roster = r, updated_at = now(),
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
  delete from attendance where session_id = (select current_session from events where id = p_id) and person_no = p_no;
  return get_board(p_id);
end $$;

create or replace function export_all(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _admin(p_id, p_token);
  return jsonb_build_object(
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'started_at', started_at) order by started_at)
                          from sessions where event_id = p_id), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object('session_id', session_id, 'no', person_no, 'at', at) order by at)
                            from attendance where event_id = p_id), '[]'::jsonb));
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
    'cancel_attendance(uuid,text,int)', 'export_all(uuid,text)', 'delete_event(uuid,text)']
  loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('grant execute on function %s to anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

-- =====================================================================
-- ★ 행사 만들기 비밀번호: 아래 '여기에-비밀번호' 를 원하는 비밀번호로 바꾼 뒤 실행하세요.
--   나중에 비밀번호를 바꾸려면 이 줄만 고쳐 다시 실행하면 됩니다.
-- =====================================================================
insert into app_settings(key, value) values ('create_password', extensions.crypt('여기에-비밀번호', extensions.gen_salt('bf')))
  on conflict (key) do update set value = excluded.value;
