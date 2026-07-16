# Conector MCP de Nutrimetry

Servidor MCP (Model Context Protocol) remoto que deja a una IA a elección del
usuario (Claude en claude.ai/web/móvil, Claude Code, u otro cliente MCP)
registrar y consultar su nutrición por lenguaje natural. Desplegado en el mismo
proyecto Vercel que la app; costo $0.

- **Endpoint:** `https://nutri.vryahn.com/api/mcp` (Streamable HTTP, stateless)
- **Auth:** OAuth 2.1 contra Supabase Auth (PKCE + dynamic client registration)
- **Aislamiento de datos:** RLS es la ÚNICA capa de autorización — el conector
  solo toca la data del usuario autenticado + el catálogo base compartido
  (owner NULL) en lectura. Nunca usa `service_role`.

## Arquitectura

```
api/mcp.js            # function Vercel: transporte MCP + verificación JWT + I/O a Supabase (RLS)
api/well-known.js     # OAuth Protected Resource Metadata (RFC 9728)
src/lib/mcp.js        # lógica PURA: validadores, avisos ⚠, decisión fork/update, cálculo de recetas
src/lib/mcp.test.js   # vitest de la lógica pura
src/pages/OAuthConsent.jsx  # pantalla de consentimiento (/oauth/consent)
vercel.json           # rewrites de /.well-known/* → /api/well-known (antes del catch-all SPA)
supabase/migrations/016_log_entry_by_id.sql  # log_entry acepta ids explícitos
```

Dependencias nuevas (solo en `api/`, no entran al bundle de la app):
`@modelcontextprotocol/sdk`, `jose` (verificación JWT vía JWKS), `zod` (schemas).

La lógica de dominio NO se duplica: `src/lib/mcp.js` reusa `domain.js`
(`MICROS`, `kcalFromMacros`, `kcalSuspicious`, `macrosImplausible`,
`componentsInconsistent`, `computeRecipePer100g`, `resolveTarget`) — los mismos
criterios que la UI. `api/mcp.js` queda delgado: transporte, auth e I/O.

## Flujo de autenticación (OAuth 2.1 de Supabase Auth)

1. El cliente MCP hace `POST /api/mcp` sin token → `api/mcp.js` responde **401**
   con `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.
2. El cliente lee ese metadata (`api/well-known.js`), que apunta al
   authorization server: `https://shzoiqbahfmfszjsrkzy.supabase.co/auth/v1`.
3. Discovery de Supabase (`/.well-known/oauth-authorization-server`) +
   dynamic client registration → el cliente se auto-registra.
4. Supabase redirige al usuario a **`/oauth/consent`** (Site URL + authorization
   path); ahí inicia sesión con sus credenciales de la app y aprueba/deniega
   (`supabase.auth.oauth.getAuthorizationDetails / approveAuthorization /
   denyAuthorization`).
5. Supabase emite access + refresh token (rotación automática).
6. Cada `POST /api/mcp` trae `Authorization: Bearer <JWT>`. `api/mcp.js` lo
   verifica con `jose` (`createRemoteJWKSet` sobre el JWKS de Supabase; issuer
   `…/auth/v1`, audience `authenticated`, alg ES256) y extrae el `sub` (uid).
7. Crea el cliente supabase-js con la publishable key + ese JWT en el header
   `Authorization` → **RLS aplica como ese usuario**. El uid solo se usa para
   marcar `owner` en escrituras y calcular `is_mine`.

No hay tokens estáticos ni passwords en variables de entorno: el alta de un
usuario nuevo es solo crear su cuenta en el dashboard de Supabase.

## Tools (8)

Todos los valores nutricionales son **por 100 g**; las cantidades registradas
SIEMPRE en gramos. Los micros usan las claves EXACTAS de `MICROS` en `domain.js`.

| Tool | Tipo | Contrato |
|------|------|----------|
| `search_catalog(query, limit=10)` | lectura | Busca `foods` y `recipes` por nombre/marca (ilike). Devuelve `type`, `id`, `name`, `brand`, macros/100 g, `portions`, `density_g_ml`, `source`, `is_mine`. RLS decide visibilidad. |
| `get_day(day?)` | lectura | Totales del día (`daily_totals`) + registros (`entry_nutrients`) con etiqueta y nombre. Default hoy; `logged:false` si vacío. |
| `get_targets(day?)` | lectura | Objetivo resuelto para la fecha (día específico o fase dow vigente vía `resolveTarget`), con `label`/`goal`. |
| `log_entry({food_id?/recipe_id?/item?, grams, label?, day?})` | escritura | Registra un consumo vía RPC `log_entry`. Prioridad `food_id` > `recipe_id` > `item` (nombre, fallback, puede enganchar homónimo). Agua = food "Agua", `grams` = ml. |
| `delete_entry(entry_id)` | escritura | Borra un registro (RLS limita a propios). `deleted:false` si no existe. |
| `create_food({name, protein_g, carbs_g, fat_g, kcal?, brand?, micros?, portions?, density_g_ml?})` | escritura | Crea alimento propio. `source:'ia_personal'`. |
| `create_recipe({name, cooked_weight_g, items:[{food_id,grams}], portions?})` | escritura | Crea receta desde ingredientes del catálogo. `source:'ia_personal'`. Devuelve valores/100 g calculados. |
| `update_food(food_id, campos parciales)` | escritura | Edita en sitio (propio) o forkea (ajeno/base). Ver reglas abajo. |

