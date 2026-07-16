# RAG en nutri: búsqueda semántica del catálogo + "Pregúntale a tu bitácora"

Implementado el 2026-07-15 en dos fases (commits `74912b9` y `58e6ac8`). Este documento
describe qué se construyó, las decisiones de diseño y cómo se verificó. La regla núcleo
del proyecto —exactitud de los datos almacenados— gobernó ambos diseños: ningún valor
nutricional se genera, copia ni transforma; los números siempre salen de las vistas SQL.

## Fase A — Búsqueda semántica del catálogo (pgvector)

### Problema

La búsqueda de alimentos era `ilike` puro: "fruta cítrica" devolvía cero resultados
aunque el catálogo tuviera Naranja, Toronja y Limón. Con 634 alimentos (490 propios +
144 del catálogo base USDA), el vocabulario del usuario ya no coincidía siempre con el
nombre exacto de la fila.

### Diseño

**Almacenamiento** — migración `017_foods_embedding.sql`:

- Extensión `pgvector` (schema `extensions`, convención Supabase).
- Columna `foods.embedding vector(768)`, nullable. `null` = alimento sin embedding
  (creado por MCP/REST o sin `VITE_GEMINI_KEY`): sigue siendo encontrable por `ilike`.
- RPC `match_foods(q vector(768), n int default 8, max_dist float default 0.65)`:
  `security invoker` + `set search_path = ''` (RLS vigente — cada usuario solo matchea
  sus foods + catálogo base), ordena por distancia coseno (`<=>`) y recorta ruido con
  `max_dist`. Sin índice HNSW a propósito: con ~600 filas el seq scan sobra
  (umbral para añadirlo: ~10k filas).

**Embeddings** — `embedText(text)` en `src/lib/ai.js`:

- Modelo `gemini-embedding-001` con `outputDimensionality: 768` (misma key client-side
  `VITE_GEMINI_KEY` del módulo "Datos con IA"; mismo riesgo aceptado: cuota, no facturación).
- **Re-normalización L2 obligatoria** (`l2normalize`): Gemini solo devuelve vectores
  normalizados a 3072 dims; a 768 hay que re-normalizar para que `<=>` sea distancia
  coseno válida.
- Devuelve `null` ante cualquier fallo (sin key, red, cuota): la rama semántica nunca
  rompe la búsqueda normal.
- **Fórmula del texto embebido, fija:** `nombre + ' ' + marca` (marca solo si existe).
  El backfill del catálogo entero usó exactamente esta fórmula; cambiarla dejaría los
  vectores existentes inconsistentes con los nuevos.

**Búsqueda híbrida** (Hoy y Alimentos): `ilike` sigue siendo la fuente primaria. Solo si
hay key, el query tiene ≥3 caracteres y el `ilike` da <8 hits, se embebe el query y se
llama `match_foods`; `mergeFoodResults` en `domain.js` (pura, testeada) fusiona con dedup
por id, `ilike` primero, cap 8. El vector viaja como string `JSON.stringify(vec)` en el
parámetro del RPC. Los resultados semánticos pasan por los mismos filtros que los
normales (sentinel de Agua, source, warnings).

**Escritura**: al guardar un alimento, el embedding se calcula fire-and-forget — si
falla, la columna queda `null` y el guardado no se bloquea ni se altera (la precisión de
los datos no depende de esto).

**Backfill de los 634 existentes**: los vectores (~4 MB) nunca pasaron por el contexto
del agente. Dos RPCs temporales `security definer` (listar pendientes / aplicar lote
jsonb con guard `where embedding is null`, imposible pisar valores) + script node local
que se autentica por PostgREST y empuja todo por HTTP. Ambas RPCs se eliminaron al
terminar. Gotcha de cuota: el free tier de `gemini-embedding-001` limita por **minuto**
(~100 embeds por ráfaga, luego 429); el script reanudable con lotes de 20 y backoff de
65 s completó los 634 en ~10 minutos.

## Fase B — "Pregúntale a tu bitácora" (RAG estructurado)

### Problema

