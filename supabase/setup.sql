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

-- 명단 밖 출석(직접 입력)·휴대폰 출석표·바뀌는 QR (나중에 추가된 것. 다시 실행해도 된다)
create table if not exists extras (               -- 명단에 없이 온 사람. 번호는 1000001부터
  event_id   uuid not null references events(id) on delete cascade,
  no         int  not null,
  dept       text not null default '',
  name       text not null,
  created_at timestamptz not null default now(),
  primary key (event_id, no)
);
alter table attendance add column if not exists device     text;   -- 입실한 휴대폰 표(해시). 한 휴대폰 한 사람·퇴실 짝 맞추기
alter table attendance add column if not exists out_device text;   -- 퇴실한 휴대폰 표(해시)
alter table attendance add column if not exists via        text;   -- 'admin' = 담당자가 대신 입실 처리
alter table attendance add column if not exists out_via    text;   -- 'admin' = 담당자가 대신 퇴실 처리
alter table events     add column if not exists qr_secret  text;   -- 바뀌는 QR을 만드는 비밀 값
-- 보관 기간 고르기 (나중에 추가된 칸)
alter table events     add column if not exists keep_days  int not null default 10;        -- 행사 기록 보관: 마지막으로 쓴 날부터 10·30·60·90일
alter table events     add column if not exists last_used  timestamptz not null default now(); -- 마지막으로 쓴 때(연락처는 여기서 10일 뒤 먼저 지움)
create index if not exists attendance_device on attendance(session_id, device);

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
alter table extras       enable row level security;
revoke all on app_settings, events, sessions, attendance, assets, extras from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app_settings, events, sessions, attendance, assets, extras from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on app_settings, events, sessions, attendance, assets, extras from authenticated';
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
-- 행사마다 고른 보관 기간(10·30·60·90일). 그 밖의 값은 10일
create or replace function _keep_days(c jsonb) returns int
language sql immutable as $$
  select case when coalesce(c->>'keep_days', '') in ('30', '60', '90') then (c->>'keep_days')::int else 10 end;
$$;
create or replace function _purge() returns void
language sql security definer set search_path = public, extensions as $$
  delete from events where expires_at < now();
  -- 연락처는 보관 기간과 상관없이 마지막으로 쓴 날부터 10일 뒤 먼저 지운다
  update events set phones = '{}'::jsonb where phones <> '{}'::jsonb and last_used < now() - interval '10 days';
$$;
-- 행사를 쓸 때마다(출석·새 회차·퇴실 받기 등) 삭제일을 뒤로 민다. '보관 연장'으로 늘린 날짜는 줄이지 않는다
create or replace function _touch(p_id uuid) returns void
language sql security definer set search_path = public, extensions as $$
  update events set last_used = now(), expires_at = greatest(expires_at, now() + make_interval(days => keep_days)) where id = p_id;
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

-- 출석 방식 설정(config.attend.*)이 켜져 있는지
create or replace function _opt(e events, k text) returns boolean
language sql immutable as $$ select coalesce((e.config->'attend'->>k) = 'true', false) $$;

-- 휴대폰 표를 해시로. 너무 짧거나 길면 없는 것으로 본다
create or replace function _dev(p text) returns text
language sql immutable set search_path = public, extensions as $$
  select case when p is null or length(p) < 16 or length(p) > 200 then null else encode(digest(p, 'sha256'), 'hex') end;
$$;

create or replace function _norm(t text) returns text
language sql immutable as $$ select lower(regexp_replace(coalesce(t, ''), '\s+', '', 'g')) $$;

-- 사람 찾기: 명단, 없으면 명단 밖에서 온 사람
create or replace function _person(e events, p_no int) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(
    (select x from jsonb_array_elements(e.roster) x where (x->>'no')::int = p_no limit 1),
    (select jsonb_build_object('no', x.no, 'dept', x.dept, 'rank', '', 'name', x.name, 'extra', true)
       from extras x where x.event_id = e.id and x.no = p_no));
$$;

-- 출석 기록이 하나도 없는 '명단 밖 사람'은 지운다(취소했을 때)
create or replace function _tidy_extras(p_id uuid) returns void
language sql security definer set search_path = public, extensions as $$
  delete from extras x where x.event_id = p_id
     and not exists (select 1 from attendance a where a.event_id = x.event_id and a.person_no = x.no);
$$;

