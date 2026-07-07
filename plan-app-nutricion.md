# Plan — App de gestión de ingesta calórica (tipo Cronometer)

**Costo de infraestructura: $0.** Sin backend propio: Supabase hace de base de datos, autenticación y API REST. El frontend es una SPA estática en hosting gratuito con tu dominio.

## 1. Arquitectura

```
[SPA React+Vite+Tailwind]  ──supabase-js──▶  [Supabase]
  Cloudflare Pages / Vercel                   ├─ Auth (login/logoff, 2+ usuarios)
  tu dominio, dark mode                       ├─ Postgres (esquema `nutri`)
                                              └─ PostgREST (API REST autogenerada)
[Tus scripts / curl]  ─────REST+JWT─────────▶  misma API
```

Decisiones clave:

- **Sin backend propio.** Todo caso de uso "por API" lo cubre PostgREST (la API REST que Supabase genera de cada tabla/vista) + Row Level Security. Cero servidores que mantener, cero costo.
- **Esquema Postgres dedicado (`nutri`), no columna `project_id`.** El free tier permite solo 2 proyectos activos; compartir un proyecto Supabase entre tus proyectos personales es correcto, pero el aislamiento se hace con un *schema* por proyecto: más limpio que un ID en cada tabla y PostgREST lo expone sin fricción (Settings → API → Exposed schemas → añadir `nutri`).
- **Stack frontend:** React + Vite + Tailwind + supabase-js + Recharts + Lucide (iconos). Elegido por economía de tokens y facilidad de edición manual: estructura plana (~15 archivos, un archivo por página), sin SSR, sin librería de estado, estilos = clases Tailwind en el propio JSX. Dark mode por defecto.
- **Sistema de diseño de marca (SPEC §7):** paleta "Atardecer de Pie de la Cuesta" adaptada a UI oscura — superficies abisal/medianoche, acento terracota (variante clara para contraste AA), estados verde/ámbar/rojo — con Fraunces (display), Inter (UI) y JetBrains Mono con `tabular-nums` para todo número. Todo como tokens en un archivo: retematizar = editar ese archivo, barato en tokens.
- **Nutrientes:** macros como columnas fijas (agregación barata), micros como `jsonb` flexible (`{"fibra_g": 10.6, "hierro_mg": 4.7}`) — añades cualquier micro sin migrar el esquema. Las claves de micros salen de una lista fija en la UI (constante en un archivo): si fueran texto libre, `fibra_g` y `fiber_g` se sumarían por separado y el dashboard se fragmentaría. Lista inicial (master plan v6): `fibra_g, sodio_mg, potasio_mg, magnesio_mg, calcio_mg, hierro_mg, agua_ml, alcohol_g` + extensible. El agua se registra como alimento ("Agua" = `{"agua_ml": 100}` por 100 g); el alcohol se muestra tal cual (la regla H8 de descuento es contabilidad tuya, no lógica de la app).
- **Valores siempre por 100 g** y cantidades en gramos. Sin unidades mixtas (tazas, piezas): simplicidad deliberada.
- **Catálogo compartido:** alimentos y recetas los ven ambos usuarios (evita capturar dos veces); solo el creador edita. Registros, objetivos y etiquetas son privados. Cambiar a catálogo privado = editar una política RLS.

## 2. Cobertura de casos de uso

| Caso de uso | Cómo se cubre |
|---|---|
| Planificar por día de semana y fecha específica | Tabla `targets` con `dow` (0–6) **o** `day` (fecha); la fecha exacta gana sobre el día de semana |
| Recetas con merma/evaporación | `recipes.cooked_weight_g` + vista `recipe_per_100g` (§4) |
| API: alta de alimentos custom | `POST /rest/v1/foods` |
| API: totales diarios (filtrados o todo) | `GET /rest/v1/daily_totals` con filtros PostgREST |
| API: registros con cada alimento | `GET /rest/v1/entry_nutrients` |
| Login / logoff | Supabase Auth (email+password, registro público desactivado; los 2 usuarios se crean desde el dashboard) |
| Dashboard día/semana/mes/trimestre/año/custom | Vista `daily_totals` + objetivos resueltos en cliente (§5) |
| Etiquetas custom (Desayuno, Comida…) | Tabla `meal_labels` por usuario |
| Fases del master plan (bulk/cut/peak con targets distintos) | `targets.valid_from`: los dow se versionan por fase; el histórico compara contra el objetivo vigente en su momento |
| Integraciones externas (script → Notion, IA con foto → registro) | API PostgREST + `rpc/log_entry` (§3); la app solo expone la API, los scripts/agentes viven fuera |

