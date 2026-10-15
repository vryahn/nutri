-- Run after 024_nutrient_coverage.sql in one admin SQL session.
-- Synthetic rows use two existing auth identities; ROLLBACK removes every fixture.
-- SET ROLE/JWT GUCs exercise database RLS, not HTTP token validation.
begin;

do $$ begin
  if (select count(*) from auth.users) < 2 then
    raise exception 'Need two auth.users for cross-owner verification';
  end if;
end $$;

select set_config('verify024.owner1', (select id::text from auth.users order by created_at, id limit 1), true);
select set_config('verify024.owner2', (select id::text from auth.users order by created_at, id offset 1 limit 1), true);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('verify024.owner1'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('verify024.owner1'), 'role', 'authenticated')::text, true);

with f as (
  insert into nutri.foods (owner, name, kcal, protein_g, carbs_g, fat_g, micros)
  values (current_setting('verify024.owner1')::uuid, '__verify024_A__', 100, 10, 20, 1,
    '{"sodio_mg":0,"potasio_mg":null,"magnesio_mg":10,"agua_ml":20}'::jsonb)
  returning id
) select set_config('verify024.food_a', id::text, true) from f;
with f as (
  insert into nutri.foods (owner, name, kcal, protein_g, carbs_g, fat_g, micros)
  values (current_setting('verify024.owner1')::uuid, '__verify024_B__', 200, 20, 30, 2,
    '{"sodio_mg":40,"magnesio_mg":null,"agua_ml":10,"calcio_mg":5}'::jsonb)
  returning id
) select set_config('verify024.food_b', id::text, true) from f;
with r as (
  insert into nutri.recipes (owner, name, cooked_weight_g)
  values (current_setting('verify024.owner1')::uuid, '__verify024_recipe__', 250)
  returning id
) select set_config('verify024.recipe', id::text, true) from r;
insert into nutri.recipe_items (recipe_id, food_id, grams) values
  (current_setting('verify024.recipe')::uuid, current_setting('verify024.food_a')::uuid, 100),
  (current_setting('verify024.recipe')::uuid, current_setting('verify024.food_b')::uuid, 200);
with e as (
  insert into nutri.entries (owner, day, recipe_id, grams)
  values (current_setting('verify024.owner1')::uuid, date '2099-12-31', current_setting('verify024.recipe')::uuid, 125)
  returning id
) select set_config('verify024.entry_recipe', id::text, true) from e;
with e as (
  insert into nutri.entries (owner, day, food_id, grams)
  values (current_setting('verify024.owner1')::uuid, date '2099-12-31', current_setting('verify024.food_a')::uuid, 100)
  returning id
) select set_config('verify024.entry_food', id::text, true) from e;

do $$
declare r record;
begin
  select * into r from nutri.recipe_per_100g where recipe_id = current_setting('verify024.recipe')::uuid;
  if r.kcal <> 200 or r.protein_g <> 20 or r.carbs_g <> 32 or r.fat_g <> 2 then
    raise exception 'Recipe per-100g macros incorrect: %', row_to_json(r);
  end if;
  if r.micros <> '{"sodio_mg":32,"magnesio_mg":4,"agua_ml":16,"calcio_mg":4}'::jsonb
     or r.micros_complete <> '{"sodio_mg":true,"agua_ml":true}'::jsonb then
    raise exception 'Recipe observed/complete micros incorrect: %', row_to_json(r);
  end if;
  select * into r from nutri.entry_nutrients where id = current_setting('verify024.entry_recipe')::uuid;
  if r.kcal <> 250 or r.micros <> '{"sodio_mg":40,"magnesio_mg":5,"agua_ml":20,"calcio_mg":5}'::jsonb
     or r.micros_complete <> '{"sodio_mg":true,"agua_ml":true}'::jsonb then
    raise exception 'Recipe entry observed/complete micros incorrect: %', row_to_json(r);
  end if;
  select * into r from nutri.entry_nutrients where id = current_setting('verify024.entry_food')::uuid;
  if r.micros <> '{"sodio_mg":0,"magnesio_mg":10,"agua_ml":20}'::jsonb
     or r.micros_complete <> '{"sodio_mg":true,"magnesio_mg":true,"agua_ml":true}'::jsonb then
    raise exception 'Direct food entry failed zero/null distinction: %', row_to_json(r);
  end if;
  select * into r from nutri.daily_totals where owner = current_setting('verify024.owner1')::uuid and day = date '2099-12-31';
  if r.kcal <> 350 or r.micros <> '{"sodio_mg":40,"magnesio_mg":15,"agua_ml":40,"calcio_mg":5}'::jsonb
     or r.micros_complete <> '{"sodio_mg":true,"agua_ml":true}'::jsonb then
    raise exception 'Daily observed/complete micros incorrect: %', row_to_json(r);
  end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('verify024.owner2'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('verify024.owner2'), 'role', 'authenticated')::text, true);
with f as (
  insert into nutri.foods (owner, name, kcal, protein_g, carbs_g, fat_g, micros)
  values (current_setting('verify024.owner2')::uuid, '__verify024_other__', 50, 1, 2, 3, '{"sodio_mg":0}'::jsonb)
  returning id
) select set_config('verify024.other_food', id::text, true) from f;
with e as (
  insert into nutri.entries (owner, day, food_id, grams)
  values (current_setting('verify024.owner2')::uuid, date '2099-12-31', current_setting('verify024.other_food')::uuid, 100)
  returning id
) select set_config('verify024.other_entry', id::text, true) from e;

do $$ begin
  if exists (select 1 from nutri.foods where id in (current_setting('verify024.food_a')::uuid, current_setting('verify024.food_b')::uuid))
     or exists (select 1 from nutri.recipes where id = current_setting('verify024.recipe')::uuid)
     or exists (select 1 from nutri.recipe_per_100g where recipe_id = current_setting('verify024.recipe')::uuid)
     or exists (select 1 from nutri.entry_nutrients where id in (current_setting('verify024.entry_recipe')::uuid, current_setting('verify024.entry_food')::uuid))
     or exists (select 1 from nutri.daily_totals where owner = current_setting('verify024.owner1')::uuid and day = date '2099-12-31') then
    raise exception 'Owner 2 can read owner 1 fixture through a table or view';
  end if;
  if not exists (select 1 from nutri.entry_nutrients where id = current_setting('verify024.other_entry')::uuid and micros_complete = '{"sodio_mg":true}'::jsonb)
     or not exists (select 1 from nutri.daily_totals where owner = current_setting('verify024.owner2')::uuid and day = date '2099-12-31' and micros_complete ? 'sodio_mg') then
    raise exception 'Owner 2 cannot read own fixture';
  end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('verify024.owner1'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('verify024.owner1'), 'role', 'authenticated')::text, true);
do $$ begin
  if exists (select 1 from nutri.foods where id = current_setting('verify024.other_food')::uuid)
     or exists (select 1 from nutri.entry_nutrients where id = current_setting('verify024.other_entry')::uuid)
     or exists (select 1 from nutri.daily_totals where owner = current_setting('verify024.owner2')::uuid and day = date '2099-12-31') then
    raise exception 'Owner 1 can read owner 2 fixture';
  end if;
end $$;

rollback;
