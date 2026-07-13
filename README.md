# nutri.

Personal nutrition-tracking app (Cronometer-style, simplified) for 2 users. Backend = Supabase (Postgres + Auth + PostgREST), no server of our own. Frontend = static SPA (React + Vite + Tailwind).

## Setup

One-time manual steps:

1. Create a project on [Supabase](https://supabase.com) (or use an existing one).
2. **SQL Editor** → paste the full contents of [`supabase/migration.sql`](supabase/migration.sql) → **Run**.
3. **Settings → API → Exposed schemas** → add `nutri`.
4. **Authentication → Sign In / Up** → **Allow new users: OFF**. Create the 2 users by hand (email + password) from the dashboard. Password resets are done from there too (there is no self-service flow).
5. Copy the **Project URL** and the **anon key** (Settings → API) into a `.env` file at the project root:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

`.env` is in `.gitignore`. Never use the `service_role` key in the frontend.

## API — contract for external scripts

The Supabase REST API (PostgREST) is public for this project: any script holding a user's credentials can read and write that user's data. Examples with `curl` (replace `$SUPABASE_URL`, `$ANON_KEY`, `$EMAIL`, `$PASSWORD`, `$JWT`).

### Login

```bash
curl -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
```

Returns `access_token` (JWT, expires ~1 h) and `refresh_token`. Long-running scripts: re-login per run, or use `grant_type=refresh_token` with the `refresh_token`.

### Logout

```bash
curl -X POST "$SUPABASE_URL/auth/v1/logout" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT"
```

### Required headers for the `nutri` schema

Every call to `/rest/v1/...` in this project needs:

- `apikey: $ANON_KEY`
- `Authorization: Bearer $JWT`
- `Accept-Profile: nutri` (reads, `GET`)
- `Content-Profile: nutri` (writes, `POST`/`PATCH`/`DELETE`)

### Create a custom food

```bash
curl -X POST "$SUPABASE_URL/rest/v1/foods" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" \
  -H "Content-Type: application/json" \
  -d '{"name":"Arroz blanco cocido","kcal":130,"protein_g":2.7,"carbs_g":28,"fat_g":0.3,"micros":{"sodio_mg":1}}'
```

### Daily totals (filtered or full)

```bash
curl "$SUPABASE_URL/rest/v1/daily_totals?day=gte.2026-07-01&day=lte.2026-07-07" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Accept-Profile: nutri"
```

As CSV (replaces Cronometer's weekly export; a day counts as "logged" when `kcal > 0`):

```bash
curl "$SUPABASE_URL/rest/v1/daily_totals?day=gte.2026-07-01&day=lte.2026-07-07" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Accept-Profile: nutri" \
  -H "Accept: text/csv"
```

### A day's entries with each food

```bash
curl "$SUPABASE_URL/rest/v1/entry_nutrients?day=eq.2026-07-07&order=created_at" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Accept-Profile: nutri"
```

### Logging in a single call (for agents)

`rpc/log_entry` looks up the food or recipe by name (case-insensitive), creates the label if it doesn't exist, and inserts the entry:

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/log_entry" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" \
  -H "Content-Type: application/json" \
  -d '{"p_item":"Arroz con pollo","p_grams":350,"p_label":"Cena"}'
```

If the item doesn't exist, the call responds with a clear error (`item no encontrado: <name>`).

**Recommended flow for a photo agent:** search `GET /foods?name=ilike.*X*` → if it doesn't exist, `POST /foods` to create it → `POST /rpc/log_entry` to log it.

### Corrections from scripts

```bash
# fix an entry's grams
curl -X PATCH "$SUPABASE_URL/rest/v1/entries?id=eq.<uuid>" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" \
  -H "Content-Type: application/json" \
  -d '{"grams": 200}'

# delete an entry
curl -X DELETE "$SUPABASE_URL/rest/v1/entries?id=eq.<uuid>" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri"
```

RLS prevents touching another user's entries (fails silently: 0 rows affected). The API covers full read and write of every `nutri` table (`foods`, `recipes`, `recipe_items`, `meal_labels`, `entries`, `targets`), subject to the same RLS policies.

### Filter syntax (PostgREST)

Basic operators on any column: `eq.` `gte.` `lte.` `ilike.`. Query modifiers: `order=`, `limit=`, `select=`. Example: `?name=ilike.*pollo*&order=created_at.desc&limit=10&select=id,name`.

## Playbooks for agents (AI via API)

Claude (or another AI) operates with the user's credentials via the password grant above — RLS applies by itself, so an agent can only write what its user could. The valid keys of the `micros` jsonb are exactly those in `MICROS` in `src/lib/domain.js` (38 keys; values **per 100 g**, always): the basics `grasa_sat_g, grasa_trans_g, azucar_g, azucar_anadido_g, fibra_g, sodio_mg, potasio_mg, magnesio_mg, calcio_mg, hierro_mg, agua_ml, alcohol_g` plus cholesterol, vitamins (`vit_a_mcg … vit_b12_mcg, colina_mg`), minerals (`zinc_mg, fosforo_mg, selenio_mcg, cobre_mg, manganeso_mg, yodo_mcg, cromo_mcg, molibdeno_mcg`) and antioxidants (`beta_caroteno_mcg, licopeno_mcg, luteina_zeaxantina_mcg`) — check the file for the exact list with units.

Extra `foods` fields: `portions` (jsonb `[{"name":"vaso","grams":247}]`, amount chips when logging) and `density_g_ml` (numeric, liquids only: the UI lets you enter ml and converts it to grams). kcal↔macros consistency audit: a food "needs review" when `|kcal − (4·protein_g + 4·carbs_g + 9·fat_g + 7·alcohol_g)| > max(20, 25 %)` — same criterion as `kcalSuspicious` in `domain.js`; an agent can audit the catalog with a simple `GET /rest/v1/foods` and that formula.

### Bulk-import foods

`POST /rest/v1/foods` accepts an array:

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

### Bulk-import body measurements

`POST /rest/v1/body_metrics` accepts an array; one row per day. `metrics` is a jsonb with the keys of `BODY_METRICS` in `src/lib/domain.js` (`peso_kg, grasa_pct, musculo_kg, agua_pct, hueso_kg, grasa_visceral, metabolismo_basal_kcal, cintura_cm, cadera_cm, pecho_cm, cuello_cm, brazo_cm, muslo_cm, pantorrilla_cm`). RLS sets `owner` by itself.

```bash
curl -X POST "$SUPABASE_URL/rest/v1/body_metrics" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" -H "Content-Type: application/json" \
  -d '[
    {"day":"2026-07-07","metrics":{"peso_kg":80.5,"grasa_pct":22,"cintura_cm":86}},
    {"day":"2026-07-08","metrics":{"peso_kg":80.2},"note":"post-entreno"}
  ]'
```

**The mode is set in the call** via the `Prefer` header (there's a `unique(owner, day)`):

- **Replace a day that already exists:** `-H "Prefer: resolution=merge-duplicates"` with `?on_conflict=owner,day` — replaces the whole row (that day's `metrics` is replaced by the payload's).
- **New days only (don't touch existing ones):** `-H "Prefer: resolution=ignore-duplicates"` with `?on_conflict=owner,day`.
- **No `Prefer`:** inserts; a day that already exists returns 409.

```bash
# Replace colliding days
curl -X POST "$SUPABASE_URL/rest/v1/body_metrics?on_conflict=owner,day" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d '[{"day":"2026-07-07","metrics":{"peso_kg":80.4}}]'
```

Note: PostgREST's upsert replaces the whole day's `metrics`. Per-measurement "merging" (keeping the previous keys and only adding/overwriting the new ones) is a UI convenience (**Body** tab → Import); via API, to merge, read the day (`GET`), combine the jsonb and re-send it with `merge-duplicates`.

### Export foods (or any table)

```bash
# Full JSON
curl "$SUPABASE_URL/rest/v1/foods?select=*&order=name" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Accept-Profile: nutri"

# CSV
curl "$SUPABASE_URL/rest/v1/foods?select=*" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H "Accept-Profile: nutri" -H "Accept: text/csv"
```

### Audit and fix foods (retroactive)

Entry nutrients are **always computed in the SQL views** (`entry_nutrients`, `daily_totals`), never copied: fixing a food retroactively updates every past entry that uses it, without touching `entries`.

```bash
curl -X PATCH "$SUPABASE_URL/rest/v1/foods?id=eq.<uuid>" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" -H "Content-Type: application/json" \
  -d '{"kcal": 218, "micros": {"fibra_g": 6.3, "sodio_mg": 45}}'
```

Only the user's own foods are editable (RLS); the other user's foods are readable but the PATCH affects 0 rows.

### Retroactive audit against USDA FDC

Foods with `source='gemini'` are estimates (not a transcribed label nor Open Food Facts) — the natural candidate to audit. For each one, compare its macros against the official FDC value:

```bash
# 1. list the foods to audit (name + stored macros)
curl "$SUPABASE_URL/rest/v1/foods?source=eq.gemini&select=id,name,kcal,protein_g,carbs_g,fat_g" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Accept-Profile: nutri"

# 2. for each name, find the closest match in FDC (use a free key from
# https://fdc.nal.usda.gov/api-key-signup or DEMO_KEY for one-off tests)
curl "https://api.nal.usda.gov/fdc/v1/foods/search?query=<name in English>&dataType=Foundation,SR%20Legacy&pageSize=1&api_key=$FDC_KEY"

# 3. detail of the chosen fdcId — foodNutrients carries the official per-100 g values
curl "https://api.nal.usda.gov/fdc/v1/food/<fdcId>?api_key=$FDC_KEY"
```

Flag as a discrepancy any macro (kcal, protein_g, carbs_g, fat_g) that differs >25 % from the FDC value (`nutrient.id` 1008/1003/1005/1004) and fix it with the PATCH from the previous section. It's a manual/agent-assisted check; there's no endpoint or script in the app.

### Configure targets and phases

A `targets` row is either recurring (`dow` 0=Sunday…6, versioned by `valid_from`) or a one-off override (`day`). A **phase** (e.g. a mini bulk from Aug 1 to Sep 15) is two weeks: the phase week with `valid_from` = start and `label` = name, and a **restoration** week with `valid_from` = end+1 (a copy of the previous week):

```bash
# phase week (7 rows, one per dow; null = no target for that field)
curl -X POST "$SUPABASE_URL/rest/v1/targets" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" -H "Content-Type: application/json" \
  -d '[
    {"dow":0,"valid_from":"2026-08-01","label":"Mini bulk","kcal":3000,"protein_g":180},
    {"dow":1,"valid_from":"2026-08-01","label":"Mini bulk","kcal":3200,"protein_g":180}
  ]'
