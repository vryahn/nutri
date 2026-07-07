-- Esquema `nutri` — app de nutrición. Pegar completo en Supabase → SQL Editor.
-- Después de correr: Settings → API → Exposed schemas → añadir `nutri`.
create schema nutri;

-- ===== Helpers jsonb para micros =====
create function nutri.jsonb_scale(m jsonb, factor numeric) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(key, round(value::numeric * factor, 3)), '{}'::jsonb)
  from jsonb_each_text(coalesce(m, '{}'::jsonb))
$$;

create function nutri.jsonb_add(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(key, total), '{}'::jsonb)
  from (
    select key, round(sum(value::numeric), 3) as total
    from (select * from jsonb_each_text(coalesce(a, '{}'::jsonb))
          union all
          select * from jsonb_each_text(coalesce(b, '{}'::jsonb))) t
    group by key
  ) s
$$;

create aggregate nutri.jsonb_sum(jsonb) (
  sfunc = nutri.jsonb_add, stype = jsonb, initcond = '{}'
);

-- ===== Tablas =====
create table nutri.foods (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id),
  name        text not null,
  brand       text,
  kcal        numeric not null default 0,
  protein_g   numeric not null default 0,
  carbs_g     numeric not null default 0,
  fat_g       numeric not null default 0,
  micros      jsonb not null default '{}',
  source      text default 'manual',   -- manual | off | usda
  created_at  timestamptz default now()
);

create table nutri.recipes (
  id              uuid primary key default gen_random_uuid(),
  owner           uuid not null default auth.uid() references auth.users(id),
  name            text not null,
  cooked_weight_g numeric check (cooked_weight_g > 0),
  created_at      timestamptz default now()
);

create table nutri.recipe_items (
  recipe_id uuid references nutri.recipes(id) on delete cascade,
  food_id   uuid references nutri.foods(id),
  grams     numeric not null check (grams > 0),
  primary key (recipe_id, food_id)
);

create table nutri.meal_labels (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id),
  name       text not null,
  sort_order int default 0,
  unique (owner, name)
);

create table nutri.entries (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid() references auth.users(id),
  day           date not null default current_date,
  meal_label_id uuid references nutri.meal_labels(id) on delete set null,
  food_id       uuid references nutri.foods(id),
  recipe_id     uuid references nutri.recipes(id),
  grams         numeric not null check (grams > 0),
  created_at    timestamptz default now(),
  check (num_nonnulls(food_id, recipe_id) = 1)
);
create index on nutri.entries (owner, day);

create table nutri.targets (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id),
  dow        smallint check (dow between 0 and 6),  -- 0=domingo
  day        date,
  valid_from date not null default current_date,    -- versiona las filas dow por fase
  kcal       numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  micros     jsonb not null default '{}',
  check (num_nonnulls(dow, day) = 1),
  unique (owner, dow, valid_from),
  unique (owner, day)
);

-- ===== Vistas (security_invoker para que apliquen RLS) =====
create view nutri.recipe_per_100g with (security_invoker = true) as
select
  r.id as recipe_id,
  round(sum(f.kcal      * i.grams / 100) * 100 / coalesce(r.cooked_weight_g, sum(i.grams)), 1) as kcal,
  round(sum(f.protein_g * i.grams / 100) * 100 / coalesce(r.cooked_weight_g, sum(i.grams)), 2) as protein_g,
  round(sum(f.carbs_g   * i.grams / 100) * 100 / coalesce(r.cooked_weight_g, sum(i.grams)), 2) as carbs_g,
  round(sum(f.fat_g     * i.grams / 100) * 100 / coalesce(r.cooked_weight_g, sum(i.grams)), 2) as fat_g,
  nutri.jsonb_scale(
    nutri.jsonb_sum(nutri.jsonb_scale(f.micros, i.grams / 100)),
    100 / coalesce(r.cooked_weight_g, sum(i.grams))
  ) as micros
