# nutri.

App personal de registro nutricional (estilo Cronometer, simplificada) para 2 usuarios. Backend = Supabase (Postgres + Auth + PostgREST), sin servidor propio. Frontend = SPA estática (React + Vite + Tailwind).

## Setup

Pasos manuales, una sola vez:

1. Crea un proyecto en [Supabase](https://supabase.com) (o usa uno existente).
2. **SQL Editor** → pega el contenido completo de [`supabase/migration.sql`](supabase/migration.sql) → **Run**.
3. **Settings → API → Exposed schemas** → añade `nutri`.
4. **Authentication → Sign In / Up** → **Allow new users: OFF**. Crea los 2 usuarios a mano (email + password) desde el dashboard. El reset de contraseña también se hace desde ahí (no hay flujo self-service).
5. Copia el **Project URL** y la **anon key** (Settings → API) a un archivo `.env` en la raíz del proyecto:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

`.env` está en `.gitignore`. Nunca uses la `service_role` key en el frontend.

## API — contrato para scripts externos

La API REST de Supabase (PostgREST) es pública para este proyecto: cualquier script con las credenciales de un usuario puede leer y escribir sus datos. Ejemplos con `curl` (reemplaza `$SUPABASE_URL`, `$ANON_KEY`, `$EMAIL`, `$PASSWORD`, `$JWT`).

### Login

```bash
curl -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
```

Devuelve `access_token` (JWT, expira ~1 h) y `refresh_token`. Scripts largos: re-login por corrida, o usar `grant_type=refresh_token` con el `refresh_token`.

### Logout

```bash
curl -X POST "$SUPABASE_URL/auth/v1/logout" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT"
```

### Headers obligatorios para el esquema `nutri`

Todas las llamadas a `/rest/v1/...` de este proyecto necesitan:

- `apikey: $ANON_KEY`
- `Authorization: Bearer $JWT`
- `Accept-Profile: nutri` (lecturas, `GET`)
- `Content-Profile: nutri` (escrituras, `POST`/`PATCH`/`DELETE`)

### Alta de alimento custom

```bash
curl -X POST "$SUPABASE_URL/rest/v1/foods" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" \
  -H "Content-Type: application/json" \
  -d '{"name":"Arroz blanco cocido","kcal":130,"protein_g":2.7,"carbs_g":28,"fat_g":0.3,"micros":{"sodio_mg":1}}'
```

### Totales diarios (filtrados o completos)

```bash
curl "$SUPABASE_URL/rest/v1/daily_totals?day=gte.2026-07-01&day=lte.2026-07-07" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Accept-Profile: nutri"
```

En CSV (reemplaza el export semanal de Cronometer; un día cuenta como "registrado" si `kcal > 0`):

```bash
curl "$SUPABASE_URL/rest/v1/daily_totals?day=gte.2026-07-01&day=lte.2026-07-07" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Accept-Profile: nutri" \
  -H "Accept: text/csv"
```

### Registros de un día con cada alimento

```bash
curl "$SUPABASE_URL/rest/v1/entry_nutrients?day=eq.2026-07-07&order=created_at" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Accept-Profile: nutri"
```

### Registro en una sola llamada (para agentes)

`rpc/log_entry` busca el alimento o receta por nombre (case-insensitive), crea la etiqueta si no existe, e inserta el registro:

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/log_entry" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" \
  -H "Content-Type: application/json" \
  -d '{"p_item":"Arroz con pollo","p_grams":350,"p_label":"Cena"}'
```

Si el item no existe, la llamada responde con un error claro (`item no encontrado: <nombre>`).

**Flujo recomendado para un agente de fotos:** buscar `GET /foods?name=ilike.*X*` → si no existe, `POST /foods` para crearlo → `POST /rpc/log_entry` para registrarlo.

### Correcciones desde scripts

```bash
# corregir gramos de un registro
curl -X PATCH "$SUPABASE_URL/rest/v1/entries?id=eq.<uuid>" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" \
  -H "Content-Type: application/json" \
  -d '{"grams": 200}'

# borrar un registro
curl -X DELETE "$SUPABASE_URL/rest/v1/entries?id=eq.<uuid>" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri"
```

RLS impide tocar registros de otro usuario (falla en silencio: 0 filas afectadas). La API cubre lectura y escritura completa de todas las tablas de `nutri` (`foods`, `recipes`, `recipe_items`, `meal_labels`, `entries`, `targets`), sujeto a las mismas políticas de RLS.

### Sintaxis de filtros (PostgREST)

Operadores básicos sobre cualquier columna: `eq.` `gte.` `lte.` `ilike.`. Modificadores de query: `order=`, `limit=`, `select=`. Ejemplo: `?name=ilike.*pollo*&order=created_at.desc&limit=10&select=id,name`.

## Playbooks para agentes (IA vía API)

Claude (u otra IA) opera con las credenciales del usuario vía el password grant de arriba — RLS aplica solo, así que un agente solo puede escribir lo que su usuario podría. Las claves válidas del jsonb `micros` son exactamente las de `MICROS` en `src/lib/domain.js` (38 claves; valores **por 100 g**, siempre): las básicas `grasa_sat_g, grasa_trans_g, azucar_g, azucar_anadido_g, fibra_g, sodio_mg, potasio_mg, magnesio_mg, calcio_mg, hierro_mg, agua_ml, alcohol_g` más colesterol, vitaminas (`vit_a_mcg … vit_b12_mcg, colina_mg`), minerales (`zinc_mg, fosforo_mg, selenio_mcg, cobre_mg, manganeso_mg, yodo_mcg, cromo_mcg, molibdeno_mcg`) y antioxidantes (`beta_caroteno_mcg, licopeno_mcg, luteina_zeaxantina_mcg`) — consulta el archivo para la lista exacta con unidades.

Campos extra de `foods`: `portions` (jsonb `[{"name":"vaso","grams":247}]`, chips de cantidad al registrar) y `density_g_ml` (numeric, solo líquidos: la UI permite capturar ml y los convierte a gramos). Auditoría de coherencia kcal↔macros: un alimento "requiere revisión" cuando `|kcal − (4·protein_g + 4·carbs_g + 9·fat_g + 7·alcohol_g)| > max(20, 25 %)` — mismo criterio que `kcalSuspicious` en `domain.js`; un agente puede auditar el catálogo con un simple `GET /rest/v1/foods` y esa fórmula.

### Importar alimentos en lote

`POST /rest/v1/foods` acepta un array:

```bash
curl -X POST "$SUPABASE_URL/rest/v1/foods" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '[
    {"name":"Avena","kcal":389,"protein_g":16.9,"carbs_g":66.3,"fat_g":6.9,
     "micros":{"fibra_g":10.6,"magnesio_mg":177}},
    {"name":"Tortilla de maíz","kcal":218,"protein_g":5.7,"carbs_g":44.6,"fat_g":2.9,
     "micros":{"fibra_g":6.3,"sodio_mg":45,"potasio_mg":186}}
  ]'