### Prohibido vía MCP (por diseño)

No hay `delete_food` ni `delete_recipe`, ni edición de recetas — eso se hace en
la app (ahí viven `reviewed_at`, el `UndoToast` y la validación del FoodForm).
**Consecuencia operativa:** un `create_food`/`create_recipe` NO es reversible
solo con el conector; para limpiar hay que ir a la DB (Supabase). `log_entry` sí
es un round-trip limpio con `delete_entry`.

## Reglas de datos (precisión = prioridad núcleo)

- **Fuente `ia_personal`:** todo lo creado por MCP (`create_food`,
  `create_recipe`) nace con `source:'ia_personal'`. El filtrado por `source` del
  catálogo puede excluirlo del base compartido (calidad = responsabilidad del
  dueño).
- **Validación DURA (bloquea, error MCP, no guarda):** claves de micros fuera de
  `MICROS` (el error lista las válidas), números no finitos o < 0, `portions`
  con shape inválido (`{name, grams>0}`), `density_g_ml ≤ 0`.
- **Avisos SUAVES (guardan SIEMPRE + `warnings[]` en la respuesta):** los mismos
  ⚠ de la UI — `kcalSuspicious` (kcal vs Atwater), `macrosImplausible` (valores
  altos para 100 g), `componentsInconsistent`. La app los pinta igual porque se
  recalculan al vuelo en las vistas SQL; nada se guarda "limpio en silencio".
- **kcal ausente:** se calcula por Atwater desde los macros (`kcalFromMacros`),
  igual que el placeholder del FoodForm.
- **`update_food` — decisión fork/update (`decideUpdatePath`):**
  - Food propio, se tocan SOLO `portions` → update en sitio, `source` NO cambia.
  - Food propio, cualquier otro campo → update en sitio, `source:'ia_personal'`,
    `reviewed_at:null`.
  - Food ajeno o del catálogo base (owner NULL) → **fork**: inserta una copia
    propia con los cambios, `source:'ia_personal'`; el original queda intacto.
    Respuesta con `forked:true` + id nuevo.

## Migración 016 (`log_entry_by_id`)

`log_entry` ganó parámetros opcionales `p_food_id` / `p_recipe_id`. Motivo: con
el catálogo compartido, el match por `lower(name) limit 1` podía enganchar un
food ajeno homónimo en silencio. Prioridad `p_food_id` > `p_recipe_id` > `p_item`;
el lookup por nombre ahora prefiere lo propio (`order by (owner = auth.uid())
desc`). Se hizo DROP + CREATE (no `or replace`) porque un overload dejaría a
PostgREST sin resolver la llamada REST. Conserva `security invoker` y
`search_path=''`.

## Configuración

### Supabase (una vez)

Dashboard → **Authentication → OAuth Server**:
- Enable OAuth 2.1 server (beta, gratis).
- **Authorization Path:** `/oauth/consent`.
- **Dynamic client registration: ON** (claude.ai lo necesita).

Dashboard → **Authentication → URL Configuration**:
- **Site URL:** `https://nutri.vryahn.com` (la raíz de la app, NO el endpoint del
  MCP). Supabase arma la URL de consentimiento como `Site URL + Authorization
  Path`; si el Site URL apunta a `/api/mcp`, el consent resuelve a una ruta
  inexistente y además rompe los redirects normales de auth.

### Cliente MCP (cada usuario, una vez)

- **claude.ai (web/móvil):** Ajustes → Conectores → Add custom connector → URL
  `https://nutri.vryahn.com/api/mcp` (sin OAuth manual: se descubre solo).
  Requiere plan de pago de claude.ai.
- **Claude Code:** `claude mcp add --transport http nutrimetry https://nutri.vryahn.com/api/mcp`.
- **Otros clientes:** misma URL donde configuren conectores MCP remotos.

### Alta de un usuario nuevo

Solo crear su cuenta en el dashboard de Supabase (Authentication → Users;
sign-up público sigue OFF). Nada de tokens, env vars ni redeploys. Él agrega el
conector y en el primer uso lo manda a `/oauth/consent` a iniciar sesión y
aprobar.

## Deploy

Push a `main` = deploy a Vercel. En Vercel, filesystem/functions resuelven antes
que los rewrites, así que `/api/*` y `/.well-known/oauth-protected-resource`
funcionan pese al catch-all SPA. La CSP y los headers de `vercel.json` no
estorban a las respuestas JSON.

## Verificación en producción

```sh
# Metadata OAuth (debe dar 200 con JSON del resource server)
curl -s https://nutri.vryahn.com/.well-known/oauth-protected-resource

# MCP sin token (debe dar 401 con WWW-Authenticate)
curl -si -X POST https://nutri.vryahn.com/api/mcp -H 'content-type: application/json' -d '{}'

# La app sigue sirviendo (200)
curl -so /dev/null -w '%{http_code}\n' https://nutri.vryahn.com/
```

Batería funcional completa ejecutada contra prod (2026-07-16), cero alteración
neta: Atwater, 1.5× en macros y micros, receta canónica `(A + 2B) / 2.5`,
micro inválido bloquea, macros implausibles guardan con warning, fork deja el
base intacto, update propio en sitio.
