-- Preserve observed micro sums while recording whether every ingredient/entry
-- has an explicit value. A declared 0 is known; an absent or JSON null key is not.
create function nutri.jsonb_known_intersection(state jsonb, item jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k.key, true), '{}'::jsonb)
  from jsonb_each(coalesce(item, '{}'::jsonb)) as k(key, value)
  where (jsonb_typeof(k.value) = 'number' or k.value = 'true'::jsonb)
    and (state is null or state ? k.key)
$$;

create aggregate nutri.jsonb_known_all(jsonb) (
  sfunc = nutri.jsonb_known_intersection,
  stype = jsonb
);

create or replace view nutri.recipe_per_100g with (security_invoker = true) as
select
  r.id as recipe_id,
  round(sum(f.kcal      * i.grams / 100) * 100 / coalesce(r.cooked_weight_g, sum(i.grams)), 1) as kcal,
  round(sum(f.protein_g * i.grams / 100) * 100 / coalesce(r.cooked_weight_g, sum(i.grams)), 2) as protein_g,
  round(sum(f.carbs_g   * i.grams / 100) * 100 / coalesce(r.cooked_weight_g, sum(i.grams)), 2) as carbs_g,
  round(sum(f.fat_g     * i.grams / 100) * 100 / coalesce(r.cooked_weight_g, sum(i.grams)), 2) as fat_g,
  nutri.jsonb_scale(
    nutri.jsonb_sum(nutri.jsonb_scale(jsonb_strip_nulls(f.micros), i.grams / 100)),
    100 / coalesce(r.cooked_weight_g, sum(i.grams))
  ) as micros,
  nutri.jsonb_known_all(f.micros) as micros_complete
from nutri.recipes r
join nutri.recipe_items i on i.recipe_id = r.id
join nutri.foods f on f.id = i.food_id
group by r.id, r.cooked_weight_g;

-- Preserve sort_order and brand columns added by migrations 006 and 008.
create or replace view nutri.entry_nutrients with (security_invoker = true) as
select
  e.id, e.owner, e.day, e.created_at, e.grams,
  e.food_id, e.recipe_id, e.meal_label_id,
  ml.name as meal,
  coalesce(f.name, r.name) as item,
  round(e.grams / 100 * coalesce(f.kcal, rp.kcal), 1)           as kcal,
  round(e.grams / 100 * coalesce(f.protein_g, rp.protein_g), 2) as protein_g,
  round(e.grams / 100 * coalesce(f.carbs_g, rp.carbs_g), 2)     as carbs_g,
  round(e.grams / 100 * coalesce(f.fat_g, rp.fat_g), 2)         as fat_g,
  nutri.jsonb_scale(jsonb_strip_nulls(coalesce(f.micros, rp.micros)), e.grams / 100) as micros,
  e.sort_order,
  f.brand as brand,
  case when e.food_id is not null
    then nutri.jsonb_known_intersection(null, f.micros)
    else coalesce(rp.micros_complete, '{}'::jsonb)
  end as micros_complete
from nutri.entries e
left join nutri.meal_labels ml on ml.id = e.meal_label_id
left join nutri.foods f on f.id = e.food_id
left join nutri.recipes r on r.id = e.recipe_id
left join nutri.recipe_per_100g rp on rp.recipe_id = e.recipe_id;

create or replace view nutri.daily_totals with (security_invoker = true) as
select owner, day,
       round(sum(kcal), 1)      as kcal,
       round(sum(protein_g), 1) as protein_g,
       round(sum(carbs_g), 1)   as carbs_g,
       round(sum(fat_g), 1)     as fat_g,
       nutri.jsonb_sum(micros)  as micros,
       nutri.jsonb_known_all(micros_complete) as micros_complete
from nutri.entry_nutrients
group by owner, day;
