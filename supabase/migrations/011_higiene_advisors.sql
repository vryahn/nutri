-- 011_higiene_advisors.sql — auditoría 2026-07-10 (BIBLIA.md §3.2)
-- (a) search_path fijo en funciones del esquema (lint function_search_path_mutable).
--     Los cuerpos solo referencian pg_catalog (implícito con '') y objetos nutri.*
--     / auth.* ya calificados, así que '' es seguro.
--     nutri.jsonb_sum es un AGGREGATE: Postgres no admite SET en agregados y su
--     sfunc quedó resuelta por OID al crearse — el WARN del lint se ACEPTA (falso
--     positivo para agregados, sin superficie real de hijack).
-- (b) auth.uid() → (select auth.uid()) en todas las policies (lint auth_rls_initplan:
--     evita re-evaluar la función por fila).
-- (c) ritems_mod (FOR ALL) se divide en insert/update/delete: FOR ALL duplicaba la
--     policy permisiva de SELECT con ritems_sel (lint multiple_permissive_policies).
-- (d) Índice de cobertura para toda FK sin él (lint unindexed_foreign_keys).
-- Semántica de acceso: IDÉNTICA — mismas condiciones owner = auth.uid(), solo
-- cambia la forma de evaluación. Reversa pensada: alter policy de vuelta a
-- auth.uid() desnudo, recrear ritems_mod for all, drop índices, reset search_path.

-- (a) funciones
alter function nutri.jsonb_scale(jsonb, numeric) set search_path = '';
alter function nutri.jsonb_add(jsonb, jsonb) set search_path = '';
alter function nutri.log_entry(text, numeric, text, date) set search_path = '';

-- (b) policies con initplan
alter policy foods_sel on nutri.foods using (owner = (select auth.uid()));
alter policy foods_ins on nutri.foods with check (owner = (select auth.uid()));
alter policy foods_upd on nutri.foods using (owner = (select auth.uid()));
alter policy foods_del on nutri.foods using (owner = (select auth.uid()));

alter policy recipes_sel on nutri.recipes using (owner = (select auth.uid()));
alter policy recipes_ins on nutri.recipes with check (owner = (select auth.uid()));
alter policy recipes_upd on nutri.recipes using (owner = (select auth.uid()));
alter policy recipes_del on nutri.recipes using (owner = (select auth.uid()));

alter policy ritems_sel on nutri.recipe_items using (
  exists (select 1 from nutri.recipes r
          where r.id = recipe_items.recipe_id and r.owner = (select auth.uid()))
);

alter policy labels_own on nutri.meal_labels
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

alter policy entries_own on nutri.entries
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

alter policy targets_own on nutri.targets
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

alter policy prefs_own on nutri.prefs
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- (c) recipe_items: FOR ALL → tres policies de escritura (SELECT queda solo en ritems_sel)
drop policy ritems_mod on nutri.recipe_items;

create policy ritems_ins on nutri.recipe_items for insert to authenticated
  with check (exists (select 1 from nutri.recipes r
                      where r.id = recipe_items.recipe_id and r.owner = (select auth.uid())));

create policy ritems_upd on nutri.recipe_items for update to authenticated
  using (exists (select 1 from nutri.recipes r
                 where r.id = recipe_items.recipe_id and r.owner = (select auth.uid())))
  with check (exists (select 1 from nutri.recipes r
                      where r.id = recipe_items.recipe_id and r.owner = (select auth.uid())));

create policy ritems_del on nutri.recipe_items for delete to authenticated
  using (exists (select 1 from nutri.recipes r
                 where r.id = recipe_items.recipe_id and r.owner = (select auth.uid())));

-- (d) índices de cobertura de FKs
create index if not exists entries_food_id_idx      on nutri.entries (food_id);
create index if not exists entries_recipe_id_idx    on nutri.entries (recipe_id);
create index if not exists entries_meal_label_id_idx on nutri.entries (meal_label_id);
create index if not exists foods_owner_idx          on nutri.foods (owner);
create index if not exists recipes_owner_idx        on nutri.recipes (owner);
create index if not exists recipe_items_food_id_idx on nutri.recipe_items (food_id);
