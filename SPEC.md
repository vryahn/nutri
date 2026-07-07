# SPEC — App de nutrición (tipo Cronometer) · Supabase + React

> **Cómo usar este archivo (para Bryan, no es parte del spec):**
> 1. Crea un repo vacío y guarda este archivo como `SPEC.md` en la raíz.
> 2. Abre Claude Code en esa carpeta con **Sonnet** (`/model sonnet`). Sonnet basta: el spec ya resolvió todas las decisiones; el trabajo es ejecución. Escala a Opus solo si una fase se atora dos veces (típicamente RLS/SQL). Fable no hace falta.
> 3. Prompt inicial: `Lee SPEC.md completo y ejecútalo fase por fase, empezando por F0. Detente donde el spec marque PAUSA.`
> 4. Para ahorrar tokens: una sesión por fase (`/clear` entre fases); el spec en el repo es la memoria, no la conversación. Al retomar: `Lee SPEC.md y continúa con la fase N.`

---

## 1. Rol y objetivo

Construye una web app personal de registro nutricional (estilo Cronometer, mucho más simple) para 2 usuarios, con costo de infraestructura $0:

- **Backend = Supabase únicamente**: Postgres (esquema `nutri`), Auth y la API REST autogenerada (PostgREST). **No hay servidor propio, no hay edge functions.** Toda la lógica vive en SQL (vistas/función) o en el cliente.
- **Frontend = SPA estática**: React + Vite + Tailwind, deploy en Cloudflare Pages o Vercel.
- La API REST de Supabase es un contrato público del proyecto: scripts externos del usuario (export a Notion, un agente de IA que registra comidas desde fotos) la consumirán. El README la documenta.

## 2. Restricciones duras

- **Stack cerrado:** `react`, `react-dom`, `react-router-dom`, `@supabase/supabase-js`, `recharts`, `tailwindcss`, `lucide-react` (iconos SVG; nunca emojis como iconos), y `vite-plugin-pwa` (solo F5). Ninguna otra dependencia sin justificarla en una línea en el commit.
- **JavaScript (JSX), no TypeScript.** Proyecto pequeño mantenido por IA; menos tokens.
- **Economía de tokens y de archivos:** estructura plana, objetivo ≤20 archivos en `src/`. Un archivo por página. Lógica compartida SOLO en `src/lib/`. Sin providers/context salvo un hook de sesión. Sin factories, sin capas de servicios, sin barrel files. Componentes extraídos solo si se usan ≥2 veces.
- **Estilo:** Tailwind en el JSX; los colores y fuentes SOLO vía los tokens del §7 (cambiar el tema = editar un archivo). **Solo modo oscuro** (no hay toggle). Mobile-first: se usará sobre todo desde el teléfono.
- **Secretos:** `.env` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (ignorado en git), `.env.example` committeado. La `service_role` key no se usa en ningún lugar del proyecto.
- **Git:** un commit al cerrar cada fase, mensaje `F<N>: <resumen>`.
- Si algo del spec resulta imposible o contradictorio al implementarlo, **dilo y propón el cambio mínimo**; no improvises en silencio.

## 3. Estructura objetivo

```
index.html  vite.config.js  .env.example  README.md
supabase/migration.sql
.github/workflows/keepalive.yml  backup.yml   # F5; no cuentan para el límite de src/
src/main.jsx
src/App.jsx            # router, guard de sesión, layout con tab bar
src/lib/supabase.js    # createClient
src/lib/domain.js      # MICROS, resolución de targets, cálculos, helpers de fecha
src/pages/Login.jsx  Today.jsx  Foods.jsx  Recipes.jsx  Targets.jsx  Dashboard.jsx
src/components/        # ≤5 piezas reutilizadas (picker, inputs de nutrientes, barra de progreso…)
```

## 4. Modelo de dominio (reglas de negocio)