-- 명단 밖 사람 찾거나 새로 등록. 명단에 같은 부서·이름이 있으면 그 사람 번호
create or replace function _find_person(e events, p_dept text, p_name text) returns int
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(
    (select (x->>'no')::int from jsonb_array_elements(e.roster) x
      where _norm(x->>'name') = _norm(p_name) and _norm(x->>'dept') = _norm(p_dept) limit 1),
    (select x.no from extras x where x.event_id = e.id and _norm(x.name) = _norm(p_name) and _norm(x.dept) = _norm(p_dept) limit 1));
$$;
create or replace function _add_extra(p_id uuid, p_dept text, p_name text) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  loop
    begin
      insert into extras(event_id, no, dept, name)
        values (p_id, coalesce((select max(x.no) from extras x where x.event_id = p_id), 1000000) + 1, p_dept, p_name)
        returning no into n;
      return n;
    exception when unique_violation then null;   -- 동시에 들어오면 다음 번호로 다시
    end;
  end loop;
end $$;
create or replace function _clean_text(t text, n int) returns text
language sql immutable as $$ select left(trim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')), n) $$;

-- 바뀌는 QR: 30초마다 달라지는 암호, 그리고 QR을 찍은 휴대폰에 주는 15분짜리 통과표
create or replace function _qr_secret(p_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  select qr_secret into s from events where id = p_id;
  if s is null then
    update events set qr_secret = encode(gen_random_bytes(16), 'hex') where id = p_id and qr_secret is null;
    select qr_secret into s from events where id = p_id;
  end if;
  return s;
end $$;
create or replace function _qr_code(p_secret text, p_w bigint) returns text
language sql immutable set search_path = public, extensions as $$
  select substr(encode(hmac(p_w::text, p_secret, 'sha256'), 'hex'), 1, 10);
$$;
create or replace function _pass_sig(p_secret text, p_dev text, p_exp bigint) returns text
language sql immutable set search_path = public, extensions as $$
  select substr(encode(hmac(p_dev || ':' || p_exp, p_secret, 'sha256'), 'hex'), 1, 32);
$$;
create or replace function _pass_ok(e events, p_dev text, p_pass text) returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
declare x bigint;
begin
  if not _opt(e, 'rotate_qr') then return true; end if;
  if p_dev is null or p_pass is null or e.qr_secret is null or p_pass !~ '^[0-9]{1,12}\.[0-9a-f]{32}$' then return false; end if;
  x := split_part(p_pass, '.', 1)::bigint;
  return x >= floor(extract(epoch from now())) and split_part(p_pass, '.', 2) = _pass_sig(e.qr_secret, p_dev, x);
end $$;

create or replace function _event_payload(e events) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', e.id,
    'config', e.config,
    'roster', e.roster,
    'extras', coalesce((select jsonb_agg(jsonb_build_object('no', x.no, 'dept', x.dept, 'name', x.name) order by x.no)
                        from extras x where x.event_id = e.id), '[]'::jsonb),
    'session', (select jsonb_build_object('id', s.id, 'label', s.label, 'started_at', s.started_at, 'mode', s.mode)
                from sessions s where s.id = e.current_session),
    'assets', coalesce((select jsonb_agg(a.key) from assets a where a.event_id = e.id), '[]'::jsonb),
    'expires_at', e.expires_at, 'keep_days', e.keep_days);
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
  r := _clean_roster(coalesce(p_roster, '[]'::jsonb));
  if jsonb_array_length(r) = 0 and coalesce(p_config->'attend'->>'walkin', '') <> 'true' then raise exception '명단이 비어 있습니다'; end if;
  if jsonb_array_length(r) > 2000 then raise exception '명단은 2000명까지입니다'; end if;
  tok := encode(gen_random_bytes(18), 'hex');
  insert into events(admin_hash, config, roster, phones, keep_days, expires_at)
    values (encode(digest(tok, 'sha256'), 'hex'), p_config, r, _phones(p_roster), _keep_days(p_config),
            now() + make_interval(days => _keep_days(p_config))) returning id into new_id;
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

-- 휴대폰이 QR을 찍고 들어올 때: 이 휴대폰이 이미 출석했는지, (바뀌는 QR이면) 통과표
create or replace function join_enter(p_id uuid, p_device text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events; s sessions; d text; a attendance; me jsonb; w bigint; sec text; code_ok boolean := true; pass text; x bigint;
begin
  select * into e from events where id = p_id and expires_at >= now();
  if e.id is null then return null; end if;
  d := _dev(p_device);
  select * into s from sessions where id = e.current_session;
  if d is not null then
    select * into a from attendance where session_id = s.id and (device = d or out_device = d) order by at nulls last limit 1;
    if a.session_id is not null then
      me := coalesce(_person(e, a.person_no), jsonb_build_object('no', a.person_no, 'dept', '', 'name', ''))
            || jsonb_build_object('at', a.at, 'out_at', a.out_at, 'session', s.label);
    end if;
  end if;
  if _opt(e, 'rotate_qr') then
    sec := _qr_secret(e.id); w := floor(extract(epoch from now()) / 30)::bigint;
    code_ok := p_code is not null and d is not null and p_code in (_qr_code(sec, w), _qr_code(sec, w - 1));
    if code_ok then x := floor(extract(epoch from now()))::bigint + 900; pass := x || '.' || _pass_sig(sec, d, x); end if;
  end if;
  return jsonb_build_object('me', me, 'pass', pass, 'code_ok', code_ok, 'mode', s.mode,
                            'strict', _opt(e, 'one_phone'), 'rotate', _opt(e, 'rotate_qr'));
end $$;

-- 출석(입실)·퇴실 제출. p_no = 명단에서 고른 번호, 없으면 p_dept·p_name(직접 쓴 것)
create or replace function submit_attendance2(p_id uuid, p_no int, p_dept text, p_name text, p_device text, p_pass text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events; s sessions; p jsonb; prev attendance; oth attendance; d text; n int; nm text; dp text;
        onep boolean; dupblock boolean; t timestamptz;
begin
  select * into e from events where id = p_id and expires_at >= now();
  if e.id is null then return jsonb_build_object('status', 'error', 'message', '행사를 찾을 수 없습니다'); end if;
  d := _dev(p_device); onep := _opt(e, 'one_phone');
  if d is null and (onep or _opt(e, 'rotate_qr')) then
    return jsonb_build_object('status', 'error', 'message', '화면을 새로고침한 뒤 다시 해 주세요');
  end if;
  if not _pass_ok(e, d, p_pass) then
    return jsonb_build_object('status', 'error', 'code', 'qr', 'message', 'QR이 바뀌었어요. 강의실 화면의 QR을 다시 찍어 주세요');
  end if;
  select * into s from sessions where id = e.current_session;

  -- 누구인지
  if p_no is not null then
    n := p_no;
  else
    if not (_opt(e, 'walkin') or jsonb_array_length(e.roster) = 0) then
      return jsonb_build_object('status', 'error', 'message', '명단에 있는 사람만 출석할 수 있어요. 담당자에게 말씀해 주세요');
    end if;
    nm := _clean_text(p_name, 40); dp := _clean_text(p_dept, 60);
    if nm = '' then return jsonb_build_object('status', 'error', 'message', '이름을 써 주세요'); end if;
    n := _find_person(e, dp, nm);
  end if;

  -- 한 휴대폰은 한 사람만
  if onep then
    if s.mode = 'out' then
      select * into oth from attendance where session_id = s.id and (device = d or out_device = d) and (n is null or person_no <> n) limit 1;
    else
      select * into oth from attendance where session_id = s.id and device = d and (n is null or person_no <> n) limit 1;
    end if;
    if oth.session_id is not null then
      return jsonb_build_object('status', 'error', 'code', 'other', 'message',
        '이 휴대폰으로는 이미 ' || coalesce(nullif(_person(e, oth.person_no)->>'name', ''), '다른 사람') || ' 님이 했어요. 한 휴대폰은 한 사람만 할 수 있어요');
    end if;
  end if;

  -- 명단 밖 새 사람
  if n is null then
    if (select count(*) from extras where event_id = e.id and created_at > now() - interval '1 minute') >= 60 then
      return jsonb_build_object('status', 'error', 'message', '지금 제출이 몰리고 있어요. 잠시 뒤 다시 해 주세요');
    end if;
    if (select count(*) from extras where event_id = e.id) >= 3000 then
      return jsonb_build_object('status', 'error', 'message', '더 받을 수 없어요. 담당자에게 말씀해 주세요');
    end if;
    n := _add_extra(e.id, dp, nm);
  end if;
  p := _person(e, n);
  if p is null then return jsonb_build_object('status', 'error', 'message', '명단에 없는 이름입니다'); end if;

  select * into prev from attendance where session_id = s.id and person_no = n;
  dupblock := coalesce((e.config->>'block_duplicate')::boolean, true);
  perform _touch(e.id);   -- 출석한 날도 쓴 날로 친다
  if s.mode = 'out' then
    -- 퇴실 받는 중
    if onep and prev.at is not null and prev.device is not null and prev.device <> d then
      return jsonb_build_object('status', 'error', 'code', 'phone', 'message', '입실할 때와 같은 휴대폰·같은 앱(브라우저)으로 QR을 찍어 주세요. 안 되면 담당자에게 말씀해 주세요');
    end if;
    if prev.out_at is not null then
      return p || jsonb_build_object('status', case when dupblock then 'dup' else 'ok' end, 'kind', 'out',
                                     'session', s.label, 'at', prev.out_at, 'in_at', prev.at);
    end if;
    insert into attendance(session_id, event_id, person_no, at, out_at, out_device) values (s.id, e.id, n, null, now(), d)
      on conflict (session_id, person_no) do update set out_at = coalesce(attendance.out_at, excluded.out_at),
                                                        out_device = coalesce(attendance.out_device, excluded.out_device)
      returning out_at into t;
    return p || jsonb_build_object('status', 'ok', 'kind', 'out', 'session', s.label, 'at', t, 'in_at', prev.at);
  end if;
  -- 입실 받는 중
  if prev.at is not null then
    if onep and prev.device is not null and prev.device <> d then
      return jsonb_build_object('status', 'error', 'code', 'taken', 'message',
        coalesce(p->>'name', '') || ' 님은 이미 다른 휴대폰으로 출석했어요. 본인이 맞다면 담당자에게 말씀해 주세요');
    end if;
    if prev.device is null and d is not null then   -- 담당자가 대신 처리한 사람: 이 휴대폰을 그 사람 것으로 묶는다
      update attendance set device = d where session_id = s.id and person_no = n and device is null;
    end if;
    return p || jsonb_build_object('status', case when dupblock then 'dup' else 'ok' end, 'kind', 'in', 'session', s.label, 'at', prev.at);
  end if;
  insert into attendance(session_id, event_id, person_no, at, device) values (s.id, e.id, n, now(), d)
    on conflict (session_id, person_no) do update set at = coalesce(attendance.at, excluded.at),
                                                      device = coalesce(attendance.device, excluded.device)
    returning at into t;
  return p || jsonb_build_object('status', 'ok', 'kind', 'in', 'session', s.label, 'at', t);
end $$;

-- 예전 화면(새로고침 전 휴대폰)이 부르는 함수. 새 함수로 넘긴다
create or replace function submit_attendance(p_id uuid, p_no int) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select submit_attendance2(p_id, p_no, null, null, null, null);
$$;

-- "내 이름이 아니에요": 이 휴대폰으로 낸 이번 회차 출석(퇴실 받는 중이면 퇴실)을 본인이 되돌린다
create or replace function undo_my_attendance(p_id uuid, p_device text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events; s sessions; d text;
begin
  select * into e from events where id = p_id and expires_at >= now();
  if e.id is null then return jsonb_build_object('status', 'error', 'message', '행사를 찾을 수 없습니다'); end if;
  d := _dev(p_device);
  if d is null then return jsonb_build_object('status', 'error', 'message', '화면을 새로고침한 뒤 다시 해 주세요'); end if;
  select * into s from sessions where id = e.current_session;
  if s.mode = 'out' then
    update attendance set out_at = null, out_device = null, out_via = null where session_id = s.id and out_device = d;
    delete from attendance where session_id = s.id and at is null and out_at is null;
  else
    delete from attendance where session_id = s.id and device = d and out_at is null;
  end if;
  perform _tidy_extras(e.id);
  return jsonb_build_object('status', 'ok');
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
    'list', coalesce((select jsonb_agg(jsonb_build_object('no', a.person_no, 'at', a.at)
                        || coalesce((select jsonb_build_object('dept', x.dept, 'name', x.name) from extras x
                                      where x.event_id = a.event_id and x.no = a.person_no), '{}'::jsonb) order by a.at)
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
  if jsonb_array_length(r) = 0 and coalesce(coalesce(p_config, e.config)->'attend'->>'walkin', '') <> 'true' then raise exception '명단이 비어 있습니다'; end if;
  -- 새 명단에 전화번호가 하나도 없으면 예전 번호를 그대로 둔다
  ph := case when p_roster is null or _phones(p_roster) = '{}'::jsonb then e.phones else _phones(p_roster) end;
  update events set config = coalesce(p_config, config), roster = r, phones = ph, updated_at = now(), last_used = now(),
         keep_days = _keep_days(coalesce(p_config, config)),
         expires_at = now() + make_interval(days => _keep_days(coalesce(p_config, config)))
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
  update events set current_session = sid, updated_at = now() where id = p_id;
  perform _touch(p_id);
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
  perform _tidy_extras(p_id);
  return get_board(p_id);
end $$;

create or replace function export_all(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _admin(p_id, p_token);
  return jsonb_build_object(
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'started_at', started_at) order by started_at)
                          from sessions where event_id = p_id), '[]'::jsonb),
    'current', (select current_session from events where id = p_id),
    'extras', coalesce((select jsonb_agg(jsonb_build_object('no', x.no, 'dept', x.dept, 'name', x.name) order by x.no)
                        from extras x where x.event_id = p_id), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object('session_id', session_id, 'no', person_no, 'at', at, 'out_at', out_at,
                              'via', via, 'out_via', out_via, 'dev', left(device, 8), 'out_dev', left(out_device, 8)) order by coalesce(at, out_at))
                            from attendance where event_id = p_id), '[]'::jsonb));
end $$;

-- 입실/퇴실 받기 바꾸기
create or replace function set_mode(p_id uuid, p_token text, p_mode text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _admin(p_id, p_token);
  if p_mode not in ('in', 'out') then raise exception '잘못된 값'; end if;
  update sessions set mode = p_mode where id = (select current_session from events where id = p_id);
  perform _touch(p_id);
  return get_board(p_id);
end $$;

-- 담당자가 대신 출석(입실)·퇴실 처리 (휴대폰이 없거나 꺼진 사람)
create or replace function admin_mark(p_id uuid, p_token text, p_no int, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events;
begin
  e := _admin(p_id, p_token);
  if _person(e, p_no) is null then raise exception '명단에 없는 사람입니다'; end if;
  if p_kind = 'out' then
    insert into attendance(session_id, event_id, person_no, at, out_at, out_via) values (e.current_session, p_id, p_no, null, now(), 'admin')
      on conflict (session_id, person_no) do update set
        out_via = case when attendance.out_at is null then 'admin' else attendance.out_via end,
        out_at = coalesce(attendance.out_at, excluded.out_at);
  else
    insert into attendance(session_id, event_id, person_no, at, via) values (e.current_session, p_id, p_no, now(), 'admin')
      on conflict (session_id, person_no) do update set
        via = case when attendance.at is null then 'admin' else attendance.via end,
        at = coalesce(attendance.at, excluded.at);
  end if;
  perform _touch(p_id);
  return get_board(p_id);
end $$;

-- 담당자가 명단에 없는 사람을 직접 넣고 출석 처리
create or replace function admin_add(p_id uuid, p_token text, p_dept text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events; n int; nm text; dp text;
begin
  e := _admin(p_id, p_token);
  nm := _clean_text(p_name, 40); dp := _clean_text(p_dept, 60);
  if nm = '' then raise exception '이름을 써 주세요'; end if;
  n := _find_person(e, dp, nm);
  if n is null then n := _add_extra(p_id, dp, nm); end if;
  return admin_mark(p_id, p_token, n, 'in');
end $$;

-- 바뀌는 QR에 넣을 지금 암호 (담당자용 강의실 화면만)
create or replace function get_qr(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare sec text; ep numeric; w bigint;
begin
  perform _admin(p_id, p_token);
  sec := _qr_secret(p_id); ep := extract(epoch from clock_timestamp()); w := floor(ep / 30)::bigint;
  return jsonb_build_object('code', _qr_code(sec, w), 'ttl_ms', round(((w + 1) * 30 - ep) * 1000));
end $$;

-- 전화번호 (관리 열쇠가 있어야만 읽힘)
create or replace function get_phones(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events;
begin
  e := _admin(p_id, p_token);
  return e.phones;
end $$;

-- 강의실 화면이 몇 초마다 묻는 함수. 지난번과 같으면 '같음'만 짧게 돌려줘 전송량을 줄인다
create or replace function get_board2(p_id uuid, p_ver text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events; s sessions; v text; b jsonb;
begin
  select * into e from events where id = p_id and expires_at >= now();
  if e.id is null then return null; end if;
  select * into s from sessions where id = e.current_session;
  select md5(concat_ws('|', s.id, s.label, s.mode, e.updated_at, count(a.at), max(a.at), count(a.out_at), max(a.out_at)))
    into v from attendance a where a.session_id = s.id;
  if p_ver is not null and p_ver = v then return jsonb_build_object('same', true, 'v', v); end if;
  b := get_board(p_id);
  return b || jsonb_build_object('v', v);
end $$;

-- 보관 연장: 지금 삭제일에서 30일 더 (오늘부터 최대 120일)
create or replace function extend_keep(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events;
begin
  perform _admin(p_id, p_token);
  update events set expires_at = least(greatest(expires_at, now()) + interval '30 days', now() + interval '120 days')
   where id = p_id returning * into e;
  return jsonb_build_object('expires_at', e.expires_at);
end $$;

-- 지난 출석부 엑셀로 이어 붙이기: 받아 둔 '전체 출석부'의 지난 회차를 되살린다
-- p_sessions = [{label, started_at, rows: [{dept, name, at, out_at}]}]  · 같은 이름·같은 날 회차가 이미 있으면 건너뜀
create or replace function import_history(p_id uuid, p_token text, p_sessions jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare e events; x jsonb; r jsonb; sid uuid; n int; ns int := 0; nr int := 0; lb text; st timestamptz; nm text; dp text;
begin
  e := _admin(p_id, p_token);
  if jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) > 100 then raise exception '회차는 100개까지 올릴 수 있어요'; end if;
  for x in select * from jsonb_array_elements(p_sessions) loop
    lb := _clean_text(x->>'label', 40); st := (x->>'started_at')::timestamptz;
    if lb = '' or st is null then continue; end if;
    if exists (select 1 from sessions ss where ss.event_id = p_id and ss.label = lb
                 and (ss.started_at at time zone 'Asia/Seoul')::date = (st at time zone 'Asia/Seoul')::date
                 and exists (select 1 from attendance a where a.session_id = ss.id)) then continue; end if;   -- 출석이 든 같은 회차만 건너뜀
    if jsonb_array_length(coalesce(x->'rows', '[]'::jsonb)) > 5000 then raise exception '한 회차는 5000명까지예요'; end if;
    insert into sessions(event_id, label, started_at) values (p_id, lb, st) returning id into sid;
    ns := ns + 1;
    for r in select * from jsonb_array_elements(coalesce(x->'rows', '[]'::jsonb)) loop
      nm := _clean_text(r->>'name', 40); dp := _clean_text(r->>'dept', 60);
      if nm = '' or (r->>'at' is null and r->>'out_at' is null) then continue; end if;
      n := _find_person(e, dp, nm);
      if n is null then
        if (select count(*) from extras where event_id = p_id) >= 3000 then continue; end if;
        n := _add_extra(p_id, dp, nm);
      end if;
      insert into attendance(session_id, event_id, person_no, at, out_at, via)
        values (sid, p_id, n, (r->>'at')::timestamptz, (r->>'out_at')::timestamptz, 'import')
        on conflict (session_id, person_no) do nothing;
      nr := nr + 1;
    end loop;
  end loop;
  update events set updated_at = now() where id = p_id;
  perform _touch(p_id);
  return jsonb_build_object('sessions', ns, 'rows', nr);
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
    'set_mode(uuid,text,text)', 'get_phones(uuid,text)',
    'join_enter(uuid,text,text)', 'submit_attendance2(uuid,int,text,text,text,text)', 'undo_my_attendance(uuid,text)',
    'admin_mark(uuid,text,int,text)', 'admin_add(uuid,text,text,text)', 'get_qr(uuid,text)',
    'get_board2(uuid,text)', 'extend_keep(uuid,text)', 'import_history(uuid,text,jsonb)']
  loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('grant execute on function %s to anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end $$;

-- 새로 만든 함수를 바로 쓸 수 있게 API에 알린다
notify pgrst, 'reload schema';

-- =====================================================================
-- ★ 행사 만들기 비밀번호: 아래 '여기에-비밀번호' 를 원하는 비밀번호로 바꾼 뒤 실행하세요.
--   나중에 비밀번호를 바꾸려면 이 줄만 고쳐 다시 실행하면 됩니다.
-- =====================================================================
insert into app_settings(key, value) values ('create_password', extensions.crypt('여기에-비밀번호', extensions.gen_salt('bf')))
  on conflict (key) do update set value = excluded.value;