```

### Exportar alimentos (o cualquier tabla)

```bash
# JSON completo
curl "$SUPABASE_URL/rest/v1/foods?select=*&order=name" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Accept-Profile: nutri"

# CSV
curl "$SUPABASE_URL/rest/v1/foods?select=*" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H "Accept-Profile: nutri" -H "Accept: text/csv"
```

### Auditar y corregir alimentos (retroactivo)

Los nutrientes de los registros se calculan **siempre en las vistas SQL** (`entry_nutrients`, `daily_totals`), nunca se copian: corregir un food actualiza retroactivamente todos los registros pasados que lo usan, sin tocar `entries`.

```bash
curl -X PATCH "$SUPABASE_URL/rest/v1/foods?id=eq.<uuid>" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" -H "Content-Type: application/json" \
  -d '{"kcal": 218, "micros": {"fibra_g": 6.3, "sodio_mg": 45}}'
```

Solo los foods del propio usuario son editables (RLS); los del otro usuario se leen pero el PATCH afecta 0 filas.

### Auditoría retroactiva contra USDA FDC

Los foods con `source='gemini'` son estimaciones (no etiqueta transcrita ni Open Food Facts) — el candidato natural a auditar. Para cada uno, compara sus macros contra el dato oficial de FDC:

```bash
# 1. lista los foods a auditar (nombre + macros guardados)
curl "$SUPABASE_URL/rest/v1/foods?source=eq.gemini&select=id,name,kcal,protein_g,carbs_g,fat_g" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Accept-Profile: nutri"

# 2. por cada nombre, busca el match más cercano en FDC (usa una key gratuita de
# https://fdc.nal.usda.gov/api-key-signup o DEMO_KEY para pruebas puntuales)
curl "https://api.nal.usda.gov/fdc/v1/foods/search?query=<nombre en inglés>&dataType=Foundation,SR%20Legacy&pageSize=1&api_key=$FDC_KEY"