1. **Todo valor nutricional se almacena por 100 g.** Cantidades siempre en gramos. Sin tazas/piezas/porciones.
2. **Macros** = columnas fijas (`kcal, protein_g, carbs_g, fat_g`). **Micros** = `jsonb` con claves de una constante única en `src/lib/domain.js`:
   ```js
   export const MICROS = [
     { key: 'fibra_g',     label: 'Fibra',    unit: 'g'  },
     { key: 'sodio_mg',    label: 'Sodio',    unit: 'mg' },
     { key: 'potasio_mg',  label: 'Potasio',  unit: 'mg' },
     { key: 'magnesio_mg', label: 'Magnesio', unit: 'mg' },
     { key: 'calcio_mg',   label: 'Calcio',   unit: 'mg' },
     { key: 'hierro_mg',   label: 'Hierro',   unit: 'mg' },
     { key: 'agua_ml',     label: 'Agua',     unit: 'ml' },
     { key: 'alcohol_g',   label: 'Alcohol',  unit: 'g'  },
   ];
   ```
   Los formularios generan los inputs desde esta lista; solo se guardan las claves con valor. Nunca claves de texto libre (fragmentarían las sumas). El agua se registra como un alimento normal ("Agua", 0 kcal, `{"agua_ml":100}`).
3. **Recetas y merma:** una receta tiene ingredientes (alimento + gramos) y un `cooked_weight_g` opcional (peso real tras cocción). Nutrientes por 100 g de receta = `Σ(nutriente_i × gramos_i/100) × 100 / peso_cocido` (si `cooked_weight_g` es null, usar la suma de gramos crudos). Ejemplo canónico de verificación: 100 g de A + 200 g de B que cocidos pesan 250 g → los 250 g contienen el total de A+B; comer 125 g = la mitad. Esta conversión ya la hace la vista SQL `recipe_per_100g`; el preview del editor la replica en cliente.
4. **Objetivos (targets):** por día de semana (`dow` 0–6, 0=domingo) **versionados con `valid_from`**, o por fecha exacta (`day`). Resolución para una fecha F: `target(F) = fila con day=F` si existe; si no, `fila dow=weekday(F) con el mayor valid_from ≤ F`. Sin target aplicable → el dashboard muestra consumido sin %. El versionado existe porque el usuario vive en fases (bulk/cut) con targets distintos: el histórico de julio debe compararse contra el objetivo de julio, no contra el actual.
5. **Semántica de adherencia por nutriente (solo UI, sin esquema):**
   - kcal = **diana**: verde dentro de ±5 % del objetivo, ámbar ±15 %, rojo fuera.
   - proteína = **piso**: verde si ≥ objetivo, rojo si <.
   - resto (carbs, grasa, micros) = informativo: % del objetivo sin color, salvo:
   - **sodio = piso clínico**: si el día tiene registros y el sodio total < 1,500 mg → badge rojo "⚠ sodio < 1,500 mg" SIEMPRE, independiente del objetivo. (Regla de seguridad médica del usuario; no la quites ni la hagas configurable.)
6. **Día registrado** = día con kcal consumidas > 0. El dashboard muestra "días registrados / días del rango".
7. Los registros (`entries`) referencian alimento O receta + gramos; los nutrientes se calculan siempre vía las vistas (no se copian valores). Corregir un alimento recalcula el histórico: comportamiento deseado.
8. **Todo es por usuario salvo el catálogo.** Cada usuario tiene sus propios registros, etiquetas y objetivos — incluidos los valores de cada macro y micro de sus targets (los 2 usuarios siguen planes distintos: pisos de proteína, bandas de sodio/potasio y kcal diferentes). Solo alimentos y recetas se comparten (lectura para todos, escritura del creador). La app nunca muestra datos de otro usuario; RLS ya lo garantiza, la UI no debe asumir nada global.

## 5. Migración SQL (F0) — contenido EXACTO de `supabase/migration.sql`

Genera el archivo con este contenido literal. Si el SQL Editor reporta un error real al aplicarla, corrige lo mínimo y anota el cambio en el README.

```sql
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
```

## 6. Configuración manual de Supabase (checklist → README)

El humano hace esto una vez (documéntalo en el README, sección "Setup"):

1. Proyecto Supabase (nuevo o existente) → SQL Editor → pegar `supabase/migration.sql` → Run.
2. Settings → API → **Exposed schemas** → añadir `nutri`.
3. Authentication → Sign In / Up → **Allow new users: OFF**. Crear los 2 usuarios a mano (email+password). Reset de contraseña = admin desde el dashboard.
4. Copiar Project URL y anon key a `.env`.

## 7. Sistema de diseño — marca personal BR. en dark mode

Identidad: paleta "Atardecer de Pie de la Cuesta" adaptada a UI oscura + tipografía Editorial Tech. Todos los valores viven como tokens (CSS variables + `tailwind.config`) en UN solo lugar.

