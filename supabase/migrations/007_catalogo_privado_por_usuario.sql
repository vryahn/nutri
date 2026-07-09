-- 007_catalogo_privado_por_usuario.sql
-- Catálogo de alimentos y recetas PRIVADO por usuario (deja de compartirse en lectura).
-- Compartir a otro usuario será funcionalidad futura (no incluida aquí).
-- Parte A: duplica el catálogo maestro (foods) a cada otro usuario que no lo tenga,
--          remapeando sus entries y prefs.water_food_id a sus propias copias (idempotente).
-- Parte B: cierra las políticas SELECT de foods, recipes y recipe_items a owner = auth.uid().
-- Bryan (catálogo maestro) no pierde ni cambia ninguna fila propia.

-- Dueño del catálogo maestro = usuario con más foods (resuelto dinámicamente, sin hardcode).
create temporary table _master as
  select owner from nutri.foods group by owner order by count(*) desc limit 1;

-- Usuarios destino = todos menos el maestro.
create temporary table _targets as
  select u.id as owner from auth.users u
  where u.id <> (select owner from _master);

-- Mapa old_food_id -> new_food_id por usuario destino.
create temporary table _food_map (target_owner uuid, old_id uuid, new_id uuid);

-- (1) Foods del maestro que el destino AÚN NO tiene por (name, brand): copia con id nuevo.
insert into _food_map (target_owner, old_id, new_id)
select t.owner, f.id, gen_random_uuid()
from _targets t
join nutri.foods f on f.owner = (select owner from _master)
where not exists (
  select 1 from nutri.foods f2
  where f2.owner = t.owner
    and f2.name = f.name
    and coalesce(f2.brand,'') = coalesce(f.brand,'')
);

-- (2) Foods del maestro que el destino YA tiene por (name, brand): mapea a su copia existente.
insert into _food_map (target_owner, old_id, new_id)
select t.owner, f.id, f2.id
from _targets t
join nutri.foods f on f.owner = (select owner from _master)
join nutri.foods f2 on f2.owner = t.owner
  and f2.name = f.name
  and coalesce(f2.brand,'') = coalesce(f.brand,'');

-- Inserta las copias nuevas (solo las del paso 1).
insert into nutri.foods (id, owner, name, brand, kcal, protein_g, carbs_g, fat_g,
                         micros, source, portions, density_g_ml)
select m.new_id, m.target_owner, f.name, f.brand, f.kcal, f.protein_g, f.carbs_g, f.fat_g,
       f.micros, f.source, f.portions, f.density_g_ml
from _food_map m
join nutri.foods f on f.id = m.old_id
where not exists (select 1 from nutri.foods x where x.id = m.new_id);

-- Remapea los entries de cada destino a sus propias copias.
update nutri.entries e
set food_id = m.new_id
from _food_map m
where m.target_owner = e.owner
  and m.old_id = e.food_id
  and e.food_id is not null;

-- Remapea prefs.water_food_id (el demo apuntaba al "Agua" de Bryan).
update nutri.prefs p
set data = jsonb_set(p.data, '{water_food_id}', to_jsonb(m.new_id::text))
from _food_map m
where m.target_owner = p.owner
  and (p.data->>'water_food_id') = m.old_id::text;

-- Parte B — RLS privado por usuario.
alter policy foods_sel   on nutri.foods        using (owner = auth.uid());
alter policy recipes_sel on nutri.recipes      using (owner = auth.uid());
alter policy ritems_sel  on nutri.recipe_items using (
  exists (select 1 from nutri.recipes r
          where r.id = recipe_items.recipe_id and r.owner = auth.uid())
);

drop table _food_map;
drop table _targets;
drop table _master;
