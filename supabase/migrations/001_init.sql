-- منصة تصعيد الحالات | تجمع الحدود الشمالية الصحي
-- المخطط الأساسي: الطلبات، روابط الجهات، سجل المتابعة، والصلاحيات.
--
-- مبدأ الصلاحيات:
--   * التنسيق الطبي (جدول staff) يدخل بكلمة مرور، وهو الوحيد الذي يقرأ الجداول ويكتب فيها.
--   * الطبيب/المستشفى/قائد المسار/إدارة المستشفيات لا يملكون حسابات؛ يصلون عبر رابط برمز
--     عشوائي (token) ولا يلمسون الجداول مباشرة، بل عبر دالتين فقط:
--     get_response_form و submit_response.
--   * بعد توقيع أي جهة وإرسالها تُقفل خانتها نهائياً، ولا يستطيع أحد (ولا التنسيق) تعديلها.

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── الموظفون (التنسيق الطبي) ─────────────────────────
create table public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  phone      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and active);
$$;

create or replace function public.staff_name(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select full_name from public.staff where user_id = uid;
$$;

-- ───────────────────────── الطلبات ─────────────────────────
create sequence public.request_serial;

create table public.requests (
  id                 uuid primary key default gen_random_uuid(),
  serial             integer not null unique default nextval('public.request_serial'),
  created_at         timestamptz not null default now(),
  created_by         uuid not null default auth.uid() references auth.users(id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),

  -- بيانات الحالة
  started_at         timestamptz,
  referral_no        text,
  case_type          text check (case_type in ('طارئة', 'إنقاذ حياة')),
  specialty          text,

  -- مركز اتصال الطوارئ بالوزارة 1937
  c937_contacted     boolean,
  c937_at            timestamptz,
  c937_code          text,
  c937_direction     text,

  -- مشرف التنسيق الطبي
  supervisor_name    text,
  supervisor_phone   text,

  -- المستشفى المعني
  hospital_name      text,

  -- الدعم / التوجيه ونتيجة التصعيد
  support_request    text,
  outcome            text not null default 'تحت الإجراء'
                     check (outcome in ('تم حل التحدي', 'تحت الإجراء', 'بانتظار توجيه', 'تم التوجيه', 'تم انتهاء التصعيد')),

  -- توقيع التنسيق الطبي
  coordinator_name       text,
  coordinator_signature  text check (coordinator_signature is null or length(coordinator_signature) < 400000),
  coordinator_signed_at  timestamptz
);

create index requests_created_at_idx on public.requests (created_at desc);
create index requests_outcome_idx on public.requests (outcome);

-- ───────────────────────── روابط الجهات وردودها ─────────────────────────
create table public.responses (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.requests(id) on delete cascade,
  party_type       text not null check (party_type in ('hospital', 'path_leader', 'hospitals_admin', 'other')),
  party_label      text not null,              -- اسم المستشفى أو الجهة كما يظهر في النموذج
  recipient_phone  text,
  token            text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_at       timestamptz not null default now(),
  created_by       uuid not null default auth.uid() references auth.users(id),
  opened_at        timestamptz,
  revoked_at       timestamptz,

  -- ما تعبّئه الجهة
  medical_opinion  text,   -- المستشفى: الرأي الطبي ورد الطبيب المعالج
  action_taken     text,   -- المستشفى: الإجراء المتخذ والجهات التي تم التواصل معها
  statement        text,   -- الجهات الأخرى: الإفادة
  responder_name   text,
  responder_title  text,
  signature        text check (signature is null or length(signature) < 400000),
  submitted_at     timestamptz
);

create index responses_request_idx on public.responses (request_id, created_at);

-- ───────────────────────── سجل المتابعة ─────────────────────────
create table public.request_events (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.requests(id) on delete cascade,
  at          timestamptz not null default now(),
  kind        text not null,      -- created | updated | outcome | link | opened | submitted | revoked | note
  detail      text,
  actor       text                -- اسم من قام بالحدث
);

create index request_events_request_idx on public.request_events (request_id, at);

-- ───────────────────────── المشغّلات ─────────────────────────
create or replace function public.tg_events_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'note' then
    new.actor := staff_name(auth.uid());
    new.at := now();
  end if;
  return new;
end $$;

create trigger request_events_before before insert on public.request_events
for each row execute function public.tg_events_before();

create or replace function public.tg_requests_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.serial := old.serial;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    -- توقيع التنسيق بعد اعتماده لا يتغيّر
    if old.coordinator_signature is not null then
      new.coordinator_signature := old.coordinator_signature;
      new.coordinator_signed_at := old.coordinator_signed_at;
      new.coordinator_name := old.coordinator_name;
    end if;
  end if;
  if new.coordinator_signature is not null and new.coordinator_signed_at is null then
    new.coordinator_signed_at := now();
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger requests_before before insert or update on public.requests
for each row execute function public.tg_requests_before();

create or replace function public.tg_requests_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into request_events (request_id, kind, detail, actor)
    values (new.id, 'created', 'إنشاء الطلب', staff_name(auth.uid()));
  else
    if new.outcome is distinct from old.outcome then
      insert into request_events (request_id, kind, detail, actor)
      values (new.id, 'outcome', new.outcome, staff_name(auth.uid()));
    end if;
    if old.coordinator_signature is null and new.coordinator_signature is not null then
      insert into request_events (request_id, kind, detail, actor)
      values (new.id, 'signed', 'توقيع التنسيق الطبي', staff_name(auth.uid()));
    end if;
  end if;
  return null;
end $$;

create trigger requests_after after insert or update on public.requests
for each row execute function public.tg_requests_after();

create or replace function public.party_type_label(t text)
returns text language sql immutable as $$
  select case t
    when 'hospital' then 'المستشفى'
    when 'path_leader' then 'قائد المسار للتخصص'
    when 'hospitals_admin' then 'إدارة المستشفيات'
    else 'جهة أخرى' end;
$$;

create or replace function public.tg_responses_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    -- الرد الموقّع مقفل نهائياً
    if old.submitted_at is not null then
      raise exception 'لا يمكن تعديل رد تم توقيعه وإرساله';
    end if;
    new.id := old.id;
    new.request_id := old.request_id;
    new.token := old.token;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end $$;

create trigger responses_before before update on public.responses
for each row execute function public.tg_responses_before();

create or replace function public.tg_responses_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into request_events (request_id, kind, detail, actor)
    values (new.request_id, 'link', 'إرسال رابط إلى ' || party_type_label(new.party_type) || ': ' || new.party_label, staff_name(auth.uid()));
  elsif old.revoked_at is null and new.revoked_at is not null then
    insert into request_events (request_id, kind, detail, actor)
    values (new.request_id, 'revoked', 'إلغاء رابط ' || new.party_label, staff_name(auth.uid()));
  end if;
  return null;
end $$;

create trigger responses_after after insert or update on public.responses
for each row execute function public.tg_responses_after();

-- ───────────────────────── صلاحيات الجداول (RLS) ─────────────────────────
alter table public.staff          enable row level security;
alter table public.requests       enable row level security;
alter table public.responses      enable row level security;
alter table public.request_events enable row level security;

create policy staff_read on public.staff for select to authenticated using (public.is_staff());

create policy requests_read   on public.requests for select to authenticated using (public.is_staff());
create policy requests_insert on public.requests for insert to authenticated with check (public.is_staff());
create policy requests_update on public.requests for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy responses_read   on public.responses for select to authenticated using (public.is_staff());
create policy responses_insert on public.responses for insert to authenticated
  with check (public.is_staff() and submitted_at is null and signature is null);

create policy events_read on public.request_events for select to authenticated using (public.is_staff());
create policy events_insert on public.request_events for insert to authenticated
  with check (public.is_staff() and kind = 'note');

-- التنسيق يستطيع فقط إلغاء رابط لم يُستخدم بعد، ولا يعدّل محتوى الرد
revoke update on public.responses from authenticated;
grant update (revoked_at) on public.responses to authenticated;
create policy responses_revoke on public.responses for update to authenticated
  using (public.is_staff() and submitted_at is null) with check (public.is_staff());

-- لا حذف لأي سجل من الواجهة: التوثيق يبقى كاملاً
revoke delete on public.requests, public.responses, public.request_events from authenticated, anon;
revoke all on public.requests, public.responses, public.request_events, public.staff from anon;

-- ───────────────────────── وصول الجهات عبر الرابط ─────────────────────────
create or replace function public.get_response_form(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.responses;
  q public.requests;
begin
  select * into r from responses where token = p_token;
  if not found or r.revoked_at is not null then
    raise exception 'الرابط غير صالح أو تم إلغاؤه' using errcode = 'P0002';
  end if;
  select * into q from requests where id = r.request_id;

  if r.opened_at is null then
    update responses set opened_at = now() where id = r.id;
    insert into request_events (request_id, kind, detail, actor)
    values (r.request_id, 'opened', 'فتح الرابط: ' || r.party_label, null);
  end if;

  return jsonb_build_object(
    'party', jsonb_build_object(
      'type', r.party_type, 'type_label', party_type_label(r.party_type), 'label', r.party_label,
      'medical_opinion', r.medical_opinion, 'action_taken', r.action_taken, 'statement', r.statement,
      'responder_name', r.responder_name, 'responder_title', r.responder_title,
      'signature', r.signature, 'submitted_at', r.submitted_at),
    'request', jsonb_build_object(
      'serial', q.serial, 'created_at', q.created_at, 'started_at', q.started_at,
      'referral_no', q.referral_no, 'case_type', q.case_type, 'specialty', q.specialty,
      'c937_contacted', q.c937_contacted, 'c937_at', q.c937_at, 'c937_code', q.c937_code, 'c937_direction', q.c937_direction,
      'supervisor_name', q.supervisor_name, 'supervisor_phone', q.supervisor_phone,
      'hospital_name', q.hospital_name, 'support_request', q.support_request, 'outcome', q.outcome,
      'coordinator_name', q.coordinator_name, 'coordinator_signature', q.coordinator_signature,
      'coordinator_signed_at', q.coordinator_signed_at),
    'others', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', o.party_type, 'type_label', party_type_label(o.party_type), 'label', o.party_label,
        'medical_opinion', o.medical_opinion, 'action_taken', o.action_taken, 'statement', o.statement,
        'responder_name', o.responder_name, 'responder_title', o.responder_title,
        'signature', o.signature, 'submitted_at', o.submitted_at) order by o.submitted_at)
      from responses o
      where o.request_id = r.request_id and o.id <> r.id and o.submitted_at is not null), '[]'::jsonb)
  );
