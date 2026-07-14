-- 014_meal_labels_archive.sql — borrado suave (archivado) de etiquetas de sección.
--
-- Motivo: entries.meal_label_id es ON DELETE SET NULL, así que borrar una etiqueta
-- reescribía TODOS los registros históricos que la usaban: el hecho "esto fue una
-- cena" se perdía para siempre y sin respaldo, y por eso el borrado no podía tener
-- un "Deshacer" real (reinsertar la etiqueta no recuperaba los registros).
--
-- Ahora borrar = archivar. Los registros conservan su meal_label_id; la UI solo
-- lista las etiquetas con archived_at is null y groupByLabel (Today.jsx) ya rutea
-- cualquier meal_label_id desconocido a "Sin etiqueta" — mismo efecto visible que
-- el borrado duro, pero reversible y sin tocar un solo registro.
--
-- unique(owner, name) se CONSERVA a propósito: recrear una etiqueta con el nombre
-- de una archivada la REVIVE (y sus registros históricos vuelven a su sección), en
-- vez de crear una fila nueva que los dejaría huérfanos para siempre.

alter table nutri.meal_labels add column if not exists archived_at timestamptz;

-- log_entry (RPC de agentes, README § Playbooks): su on-conflict engancharía los
-- registros nuevos a una etiqueta archivada, que se verían en "Sin etiqueta".
-- Revivirla es la misma semántica que la UI. Idéntica a la versión de la 011 salvo
-- el `archived_at = null` del do-update; el search_path fijo se re-declara aquí
-- porque create or replace no lo hereda solo.
create or replace function nutri.log_entry(
  p_item text, p_grams numeric,
  p_label text default null, p_day date default current_date
) returns setof nutri.entries
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_food uuid; v_recipe uuid; v_label uuid;
begin
  select id into v_food from nutri.foods where lower(name) = lower(p_item) limit 1;
  if v_food is null then
    select id into v_recipe from nutri.recipes where lower(name) = lower(p_item) limit 1;
  end if;
  if v_food is null and v_recipe is null then
    raise exception 'item no encontrado: %', p_item;
  end if;
  if p_label is not null then
    insert into nutri.meal_labels (owner, name) values (auth.uid(), p_label)
    on conflict (owner, name) do update set name = excluded.name, archived_at = null
    returning id into v_label;
  end if;
  return query
    insert into nutri.entries (owner, day, meal_label_id, food_id, recipe_id, grams)
    values (auth.uid(), p_day, v_label, v_food, v_recipe, p_grams)
    returning *;
end $$;
