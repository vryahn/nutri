# nutri. — guía para sesiones de Claude

App personal de registro nutricional (tipo Cronometer, simple) para 2 usuarios. **Ya está construida, desplegada y en uso** — el trabajo aquí es mantenimiento: mejoras, bugs, consultas y migraciones. `SPEC.md` es el spec original completo (referencia, no tarea pendiente).

## Reglas duras (siguen vigentes, no las relajes)

- **Stack cerrado:** react, react-dom, react-router-dom, @supabase/supabase-js, recharts, tailwindcss, lucide-react, vite-plugin-pwa. Ninguna dependencia nueva sin justificarla en una línea en el commit.
- **JavaScript (JSX), no TypeScript.** Estructura plana, objetivo ≤20 archivos en `src/`. Un archivo por página; lógica compartida SOLO en `src/lib/`; componentes extraídos solo si se usan ≥2 veces.
- **Estilo:** Tailwind en el JSX; colores/fuentes SOLO vía los tokens CSS de `src/index.css` + `tailwind.config.js`. Solo modo oscuro. Mobile-first (375 px sin scroll horizontal, touch ≥44 px, `prefers-reduced-motion` respetado).
- **Regla de seguridad médica:** el badge rojo de sodio < 1,500 mg (constante `SODIUM_FLOOR_MG` en `src/lib/domain.js`) no se quita ni se hace configurable.
- La `service_role`/secret key de Supabase no se usa en ningún lugar del proyecto.
- Repo **público**: nunca commitear credenciales, keys ni connection strings.

## Arquitectura

```
supabase/migration.sql   # migración inicial 000 (YA aplicada en producción)
supabase/migrations/     # migraciones incrementales (001 prefs+targets.label, 002 foods.portions+density_g_ml — ambas aplicadas)
src/lib/supabase.js      # createClient, schema 'nutri'
src/lib/domain.js        # MICROS, resolución de targets, adherencia, fórmula de recetas, reorderLabels
src/pages/               # Login, Today, Foods, Recipes, Targets, Dashboard (una por tab)
src/components/          # LabelsModal
src/App.jsx              # router, guard de sesión, tab bar
.github/workflows/       # keepalive.yml (semanal), backup.yml (mensual)
```

Invariantes de dominio:
- Todo valor nutricional se almacena **por 100 g**; cantidades siempre en gramos.
- Micros = jsonb con claves EXACTAS de la constante `MICROS` (claves libres fragmentarían las sumas). Son 38: los primeros `MICROS_DEFAULT` (8) siempre visibles; el resto oculto salvo favoritos del usuario (`prefs.data.fav_micros`), que se promueven en FoodForm y Dashboard.
- Kcal↔macros: `kcalFromMacros` (Atwater 4/4/9 + alcohol 7) es el placeholder del campo Kcal y su valor por defecto si se guarda vacío; `kcalSuspicious` (tolerancia max(20 kcal, 25 %)) pinta ⚠ "requiere revisión" en lista y formulario. Se calcula al vuelo, NO se persiste — la auditoría retroactiva es gratis.
- `foods.portions` (jsonb `[{name, grams}]`) y `foods.density_g_ml`: porciones custom (chips que SUMAN gramos al registrar) y densidad para líquidos (toggle g/ml en las hojas de Hoy; en la DB siempre entran gramos). Son absolutas: no se escalan con la base "valores por N g" del formulario.
- Gemini: los micros visibles (8 default + favoritos) son OBLIGATORIOS en la respuesta (sin dato fiable → 0); los ocultos solo con dato fiable (si no, null y se omiten). También estima `density_g_ml` para líquidos.
- Los nutrientes de registros se calculan siempre vía las vistas SQL (`entry_nutrients`, `daily_totals`, `recipe_per_100g`) — nunca se copian valores.
- **`computeRecipePer100g` en `domain.js` replica la vista `recipe_per_100g`. Si cambias una, cambia la otra.** Caso canónico de verificación: 100 g de A + 200 g de B con peso cocido 250 → por 100 g = (A + 2B) / 2.5.
- Resolución de target para fecha F: fila `day=F` si existe; si no, fila `dow=weekday(F)` con mayor `valid_from ≤ F`. `resolveTarget` en `domain.js` la implementa; Today y Dashboard la usan.
- RLS: catálogo (foods, recipes) compartido en lectura / escritura solo del dueño; entries, meal_labels, targets y prefs 100 % privados por usuario.
- Agua: entries de un food "Agua" propio (micros `{agua_ml:100}`, grams = ml), id cacheado en `prefs.data.water_food_id`. En UI el agua va como sección propia ANTES de los macros (Hoy y Dashboard) y NUNCA en la tabla/lista de micros. Hoy la excluye de Recientes, búsqueda y "Copiar día anterior".
- Agentes: import/export/auditoría de foods, fases de targets y evaluación de ingesta van por la API REST — playbooks con curl en README § "Playbooks para agentes". La auditoría es retroactiva gratis porque los nutrientes se calculan en vistas.

