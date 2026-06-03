begin;

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'append_plan_item_today',
        'generate_plan',
        'generate_plan_days',
        'generate_today_plan',
        'get_today_plan_id'
      )
  loop
    execute format('revoke execute on function %s from authenticated', fn);
    execute format('revoke execute on function %s from public, anon', fn);
  end loop;
end $$;

commit;
