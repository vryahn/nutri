# nutri. (Nutrimetry)

A precision-first nutrition-tracking PWA — think Cronometer, rebuilt small and exact. React SPA on Vercel, Supabase (Postgres + Auth + PostgREST) as the entire backend, Row Level Security as the only authorization layer. In production at [nutri.vryahn.com](https://nutri.vryahn.com), used daily by two real users.

The core design commitment: **stored nutritional data is never allowed to drift or degrade.** Every trade-off in the codebase — UX, speed, scope — resolves in favor of data accuracy. Questionable values get flagged (⚠), never silently saved.

## Why this codebase is worth a look

- **Nutrients are computed, never copied.** Entries store only `(food, grams)`; SQL views derive every nutrient at read time. Fixing a food retroactively corrects all history for free — there is no denormalized data to backfill, ever.
- **No app server.** The client talks to PostgREST directly; RLS policies are the sole authorization layer. The only server-side code is a stateless MCP endpoint (one Vercel function) that also delegates all authorization to RLS.
- **AI with a regression gate.** LLM-based nutrition extraction (Gemini → Mistral fallback cascade) is guarded by a scored golden-set eval (`npm run eval`) with a committed baseline; prompt or model changes that degrade extraction quality block the push.
- **Agent-friendly by design.** A remote MCP server with OAuth, plus documented curl playbooks, let an AI assistant log meals, audit the food catalog, and evaluate intake — with the exact same RLS guarantees as the app.

## Feature highlights

- Daily food log with meal sections, drag-to-reorder, per-meal templates, and a frequency-ranked quick-add (30-day window, portion size chosen by mode — validated by backtest against real logs).
- Custom food catalog: values per 100 g, custom portions, density-aware g/ml entry for liquids, plausibility warnings, semantic search (pgvector).
- Recipes with cooked-weight math: per-100 g values derive from ingredients via a SQL view, mirrored by a pure JS function with a canonical test case.
- Nutrition targets with weekly recurrence, versioned phases (bulk/cut/maintenance), and single-day overrides; deterministic date-resolution rule shared by all consumers.
- Dashboard: adherence, trends, top foods, phase-aware ranges, CSV export, and a RAG-based "ask your log" natural-language query flow.
- Body measurements (weight, composition, circumferences) with progress photos in a private storage bucket.
- 108-micronutrient panel (Cronometer parity plus market-specific sweeteners tracked for medical reasons), water tracking, hard-coded sodium safety floor.
- Bilingual (es/en), dark/light/system themes, installable PWA, 375 px-first responsive layout.

## Architecture

```
Browser (React SPA, static)  ──►  Supabase PostgREST  ──►  Postgres 17, schema `nutri` (RLS)
        │                                                    ▲
        └──►  /api/mcp (Vercel function, stateless MCP)  ────┘  (same RLS, user's own JWT)
```

### Client

React 18 + Vite, JavaScript (JSX) — no TypeScript, by explicit decision: the project optimizes for a small, flat, auditable codebase (one file per page, shared logic only in `src/lib/`, components extracted only when used twice or more). Tailwind for styling with all color/typography flowing through CSS tokens in `src/index.css` (two themes, every text/background pair ≥ 4.5:1 contrast). `vite-plugin-pwa` for installability and offline shell. Recharts for charts, `@dnd-kit` for drag-to-reorder. Production error monitoring via Sentry (errors only, initialized only in the production build).

### Database (schema `nutri`)

- **Tables:** `foods`, `recipes`, `recipe_items`, `meal_labels`, `entries`, `targets`, `prefs`, `body_metrics`. Initial schema in [`supabase/migration.sql`](supabase/migration.sql); 21 incremental migrations in [`supabase/migrations/`](supabase/migrations/) (all applied in production).
- **Views** (all `security_invoker = true`, so RLS applies through them): `entry_nutrients` (each entry with computed nutrients), `daily_totals` (per-day sums), `recipe_per_100g` (recipe values derived from ingredients and cooked weight).
- **Micros as closed-vocabulary jsonb:** the `micros` column accepts exactly the 108 keys defined in `MICROS` (`src/lib/domain.js`). The views sum the jsonb generically with `jsonb_each_text`, so adding a micronutrient key requires no migration.
- **RPCs:** `log_entry` (one-call logging by id or name, creates the meal label on demand), `match_foods` (pgvector cosine search over food embeddings).

### RLS model

Everything is private per user (`owner = auth.uid()` on both read and write; `recipe_items` via its recipe's owner) — with one deliberate exception: a shared base catalog of 144 USDA foods (`owner IS NULL`) readable by all users, added in migration 015. `entries`, `meal_labels`, `targets`, `prefs`, and `body_metrics` are 100 % private. Progress photos live in a private storage bucket (`body-photos`) with per-user path-prefix policies. The Supabase `service_role` key is not used anywhere in the project.

### MCP server (`api/mcp.js`)

A remote MCP server at `https://nutri.vryahn.com/api/mcp` — Streamable HTTP, stateless, running as a single Vercel serverless function. Auth is OAuth via Supabase Auth: clients discover the flow from the `WWW-Authenticate` header (`/.well-known/oauth-protected-resource`, served by `api/well-known.js`), and the user approves access on an in-app consent page (`/oauth/consent`). JWTs are verified against Supabase's JWKS (via `jose`); the verified token is then used as the Supabase client's bearer, so **RLS is the only authorization layer** — the connector can only touch the authenticated user's data.

Ten tools: `search_catalog`, `log_entry`, `delete_entry`, `get_day`, `get_targets`, `create_food` (per 100 g, hard-validates micro keys, emits the same soft ⚠ warnings as the app), `create_recipe`, `update_food` (own food → update; base-catalog food → fork to an owned copy), `log_measurement`, `get_measurements`. Deleting foods and editing recipes are app-only by design. The pure logic (validators, warnings, fork-vs-update decision, recipe math) lives in `src/lib/mcp.js` and is unit-tested; `api/mcp.js` is transport + I/O.

## Data integrity

The rules that keep the numbers trustworthy:

- **Per-100 g canonical storage.** Every nutritional value is stored per 100 g; every quantity is stored in grams. Unit conversion (ml → g) always requires an explicit density — never an assumed 1.0. If a food is being entered in ml and has no density, saving is blocked, not fudged.
- **Computed, not copied.** Entry nutrients always come from the SQL views. `computeRecipePer100g` in `domain.js` replicates the `recipe_per_100g` view exactly, with a canonical verification case (100 g of A + 200 g of B at 250 g cooked weight ⇒ per 100 g = (A + 2B) / 2.5) enforced in tests.
- **Atwater kcal validation.** `kcalFromMacros` computes expected kcal as `4·protein + 4·carbs + 9·fat + 7·alcohol − 2·fiber` (fiber at 2 kcal/g per NOM-051/EU labeling rules, since `carbs_g` is total carbohydrate), with a −1.6 kcal/g correction for sugar alcohols. `kcalSuspicious` flags a food when its stored kcal deviates from that by more than `max(20 kcal, 25 %)`. The flag is computed on the fly and never persisted — so tightening the criterion retroactively re-audits the whole catalog at zero cost.
- **Plausibility checks.** `macrosImplausible` (macros + alcohol + water > 105 g per 100 g, any macro > 100 g, or any micro above its `MICRO_MAX` cap) and `componentsInconsistent` (compositional inequalities: sat + trans fat ≤ total fat, sugar ≤ carbs, added sugar ≤ sugar, fiber ≤ carbs, each with 0.5 g slack) surface non-blocking ⚠ warnings in both the food list and the form.
- **High-intensity sweeteners and trace micros are never estimated** — they are filled only from declared or published data. Open Food Facts `additives_tags` only warn of presence (amounts are almost never declared).
- **Soft-delete where hard-delete would corrupt history.** Meal labels are archived (`archived_at`), never deleted: the FK on `entries.meal_label_id` is `ON DELETE SET NULL`, so a real delete would rewrite historical entries. Recreating a label with an archived name revives it, restoring its entries to their section.
- **A hard-coded medical safety rule:** the red badge for sodium below 1,500 mg/day (`SODIUM_FLOOR_MG`) is not removable or configurable.

## AI integration

All AI features are optional (gated by env keys) and none of them can write bad data silently — everything lands in a form the user reviews.

### Structured extraction with a fallback cascade

"Datos con IA" in the food form accepts a text description, an EAN barcode, or a photo (nutrition label or dish). The source hierarchy is strict:

1. **Legible nutrition label in the photo → transcription, not estimation** (`mode: 'etiqueta'`).
2. **EAN (typed or read from the photo) → Open Food Facts**, but only after the barcode passes GS1 check-digit validation (typed EANs that fail block with an error; Gemini-read EANs that fail are silently discarded).
3. **Otherwise → USDA-style estimation** prioritizing Mexican market data (`mode: 'estimacion'`), with up to 6 tappable match chips from USDA FoodData Central for generic unbranded foods.

Requests use Gemini's `response_schema` for structured per-100 g JSON output, and photos are canvas-compressed to 1024 px before inline upload. The model cascade (`AI_CHAIN` in `src/lib/ai.js`) falls through on *any* error: `gemini-3.5-flash` → `gemini-2.5-flash` → `mistral-small-latest` (OpenAI-compatible endpoint; the Gemini-style schema is translated to strict JSON Schema by `toJsonSchema`).

Results are merged by confidence: a transcribed label wins over Open Food Facts (which only fills gaps); OFF wins over a Gemini estimate when there is a barcode match; Gemini fills only what remains. Seven fields (kcal, protein, carbs, fat, sodium, potassium, magnesium) always get a best estimate — everything else is filled only from reliable data or left null; a returned 0 never fills an input. When a transcribed label *and* an OFF match both exist, numeric fields are cross-checked and discrepancies > 25 % (minimum 5 units on both sides) produce an ephemeral warning.

### Semantic catalog search

`foods.embedding vector(768)` (migration 017, pgvector) holds L2-normalized `gemini-embedding-001` embeddings of `name + brand`, generated fire-and-forget on save. Search is hybrid: `ilike` first; if it returns fewer than 8 hits, results are topped up via the `match_foods` RPC (cosine distance, 0.65 cutoff) and merged in `domain.js`. Foods without embeddings (created via REST/MCP) still surface through `ilike` — the feature degrades, never breaks.

### RAG: "ask your log"

The Dashboard's ask flow is a three-step structured RAG pipeline in `src/lib/ai.js`: a **planner** call produces a typed query plan (date range, nutrients, detail level — sanitized by `sanitizeAskPlan`, range capped at 92 days) → the app fetches real data from `daily_totals` / `entry_nutrients` plus resolved targets → an **answer** call receives that context as compact CSV (entries capped at 400 by kcal) and must cite only figures from it, referencing specific days and foods, and never prescribing. Chat history lives only in the sheet's memory.

### Scored evals

`npm run eval` runs a golden set (7 cases: label transcriptions and estimates, ground truth from USDA FDC — never from model memory) through the real extraction path and scores per-field against tolerances (transcription: `max(2 %, 0.5 u)`; estimation: ±30 % macros / ±40 % micros). Any regression against the committed `baseline.json` — a previously passing case/field failing, or micro-hallucination counts growing past `1.5× + 3` — fails the suite. The model is pinned at `temperature: 0` for determinism, one baseline per model (the Mistral tail of the cascade has its own). Evals never run in CI (quota cost + nondeterminism); the scoring logic itself *is* CI-tested without network (`score.test.js`). Baseline updates are deliberate (`UPDATE_BASELINE=1 npm run eval`) and each one is committed with its rationale.

## Internationalization

Spanish-first by design, with a deliberately minimal mechanism (`src/lib/i18n.js`): **the Spanish source string is the translation key.** The English dictionary maps Spanish strings to English; a missing translation falls back to the Spanish source. This means a missing key can never render `undefined` or an empty label — the worst case is the product's native language. Interpolation uses literal `%n`/`%s` markers replaced by the caller after `t()`. Language and unit preferences live in a `RegionSheet`, per user.

## Domain language

A documented engineering decision, not an accident: **the domain vocabulary is Spanish; the infrastructure vocabulary is English.**

- Spanish: jsonb domain keys (`sodio_mg`, `potasio_mg`, `peso_kg`, `cintura_cm`), UI strings, meal labels. The product serves Spanish-speaking users, and the jsonb keys form a closed vocabulary (`MICROS`, `BODY_METRICS` in `src/lib/domain.js`) that users and agents see directly in API payloads — matching the users' language makes payloads self-explanatory to the people auditing their own data.
- English: schema and table names (`foods`, `entries`, `daily_totals`), column names (`kcal`, `protein_g`, `valid_from`), views, RPC names, and the REST/MCP API surface — matching the conventions of the tooling ecosystem.

The boundary is stable and consistent: anything that is *data about food or the body* speaks Spanish; anything that is *structure* speaks English.

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

`rpc/log_entry` looks up the food or recipe by name (case-insensitive) — or takes an explicit `p_food_id`/`p_recipe_id` — creates the label if it doesn't exist, and inserts the entry:

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

### MCP connector (remote server with OAuth)

The app exposes a remote MCP server at `https://nutri.vryahn.com/api/mcp` (Streamable HTTP, stateless). Auth is OAuth via Supabase Auth: MCP clients discover the flow from the `WWW-Authenticate` header (`/.well-known/oauth-protected-resource`) and the user approves access on the in-app consent page (`/oauth/consent`). RLS is the only authorization layer — the connector can only touch the authenticated user's data. Adding a user = creating their account in the Supabase dashboard, nothing else.

Tools: `search_catalog`, `log_entry` (by id or name; water = the "Agua" food, grams = ml), `delete_entry`, `get_day`, `get_targets`, `create_food` (per 100 g, hard-validates micro keys, soft warnings ⚠ same as the app), `create_recipe`, `update_food` (own food → update; base-catalog food → fork to own copy), `log_measurement`, `get_measurements`. Deleting foods and editing recipes are app-only by design.

Claude (or another AI) can also operate with the user's credentials via the password grant above — RLS applies by itself, so an agent can only write what its user could. The valid keys of the `micros` jsonb are exactly those in `MICROS` in `src/lib/domain.js` (108 keys; values **per 100 g**, always): the basics `grasa_sat_g, grasa_trans_g, azucar_g, azucar_anadido_g, fibra_g, sodio_mg, potasio_mg, magnesio_mg, calcio_mg, hierro_mg, agua_ml, alcohol_g` plus cholesterol, vitamins, minerals, antioxidants, amino acids, and high-intensity sweeteners — check the file for the exact list with units.

Extra `foods` fields: `portions` (jsonb `[{"name":"vaso","grams":247}]`, amount chips when logging) and `density_g_ml` (numeric, liquids only: the UI lets you enter ml and converts it to grams). kcal↔macros consistency audit: a food "needs review" when its kcal deviates from the Atwater expectation (`4·protein_g + 4·carbs_g + 9·fat_g + 7·alcohol_g − 2·fibra_g`, with a −1.6 kcal/g sugar-alcohol correction) by more than `max(20, 25 %)` — same criterion as `kcalSuspicious` in `domain.js`; an agent can audit the catalog with a simple `GET /rest/v1/foods` and that formula.

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

`POST /rest/v1/body_metrics` accepts an array; one row per day. `metrics` is a jsonb whose valid keys are exactly those in `BODY_METRICS` in `src/lib/domain.js` (29 keys: `peso_kg`, `grasa_pct`, `musculo_kg`, `cintura_cm`, per-side circumferences, segmental lean/fat masses, and more — check the file for the exact list with units). RLS sets `owner` by itself.

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

Flag as a discrepancy any macro (kcal, protein_g, carbs_g, fat_g) that differs >25 % from the FDC value (`nutrient.id` 1008/1003/1005/1004; note that `Foundation` entries often lack 1008 — fall back to the Atwater factors 2048/2047, as `fetchFDC` in `src/lib/sources.js` does) and fix it with the PATCH from the previous section. It's a manual/agent-assisted check; there's no endpoint or script in the app.

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

## Local setup

One-time manual steps:

1. Create a project on [Supabase](https://supabase.com) (or use an existing one).
2. **SQL Editor** → paste the full contents of [`supabase/migration.sql`](supabase/migration.sql) → **Run**, then apply the files in [`supabase/migrations/`](supabase/migrations/) in order.
3. **Settings → API → Exposed schemas** → add `nutri`.
4. **Authentication → Sign In / Up** → **Allow new users: OFF**. Create the users by hand (email + password) from the dashboard. Password resets are done from there too (there is no self-service flow).
5. Copy the **Project URL** and the **anon key** (Settings → API) into a `.env` file at the project root:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

Then `npm ci && npm run dev`. `.env` is in `.gitignore`. Never use the `service_role` key in the frontend.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | yes | anon/publishable key |
| `VITE_GEMINI_KEY` | no | enables "Datos con IA", semantic search, and "ask your log" ([Google AI Studio](https://aistudio.google.com/apikey) free tier, no billing); without it those modules are hidden |
| `VITE_MISTRAL_KEY` | no | enables the Mistral tail of the AI fallback cascade; skipped if absent |
| `VITE_FDC_KEY` | no | enables USDA FoodData Central match chips ([free key](https://fdc.nal.usda.gov/api-key-signup)); without it they simply don't appear |
| `VITE_SENTRY_DSN` | no | production-only error monitoring ([Sentry](https://sentry.io), platform: React); dev stays silent |

The AI keys are client-side and visible in the bundle — a deliberate, documented trade-off: use free-tier keys with **no billing attached**, so the worst case is quota exhaustion, not a bill. The Sentry DSN is publishable by design. To use any of these in production, set the same variables in Vercel → Environment Variables.

## Testing and quality

- **147 unit tests** (`npm test`, Vitest) across 7 suites: domain math (targets resolution, recipe formula, adherence, plausibility checks), source mappers (OFF/FDC normalization), AI plumbing (schema translation, plan sanitizing), bulk importer, derived body metrics, MCP server logic, and eval scoring. The canonical recipe case and the "150 g of a food = 1.5× its per-100 g values" invariant are encoded as tests.
- **Scored AI evals** (`npm run eval`) as described above — a deliberate before/after gate for prompt or model changes, never a CI step.
- **Lint** (`npm run lint`, ESLint) and a clean `npm run build` are required before any commit; label photos for evals are local-only (the repo is public), and the runner skips cases whose photo is missing so a fresh clone stays green.

## CI/CD and operations

Push to `main` = automatic production deploy on Vercel. There is no staging environment; verification happens locally before pushing. Hardened response headers (CSP with an explicit `connect-src` allowlist, `frame-ancestors 'none'`, `nosniff`, referrer and permissions policies) are set in [`vercel.json`](vercel.json).

Three GitHub Actions (secrets under **Settings → Secrets and variables → Actions**):

- [`ci.yml`](.github/workflows/ci.yml) — lint + test + build on every push to `main`.
- [`keepalive.yml`](.github/workflows/keepalive.yml) — weekly cron that does `GET /rest/v1/` (avoids the free tier's automatic pause after 7 days of inactivity). It deliberately accepts non-2xx responses: with Supabase's new publishable keys the REST root returns 401, but that still counts as activity.
- [`backup.yml`](.github/workflows/backup.yml) — monthly cron that runs `pg_dump` (installs the Postgres 17 client from PGDG, since the server runs PG 17 and Ubuntu ships pg_dump 16), encrypts the result with GPG (symmetric AES256) and uploads ONLY `backup.sql.gpg` as a workflow artifact (90-day retention; the free tier includes no backups). The repo is public and the dump includes `auth.users` (emails, password hashes) — which is why it never uploads unencrypted. Note: Storage (the `body-photos` bucket) is not covered by `pg_dump`.

Secrets: `SUPABASE_URL` and `ANON_KEY` (keepalive), `BACKUP_PASSPHRASE` (backup encryption), and `SUPABASE_DB_URL` — the Postgres connection string **for the Session Pooler** (dashboard **Connect** button → *Session pooler* tab). Don't use the direct connection (`db.<ref>.supabase.co`): it resolves to IPv6 only and GitHub Actions runners have no IPv6 egress, so the workflow fails with "Network is unreachable".

To decrypt a downloaded backup:

```
gpg --batch --decrypt --passphrase "..." backup.sql.gpg > backup.sql
```

## Deliberate non-goals

Sleep and training tracking (they live in other tools). TypeScript, E2E tests, public sign-up, self-service password recovery, camera barcode scanner, edge functions. Scope discipline is part of the design: the app stays small enough for one person to audit end to end.
