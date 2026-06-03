begin;

create or replace function public.admin_list_exercises()
returns table(
  exercise_id integer,
  canonical_name text,
  exercise_type integer,
  is_manual_only boolean,
  is_distance_based boolean,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_user() then
    raise exception 'Not authorized';
  end if;

  return query
  select e.exercise_id, e.canonical_name, e.exercise_type, e.is_manual_only, e.is_distance_based, e.is_active
  from public.exercise e
  order by e.canonical_name;
end;
$$;

create or replace function public.admin_list_slot_codes()
returns table(slot_code text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_user() then
    raise exception 'Not authorized';
  end if;

  return query
  select distinct es.slot_code
  from public.exercise_slot es
  order by es.slot_code;
end;
$$;

revoke execute on function public.admin_list_exercises() from public, anon;
revoke execute on function public.admin_list_slot_codes() from public, anon;
grant execute on function public.admin_list_exercises() to authenticated;
grant execute on function public.admin_list_slot_codes() to authenticated;

commit;
