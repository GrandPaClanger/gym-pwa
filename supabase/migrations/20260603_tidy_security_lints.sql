begin;

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

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
        'admin_create_exercise',
        'admin_list_exercises',
        'admin_list_slot_codes',
        'admin_map_exercise_slot',
        'admin_update_exercise',
        'append_plan_item_today',
        'generate_plan',
        'generate_plan_days',
        'generate_today_plan',
        'get_today_plan_id',
        'is_admin_user',
        'log_session_json',
        'my_exercise_max_load_stats',
        'my_exercise_notes',
        'set_exercise_note'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn);
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

commit;
