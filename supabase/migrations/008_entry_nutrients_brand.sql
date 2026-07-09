-- Expone marca del alimento en entry_nutrients para mostrarla en Hoy.
-- Aditivo: misma vista de 006, agrega f.brand como última columna.
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
  nutri.jsonb_scale(coalesce(f.micros, rp.micros), e.grams / 100) as micros,
  e.sort_order,
  f.brand as brand
from nutri.entries e
left join nutri.meal_labels ml on ml.id = e.meal_label_id
left join nutri.foods f on f.id = e.food_id
left join nutri.recipes r on r.id = e.recipe_id
left join nutri.recipe_per_100g rp on rp.recipe_id = e.recipe_id;