end $$;

create or replace function public.submit_response(
  p_token text,
  p_responder_name text,
  p_responder_title text,
  p_medical_opinion text,
  p_action_taken text,
  p_statement text,
  p_signature text
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  r public.responses;
  ts timestamptz := now();
begin
  select * into r from responses where token = p_token for update;
  if not found or r.revoked_at is not null then
    raise exception 'الرابط غير صالح أو تم إلغاؤه' using errcode = 'P0002';
  end if;
  if r.submitted_at is not null then
    raise exception 'تم إرسال هذا الرد مسبقاً ولا يمكن تعديله' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_responder_name), '') = '' then
    raise exception 'الاسم مطلوب' using errcode = 'P0001';
  end if;
  if p_signature is null or p_signature not like 'data:image/png;base64,%' or length(p_signature) > 400000 then
    raise exception 'التوقيع مطلوب' using errcode = 'P0001';
  end if;
  if r.party_type = 'hospital' then
    if coalesce(trim(p_medical_opinion), '') = '' then
      raise exception 'الرأي الطبي مطلوب' using errcode = 'P0001';
    end if;
  elsif coalesce(trim(p_statement), '') = '' then
    raise exception 'الإفادة مطلوبة' using errcode = 'P0001';
  end if;

  update responses set
    responder_name  = left(trim(p_responder_name), 200),
    responder_title = left(nullif(trim(p_responder_title), ''), 200),
    medical_opinion = case when r.party_type = 'hospital' then left(p_medical_opinion, 8000) end,
    action_taken    = case when r.party_type = 'hospital' then left(nullif(trim(p_action_taken), ''), 8000) end,
    statement       = case when r.party_type <> 'hospital' then left(p_statement, 8000) end,
    signature       = p_signature,
    submitted_at    = ts
  where id = r.id;

  insert into request_events (request_id, kind, detail, actor)
  values (r.request_id, 'submitted', 'توقيع وإرسال رد ' || party_type_label(r.party_type) || ': ' || r.party_label, trim(p_responder_name));

  return ts;
end $$;

revoke all on function public.get_response_form(text) from public;
revoke all on function public.submit_response(text, text, text, text, text, text, text) from public;
grant execute on function public.get_response_form(text) to anon, authenticated;
grant execute on function public.submit_response(text, text, text, text, text, text, text) to anon, authenticated;

-- ───────────────────────── التحديث اللحظي لشاشة التنسيق ─────────────────────────
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.requests, public.responses, public.request_events;
  end if;
end $$;
