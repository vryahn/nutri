-- Run only after migration 023, as a single SQL batch with an admin SQL session.
-- Uses two existing auth.users as fixture owners, synthetic rows, and ROLLBACK.
-- SET ROLE + JWT GUCs exercises RLS; it does not exercise HTTP login/token validation.
begin;

do $$
begin
  if (select count(*) from auth.users) < 2 then
    raise exception 'Need two auth.users for cross-owner verification';
  end if;
  if has_function_privilege('anon', 'nutri.save_recipe_atomic(uuid,text,numeric,jsonb,text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'nutri.replace_phase_atomic(date,date,jsonb)', 'EXECUTE') then
    raise exception 'Anon can execute atomic write RPC';
  end if;
end $$;

select set_config('verify023.owner1', (select id::text from auth.users order by created_at, id limit 1), true);
select set_config('verify023.owner2', (select id::text from auth.users order by created_at, id offset 1 limit 1), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('verify023.owner1'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('verify023.owner1'), 'role', 'authenticated')::text, true);
with f as (
  insert into nutri.foods (owner, name, kcal, protein_g, carbs_g, fat_g)
  values (current_setting('verify023.owner1')::uuid, '__verify023_food1__', 100, 1, 1, 1)
  returning id
)
select set_config('verify023.food1', id::text, true) from f;
select set_config('verify023.recipe', nutri.save_recipe_atomic(
  null, '__verify023_recipe__', 100, '[]'::jsonb, 'manual',
  jsonb_build_array(jsonb_build_object('food_id', current_setting('verify023.food1'), 'grams', 100))
)::text, true);
insert into nutri.targets (owner, dow, valid_from, label, kcal)
select current_setting('verify023.owner1')::uuid, dow, date '2099-12-01', '__verify023_phase__', 2000
from generate_series(0, 6) dow;

select set_config('request.jwt.claim.sub', current_setting('verify023.owner2'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('verify023.owner2'), 'role', 'authenticated')::text, true);
with f as (
  insert into nutri.foods (owner, name, kcal, protein_g, carbs_g, fat_g)
  values (current_setting('verify023.owner2')::uuid, '__verify023_food2__', 100, 1, 1, 1)
  returning id
)
select set_config('verify023.food2', id::text, true) from f;

do $$
declare v_failed boolean := false;
begin
  begin
    perform nutri.save_recipe_atomic(current_setting('verify023.recipe')::uuid,
      'cross-owner', 100, '[]'::jsonb, 'manual',
      jsonb_build_array(jsonb_build_object('food_id', current_setting('verify023.food2'), 'grams', 100)));
  exception when sqlstate '42501' then v_failed := true;
  end;
  if not v_failed then raise exception 'Cross-owner recipe update succeeded'; end if;
  v_failed := false;
  begin
    perform nutri.save_recipe_atomic(null, 'cross-owner food', 100, '[]'::jsonb, 'manual',
      jsonb_build_array(jsonb_build_object('food_id', current_setting('verify023.food1'), 'grams', 100)));
  exception when sqlstate '42501' then v_failed := true;
  end;
  if not v_failed then raise exception 'Cross-owner ingredient succeeded'; end if;
  v_failed := false;
  begin
    perform nutri.replace_phase_atomic(date '2099-12-01', date '2099-12-08',
      (select jsonb_agg(jsonb_build_object('owner', current_setting('verify023.owner2'),
        'dow', dow, 'valid_from', '2099-12-08', 'kcal', 2000)) from generate_series(0, 6) dow));
  exception when sqlstate '42501' then v_failed := true;
  end;
  if not v_failed then raise exception 'Cross-owner phase replacement succeeded'; end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('verify023.owner1'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('verify023.owner1'), 'role', 'authenticated')::text, true);
do $$
declare
  v_before jsonb;
  v_after jsonb;
  v_failed boolean := false;
begin
  select jsonb_build_object('recipe', to_jsonb(r), 'items',
    (select jsonb_agg(to_jsonb(i) order by i.food_id) from nutri.recipe_items i where i.recipe_id = r.id))
  into v_before from nutri.recipes r where r.id = current_setting('verify023.recipe')::uuid;
  begin
    perform nutri.save_recipe_atomic(current_setting('verify023.recipe')::uuid,
      'invalid replacement', 100, '[]'::jsonb, 'manual',
      jsonb_build_array(jsonb_build_object('food_id', current_setting('verify023.food1'), 'grams', 'Infinity')));
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'Invalid grams accepted'; end if;
  select jsonb_build_object('recipe', to_jsonb(r), 'items',
    (select jsonb_agg(to_jsonb(i) order by i.food_id) from nutri.recipe_items i where i.recipe_id = r.id))
  into v_after from nutri.recipes r where r.id = current_setting('verify023.recipe')::uuid;
  if v_after is distinct from v_before then raise exception 'Recipe changed after invalid input'; end if;
end $$;

do $$
declare
  v_before_phase jsonb;
  v_after_phase jsonb;
  v_failed boolean := false;
begin
  select jsonb_agg(to_jsonb(t) order by t.dow) into v_before_phase
  from nutri.targets t where t.valid_from = date '2099-12-01' and t.dow is not null;
  begin
    perform nutri.replace_phase_atomic(date '2099-12-01', date '2099-12-08',
      (select jsonb_agg(to_jsonb(t) || jsonb_build_object('valid_from', '2099-12-08', 'goal', '__invalid__'))
       from nutri.targets t where t.valid_from = date '2099-12-01' and t.dow is not null));
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'Phase CHECK did not fail'; end if;
  select jsonb_agg(to_jsonb(t) order by t.dow) into v_after_phase
  from nutri.targets t where t.valid_from = date '2099-12-01' and t.dow is not null;
  if v_after_phase is distinct from v_before_phase then raise exception 'Phase lost data after insert failure'; end if;
  if exists (select 1 from nutri.targets where valid_from = date '2099-12-08' and dow is not null)
    then raise exception 'New phase survived failed replacement'; end if;
  if jsonb_array_length(v_after_phase) <> 7 then raise exception 'Old phase has fewer than seven weekdays'; end if;
end $$;

select nutri.save_recipe_atomic(current_setting('verify023.recipe')::uuid,
  '__verify023_updated__', 200, '[]'::jsonb, 'manual',
  jsonb_build_array(jsonb_build_object('food_id', current_setting('verify023.food1'), 'grams', 200)));
select nutri.replace_phase_atomic(date '2099-12-01', date '2099-12-08',
  (select jsonb_agg(to_jsonb(t) || jsonb_build_object('valid_from', '2099-12-08'))
   from nutri.targets t where t.valid_from = date '2099-12-01' and t.dow is not null));
do $$
begin
  if not exists (
    select 1 from nutri.recipes r join nutri.recipe_items i on i.recipe_id = r.id
    where r.id = current_setting('verify023.recipe')::uuid and r.name = '__verify023_updated__'
      and r.cooked_weight_g = 200 and i.grams = 200
  ) then raise exception 'Successful recipe replacement missing'; end if;
  if (select count(*) from nutri.targets where valid_from = date '2099-12-08' and dow is not null) <> 7
     or exists (select 1 from nutri.targets where valid_from = date '2099-12-01' and dow is not null) then
    raise exception 'Successful phase replacement missing';
  end if;
end $$;

rollback;
