begin;

with target_user as (
  select user_id
  from exercise_group
  where user_id is not null
  order by exercise_group_id
  limit 1
),
old_groups as (
  select g.exercise_group_id
  from exercise_group g
  join target_user tu on tu.user_id = g.user_id
  where lower(g.name) not in ('cardio', 'push', 'pull', 'legs', 'core', 'class')
)
delete from exercise_group_item item
using old_groups old
where item.exercise_group_id = old.exercise_group_id;

with target_user as (
  select user_id
  from exercise_group
  where user_id is not null
  order by exercise_group_id
  limit 1
)
delete from exercise_group g
using target_user tu
where g.user_id = tu.user_id
  and lower(g.name) not in ('cardio', 'push', 'pull', 'legs', 'core', 'class');

commit;
