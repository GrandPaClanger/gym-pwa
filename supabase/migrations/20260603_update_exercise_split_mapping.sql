begin;

create temp table exercise_category_map (
  exercise_id integer primary key,
  canonical_name text not null,
  category text not null
) on commit drop;

insert into exercise_category_map (exercise_id, canonical_name, category) values
  (63, 'Outdoor Cycling', 'Cardi_Main'),
  (1, 'Cycling Warm Up', 'Cardi_Main'),
  (2, 'Cross Trainer Warm Up', 'Cardi_Main'),
  (3, 'Rowing Warm Up', 'Cardi_Main'),
  (4, 'Treadmill Incline Walk Warm Up', 'Cardi_Main'),
  (5, 'Easy Walk Cool Down', 'Cardi_Main'),
  (6, 'Cycling Cool Down', 'Cardi_Main'),
  (7, 'Rowing Cool Down', 'Cardi_Main'),
  (8, 'Cross Trainer Cool Down', 'Cardi_Main'),
  (51, 'Outdoor Walk', 'Cardi_Main'),
  (53, 'Cross Trainer', 'Cardi_Main'),
  (54, 'Cycling', 'Cardi_Main'),
  (55, 'Treadmill Walk', 'Cardi_Main'),
  (50, 'Treadmill Cooldown', 'Cardi_Main'),
  (42, 'Tacx Neo Cycling', 'Cardi_Main'),
  (52, 'Swimming', 'Cardi_Main'),
  (77, 'Downward Dog', 'Cardi_Main'),
  (78, 'Pilates', 'Class'),
  (67, 'Dead Bug', 'Core'),
  (68, 'Bird Dog', 'Core'),
  (70, 'Side Plank', 'Core'),
  (71, 'Glute Bridge', 'Core'),
  (72, 'Plank', 'Core'),
  (73, 'Hip rotation', 'Core'),
  (69, 'Cobra', 'Core'),
  (76, 'Prayer Pose with Lateral raise', 'Core'),
  (40, 'Cable Woodchop', 'Core'),
  (46, 'Inclined Sit-up', 'Core'),
  (58, 'DB Side Bend', 'Core'),
  (24, 'Single-Arm Cable Row', 'Pull'),
  (62, 'Kettlebell Swing', 'Core'),
  (64, 'Single Arm Kettlebell Deadlift', 'Legs'),
  (65, 'Romanian Deadlift', 'Legs'),
  (66, 'Kettlebell Press', 'Push'),
  (38, 'Biceps Curls 21s', 'Pull'),
  (9, 'Smith Machine Squat', 'Legs'),
  (10, 'Leg Press', 'Legs'),
  (18, 'Hip Thrust (Machine)', 'Legs'),
  (20, 'Chest Press (Smith Machine)', 'Push'),
  (23, 'Lat Pulldown', 'Pull'),
  (25, 'Single-Arm Low Row', 'Pull'),
  (27, 'Cable Face Pull', 'Pull'),
  (30, 'Shoulder Press (Smith Machine)', 'Push'),
  (49, 'Seated Row', 'Pull'),
  (16, 'Deadlift', 'Legs'),
  (11, 'Leg Extension', 'Legs'),
  (12, 'Hamstring Curl', 'Legs'),
  (13, 'Hip Adductor', 'Legs'),
  (14, 'Standing Abductor', 'Legs'),
  (15, 'Calf Raise (Smith Machine)', 'Legs'),
  (19, 'Seated Chest Press (Machine)', 'Push'),
  (21, 'Cable Chest Fly', 'Push'),
  (22, 'Pec Deck', 'Push'),
  (26, 'Reverse Pec Deck', 'Pull'),
  (28, 'Dumbbell Pullover', 'Pull'),
  (29, 'DB Lateral Raise', 'Push'),
  (32, 'Overhead Tricep Extension', 'Push'),
  (33, 'Triceps Pushdown', 'Push'),
  (34, 'Single Arm Tricep Cable Extension', 'Push'),
  (35, 'Inclined Bicep Curl', 'Pull'),
  (36, 'Hammer Curl', 'Pull'),
  (37, '2 Handed Hammer Curl', 'Pull'),
  (39, 'Cable Crunch', 'Core'),
  (45, 'Lat Pull Down Close Grip', 'Pull'),
  (47, 'Tricep pushdown Twist', 'Push'),
  (48, 'Goblet Squat', 'Legs'),
  (31, 'Dumbbell Front Shoulder Raise', 'Push'),
  (57, 'Seated Shoulder Press', 'Push'),
  (61, 'Arnold Press', 'Push'),
  (56, 'Shoulder Shrug (Smith Machine)', 'Pull'),
  (17, 'DB Split Squat', 'Legs'),
  (59, 'Seated 6 Point Shoulder Raise', 'Push'),
  (60, 'Press Ups', 'Push'),
  (74, 'Inclined Squat', 'Legs'),
  (75, 'Inclined Calf Raise', 'Legs');