### Tokens de color

```
--bg:            #081D26   /* fondo app (abisal profundo) */
--surface:       #0C2A36   /* cards (abisal) */
--surface-2:     #113240   /* elevación = superficie más clara; hover/inputs */
--surface-3:     #1E3A4A   /* medianoche: sheets/modales */
--border:        rgba(250,250,249,0.08)
--text:          #FAFAF9   /* espuma */
--text-2:        #9DB2BD   /* secundario (≥4.5:1 sobre surface) */
--text-3:        #64748B   /* bruma: metadata, solo texto grande/etiquetas */
--accent:        #F97316   /* terracota clara: interactivo, links, tab activa (la terracota #C2410C pura no alcanza contraste sobre abisal) */
--accent-deep:   #C2410C   /* terracota de marca: rellenos, botón primario (texto espuma encima), el "punto" de marca */
--ok:            #34D399   /* piso cumplido, en diana */
--warn:          #FBBF24   /* cerca del límite */
--danger:        #F87171   /* flag de sodio, fuera de rango */
/* Datos (charts/anillos) — siempre acompañados de etiqueta de texto, nunca color solo: */
--d-kcal: #F97316  --d-prot: #34D399  --d-carb: #60A5FA  --d-fat: #FBBF24
```

### Tipografía

- **Fraunces** (600) — solo display: wordmark y título de página.
- **Inter** (400/500/600) — todo el UI y cuerpo, base 16 px (evita el auto-zoom de iOS).
- **JetBrains Mono** (500) — **todos los valores numéricos** (kcal, gramos, %, macros) con `font-variant-numeric: tabular-nums`: las cifras no bailan al actualizarse.
- Google Fonts con `display=swap`, solo los pesos listados.

### Marca

- Wordmark del header: `nutri` en Fraunces + punto final en terracota (`nutri.`) — guiño al monograma BR.
- Login y icono PWA: monograma **BR.** (SVG inline: espuma sobre abisal, punto terracota). Nada de logos raster.

### Componentes e interacción (reglas duras)

- **Tab bar inferior** con los 5 destinos (Hoy · Alimentos · Recetas · Objetivos · Dashboard), icono Lucide + label siempre, activa en `--accent` con indicador; `padding-bottom: env(safe-area-inset-bottom)` (PWA instalada en iPhone).
- Cards `rounded-2xl` sobre `--surface`; elevación = superficie más clara, **sin sombras pesadas** (dark mode).
- Feedback de toque en todo lo tappable: `active:scale-[0.98]` + transición 150 ms; transiciones 150–300 ms `ease-out`; **`prefers-reduced-motion: reduce` desactiva transforms y animaciones de charts**.
- Targets táctiles ≥44 px; inputs numéricos `inputmode="decimal"` altura ≥44 px; labels visibles (nunca solo placeholder); error debajo del campo.
- Cargas >300 ms → **skeleton** del layout esperado (no spinner de página); alturas reservadas para evitar saltos (CLS).
- Empty states con acción: "Sin alimentos aún" + botón "Crear el primero"; ídem recetas/objetivos.
- Confirmación antes de borrar; toast breve de éxito/error (`aria-live="polite"`); focus visible (ring `--accent`) en todo interactivo.
- Charts Recharts: gridlines sutiles (`--border`), tooltips con valores exactos, línea de objetivo en `--accent`, donut de macros (3 categorías máx + etiquetas directas), sin animación bajo reduced-motion.
- Layout: `min-h-dvh` (no `100vh`); sin scroll horizontal a 375 px; contenido con padding inferior para no quedar bajo la tab bar.

## 8. Páginas

**Login** — email + password (`signInWithPassword`). Sin registro, sin "olvidé mi contraseña". Sesión persistente (default de supabase-js). Botón de logout en el layout.

**Hoy (Today)** — pantalla principal y tab por defecto:
- Selector de fecha: hoy por default, flechas ± día, `<input type="date">` al tocar.
- Resumen del día: kcal y macros consumidos vs objetivo resuelto (barras de progreso, semántica §4.5), badge de sodio si aplica.
- Entradas agrupadas por etiqueta (orden `sort_order`; sin etiqueta al final). Cada fila: nombre, gramos, kcal; tap para editar gramos/etiqueta o borrar.
- Añadir: buscador único sobre alimentos + recetas (ilike sobre `name`, marcar cuáles son recetas), luego gramos + etiqueta.
- **Recientes:** encima del buscador, chips con los ~8 items distintos más recientemente registrados por el usuario; un tap precarga item + últimos gramos usados. Es la vía rápida del 90 % de los registros diarios.
- Botón "Copiar día anterior" (duplica las entradas del día previo a la fecha visible).
- Gestión de etiquetas (crear/renombrar/ordenar/borrar) accesible desde aquí o desde un modal simple.

