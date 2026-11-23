# Datos e integraciones de Nutri

[Manual de Nutri](README.md)

[README](../README.md) para instalación, ejemplos REST y flujos de agentes. [BIBLIA](../BIBLIA.md) para normas de integridad, seguridad, migraciones y mantenimiento. Para el contrato técnico, coteja el consumidor con la última migración que define el objeto. Este mapa describe el código versionado. Para saber qué versión está servida o qué migraciones están aplicadas, verifica el entorno correspondiente.

## Qué consulta y escribe cada flujo

Web, macOS y iPhone usan Supabase Auth y el esquema Postgres `nutri` por PostgREST. Para REST directo envía la clave publicable en `apikey`, el JWT del usuario en `Authorization`, `Accept-Profile: nutri` en lecturas y `Content-Profile: nutri` en escrituras y RPC por POST. El [README](../README.md#api--contract-for-external-scripts) tiene solicitudes con marcadores.

| Flujo | Lectura | Escritura y reglas |
| --- | --- | --- |
| Alimentos | `foods`, `match_foods` | Nutrientes por 100 g. `portions` guarda nombres y gramos, `density_g_ml` permite convertir volumen. Los cambios nutritivos invalidan `reviewed_at`. Si falta kcal, el formulario puede calcularla a partir de macros, incluida la contribución del alcohol y el ajuste de fibra de `kcalFromMacros`. El catálogo base usa `owner IS NULL` y se copia al personalizarlo. |
| Recetas | `recipes`, `recipe_items`, `recipe_per_100g` | Web y nativos guardan cabecera e ingredientes en `save_recipe_atomic`. Los gramos de las líneas con el mismo alimento se agrupan antes de calcular y guardar la receta. Divide la suma nutricional entre el peso cocido o la suma de pesos, y escala a 100 g. |
| Hoy | `entry_nutrients`, `meal_labels`, `prefs`, `targets` | `entries` exige gramos positivos y exactamente uno de `food_id` y `recipe_id`. `log_entry` registra desde MCP y scripts. La cola local reintenta escrituras individuales de `entries` con el UUID original y las limita al propietario. Copias de comidas y reordenamientos web se escriben en línea. |
| Dashboard y bitácora | `daily_totals`, `entry_nutrients`, `targets`, `body_metrics` | Las vistas escalan cada entrada por gramos / 100 y agregan por dueño y día. Los resultados derivan del catálogo actual. Corregir un alimento o receta puede recalcular días históricos. |
| Objetivos | `targets`; las reglas consultan también `body_metrics` y `daily_totals` | `replace_phase_atomic` reemplaza las siete filas semanales en una transacción. El Asistente guarda la fase y sus excepciones mediante `save_targets_wizard`. Compara las revisiones que devolvió `targets_wizard_snapshot` y revierte el lote completo si hubo cambios concurrentes. La fila `day` tiene prioridad. Si falta, se usa el día de semana (`dow=0` es domingo) de la fase con mayor `valid_from` hasta esa fecha. Sin coincidencia queda sin objetivo. |
| Medidas | `body_metrics`, bucket privado `body-photos` | Una fila por `owner,day`. `metrics` usa claves de `BODY_METRICS`, `note` guarda contexto y `photo_paths` referencia archivos de Storage. |
| Preferencias | `prefs.data` por propietario | `merge_prefs(patch)` aplica un parche de primer nivel en SQL. Conserva las claves fuera del parche. |
| Demo | Datos sintéticos del usuario anónimo | `seed_demo(lang, demo_day)` siembra con el idioma y día local del cliente. `cleanup_demo_users()` se ejecuta por cron. |

Reglas que afectan a varias rutas

- Usa las claves y unidades de `MICROS` y `BODY_METRICS` definidas en [domain.js](../src/lib/domain.js). Un cero declarado es un dato. Una clave ausente o un valor JSON `null` indica dato desconocido. Las vistas conservan la suma observada en `micros` y exponen `micros_complete` por intersección de claves conocidas entre ingredientes o entradas. Consulta ambas antes de interpretar una suma como cobertura completa. [Migración 024](../supabase/migrations/024_nutrient_coverage.sql)
- Una etiqueta se archiva con `archived_at`. Las listas de etiquetas activas filtran valores nulos en esa columna. El archivo conserva la FK de las entradas históricas. Crear de nuevo el nombre o registrarlo vía `log_entry` reactiva la etiqueta. [Migración 014](../supabase/migrations/014_meal_labels_archive.sql)
- El agua simple va en `entries` con gramos equivalentes a mililitros. Hoy la reconoce por `prefs.water_food_id` o por la firma nutricional del agua simple en registros anteriores. [domain.js](../src/lib/domain.js) · [Today.jsx](../src/pages/Today.jsx)
- `bounds` complementa el valor objetivo. Cada lado omitido usa el límite implícito. El umbral de sodio de 1,500 mg conserva su alerta cuando hay comida registrada. `rules` se evalúa en cliente y `applied_rule` deja la procedencia de una fase nueva. El plan maestro aprobado de Anthropometry gobierna los cambios de planificación y sus reglas. [domain.js](../src/lib/domain.js) · [Dependencia del plan de seguimiento](../README.md#dependencia-del-plan-de-seguimiento)
- Para `log_entry`, resuelve el ID en el catálogo. La RPC acepta `p_food_id`, luego `p_recipe_id`, luego `p_item`; un ID presente se valida bajo RLS. El nombre exacto sin distinguir mayúsculas busca primero alimentos y luego recetas. Con homónimos puede escoger el alimento base, porque `ORDER BY (owner = auth.uid()) DESC` ordena el `NULL` de esa fila primero. [Migración 016](../supabase/migrations/016_log_entry_by_id.sql) · [Orden de valores nulos en PostgreSQL](https://www.postgresql.org/docs/17/queries-order.html)

## Migraciones, permisos y almacenamiento

El [SQL inicial](../supabase/migration.sql) es la base histórica. Las [migraciones incrementales](../supabase/migrations/) contienen también correcciones y cambios de datos. Hay prefijos repetidos (`003`, `014`), así que identifica las migraciones por nombre completo y confirma su orden y aplicación en el historial del entorno. El flujo operativo, los grants, RLS y los advisors de seguridad y rendimiento se rigen por la [BIBLIA](../BIBLIA.md#32-base-de-datos-postgressupabase).

| Migraciones | Qué consultar |
| --- | --- |
| `001`–`010` | Preferencias y fases, porciones y densidad, recetas/ingredientes importados, procedencia, orden de entradas, privacidad del catálogo, marca en `entry_nutrients` y metadatos de objetivos. La 007 cambió el acceso al catálogo y remapeó datos existentes. |
| `011`–`015` | Higiene de permisos, medidas y fotos, porciones en recetas, `reviewed_at`, archivo de etiquetas, `merge_prefs` y base compartida. |
| `016`–`022` | `log_entry` por ID, embeddings, límites, sandbox demo, reglas de objetivos, `seed_demo` por idioma y luego por día local. `022` sustituye la firma de `020`. |
| `023`–`025` | Guardado atómico de recetas y fases, vistas con cobertura de micros y cuota de IA. |
| `027` | Guardado transaccional del Asistente con comparación de revisiones por propietario. |

La clave publicable identifica la app. El JWT determina el usuario para RLS. `foods` permite leer el catálogo base y los alimentos propios, y modificar los propios. `recipes` es privado y `recipe_items` hereda la propiedad de la receta. `entries`, `meal_labels`, `targets`, `body_metrics` y `prefs` aíslan por dueño. Las vistas nutricionales ejecutan con `security_invoker`. El proyecto aplica JWT del usuario y la clave publicable en los clientes y funciones Vercel. [Políticas 007](../supabase/migrations/007_catalogo_privado_por_usuario.sql) · [Higiene 011](../supabase/migrations/011_higiene_advisors.sql) · [Catálogo base 015](../supabase/migrations/015_catalogo_base_compartido.sql)

La demo crea una sesión con `signInAnonymously()` que usa el rol `authenticated` y lleva `is_anonymous`. RLS sigue aplicando por UID. El proxy de IA rechaza la demo y una política restrictiva impide que suba fotos. La pantalla pública de la app ofrece login y demo. Confirma por separado en Auth la configuración de altas y OAuth de cada entorno. [Login](../src/pages/Login.jsx) · [Migración 019](../supabase/migrations/019_demo_anon_sandbox.sql) · [Migración 022](../supabase/migrations/022_demo_local_day.sql)

Storage limita `body-photos` a 5 MiB por objeto y a JPEG, WebP o PNG. Las políticas de lectura, inserción y borrado exigen que el primer segmento del objeto sea el UID. Web sube JPEG y genera URLs firmadas de 3,600 s. Storage y la fila SQL se actualizan por separado. Ante una interrupción, coteja la referencia y el objeto antes de reintentar. El borrado físico es irreversible y la UI lo confirma. El dump de Postgres cubre las referencias SQL y los metadatos que alcance el dump, mientras que recuperar las imágenes requiere una copia de los objetos. [Migración 013](../supabase/migrations/013_body_photos.sql) · [Body.jsx](../src/pages/Body.jsx)

## Fuentes nutricionales, IA y cuota

Precedencia del formulario web de Alimentos.

1. **Etiqueta u Open Food Facts (OFF).** Un EAN escrito y válido consulta OFF. Con una foto de etiqueta, la lectura extraída tiene prioridad y OFF puede completar huecos de la misma base. Con una estimación genérica y un EAN reconocido, OFF tiene prioridad y la estimación completa macros y los micros principales faltantes cuando coincide la base. La fuente conserva los ceros existentes. OFF declara `100g` o `100ml` en `nutrition_data_per`. Para llevar 100 ml a 100 g hace falta densidad. El mapeo convierte minerales y cafeína de g a mg. Como respaldo, sodio = sal ÷ 2.5 × 1,000. Los aditivos identificados indican presencia. [Foods.jsx](../src/pages/Foods.jsx) · [sources.js](../src/lib/sources.js)
2. **USDA FoodData Central.** La búsqueda muestra coincidencias seleccionables de Foundation y SR Legacy. El detalle seleccionado rellena el formulario. El mapeo de energía prioriza los IDs 1008, 2048 y 2047, en ese orden, y convierte solo unidades reconocidas. La búsqueda o el detalle pasan por `/api/ai` con `kind: 'usda'` y `model: 'search'` o `'food'`. La traducción auxiliar de nombres usa MyMemory y puede conservar el inglés si falla. [sources.js](../src/lib/sources.js) · [api/ai.js](../api/ai.js)
3. **Estimación.** La cascada web intenta `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-2.5-flash` y `mistral-small-latest`. El proxy admite además los alias Gemini `3.7` y `3.5` para clientes cacheados. Groq conserva código auxiliar fuera de la allowlist y de la cascada. Las pruebas históricas de Qwen viven en la bitácora y los baselines. La UI usa la respuesta estructurada para rellenar un borrador, con avisos y revisión antes de guardar. El modo demo usa fixtures sin consumo de proveedor. [ai.js](../src/lib/ai.js) · [api/ai.js](../api/ai.js) · [Auditoría de modelos](../tech-logs/modelos-ia-2026-10-09.md)

**Proxy.** `POST /api/ai` valida el bearer con JWKS de Supabase, firma ES256, emisor `/auth/v1` del proyecto y audiencia `authenticated`. Rechaza cuentas anónimas. Generación y embeddings exigen el UID en `AI_USERS`; USDA admite cualquier sesión autenticada no anónima. La función limita a combinaciones de `kind` y `model` permitidas, comprueba 4,000,000 bytes de cuerpo, reclama cuota y llama al proveedor sin volcar el payload al log. El servidor dedica hasta 5 s a la reclamación y hasta 45 s al proveedor. El cliente web limita cada llamada a 45 s y cada cascada a 90 s. [api/ai.js](../api/ai.js) · [ai.js](../src/lib/ai.js)

**Cuota.** `claim_ai_quota(request_kind)` deriva el dueño de `auth.uid()`. Es `security definer` con `search_path` vacío y ejecución concedida a `authenticated`. La tabla `ai_daily_usage` tiene RLS y carece de acceso directo para los roles cliente. El contador atómico comparte 30 intentos por UID y día UTC entre Gemini y embeddings, con 15 para Mistral y 100 para USDA. Una reclamación exitosa cuenta aunque falle el proveedor. El proxy devuelve `429 quota_exceeded` al agotar cuota local y `503 quota_unavailable` si falla la reclamación, antes de llamar al proveedor. También puede devolver `413` por tamaño, `501` por clave ausente, `504` por plazo del proveedor o reproducir su estado HTTP, incluido otro `429`. El reinicio lógico ocurre al cambiar la fecha UTC. La migración 025 no programa purga del histórico de uso. [Migración 025](../supabase/migrations/025_ai_quota.sql) · [api/ai.js](../api/ai.js) · [Bitácora histórica de IA y cuota](../tech-logs/ia-2026-10-15.md)

**Búsqueda semántica.** Web empieza por texto y, si la consulta tiene al menos tres caracteres y hay menos de ocho coincidencias de alimentos, puede completar con `match_foods`. Usa `foods.embedding` de 768 dimensiones, L2 normalizado con `gemini-embedding-001`, y distancia coseno menor a 0.65 por defecto. Al guardar, web genera el vector de nombre y marca en segundo plano. Un alimento sin vector sigue encontrándose por texto. La RPC ejecuta bajo RLS. [Migración 017](../supabase/migrations/017_foods_embedding.sql) · [ai.js](../src/lib/ai.js)

**Pregúntale a tu bitácora.** Un plan estructurado delimita fechas y nutrientes. Dashboard carga `daily_totals`, objetivos resueltos y, si hace falta, `entry_nutrients`. El modelo responde con las cifras de ese contexto. El límite es 92 días y 400 entradas detalladas, priorizadas por kcal si hay que recortar. El historial del diálogo vive en memoria. [Dashboard.jsx](../src/pages/Dashboard.jsx) · [Diseño de búsqueda y RAG](../tech-logs/rag-busqueda-semantica-y-bitacora.md)

## MCP remoto

`POST /api/mcp` usa Streamable HTTP sin sesión de transporte persistente. Un `401` anuncia `resource_metadata` en `WWW-Authenticate`. `/.well-known/oauth-protected-resource` y su variante `/mcp` se reescriben a `/api/well-known`, que indica el servidor de autorización Supabase. El cliente descubre OAuth, el usuario consiente en `/oauth/consent` y el conector envía el bearer en cada POST. El servidor verifica emisor, audiencia `authenticated`, firma ES256 y `sub`. Rechaza sesiones anónimas y tokens sin `client_id` de tipo cadena no vacía, incluidos los JWT de login ordinario. La audiencia `authenticated` es compartida porque Supabase no permite una audiencia por recurso. El servidor reenvía el JWT aceptado a PostgREST con la clave publicable. RLS y las validaciones de las herramientas gobiernan el acceso y las escrituras. [api/mcp.js](../api/mcp.js) · [api/well-known.js](../api/well-known.js) · [OAuthConsent.jsx](../src/pages/OAuthConsent.jsx) · [Configuración histórica del conector](../tech-logs/mcp-connector.md#configuración)

En `/agentes`, la lista de aplicaciones autorizadas permite revocar un permiso. Revocar invalida los refresh tokens del cliente. Un access token ya emitido sigue siendo válido hasta su vencimiento (`exp`). [Agents.jsx](../src/pages/Agents.jsx) · [Revocación en Supabase](https://supabase.com/docs/reference/javascript/oauth-server-revokegrant)

| Herramientas registradas | Contrato |
| --- | --- |
| `search_catalog` | Busca por texto alimentos visibles y recetas propias. Devuelve IDs, datos por 100 g y `is_mine`. |
| `get_day`, `get_targets`, `get_measurements` | Lecturas de bitácora y totales, objetivo resuelto y medidas por rango. El MCP usa `America/Mexico_City` para «hoy». |
| `log_entry`, `delete_entry` | Registra por la RPC y borra por UUID de entrada. Captura en gramos. Conserva el ID devuelto para verificar o corregir. |
| `create_food`, `update_food` | Crea con fuente `ia_personal`. Editar un alimento propio limpia `reviewed_at`. Cambiar solo porciones conserva la fuente. Los demás cambios marcan `ia_personal`. Personalizar un alimento base crea copia propia. Claves inválidas y números fuera de contrato bloquean la operación. Las anomalías nutricionales válidas son avisos. |
| `create_recipe` | Crea receta a partir de IDs visibles. El MCP guarda cabecera e ingredientes en dos operaciones REST y, si fallan los ingredientes, intenta borrar la cabecera. La RPC atómica es la ruta de guardado de los clientes web y nativos. |
| `set_target_bounds` | Parche por nutriente. Una clave con `null` quita ese límite. Aplica a un día específico si existe, o a todas las filas semanales de la fase que corresponda. Rechaza fases ya terminadas. Cualquier cambio de planificación se rige por Anthropometry. |
| `log_measurement` | Lee, mezcla solo las claves enviadas y hace upsert por `owner,day`. La lectura y la escritura son solicitudes distintas. |

Para borrar alimentos o recetas, editar una receta o manejar fotos, usa los flujos de la app. Los esquemas de entrada y las validaciones exactas están en [api/mcp.js](../api/mcp.js) y [mcp.js](../src/lib/mcp.js).

En Supabase, el servidor OAuth 2.1 usa la raíz web como Site URL y `/oauth/consent` como ruta de autorización. Habilita el registro dinámico si el cliente se descubre por esa vía. [Configuración del conector](../tech-logs/mcp-connector.md#configuración)

## Configuración por entorno

| Entorno | Nombres y uso |
| --- | --- |
| Web, funciones Vercel y builds nativos | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. En macOS/iPhone el build pide clave publicable `sb_publishable_`. |
| Función Vercel | `GEMINI_KEY` para generación y embeddings, `MISTRAL_KEY` para respaldo, `FDC_KEY` para USDA. El proxy acepta como respaldo sus equivalentes con prefijo `VITE_` en el entorno servidor. |
| Dev web y evals | `VITE_GEMINI_KEY`, `VITE_MISTRAL_KEY`, `VITE_FDC_KEY` se usan en rutas directas de desarrollo. `AI_AVAILABLE` y `FDC_AVAILABLE` se activan en producción y allí el proxy decide según autenticación y configuración. `VITE_GROQ_KEY` y `GROQ_KEY` existen en auxiliares fuera de la cascada admitida. `VITE_DEV_EMAIL` y `VITE_DEV_PASSWORD` corresponden a la cuenta de prueba local. |
| Observabilidad web | `VITE_SENTRY_DSN`, opcional para producción. |
| GitHub Actions | `SUPABASE_URL` y `ANON_KEY` para keepalive. `SUPABASE_DB_URL` y `BACKUP_PASSPHRASE` para backup. |

Plantilla [`.env.example`](../.env.example), [configuración macOS](../macos/README.md) y [configuración iPhone](../ios/README.md). Configura las claves de proveedor sin prefijo `VITE_` en Vercel y reserva las variantes del cliente para dev y evals. La compilación de producción elimina las rutas web directas. Los ajustes Auth, las claves y la planificación de cron efectivamente activas se verifican en sus respectivos entornos.

## Mantenimiento y recuperación

| Trabajo | Contrato versionado |
| --- | --- |
| Keepalive | Lunes a las 06:00 UTC. Contacta `GET /rest/v1/` y registra el estado HTTP, incluso si la raíz devuelve 401. Esto mide que hubo tráfico, con independencia del éxito de una consulta autenticada. [Workflow](../.github/workflows/keepalive.yml) |
| Backup | Lunes a las 06:00 UTC o ejecución manual. Usa el cliente `pg_dump` 17 y la conexión configurada. Antes de subir comprueba tamaño mayor a 100,000 bytes y sentencias `COPY` de `nutri.entries` y `nutri.foods`. Sube solo `backup.sql.gpg` cifrado con GPG AES256. La retención configurada es 90 días. [Workflow](../.github/workflows/backup.yml) |
| Limpieza demo | `nutri-demo-cleanup` se registra con expresión `30 9 * * *` en pg_cron. Elimina usuarios anónimos con más de tres días desde creación y limpia sus filas asociadas. La ejecución pertenece al rol que agenda el cron. [Migración 019](../supabase/migrations/019_demo_anon_sandbox.sql) |
| Mantenimiento periódico | Revisión mensual de dependencias, advisors, backup y consumo de proveedores. Evaluación trimestral de dependencias y ensayo semestral de restauración. Después de DDL se ejecutan advisors en esa misma revisión. [BIBLIA](../BIBLIA.md#7-mantenimiento-periódico) |

En un ensayo de recuperación, elige un artefacto cifrado y prepara una base local o rama aislada compatible con Postgres, los esquemas y las extensiones del proyecto. Descifra en un entorno controlado y restaura allí con `psql`, deteniendo la carga en el primer error. Comprueba los conteos de `foods`, `entries` y `targets`, las vistas y el acceso bajo RLS. Trata el dump como información sensible de todo el proyecto, incluido Auth. Las fotos necesitan una copia independiente de Storage. Para revertir un despliegue de aplicación, sigue el flujo de `git revert` de la BIBLIA. Una migración aplicada requiere su propia reversión o corrección. [BIBLIA, backups](../BIBLIA.md#35-backups) · [BIBLIA, cambios](../BIBLIA.md#6-flujo-de-cambios)

## Qué comprobar al cambiar un contrato

- **Local y CI.** Node 24, `npm ci`, `npm run lint`, `npm test` y `npm run build`. CI ejecuta las comprobaciones web con una URL de prueba en Vitest. Incluye casos de dominio, formatos OFF/FDC, outbox, validadores MCP, cuota y errores del proxy con mocks. Usa el caso de 150 g = 1.5× también para micros y el caso canónico de receta. [CI](../.github/workflows/ci.yml) · [Tests web](../src/lib/)
- **SQL.** Ejecuta en una base de prueba con migraciones aplicadas los casos de [rollback de receta/fase](../supabase/tests/023_atomic_writes_rollback.sql), [cobertura de micros](../supabase/tests/024_nutrient_coverage.sql) y [cuota](../supabase/tests/ai_quota_test.sql). Verifica aislamiento con sesiones distintas y la demo cuando cambien políticas, vistas o Storage. Los tests con mocks y las suites SQL prueban capas distintas.
- **Integraciones.** Para OAuth verifica metadata, el `401` sin token, el consentimiento del cliente y lecturas bajo el usuario de prueba. Para cambios de IA ejecuta `npm run eval` antes y después, con las fotos locales requeridas, un solo modelo y su baseline. Un 429 o una corrida incompleta dejan pendiente la evaluación de calidad de los casos afectados. Los cambios de baseline son deliberados y los evals de proveedor se ejecutan fuera de CI. [Eval](../evals/README.md) · [Conector MCP](../tech-logs/mcp-connector.md)
- **Clientes nativos.** Sus README enlazan las comprobaciones de contrato, builds y pruebas de integración. El script de escritura de macOS y el script de seed web alteran datos de prueba y se reservan para sus cuentas designadas. [macOS](../macos/README.md) · [iPhone](../ios/README.md) · [Scripts](../scripts/README.md)
