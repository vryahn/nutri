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

## Free tier — mantenimiento

Ver `.github/workflows/keepalive.yml` (evita la pausa por inactividad) y `backup.yml` (backup mensual), añadidos en F5. Requieren los secrets de repo `SUPABASE_URL`, `ANON_KEY` (keepalive) y `SUPABASE_DB_URL` (backup).

## Fuera de alcance

Peso corporal, bioimpedancia, medidas, sueño y entrenamiento (Notion/Hevy). TypeScript, tests E2E, i18n, modo claro, registro público, recuperación de contraseña self-service, escáner de cámara, edge functions, dominio custom para la API.
