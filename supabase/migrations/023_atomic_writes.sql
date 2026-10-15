-- A failed recipe/phase replacement rolls back the whole RPC statement.
-- Both functions run as the caller; explicit owner checks complement table RLS.
create function nutri.save_recipe_atomic(
  p_recipe_id uuid, p_name text, p_cooked_weight_g numeric,
  p_portions jsonb, p_source text, p_items jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_id uuid;
  v_count integer;
begin
  if v_owner is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if nullif(btrim(p_name), '') is null or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Recipe name and ingredients are required' using errcode = '22023';
  end if;
  if p_cooked_weight_g is not null and (p_cooked_weight_g <= 0 or p_cooked_weight_g::text in ('NaN', 'Infinity', '-Infinity')) then
    raise exception 'Invalid cooked weight' using errcode = '22023';
  end if;
  if p_portions is null or jsonb_typeof(p_portions) <> 'array' then
    raise exception 'Invalid portions' using errcode = '22023';
  end if;
  select count(*) into v_count
  from jsonb_to_recordset(p_portions) as p(name text, grams numeric)
  where nullif(btrim(p.name), '') is null or p.grams is null or p.grams <= 0
     or p.grams::text in ('NaN', 'Infinity', '-Infinity');
  if v_count > 0 then raise exception 'Invalid portion' using errcode = '22023'; end if;
  select count(*) into v_count
  from jsonb_to_recordset(p_items) as i(food_id uuid, grams numeric)
  where i.food_id is null or i.grams is null or i.grams <= 0
     or i.grams::text in ('NaN', 'Infinity', '-Infinity');
  if v_count > 0 then raise exception 'Invalid ingredient' using errcode = '22023'; end if;
  select count(*) into v_count from (
    select i.food_id from jsonb_to_recordset(p_items) as i(food_id uuid, grams numeric)
    group by i.food_id having count(*) > 1
  ) duplicates;
  if v_count > 0 then raise exception 'Duplicate ingredient' using errcode = '22023'; end if;
  select count(*) into v_count
  from jsonb_to_recordset(p_items) as i(food_id uuid, grams numeric)
  left join nutri.foods f on f.id = i.food_id and (f.owner = v_owner or f.owner is null)
  where f.id is null;
  if v_count > 0 then raise exception 'Ingredient unavailable' using errcode = '42501'; end if;

  if p_recipe_id is null then
    insert into nutri.recipes (owner, name, cooked_weight_g, portions, source)
    values (v_owner, btrim(p_name), p_cooked_weight_g, p_portions, p_source)
    returning id into v_id;
  else
    update nutri.recipes
    set name = btrim(p_name), cooked_weight_g = p_cooked_weight_g,
        portions = p_portions, source = p_source
    where id = p_recipe_id and owner = v_owner
    returning id into v_id;
    if v_id is null then raise exception 'Recipe unavailable' using errcode = '42501'; end if;
    delete from nutri.recipe_items where recipe_id = v_id;
  end if;

  insert into nutri.recipe_items (recipe_id, food_id, grams)
  select v_id, i.food_id, i.grams
  from jsonb_to_recordset(p_items) as i(food_id uuid, grams numeric);
  return v_id;
end $$;

create function nutri.replace_phase_atomic(p_old_valid_from date, p_new_valid_from date, p_rows jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_count integer;
begin
  if v_owner is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_old_valid_from is null or p_new_valid_from is null or p_rows is null
     or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 7 then
    raise exception 'A phase needs seven weekdays' using errcode = '22023';
  end if;
  perform 1 from nutri.targets
  where owner = v_owner and valid_from = p_old_valid_from and dow is not null for update;
  select count(*) into v_count from nutri.targets
  where owner = v_owner and valid_from = p_old_valid_from and dow is not null;
  if v_count <> 7 then raise exception 'Original phase unavailable' using errcode = '42501'; end if;
  if p_new_valid_from <> p_old_valid_from and exists (
    select 1 from nutri.targets where owner = v_owner and valid_from = p_new_valid_from and dow is not null
  ) then raise exception 'Phase date already exists' using errcode = '23505'; end if;
  select count(distinct r.dow) into v_count
  from jsonb_to_recordset(p_rows) as r(owner uuid, dow smallint, valid_from date, day date)
  where r.owner = v_owner and r.valid_from = p_new_valid_from and r.day is null and r.dow between 0 and 6;
  if v_count <> 7 then raise exception 'Invalid phase weekdays or owner' using errcode = '22023'; end if;

  if p_new_valid_from <> p_old_valid_from then
    delete from nutri.targets where owner = v_owner and valid_from = p_old_valid_from and dow is not null;
    insert into nutri.targets (owner, dow, valid_from, label, description, goal,
                               rules, kcal, protein_g, carbs_g, fat_g, micros, bounds)
    select v_owner, r.dow, p_new_valid_from, r.label, r.description, r.goal,
           coalesce(r.rules, '{}'::jsonb), r.kcal, r.protein_g, r.carbs_g, r.fat_g,
           coalesce(r.micros, '{}'::jsonb), coalesce(r.bounds, '{}'::jsonb)
    from jsonb_to_recordset(p_rows) as r(
      dow smallint, label text, description text, goal text, rules jsonb,
      kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, micros jsonb, bounds jsonb
    );
  else
    insert into nutri.targets (owner, dow, valid_from, label, description, goal,
                               rules, kcal, protein_g, carbs_g, fat_g, micros, bounds)
    select v_owner, r.dow, p_new_valid_from, r.label, r.description, r.goal,
           coalesce(r.rules, '{}'::jsonb), r.kcal, r.protein_g, r.carbs_g, r.fat_g,
           coalesce(r.micros, '{}'::jsonb), coalesce(r.bounds, '{}'::jsonb)
    from jsonb_to_recordset(p_rows) as r(
      dow smallint, label text, description text, goal text, rules jsonb,
      kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, micros jsonb, bounds jsonb
    )
    on conflict (owner, dow, valid_from) do update
    set label = excluded.label, description = excluded.description, goal = excluded.goal,
        rules = excluded.rules, kcal = excluded.kcal, protein_g = excluded.protein_g,
        carbs_g = excluded.carbs_g, fat_g = excluded.fat_g,
        micros = excluded.micros, bounds = excluded.bounds;
  end if;
end $$;

revoke all on function nutri.save_recipe_atomic(uuid, text, numeric, jsonb, text, jsonb) from public, anon;
revoke all on function nutri.replace_phase_atomic(date, date, jsonb) from public, anon;
grant execute on function nutri.save_recipe_atomic(uuid, text, numeric, jsonb, text, jsonb) to authenticated;
grant execute on function nutri.replace_phase_atomic(date, date, jsonb) to authenticated;
