-- دوال المشغّلات والدوال الداخلية لا تُستدعى من الواجهة
revoke execute on function public.tg_events_before(), public.tg_requests_before(), public.tg_requests_after(),
  public.tg_responses_before(), public.tg_responses_after() from public, anon, authenticated;
revoke execute on function public.staff_name(uuid) from public, anon, authenticated;
-- is_staff تُستخدم في سياسات RLS للمستخدم المسجّل فقط
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;
alter function public.party_type_label(text) set search_path = public;