## 3. Modelo de datos (migración F0)

```sql
create schema nutri;

-- Helpers para micros jsonb: escalar y sumar
create function nutri.jsonb_scale(m jsonb, factor numeric) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(key, round(value::numeric * factor, 3)), '{}'::jsonb)
  from jsonb_each_text(m)
$$;

create function nutri.jsonb_add(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(key, total), '{}'::jsonb)
  from (
    select key, round(sum(value::numeric), 3) as total
    from (select * from jsonb_each_text(a)
          union all
          select * from jsonb_each_text(b)) t
    group by key
  ) s
$$;

create aggregate nutri.jsonb_sum(jsonb) (
  sfunc = nutri.jsonb_add, stype = jsonb, initcond = '{}'
);

-- Alimentos (valores por 100 g)
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
  source      text default 'manual',        -- manual | off | usda
  created_at  timestamptz default now()
);

-- Recetas: cooked_weight_g = peso real tras cocción (null → suma de ingredientes)
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

-- Etiquetas de comida por usuario (Desayuno, Comida, Cena, Snack…)
create table nutri.meal_labels (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id),
  name       text not null,
  sort_order int default 0,
  unique (owner, name)
);

-- Registro diario: una fila por alimento o receta consumida
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

-- Objetivos: por día de semana (versionados por fase vía valid_from) O fecha exacta.
-- Resolución: fecha exacta > fila dow con el valid_from más reciente que sea <= fecha.
-- valid_from permite que el dashboard histórico compare cada día contra el objetivo
-- vigente ENTONCES (bulk jul-sep, cut oct-dic…), no contra el actual.
create table nutri.targets (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id),
  dow        smallint check (dow between 0 and 6),   -- 0=domingo
  day        date,
  valid_from date not null default current_date,     -- solo relevante para filas dow
  kcal       numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  micros     jsonb not null default '{}',
  check (num_nonnulls(dow, day) = 1),
  unique (owner, dow, valid_from),
  unique (owner, day)
);
```

### Vistas (la lógica del sistema vive aquí)

```sql
-- Nutrientes por 100 g de receta COCIDA (aquí ocurre la conversión por merma)
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

-- Cada registro con sus nutrientes ya calculados (alimento o receta, uniforme)
create view nutri.entry_nutrients with (security_invoker = true) as
select
  e.id, e.owner, e.day, e.created_at, e.grams,
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

-- Totales por usuario y día
create view nutri.daily_totals with (security_invoker = true) as
select owner, day,
       round(sum(kcal), 1) as kcal,
       round(sum(protein_g), 1) as protein_g,
       round(sum(carbs_g), 1) as carbs_g,
       round(sum(fat_g), 1) as fat_g,
       nutri.jsonb_sum(micros) as micros
from nutri.entry_nutrients
group by owner, day;
```

Nota: los registros referencian al alimento/receta (no copian valores). Corriges un dato nutricional y todo el histórico se recalcula solo. `security_invoker = true` es obligatorio para que las vistas respeten RLS.

### RLS y permisos

```sql
alter table nutri.foods        enable row level security;
alter table nutri.recipes      enable row level security;
alter table nutri.recipe_items enable row level security;
alter table nutri.meal_labels  enable row level security;
alter table nutri.entries      enable row level security;
alter table nutri.targets      enable row level security;

-- Catálogo compartido: todos leen, solo el dueño escribe (foods y recipes)
create policy sel on nutri.foods for select to authenticated using (true);
create policy ins on nutri.foods for insert to authenticated with check (owner = auth.uid());
create policy upd on nutri.foods for update to authenticated using (owner = auth.uid());
create policy del on nutri.foods for delete to authenticated using (owner = auth.uid());
-- (idéntico para nutri.recipes)

-- recipe_items: lectura libre; escritura solo si eres dueño de la receta
create policy sel on nutri.recipe_items for select to authenticated using (true);
create policy mod on nutri.recipe_items for all to authenticated
  using (exists (select 1 from nutri.recipes r where r.id = recipe_id and r.owner = auth.uid()))
  with check (exists (select 1 from nutri.recipes r where r.id = recipe_id and r.owner = auth.uid()));

-- Datos privados: entries, targets, meal_labels
create policy own on nutri.entries for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
-- (idéntico para nutri.targets y nutri.meal_labels)

-- Exponer el esquema a la API
grant usage on schema nutri to authenticated;
grant all on all tables in schema nutri to authenticated;
grant execute on all functions in schema nutri to authenticated;
-- + Dashboard: Settings → API → Exposed schemas → añadir `nutri`
```