**Alimentos (Foods)** — lista con búsqueda; form de alta/edición: nombre, marca, 4 macros por 100 g, micros generados desde `MICROS` (colapsados por default), source. Borrar con confirmación; si Postgres rechaza por FK (tiene registros), mostrar "tiene registros asociados, no se puede borrar".

**Recetas (Recipes)** — lista; editor: nombre, ingredientes (picker de alimentos + gramos, añadir/quitar), campo "Peso cocido (g)" con hint "vacío = suma de ingredientes", y **preview en vivo de nutrientes por 100 g** calculado en cliente con la misma fórmula de la vista (§4.3).

**Objetivos (Targets)** — dos secciones:
- *Semana tipo:* editor de 7 días (kcal, macros, micros) + campo "aplica desde" (`valid_from`). Guardar inserta filas nuevas con ese `valid_from` — así arranca una fase nueva sin tocar el histórico. Botón "duplicar semana vigente" como punto de partida. Mostrar la semana vigente para la fecha actual.
- *Fechas específicas:* lista + alta de overrides puntuales (celebraciones, diet-breaks).

**Dashboard** — presets Hoy / Semana / Mes / Trimestre / Año + rango custom (dos date inputs):
- Cards de adherencia agregada del rango: consumido vs objetivo acumulado (suma de targets resueltos por día), por kcal y macros, con la semántica §4.5.
- Recharts: barras de kcal por día con línea del objetivo diario; distribución de macros del rango.
- Tabla de micros: total consumido, objetivo acumulado, % — sodio con su regla especial.
- Stat "días registrados X / Y".
- Stat "promedio diario" del rango: kcal y macros consumidos ÷ **días registrados** (no días de calendario — los días vacíos no diluyen). Es el dato con el que los usuarios calibran su TDEE observado.
- Los datos salen de 2 queries: `daily_totals` del rango + `targets` completo (resolución en cliente, §4.4).

## 9. README — documentación de la API (para scripts externos)

El README documenta con ejemplos `curl` reales del proyecto (con placeholders de URL/keys):

- Login → JWT (`POST /auth/v1/token?grant_type=password`), expira ~1 h; scripts: re-login por corrida o `refresh_token`. Logout (`POST /auth/v1/logout`).
- Headers obligatorios para el esquema: `Accept-Profile: nutri` (lecturas) / `Content-Profile: nutri` (escrituras), más `apikey` y `Authorization: Bearer`.
- Alta de alimento custom: `POST /rest/v1/foods`.
- Totales diarios filtrados o completos: `GET /rest/v1/daily_totals?day=gte.X&day=lte.Y` — y en CSV con `Accept: text/csv` (esto reemplaza el export semanal de Cronometer del usuario; adherencia = kcal > 0).
- Registros con cada alimento: `GET /rest/v1/entry_nutrients?day=eq.X&order=created_at`.
- Registro en una llamada para agentes: `POST /rest/v1/rpc/log_entry` con `{"p_item":"Arroz con pollo","p_grams":350,"p_label":"Cena"}` (busca alimento/receta por nombre case-insensitive; crea la etiqueta si no existe; error claro si el item no existe).
- Flujo recomendado para el agente de foto: buscar `GET /foods?name=ilike.*X*` → si no existe, `POST /foods` → `POST /rpc/log_entry`.
- Correcciones desde scripts: `PATCH /rest/v1/entries?id=eq.<uuid>` (p. ej. gramos) y `DELETE /rest/v1/entries?id=eq.<uuid>` — con ejemplo; RLS impide tocar registros ajenos. La API cubre lectura Y escritura completa de todas las tablas.
- Sintaxis de filtros PostgREST básica: `eq. gte. lte. ilike. order limit select`.

## 10. Fases y criterios de aceptación