Responder preguntas en lenguaje natural sobre lo registrado ("¿qué alimentos me dieron
más sodio estas dos semanas?") sin inventar cifras.

### Diseño: retrieval estructurado por SQL, no vectores

El dato relevante aquí es tabular y ya vive en vistas SQL exactas (`daily_totals`,
`entry_nutrients`). Embeber registros diarios para recuperarlos por similitud sería
peor en precisión y en costo: el pipeline usa el LLM para *decidir qué consultar* y
*redactar*, nunca para producir números. Tres pasos en `src/lib/ai.js`, sobre la cascada
`callAI` existente (Gemini 3.5 → 2.5 → Mistral):

1. **Planner** — `planAskQuery(pregunta, hoy, lang)`: salida estructurada
   `{date_from, date_to, need_detail, nutrients[]}`. Las claves de nutrientes válidas se
   inyectan al prompt desde la constante `MICROS` de `domain.js` (no se duplican).
   `sanitizeAskPlan` (pura, testeada) sanea todo: fechas ausentes/inválidas caen a los
   últimos 30 días, `date_to` futuro se recorta a hoy, rango cap a 92 días (con flag
   `clamped` que la UI muestra como aviso), nutrientes fuera de la lista se filtran con
   fallback a macros.
2. **Retrieval SQL** — desde `Dashboard.jsx`: `daily_totals` del rango; `targets` se
   reusa del estado ya cargado por la página (query idéntica, cero round-trip extra) y
   se resuelve por día con `resolveTarget`; `entry_nutrients` solo si `need_detail`,
   seleccionando macros planos + `micros` jsonb (ya escalado por entrada en la vista).
3. **Generación** — `askAnswer`: contexto compacto tipo CSV (`formatAskContext`, pura,
   testeada; entradas recortadas a las 400 de mayor kcal con aviso) + instrucciones:
   usar EXCLUSIVAMENTE cifras del contexto, citar días y alimentos concretos, describir
   sin prescribir ni dar consejo médico, responder en el idioma de i18n. El contexto de
   alimentos incluye las columnas de los nutrientes de la pregunta — sin ellas la
   respuesta no podría atribuir un micro (p. ej. sodio) a alimentos concretos.

**UI**: botón "Preguntar" en el Dashboard (junto a Fases), renderizado solo con
`VITE_GEMINI_KEY` — mismo patrón de gate que "Datos con IA". Sheet compartido (cierre al
tocar fuera), pares pregunta/respuesta solo en memoria de la sesión, cada pregunta se
procesa independiente (sin hilo conversacional). Nota fija al pie:
*"Respuesta generada por IA — verifica contra el Dashboard"* — mitigación honesta del
riesgo residual de alucinación: los números reales están en el contexto, pero la
redacción es del modelo.

## Verificación

- `npm run lint` + `npm test` (143, incluye 21 nuevos: `l2normalize`, `mergeFoodResults`,
  `sanitizeAskPlan`, `formatAskContext`) + `npm run build`, limpios en ambos commits.
- `npm run eval` omitido deliberadamente: la regla aplica a prompt/schema/cascada de la
  *extracción* de alimentos, que no se tocó (las funciones nuevas son independientes).
- Sanity vectorial por SQL: el vecino más cercano de cualquier food es él mismo
  (dist 0.0000); vecinos de "Limón, crudo" = frutas crudas.
- En vivo a 375 px (cuenta de pruebas, `/?dev=1`): "fruta citrica" → Naranja, Toronja,
  Limón (cero hits ilike); "pescado azul" → atún, huachinango, salmón, bacalao
  (match cross-lingüe: encontró "Canned tuna in water").
- Exactitud punta a punta de Fase B: a *"which foods gave me the most sodium in the last
  two weeks?"* la respuesta citó "Whole-grain bread 91 g → 409.5 mg" el 2 de julio;
  verificado contra `entry_nutrients` en la base: **409.500 exacto**.

## Límites conocidos y evolución

- Foods creados fuera de la app (MCP, REST, importador) quedan sin embedding hasta que
  alguien los edite y guarde; el híbrido los cubre por `ilike` mientras tanto.
- `max_dist 0.65` admite algo de ruido lejano (p. ej. "Crema ácida" ante "fruta
  cítrica"); bajar el umbral filtra más pero pierde matches cross-lingüe. Ajustable por
  parámetro del RPC sin migración.
- Recetas no tienen embedding (solo `ilike`): añadirlas es la misma columna + misma
  fórmula si algún día hace falta.
- El sheet de preguntas no mantiene hilo conversacional; si se quisiera, bastaría pasar
  los pares previos al planner, a costa de tokens.