### RPC para agentes externos (script de Notion, IA con foto)

Una función SQL expuesta como `POST /rest/v1/rpc/log_entry` permite registrar en **una sola llamada** por nombre (sin resolver UUIDs), creando la etiqueta si no existe:

```sql
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
```

Flujo del agente de foto: `GET /foods?name=ilike.*arroz*` (¿existe?) → si no, `POST /foods` con los nutrientes estimados → `POST /rpc/log_entry {"p_item":"Arroz con pollo","p_grams":350,"p_label":"Cena"}`. El script de Notion solo consume `GET /daily_totals` (JSON o CSV) — reemplaza al export semanal de Cronometer, con adherencia = `kcal > 0` (tu convención P3).

Auth: desactivar registro público (Authentication → Sign In / Up → Allow new users: off) y crear los 2 usuarios a mano. Más usuarios después = crearlos en el dashboard.

## 4. Conversión de recetas (tu ejemplo)

Meto 100 g de X + 200 g de Y (300 g crudos), el resultado pesa 250 g:

```
total_nutriente = X.nutriente×(100/100) + Y.nutriente×(200/100)
por_100g_cocido = total_nutriente × 100 / 250
```

Los 250 g cocidos contienen el total; comer 125 g = la mitad. Es exactamente lo que hace `recipe_per_100g`: capturas ingredientes, pesas el resultado, escribes `cooked_weight_g`, y la receta se registra como cualquier alimento (en gramos del producto cocido). Si no pesas, asume la suma de ingredientes.

## 5. Dashboard

- Presets: hoy, semana, mes, trimestre, año + dos `<input type="date">` para rango custom.
- Datos: `daily_totals` del rango (una query) + tabla `targets` completa (≤ decenas de filas, una query).
- Resolución de objetivo por día **en el cliente**: `target(fecha) = targets[day=fecha] ?? filaDow(díaDeSemana(fecha)) con max(valid_from) <= fecha`. Sin SQL de calendario.
- Adherencia = consumido/objetivo por nutriente, agregada al rango. Recharts: barras diarias kcal vs objetivo, anillos de macros del día, tabla de micros con % del objetivo.
- Semántica por nutriente (convención de UI, sin esquema extra): **kcal = diana** (verde ±5 %), **proteína = piso** (verde si ≥ objetivo; guardrail G1), **sodio = piso clínico**: día con registros y sodio < 1,500 mg → rojo siempre (cápsula de seguridad), además del % vs objetivo de fase.
- Stat de adherencia de registro: "días registrados / días del rango" (día registrado = kcal > 0).
- Stat "promedio diario del rango" (kcal/macros ÷ días registrados): con esto ambos usuarios calibran su TDEE observado (FA-0 de Alberto; TDEE creep de Bryan).
- Multiusuario real: objetivos, registros y etiquetas son por usuario (planes distintos: pisos de proteína 155 vs 135 g, bandas de electrolitos distintas, fases distintas); solo el catálogo se comparte.

## 6. La API (para tus scripts)

```bash
BASE=https://<proyecto>.supabase.co
ANON=<anon_key>   # pública, va en el frontend también

# Login → JWT (expira ~1 h; para scripts: re-login por corrida o usar refresh_token)
curl -s "$BASE/auth/v1/token?grant_type=password" -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d '{"email":"bryan@...","password":"..."}'          # → access_token

# Logoff
curl -X POST "$BASE/auth/v1/logout" -H "apikey: $ANON" -H "Authorization: Bearer $JWT"

# Alta de alimento custom
curl -X POST "$BASE/rest/v1/foods" -H "apikey: $ANON" -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" -H "Content-Type: application/json" \
  -d '{"name":"Avena","kcal":389,"protein_g":16.9,"carbs_g":66.3,"fat_g":6.9,
       "micros":{"fibra_g":10.6,"hierro_mg":4.7}}'

# Totales diarios — filtrados o toda la tabla; CSV con: -H "Accept: text/csv"
curl "$BASE/rest/v1/daily_totals?day=gte.2026-07-01&day=lte.2026-07-31" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H "Accept-Profile: nutri"

# Registros con cada alimento
curl "$BASE/rest/v1/entry_nutrients?day=eq.2026-07-06&order=created_at" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H "Accept-Profile: nutri"
```