from nutri.recipes r
join nutri.recipe_items i on i.recipe_id = r.id
join nutri.foods f on f.id = i.food_id
group by r.id, r.cooked_weight_g;

create view nutri.entry_nutrients with (security_invoker = true) as
select
  e.id, e.owner, e.day, e.created_at, e.grams,
  e.food_id, e.recipe_id, e.meal_label_id,
  ml.name as meal,
  coalesce(f.name, r.name) as item,
  round(e.grams / 100 * coalesce(f.kcal, rp.kcal), 1)           as kcal,
  round(e.grams / 100 * coalesce(f.protein_g, rp.protein_g), 2) as protein_g,
  round(e.grams / 100 * coalesce(f.carbs_g, rp.carbs_g), 2)     as carbs_g,
  round(e.grams / 100 * coalesce(f.fat_g, rp.fat_g), 2)         as fat_g,
  nutri.jsonb_scale(coalesce(f.micros, rp.micros), e.grams / 100) as micros
from nutri.entries e
left join nutri.meal_labels ml on ml.id = e.meal_label_id
left join nutri.foods f on f.id = e.food_id
left join nutri.recipes r on r.id = e.recipe_id
left join nutri.recipe_per_100g rp on rp.recipe_id = e.recipe_id;

create view nutri.daily_totals with (security_invoker = true) as
select owner, day,
       round(sum(kcal), 1)      as kcal,
       round(sum(protein_g), 1) as protein_g,
       round(sum(carbs_g), 1)   as carbs_g,
       round(sum(fat_g), 1)     as fat_g,
       nutri.jsonb_sum(micros)  as micros
from nutri.entry_nutrients
group by owner, day;

-- ===== RPC para agentes externos: registrar por nombre en una llamada =====
create function nutri.log_entry(
  p_item text, p_grams numeric,
  p_label text default null, p_day date default current_date
) returns setof nutri.entries
language plpgsql security invoker as $$
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
    on conflict (owner, name) do update set name = excluded.name
    returning id into v_label;
  end if;
  return query
    insert into nutri.entries (owner, day, meal_label_id, food_id, recipe_id, grams)
    values (auth.uid(), p_day, v_label, v_food, v_recipe, p_grams)
    returning *;
end $$;

-- ===== RLS =====
alter table nutri.foods        enable row level security;
alter table nutri.recipes      enable row level security;
alter table nutri.recipe_items enable row level security;
alter table nutri.meal_labels  enable row level security;
alter table nutri.entries      enable row level security;
alter table nutri.targets      enable row level security;

-- Catálogo compartido entre los usuarios (foods, recipes): todos leen, el dueño escribe
create policy foods_sel on nutri.foods for select to authenticated using (true);
create policy foods_ins on nutri.foods for insert to authenticated with check (owner = auth.uid());
create policy foods_upd on nutri.foods for update to authenticated using (owner = auth.uid());
create policy foods_del on nutri.foods for delete to authenticated using (owner = auth.uid());

create policy recipes_sel on nutri.recipes for select to authenticated using (true);
create policy recipes_ins on nutri.recipes for insert to authenticated with check (owner = auth.uid());
create policy recipes_upd on nutri.recipes for update to authenticated using (owner = auth.uid());
create policy recipes_del on nutri.recipes for delete to authenticated using (owner = auth.uid());

create policy ritems_sel on nutri.recipe_items for select to authenticated using (true);
create policy ritems_mod on nutri.recipe_items for all to authenticated
  using (exists (select 1 from nutri.recipes r where r.id = recipe_id and r.owner = auth.uid()))
  with check (exists (select 1 from nutri.recipes r where r.id = recipe_id and r.owner = auth.uid()));

-- Datos privados por usuario
create policy labels_own  on nutri.meal_labels for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy entries_own on nutri.entries for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy targets_own on nutri.targets for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- ===== Permisos de API =====
grant usage on schema nutri to authenticated;
grant all on all tables in schema nutri to authenticated;
grant execute on all functions in schema nutri to authenticated;