do $$
declare
  missing_count integer;
begin
  select count(*)
  into missing_count
  from exercise_category_map m
  left join exercise e on e.exercise_id = m.exercise_id
  where e.exercise_id is null;

  if missing_count > 0 then
    raise exception 'CSV mapping references % exercise ids that do not exist in exercise.', missing_count;
  end if;
end $$;

update exercise e
set
  canonical_name = m.canonical_name,
  exercise_type = case
    when m.category = 'Cardi_Main' then 2
    when m.category = 'Class' then 4
    else 1
  end
from exercise_category_map m
where e.exercise_id = m.exercise_id;

update exercise_group
set name = 'Cardio'
where lower(name) in ('cardi_main', 'cardio_main')
  and not exists (
    select 1
    from exercise_group existing
    where existing.user_id = exercise_group.user_id
      and lower(existing.name) = 'cardio'
      and existing.exercise_group_id <> exercise_group.exercise_group_id
  );

with wanted_groups(name) as (
  values ('Cardio'), ('Push'), ('Pull'), ('Legs'), ('Core'), ('Class')
),
target_user as (
  select user_id
  from exercise_group
  where user_id is not null
  order by exercise_group_id
  limit 1
)
insert into exercise_group (user_id, name)
select tu.user_id, wg.name
from wanted_groups wg
cross join target_user tu
where not exists (
  select 1
  from exercise_group g
  where g.user_id = tu.user_id
    and lower(g.name) = lower(wg.name)
);

with target_user as (
  select user_id
  from exercise_group
  where user_id is not null
  order by exercise_group_id
  limit 1
),
target_groups as (
  select exercise_group_id, name
  from exercise_group
  join target_user tu using (user_id)
  where lower(name) in ('cardio', 'push', 'pull', 'legs', 'core', 'class')
)
delete from exercise_group_item item
using target_groups tg
where item.exercise_group_id = tg.exercise_group_id;

with mapped as (
  select
    case when category = 'Cardi_Main' then 'Cardio' else category end as group_name,
    exercise_id,
    row_number() over (
      partition by case when category = 'Cardi_Main' then 'Cardio' else category end
      order by exercise_id
    ) as sequence_no
  from exercise_category_map
),
target_user as (
  select user_id
  from exercise_group
  where user_id is not null
  order by exercise_group_id
  limit 1
),
target_groups as (
  select exercise_group_id, name
  from exercise_group
  join target_user tu using (user_id)
  where lower(name) in ('cardio', 'push', 'pull', 'legs', 'core', 'class')
)
insert into exercise_group_item (exercise_group_id, exercise_id, sequence_no)
select tg.exercise_group_id, m.exercise_id, m.sequence_no
from mapped m
join target_groups tg on lower(tg.name) = lower(m.group_name)
order by tg.name, m.sequence_no;

commit;
