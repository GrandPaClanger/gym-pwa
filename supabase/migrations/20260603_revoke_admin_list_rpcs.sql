begin;

revoke execute on function public.admin_list_exercises() from public, anon, authenticated;
revoke execute on function public.admin_list_slot_codes() from public, anon, authenticated;

commit;
