-- 016_log_entry_by_id.sql — log_entry acepta ids explícitos (p_food_id/p_recipe_id).
-- Motivo: con catálogo compartido, el match por lower(name) limit 1 puede enganchar
-- un food ajeno homónimo en silencio (precisión = prioridad núcleo). El MCP registra
-- por id tras search_catalog; el nombre queda como fallback y ahora prefiere lo propio.
-- DROP + CREATE (no or-replace): añadir parámetros crearía un overload y PostgREST
-- no resuelve funciones sobrecargadas (llamadas REST ambiguas).
-- Nota de numeración: el 015 ya lo tomó 015_catalogo_base_compartido.sql (catálogo
-- base owner NULL, aplicada 2026-07-15); esta migración es la 016.

drop function nutri.log_entry(text, numeric, text, date);

create function nutri.log_entry(
  p_grams numeric,
  p_item text default null,
  p_label text default null,
  p_day date default current_date,
  p_food_id uuid default null,
  p_recipe_id uuid default null
) returns setof nutri.entries
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_food uuid; v_recipe uuid; v_label uuid;
begin
  if p_food_id is not null then
    select id into v_food from nutri.foods where id = p_food_id;
    if v_food is null then raise exception 'food_id no visible o inexistente: %', p_food_id; end if;
  elsif p_recipe_id is not null then
    select id into v_recipe from nutri.recipes where id = p_recipe_id;
    if v_recipe is null then raise exception 'recipe_id no visible o inexistente: %', p_recipe_id; end if;
  elsif p_item is not null then
    select id into v_food from nutri.foods where lower(name) = lower(p_item)
      order by (owner = auth.uid()) desc limit 1;
    if v_food is null then
      select id into v_recipe from nutri.recipes where lower(name) = lower(p_item)
        order by (owner = auth.uid()) desc limit 1;
    end if;
    if v_food is null and v_recipe is null then
      raise exception 'item no encontrado: %', p_item;
    end if;
  else
    raise exception 'se requiere p_item, p_food_id o p_recipe_id';
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

grant execute on function nutri.log_entry(numeric, text, text, date, uuid, uuid) to authenticated;
