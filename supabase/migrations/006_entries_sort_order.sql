-- Orden persistente de registros dentro de cada sección (etiqueta) en Hoy.
-- Antes solo se reordenaba ENTRE secciones (meal_label_id); dentro de una
-- sección el orden venía de created_at y no se podía reordenar por drag.
alter table nutri.entries add column if not exists sort_order int not null default 0;

-- Reexpone la vista con e.sort_order (columna al final: los consumidores usan '*').
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
  e.sort_order
from nutri.entries e
left join nutri.meal_labels ml on ml.id = e.meal_label_id
left join nutri.foods f on f.id = e.food_id
left join nutri.recipes r on r.id = e.recipe_id
left join nutri.recipe_per_100g rp on rp.recipe_id = e.recipe_id;