# … + the restoration week with valid_from 2026-09-16 (no label, or the name of the phase that follows)

# override for a specific date
curl -X POST "$SUPABASE_URL/rest/v1/targets" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H "Content-Profile: nutri" -H "Content-Type: application/json" \
  -d '{"day":"2026-08-15","kcal":2200}'
```

Resolution for a date F: `day=F` if it exists; otherwise the `dow=weekday(F)` row with the greatest `valid_from ≤ F`. The water target is the target's `agua_ml` micro. All of this is also editable from the UI (Targets tab → Versions and phases).

### Evaluate intake over a period

```bash
# per-day totals (macros + micros summed)
curl "$SUPABASE_URL/rest/v1/daily_totals?day=gte.2026-06-01&day=lte.2026-06-30&order=day" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Accept-Profile: nutri"

# detail of a day (each entry with computed nutrients and meal label)
curl "$SUPABASE_URL/rest/v1/entry_nutrients?day=eq.2026-06-15&order=created_at" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT" -H "Accept-Profile: nutri"
```

With that and the period's `targets`, the agent can compute adherence (the app uses: kcal as a target ±5 %/±15 %, protein as a floor) or apply its own metrics and draw conclusions. Semantics of "logged day": `kcal > 0` in `daily_totals`. Water lives as entries of the "Agua" food (`micros.agua_ml`, grams = ml).

## Free tier — maintenance

Two GitHub Actions keep Supabase's free tier alive with no manual intervention:

- `.github/workflows/keepalive.yml` — weekly cron that does `GET /rest/v1/` (avoids the project's automatic pause after 7 days of inactivity).
- `.github/workflows/backup.yml` — monthly cron that runs `pg_dump`, encrypts the result with GPG (symmetric AES256) and uploads ONLY `backup.sql.gpg` as a workflow artifact (90-day retention; the free tier includes no backups). The repo is public — the dump includes `auth.users` (emails, hashes), which is why it never uploads unencrypted.

Configure under the repo's **Settings → Secrets and variables → Actions**:

- `SUPABASE_URL` — the Project URL (used by keepalive).
- `ANON_KEY` — the anon/publishable key (used by keepalive).
- `SUPABASE_DB_URL` — the Postgres connection string **for the Session Pooler**, with password (the **Connect** button on the project dashboard → *Session pooler* tab → reveal the password). Don't use the direct connection (`db.<ref>.supabase.co`): it resolves to IPv6 only and GitHub Actions runners have no IPv6 egress, so the workflow fails with "Network is unreachable".
- `BACKUP_PASSPHRASE` — symmetric passphrase to encrypt/decrypt the monthly backup.

To decrypt a downloaded backup:

```
gpg --batch --decrypt --passphrase "..." backup.sql.gpg > backup.sql
```

### AI-assisted data (F6)

Under **Foods → New food** there's a "Datos con IA" (AI data) module: describe the food, type a barcode (EAN) or attach a photo (nutrition label or dish). Hierarchy: legible label in the photo → it's transcribed (not estimated); if not, EAN (typed or read from the photo) → Open Food Facts; if not, a USDA-style estimate prioritizing Mexico, with up to 3 match chips from USDA FoodData Central for generic unbranded foods. Always review before saving. Requires `VITE_GEMINI_KEY` in `.env` (a free key from [Google AI Studio](https://aistudio.google.com/apikey), free tier with no billing) and the same variable in Vercel → Environment Variables; without the key the module isn't shown. The USDA chips additionally require `VITE_FDC_KEY` (a free key from [FDC](https://fdc.nal.usda.gov/api-key-signup)); without it, they simply don't appear. Both keys are visible in the client bundle: use keys with no billing attached.

## Out of scope

Body weight, bioimpedance, measurements, sleep and training (Notion/Hevy). TypeScript, E2E tests, i18n, light mode, public sign-up, self-service password recovery, camera scanner, edge functions, custom domain for the API.
