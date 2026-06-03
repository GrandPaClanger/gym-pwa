create or replace view public.v_plan_with_suggested_load as
select
  wp.person_id,
  wp.plan_date,
  wpi.sequence_no,
  e.canonical_name as exercise_name,
  e.exercise_type,
  wpi.target_sets,
  wpi.target_reps,
  wpi.target_duration_sec,
  wpi.target_load_kg,
  v.last_best_load_kg,
  pe.baseline_load_kg,
  case
    when e.exercise_type = 1 then coalesce(wpi.target_load_kg, v.last_best_load_kg, pe.baseline_load_kg)
    else null::numeric
  end as suggested_load_kg,
  wpi.exercise_id,
  e.is_active
from public.workout_plan wp
join public.workout_plan_item wpi on wpi.plan_id = wp.plan_id
join public.exercise e on e.exercise_id = wpi.exercise_id
left join public.v_exercise_last_best_load v on v.person_id = wp.person_id and v.exercise_id = wpi.exercise_id
left join public.person_exercise pe on pe.person_id = wp.person_id and pe.exercise_id = wpi.exercise_id;

create or replace view public.v_today_plan_app as
select
  person_id,
  plan_date,
  sequence_no,
  exercise_name,
  exercise_type,
  target_sets,
  target_reps,
  target_duration_sec,
  suggested_load_kg,
  exercise_id,
  is_active
from public.v_plan_with_suggested_load
where plan_date = current_date
  and is_active = true;

create or replace view public.v_plan_today_edit as
select
  person_id,
  plan_date,
  sequence_no,
  exercise_name,
  exercise_type,
  target_sets,
  target_reps,
  target_duration_sec,
  suggested_load_kg,
  exercise_id,
  is_active
from public.v_today_plan_app;