## Comandos

- `npm run dev` — dev server (hay `.claude/launch.json` para el preview integrado).
- `npm run build` — debe salir limpio antes de cualquier commit (el warning de chunk >500 kB por Recharts es conocido y aceptado).
- `.env` local (gitignoreado): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, opcional `VITE_GEMINI_KEY` (habilita "Estimar con IA" en Alimentos; sin key el módulo se oculta). Si la carpeta es un clone nuevo, copiar de `.env.example` y rellenar.

## Migraciones de base de datos

No hay Supabase CLI vinculado, pero sí conector MCP de Supabase (proyecto prod: `shzoiqbahfmfszjsrkzy`). Flujo:
1. Crear `supabase/migrations/NNN_descripcion.sql` (numerado incremental; `migration.sql` de la raíz es la 000, no la toques).
2. Aplicarla con `apply_migration` del MCP (o, sin MCP, el usuario la pega en Supabase → SQL Editor).
3. Verificar con SQL/API REST antes de dar la fase por cerrada.
Recordar: vistas con `security_invoker = true`; nuevas tablas necesitan RLS + policies + estar cubiertas por los grants existentes del esquema `nutri`.

## Deploy y CI

- **Push a `main` = deploy automático a producción** en Vercel → https://nutri.vryahn.com (proyecto `nutri`, team `vryahns-projects`). No hay entorno de staging; verificar localmente antes de pushear.
- GitHub Actions (secrets ya configurados: `SUPABASE_URL`, `ANON_KEY`, `SUPABASE_DB_URL`):
  - `keepalive.yml` — lunes 06:00 UTC, evita la pausa del free tier.
  - `backup.yml` — día 1 de cada mes, `pg_dump` como artefacto (retención 90 días).

## Gotchas de plataforma (aprendidos construyéndolo — no re-descubrir)

- La key del proyecto es la **publishable key** nueva de Supabase (`sb_publishable_...`), equivalente a la anon key. Con ella, `GET /rest/v1/` raíz devuelve 401 "secret key required" — por eso el keepalive NO exige status 2xx (cualquier respuesta cuenta como actividad).
- La conexión directa a Postgres (`db.<ref>.supabase.co`) resuelve **solo a IPv6**; GitHub Actions no tiene salida IPv6. Para `pg_dump`/conexiones desde CI usar el **session pooler** (`aws-1-us-east-2.pooler.supabase.com:5432`, user `postgres.<ref>`).
- El servidor corre **Postgres 17**; Ubuntu trae pg_dump 16 → backup.yml instala `postgresql-client-17` vía repo PGDG.
- Ícono PWA: SVG para el manifest, pero `apple-touch-icon.png` raster es obligatorio (iOS no soporta SVG ahí). Excepción deliberada a la regla "nada de logos raster" del spec.
- API REST del esquema: headers `Accept-Profile: nutri` (lecturas) / `Content-Profile: nutri` (escrituras) obligatorios. Ejemplos curl completos en el README.
- Los `npm warn deprecated` de glob/source-map venían de `workbox-build` (pineados upstream): se resuelven con `overrides` en package.json (glob 13, source-map 0.7.6). `vite build` ejercita workbox al generar el SW, así que un build limpio valida los overrides. Recharts se migró a v3 sin cambios de código.
- Gemini ("Estimar con IA" en Alimentos): key client-side `VITE_GEMINI_KEY` (AI Studio free tier SIN billing — queda visible en el bundle; riesgo aceptado = agotar cuota, no facturación). El request usa `response_schema` para JSON estructurado por 100 g y la foto se comprime con canvas a 1024 px antes de mandarla inline. `foods.source` no tiene CHECK: `'gemini'` convive con los legados `'off'`/`'usda'`.

## Verificación antes de commitear

1. `npm run build` limpio.
2. Si tocaste cálculos: caso canónico de recetas y/o registrar 150 g de un alimento = 1.5× sus valores por 100 g (macros Y micros).
3. Si tocaste RLS/queries: probar que un usuario no ve datos privados del otro (hay 2 cuentas reales; pedir credenciales al usuario, nunca hardcodearlas).
4. UI: revisar a 375 px en el preview.
5. Commit descriptivo y push (recuerda: push = deploy).

## Fuera de alcance (spec §11 — no construir)

Peso corporal, sueño, entrenamiento (viven en Notion/Hevy). TypeScript, tests E2E, i18n, modo claro, registro público de usuarios, recuperación de contraseña self-service, escáner de cámara, edge functions.