**F0 — Base de datos y contrato de API.**
Genera `supabase/migration.sql` (§5), `README.md` con setup (§6) y docs de API (§9), `.env.example`.
✅ Aceptación: archivos generados; README claro.
**PAUSA:** pide al usuario aplicar la migración, configurar (§6) y llenar `.env`. No continúes hasta que confirme. Cuando confirme, verifica el contrato con curl (login con sus credenciales de prueba, `POST /foods` de un alimento, `GET /daily_totals`) antes de dar F0 por cerrada.

**F1 — Esqueleto de la SPA.**
Vite + Tailwind + tokens del §7 + router + guard de sesión + tab bar + Login (con monograma BR.) + Foods + etiquetas.
✅ `npm run build` limpio; login/logout reales; CRUD de alimentos y etiquetas funcionando contra Supabase; a 375 px sin overflow horizontal; tab bar con safe-area; tipografías cargando (números en JetBrains Mono); contraste AA en los pares de tokens usados.

**F2 — Registro diario (Today).**
✅ Alta/edición/borrado de entradas; agrupación por etiqueta; copiar día anterior; verificación numérica: registrar 150 g de un alimento conocido muestra exactamente 1.5× sus valores por 100 g (kcal, macros y micros).

**F3 — Recetas.**
✅ Caso canónico: receta con 100 g de un alimento A + 200 g de B y `cooked_weight_g = 250` muestra por 100 g exactamente `(A + 2B) / 2.5`; el preview del cliente coincide con la vista SQL; se puede registrar la receta en gramos desde Today.

**F4 — Objetivos y Dashboard.**
✅ Semana tipo con `valid_from` + overrides por fecha; resolución correcta (caso de prueba: un override de fecha gana al dow; una semana tipo nueva con `valid_from` futuro no afecta fechas pasadas); dashboard con presets y rango custom; semánticas diana/piso y regla de sodio < 1,500 mg visibles; stat de días registrados.

**F5 — Pulido y ciclo de vida gratuito.**
PWA instalable (`vite-plugin-pwa`, manifest + icono BR. + SW); import de alimentos desde **Open Food Facts** en Foods (buscar por nombre o código de barras tecleado → precargar el form mapeando `nutriments` por 100 g; ojo con unidades: OFF da `sodium_100g` en **gramos** → convertir a mg, y usa `energy-kcal_100g`, no `energy_100g` que es kJ; el usuario revisa y guarda con `source: 'off'`); si existe `VITE_USDA_KEY` en `.env`, botón equivalente para USDA FoodData Central (si no existe, no se muestra).
Además, dos GitHub Actions que garantizan el free tier de por vida:
- `.github/workflows/keepalive.yml` — cron semanal: `GET $SUPABASE_URL/rest/v1/` con el header `apikey` (evita la pausa por 7 días de inactividad).
- `.github/workflows/backup.yml` — cron mensual: `pg_dump` con `secrets.SUPABASE_DB_URL` → artefacto del workflow (retención 90 días; el free tier no tiene backups). README documenta los 2 secrets.
✅ Manifest y SW presentes en el build; importar un producto real de OFF funciona; ambos workflows con sintaxis válida; README final completo.

**Cierre — checklist de casos de uso.** Verifica y reporta uno por uno:
planificar por dow y fecha ✓ · recetas con merma ✓ · API alta de alimentos ✓ · API totales diarios filtrados/todo ✓ · API registros por alimento ✓ · login/logoff ✓ · dashboard día/semana/mes/trimestre/año/custom ✓ · etiquetas custom ✓ · **2 usuarios con seguimiento independiente** (verificar con ambas cuentas: cada una ve solo sus entries, sus etiquetas y sus targets — carga objetivos con valores distintos en cada cuenta y confirma que el dashboard de cada uno resuelve los suyos — pero comparten catálogo de alimentos/recetas) ✓ · `rpc/log_entry` por curl ✓ · pasada final de UI: 375 px sin scroll horizontal, touch ≥44 px, `prefers-reduced-motion` respetado, contraste AA en texto sobre superficies ✓.

## 11. Fuera de alcance (no lo construyas)

Peso corporal, bioimpedancia, medidas de cinta, sueño y entrenamiento (viven en Notion/Hevy, fuera de esta app). El script que exporta a Notion y el agente de IA por foto: son proyectos externos que consumen la API; esta app solo la expone y documenta. Tampoco: TypeScript, tests E2E, i18n, modo claro, registro público de usuarios, recuperación de contraseña self-service, escáner de cámara, edge functions, dominio custom para la API de Supabase.