`Accept-Profile`/`Content-Profile: nutri` son necesarios porque el esquema no es `public`. RLS garantiza que cada JWT solo ve lo suyo. Filtros PostgREST: `eq.`, `gte.`, `lte.`, `order=`, `limit=`, `select=` — la sintaxis completa queda documentada en el README del repo.

## 7. Fases de construcción

| Fase | Alcance | Esfuerzo |
|---|---|---|
| F0 | Proyecto Supabase: migración SQL completa (§3), exponer esquema, 2 usuarios, registro off. Probar API con curl | 1–2 h |
| F1 | SPA base: Vite+Tailwind dark, login/logoff, layout móvil, CRUD de etiquetas y alimentos | 0.5–1 día |
| F2 | Registro diario: buscar alimento/receta, gramos, etiqueta, editar/borrar, **copiar día anterior** | 0.5 día |
| F3 | Recetas: ingredientes, peso cocido, preview de nutrientes por 100 g | 2–3 h |
| F4 | Objetivos (semana tipo + fechas específicas) + dashboard (§5) | 0.5–1 día |
| F5 | Pulido: PWA instalable (icono BR.), importar desde Open Food Facts y USDA FDC, README con docs de API, GitHub Actions de keepalive semanal y backup mensual (el "gratis de por vida" como entregable, no como recordatorio) | 0.5 día |

Cada fase termina desplegada y usable. F5 es recortable; la app está completa en F4.

**Importación de alimentos (F5):** botón "buscar en OFF" (por nombre o código de barras; API libre, sin key, buena cobertura MX) y "buscar en USDA" (genéricos; API key gratuita) → precarga el formulario de alimento → revisas y guardas con `source` correspondiente. Sin sincronización ni catálogos espejo: importar = copiar una fila.

## 8. Deploy

- **Frontend:** Cloudflare Pages o Vercel (free) conectado al repo GitHub; push a `main` = deploy. Tu dominio se apunta por DNS (si el dominio ya está en Cloudflare, usa Pages).
- **API/Auth:** quedan en `<proyecto>.supabase.co` — el dominio custom de Supabase es de pago e innecesario (solo tú consumes la API).
- **Secretos:** solo `SUPABASE_URL` y `ANON_KEY`, ambos públicos por diseño (la seguridad es RLS). La `service_role` key no se usa en ningún lado.

## 9. Riesgos del free tier y mitigación

| Riesgo | Mitigación |
|---|---|
| Pausa tras 7 días sin actividad | Uso diario la evita; red de seguridad: GitHub Action semanal (cron) que hace un `select` a la API |
| Sin backups automáticos en free | GitHub Action mensual: `pg_dump` → artefacto/repo privado. Suficiente para datos personales |
| 500 MB de base de datos | Años de registros de 2 personas caben de sobra (una entrada ≈ 100 bytes) |
| 2 proyectos activos máximo | Por eso el esquema compartido `nutri` en tu proyecto existente |

## 10. Qué se dejó fuera a propósito (YAGNI)

Apps nativas, edge functions, escáner de código de barras con cámara, objetivos por comida (solo por día), verificación de email, recuperación de contraseña self-service (la resetea el admin en el dashboard), i18n, tests E2E. Cualquiera se puede añadir después sin rediseñar; ninguno bloquea los casos de uso pedidos.

**También fuera por diseño (master plan):** peso corporal, BIA, cinta, sueño y entrenamiento — su fuente de verdad ya es Notion (Hevy → Worker → Notion; capturas manuales). La app cubre solo el dominio nutricional que hoy vive en Cronometer, y los expone por API para que tus scripts los lleven a Notion. El script de Notion y el agente de foto son proyectos separados que consumen la API; no son parte de la app.
