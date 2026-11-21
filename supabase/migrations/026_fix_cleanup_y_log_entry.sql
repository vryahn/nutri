-- 026_fix_cleanup_y_log_entry.sql — dos correcciones halladas en la auditoría de seguridad (2026-11-21).
--
-- 1) cleanup_demo_users: el `delete from storage.objects` (019) lo bloquea el trigger de
--    protección de Supabase ("Direct deletion from storage tables is not allowed"), así que el
--    cron diario fallaba entero y los anónimos nunca se purgaban. El demo no puede subir fotos
--    (policy restrictiva "demo sin subir fotos", 019), así que esa línea era solo cinturón: se
--    quita. Se añade ai_daily_usage para no dejar filas huérfanas (025, sin FK a auth.users).
--
-- 2) log_entry: el fallback por nombre ordenaba `(owner = auth.uid()) desc`; con un food base
--    (owner null) la expresión es NULL y en DESC los NULL van primero, así que el base ganaba al
--    homónimo propio — lo contrario de lo que promete 016. `nulls last` lo corrige. Misma firma:
--    create or replace no crea overload.

create or replace function nutri.cleanup_demo_users()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uids uuid[];
begin
  select array_agg(id) into uids from auth.users
  where is_anonymous and created_at < now() - interval '3 days';
  if uids is null then return; end if;
  delete from nutri.entries where owner = any(uids);
  delete from nutri.recipe_items ri using nutri.recipes r where ri.recipe_id = r.id and r.owner = any(uids);
  delete from nutri.recipes where owner = any(uids);
  delete from nutri.foods where owner = any(uids);
  delete from nutri.meal_labels where owner = any(uids);
  delete from nutri.targets where owner = any(uids);
  delete from nutri.body_metrics where owner = any(uids);
  delete from nutri.prefs where owner = any(uids);
  delete from nutri.ai_daily_usage where owner = any(uids);
  delete from auth.users where id = any(uids);
end
$fn$;

revoke all on function nutri.cleanup_demo_users() from public;
revoke all on function nutri.cleanup_demo_users() from anon;
revoke all on function nutri.cleanup_demo_users() from authenticated;

create or replace function nutri.log_entry(
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
      order by (owner = auth.uid()) desc nulls last limit 1;
    if v_food is null then
      select id into v_recipe from nutri.recipes where lower(name) = lower(p_item)
        order by (owner = auth.uid()) desc nulls last limit 1;
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