# 3. detalle del fdcId elegido — foodNutrients trae los valores oficiales por 100 g
curl "https://api.nal.usda.gov/fdc/v1/food/<fdcId>?api_key=$FDC_KEY"
```

Marca como discrepancia cualquier macro (kcal, protein_g, carbs_g, fat_g) que difiera >25 % del valor de FDC (`nutrient.id` 1008/1003/1005/1004) y corrígelo con el PATCH de la sección anterior. Es un chequeo manual/asistido por agente, no hay endpoint ni script en la app.

### Configurar objetivos y fases

Una fila de `targets` es o bien recurrente (`dow` 0=domingo…6, versionada por `valid_from`) o un override puntual (`day`). Una **fase** (p. ej. mini bulk del 1 ago al 15 sep) son dos semanas: la de la fase con `valid_from` = inicio y `label` = nombre, y una de **restauración** con `valid_from` = fin+1 (copia de la semana previa):

```bash
# semana de la fase (7 filas, una por dow; null = sin objetivo ese campo)
curl -X POST "$SUPABASE_URL/rest/v1/targets" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" -H "Content-Type: application/json" \
  -d '[
    {"dow":0,"valid_from":"2026-08-01","label":"Mini bulk","kcal":3000,"protein_g":180},
    {"dow":1,"valid_from":"2026-08-01","label":"Mini bulk","kcal":3200,"protein_g":180}
  ]'
# … + la semana de restauración con valid_from 2026-09-16 (sin label o con el nombre de la fase que sigue)

# override para una fecha concreta
curl -X POST "$SUPABASE_URL/rest/v1/targets" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" -H "Content-Type: application/json" \
  -d '{"day":"2026-08-15","kcal":2200}'
```

Resolución para una fecha F: `day=F` si existe; si no, la fila `dow=weekday(F)` con mayor `valid_from ≤ F`. El objetivo de agua es el micro `agua_ml` del target. Todo esto es editable también desde la UI (tab Objetivos → Versiones y fases).

### Evaluar la ingesta de un periodo

```bash
# totales por día (macros + micros sumados)
curl "$SUPABASE_URL/rest/v1/daily_totals?day=gte.2026-06-01&day=lte.2026-06-30&order=day" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Accept-Profile: nutri"

# detalle de un día (cada registro con nutrientes calculados y etiqueta de comida)
curl "$SUPABASE_URL/rest/v1/entry_nutrients?day=eq.2026-06-15&order=created_at" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Accept-Profile: nutri"
```

Con eso y los `targets` del periodo, el agente puede calcular adherencia (la app usa: kcal como diana ±5 %/±15 %, proteína como piso) o aplicar sus propias métricas y dar conclusiones. Semántica de "día registrado": `kcal > 0` en `daily_totals`. El agua vive como entries del food "Agua" (`micros.agua_ml`, gramos = ml).

## Free tier — mantenimiento

Dos GitHub Actions garantizan el free tier de Supabase sin intervención manual:

- `.github/workflows/keepalive.yml` — cron semanal que hace `GET /rest/v1/` (evita la pausa automática por 7 días de inactividad del proyecto).
- `.github/workflows/backup.yml` — cron mensual que corre `pg_dump` y sube el resultado como artefacto del workflow (retención 90 días; el free tier no incluye backups).

Configura en **Settings → Secrets and variables → Actions** del repo:

- `SUPABASE_URL` — el Project URL (usado por keepalive).
- `ANON_KEY` — la anon/publishable key (usado por keepalive).
- `SUPABASE_DB_URL` — connection string de Postgres **del Session Pooler**, con password (botón **Connect** en el dashboard del proyecto → pestaña *Session pooler* → revela el password). No uses la conexión directa (`db.<ref>.supabase.co`): resuelve solo a IPv6 y los runners de GitHub Actions no tienen salida IPv6, el workflow falla con "Network is unreachable".

### Datos con IA (F6)

En **Alimentos → Nuevo alimento** hay un módulo "Datos con IA": describe el alimento, teclea un código de barras (EAN) o adjunta una foto (etiqueta nutrimental o platillo). Jerarquía: etiqueta legible en la foto → se transcribe (no se estima); si no, EAN (tecleado o leído en la foto) → Open Food Facts; si no, estimación tipo USDA priorizando México, con hasta 3 chips de coincidencias en USDA FoodData Central para alimentos genéricos sin marca. Revisa siempre antes de guardar. Requiere `VITE_GEMINI_KEY` en `.env` (key gratuita de [Google AI Studio](https://aistudio.google.com/apikey), free tier sin billing) y la misma variable en Vercel → Environment Variables; sin key el módulo no se muestra. Los chips USDA además requieren `VITE_FDC_KEY` (key gratuita de [FDC](https://fdc.nal.usda.gov/api-key-signup)); sin ella, simplemente no aparecen. Ambas keys son visibles en el bundle del cliente: usa keys sin facturación asociada.

## Fuera de alcance

Peso corporal, bioimpedancia, medidas, sueño y entrenamiento (Notion/Hevy). TypeScript, tests E2E, i18n, modo claro, registro público, recuperación de contraseña self-service, escáner de cámara, edge functions, dominio custom para la API.
