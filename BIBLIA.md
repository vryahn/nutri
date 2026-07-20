# Biblia de Nutrimetry

Documento normativo permanente del proyecto. Define los principios, estándares y
checklists que rigen **todo el ciclo de vida** de Nutrimetry: desarrollo, seguridad,
calidad, performance y operación. No describe la app (eso es `CLAUDE.md`) ni su
diseño original (eso es `SPEC.md`): describe **cómo se trabaja sobre ella, siempre**.

**Jerarquía documental** (en caso de conflicto gana la regla más restrictiva; si el
conflicto persiste, decide Bryan):

1. `BIBLIA.md` — principios y estándares permanentes (este documento).
2. `CLAUDE.md` — guía operativa por sesión: arquitectura viva, gotchas, comandos.
3. `SPEC.md` — spec original, referencia histórica.

Toda sesión de trabajo (humana o IA) que toque código, base de datos o
infraestructura debe cumplir esta biblia. Cambiar la biblia es en sí un cambio
que requiere aprobación explícita de Bryan.

---

## 1. Principios rectores

- **P1 — Precisión de los datos sobre todo.** Ante cualquier trade-off (UX,
  velocidad, alcance, estética), gana la exactitud de los valores nutricionales.
  Datos dudosos se marcan (⚠) y se explican; **nunca** se guardan ni se muestran
  en silencio como si fueran confiables.
- **P2 — Simplicidad deliberada.** La solución más simple que funcione (YAGNI).
  Ninguna abstracción, dependencia o configuración especulativa. Todo atajo
  deliberado se marca con un comentario `ponytail:` que nombra su techo y su
  ruta de mejora.
- **P3 — Stack cerrado.** react, react-dom, react-router-dom,
  @supabase/supabase-js, recharts, tailwindcss, lucide-react, vite-plugin-pwa,
  @dnd-kit/core, @dnd-kit/sortable. Toda dependencia nueva (incluidas las de
  desarrollo) se justifica en una línea en el commit que la introduce y se añade
  a esta lista.
- **P4 — El repo es público.** Nada sensible entra jamás al repositorio **ni a
  sus artefactos de CI**: ni credenciales, ni connection strings, ni volcados de
  datos, ni información personal. Los artefactos de GitHub Actions en un repo
  público son descargables por cualquier usuario de GitHub: se tratan como
  publicación.
- **P5 — Producción única.** Push a `main` = deploy inmediato a
  https://nutri.vryahn.com. No hay staging: la verificación completa ocurre
  **antes** del push, y el rollback es `git revert` + push.
- **P6 — Nada falla en silencio.** Toda operación de datos que falle produce
  señal visible al usuario (toast o estado de error) sin perder lo que el
  usuario había capturado. Todo dato faltante, deshabilitado o recortado en la
  UI explica su causa concreta (patrón `Hint`), nunca un guion mudo.
- **P7 — La seguridad vive en la base de datos.** El frontend es código público
  con claves públicas por diseño; la única barrera real es RLS + grants +
  validaciones SQL. Ninguna regla de seguridad se implementa "solo en cliente".

---

## 2. Arquitectura — invariantes

Estos invariantes no se rompen; cambiarlos exige decisión explícita de Bryan y
actualización simultánea de este documento y de `CLAUDE.md`.

1. **Todo valor nutricional se almacena por 100 g; cantidades siempre en
   gramos.** Las conversiones ml→g usan siempre densidad explícita, nunca 1
   asumido.
2. **Los nutrientes de registros se calculan en las vistas SQL**
   (`entry_nutrients`, `daily_totals`, `recipe_per_100g`), nunca se copian
   valores. Beneficio: toda auditoría o recalibración retroactiva es gratis.
3. **`computeRecipePer100g` (cliente) y la vista `recipe_per_100g` (SQL) son
   espejos.** Si cambias una, cambias la otra, y validas el caso canónico:
   100 g de A + 200 g de B con peso cocido 250 → por 100 g = (A + 2B) / 2.5.
4. **`MICROS` es un contrato cerrado de claves.** El jsonb `micros` solo usa
   claves exactas de esa constante; claves libres fragmentarían las sumas.
5. **RLS privado por usuario en todas las tablas.** Catálogo, entries, labels,
   targets y prefs: `owner = auth.uid()`. Toda tabla nueva nace con RLS +
   policies + cobertura de los grants del esquema `nutri` (ver §3.2).
6. **Estructura plana.** JavaScript (JSX), objetivo ≤20 archivos en `src/`. Un
   archivo por página; lógica compartida SOLO en `src/lib/`; componentes
   extraídos solo con ≥2 usos.
7. **Tokens de diseño como única fuente de color/tipografía**
   (`src/index.css` + `tailwind.config.js`), declarados en ambos temas, con
   contraste ≥4.5:1 medido en OKLCH contra `--surface-2`. El acento nunca ocupa
   el hue de un dato.
8. **Regla de seguridad médica:** el badge rojo de sodio < 1,500 mg
   (`SODIUM_FLOOR_MG`) no se quita ni se hace configurable.

---

## 3. Ciberseguridad

### 3.1 Secretos y claves

- La **publishable/anon key** de Supabase es pública por diseño; la seguridad es
  RLS. La `service_role`/secret key **no se usa en ninguna parte del proyecto**,
  ni en CI, ni en scripts, ni "temporalmente".
- Claves client-side de terceros (`VITE_GEMINI_KEY`, `VITE_MISTRAL_KEY`,
  `VITE_FDC_KEY`): riesgo aceptado = agotamiento de cuota, **nunca** facturación
  (solo free tiers sin billing). Obligatorio: restringirlas por referrer HTTP
  cuando el proveedor lo permita, y revisar su consumo en el mantenimiento
  mensual (§7). Si un proveedor exige una key con billing, esa integración se
  mueve a un backend o no se hace.
- `.env` está en `.gitignore` y así se queda; `.env.example` documenta cada
  variable sin valores.

### 3.2 Base de datos (Postgres/Supabase)

Checklist obligatorio para **toda migración** (`supabase/migrations/NNN_*.sql`):

- [ ] Tabla nueva → `enable row level security` + policies `owner = auth.uid()`
      para SELECT/INSERT/UPDATE/DELETE + verificar que los grants del esquema la
      cubren.
- [ ] En policies, `auth.uid()` siempre como `(select auth.uid())` — evita
      re-evaluación por fila (lint `auth_rls_initplan`).
- [ ] Una sola policy permisiva por rol y acción (lint
      `multiple_permissive_policies`).
- [ ] Vista nueva → `with (security_invoker = true)`.
- [ ] Función nueva → `set search_path = ''` (o fijado explícito) y todas las
      referencias calificadas con esquema. `security invoker` salvo
      justificación escrita.
- [ ] Foreign key nueva → índice de cobertura en la misma migración.
- [ ] Aplicada vía MCP (`apply_migration`) y verificada con SQL/REST antes de
      dar la fase por cerrada.
- [ ] **Después de todo DDL: correr los advisors de Supabase (security y
      performance) y resolver todo WARN** o documentar por qué se acepta.

### 3.3 Frontend

- Sin sinks XSS: `dangerouslySetInnerHTML`, `innerHTML`, `eval` y equivalentes
  están prohibidos salvo justificación escrita y revisada.
- **Headers de seguridad en `vercel.json`**: CSP con allowlist explícita
  (Anexo A), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
  mínima. **Todo dominio externo nuevo que use la app se añade a la CSP en el
  mismo commit que lo introduce** — si no está en el Anexo A y en la CSP, no se
  integra.
- Datos personales jamás en query strings ni en URLs de terceros.

### 3.4 Autenticación

- Sin registro público ni recuperación self-service (spec §11): las 2 cuentas se
  gestionan a mano en Supabase.
- **Leaked password protection**: no disponible — es exclusiva del plan Pro de
  Supabase y el proyecto opera en free tier. Limitación aceptada; el registro
  público está cerrado y solo hay 2 cuentas.
- Contraseñas largas de gestor de contraseñas; nunca hardcodeadas — las pruebas
  cross-user piden credenciales a Bryan en el momento.

### 3.5 Backups

- **Ningún volcado de datos sale de Supabase sin cifrar.** El `pg_dump` de CI se
  cifra (edad/gpg simétrico con passphrase en GitHub Secrets) **antes** de
  subirse como artefacto; un artefacto en repo público es público de facto (P4).
- El dump contiene `auth.users` (emails, hashes de contraseña) y todos los
  esquemas del proyecto — se trata siempre como dato máximo-sensible.
- **Restore drill semestral** (§7): descargar el último backup, descifrarlo y
  restaurarlo contra una base local o rama de Supabase, verificando conteos de
  filas de `foods`, `entries` y `targets`. Un backup no probado no es un backup.

### 3.6 El proyecto Supabase es compartido

El proyecto `shzoiqbahfmfszjsrkzy` aloja más de un esquema/app (p. ej. `econo`).
Los advisors reportan hallazgos de todos los esquemas: los de otros esquemas se
atienden en la sesión de SU proyecto, pero **un fallo de seguridad en cualquier
esquema compromete la misma base de datos** — no se ignoran, se enrutan.

---

## 4. Calidad y QA

### 4.1 Puertas antes de todo push (push = deploy)

1. `npm run build` limpio (el warning de chunk >500 kB de Recharts es conocido y
   aceptado).
2. Tests verdes (`npm test`, cuando exista la suite; ver §4.2).
3. Si tocaste cálculos: casos canónicos a mano — receta (A + 2B)/2.5 y registrar
   150 g de un alimento = 1.5× sus valores por 100 g (macros Y micros).
4. Si tocaste RLS/queries/policies: probar que un usuario no ve datos del otro
   (2 cuentas reales; credenciales al momento).
5. UI: revisar a 375 px (sin scroll horizontal), y 768/1280 si el cambio es de
   layout. Estados degradados: sin red, sin datos, sin keys opcionales.
6. Commit descriptivo en español; si alguna prueba falla o algo queda ambiguo:
   **no pushear**, reportar y esperar instrucciones.

### 4.2 Tests

- **`src/lib/domain.js` es lógica pura crítica y vive cubierta por tests
  unitarios** (Vitest). Todo cálculo nuevo o modificado llega con su test en el
  mismo commit. Mínimos cubiertos: `computeRecipePer100g` (caso canónico),
  `resolveTarget` (day > dow, valid_from), `kcalFromMacros`/`kcalSuspicious`
  (fibra, alcohol, tolerancias), `macrosImplausible`/`componentsInconsistent`,
  `dayCompleteness`, `bayesAdherence` (valores conocidos), `reorderLabels`,
  `parseAmount`, `toJsonSchema`, validación EAN (dígito verificador GS1) y el
  mapeo de unidades de `sources.js` (×1000 de OFF, `KCAL_IDS` de FDC).
- E2E y TypeScript siguen fuera de alcance (spec §11). Los tests unitarios de
  `src/lib/` no lo están: guardan directamente P1.
- Un test que falla nunca se borra ni se comenta para "desbloquear": o el código
  está mal, o el test documentaba un contrato que cambió con aprobación.

### 4.3 Manejo de errores

- Patrón uniforme en páginas: todo `error` de Supabase produce toast + estado
  visible; las cargas iniciales fallidas muestran estado de error reintentable,
  no una lista vacía silenciosa.
- `ErrorBoundary` raíz: una excepción de render nunca deja pantalla en blanco.
- Rutas desconocidas → redirect a `/` (catch-all).
- Los fetch a fuentes externas (OFF, FDC, IA, traducción) degradan a `null` +
  aviso; **nunca** bloquean la captura manual.

### 4.4 Accesibilidad (piso, no aspiración)

- Touch targets ≥44 px; contraste texto/fondo ≥4.5:1 en ambos temas (medido, no
  estimado); `aria-label` en todo botón de solo ícono; `prefers-reduced-motion`
  y `prefers-reduced-transparency` respetados; formularios con `label` asociado
  y `autoComplete` correcto.

---

## 5. Performance

### 5.1 Frontend — presupuestos

- **Chunk inicial (index) ≤ 250 kB gzip.** Se mide en cada `npm run build`; si
  se excede, la página o librería pesada se separa (lazy por ruta o
  `manualChunks`) antes de pushear. Recharts vive en su propio chunk lazy
  (Dashboard) — ese patrón es la referencia.
- Página nueva = candidata a `lazy()` por defecto; solo la ruta principal
  (`Hoy`) se mantiene eager.
- Imágenes/íconos: SVG primero; raster solo donde la plataforma lo exige
  (apple-touch-icon).

### 5.2 Base de datos

- El cálculo pesado vive en las vistas SQL, no en el cliente ni copiado en
  filas (invariante §2.2).
- Toda FK con índice de cobertura; policies con `(select auth.uid())`; una
  policy permisiva por rol/acción (§3.2). El costo hoy es invisible con 2
  usuarios — la regla existe para que nunca haya que "descubrirlo" a escala.
- Queries de páginas: rango cerrado por fecha (`gte`/`lte`) y solo columnas
  necesarias en vistas anchas.

### 5.3 Red

- Máximo un roundtrip evitable: cargas paralelas con `Promise.all` donde no hay
  dependencia (patrón del Dashboard).
- Fuentes externas con `preconnect`; `display=swap` en Google Fonts.

---

## 6. Flujo de cambios

1. **Planificación:** todo cambio de código se diseña con el skill `ponytail`
   (mínimo que funcione). Bug = causa raíz, no síntoma.
2. **Regla de entorno:** si la sesión no puede cerrar el ciclo (push = deploy),
   entrega un prompt autocontenido con UNA opción de modelo+esfuerzo y las
   pruebas como criterios de aceptación — no implementa a medias. Excepción:
   cambios sin deploy (migraciones vía MCP, consultas, auditorías) sí se
   ejecutan.
3. **Migraciones:** numeradas incrementales, aplicadas vía MCP, verificadas, con
   el checklist §3.2 completo y advisors corridos después.
4. **Push autorizado por defecto** si Bryan aprobó la solución y todas las
   pruebas pasan. Falla algo o hay ambigüedad → no push, reportar.
5. **Rollback:** `git revert` + push (redeploy del estado anterior). Las
   migraciones se diseñan pensando su reversa antes de aplicarlas, aunque no se
   escriba.

---

## 7. Mantenimiento periódico

| Cadencia | Tarea |
|---|---|
| Mensual | `npm audit` + `npm outdated`; advisors de Supabase (security + performance); verificar que el backup del día 1 corrió y su artefacto está **cifrado**; revisar consumo de las keys de IA/FDC. |
| Trimestral | Actualizar dependencias menores/patch; evaluar mayores pendientes (una línea de decisión: se hace / se difiere y por qué). |
| Semestral | Restore drill del backup (§3.5); releer esta biblia y `CLAUDE.md` contra la realidad del repo y corregir lo desactualizado. |
| Al tocar DDL | Advisors inmediatamente después (no esperar al mensual). |

El resultado de cada mantenimiento se deja como nota breve en el commit o en el
issue correspondiente — lo que no se registra, no ocurrió.

---

## Anexo A — Allowlist de dominios externos (CSP)

Única lista autorizada de dominios que el frontend puede tocar. Añadir un
dominio = editarlo aquí + en la CSP de `vercel.json` en el mismo commit.

| Dominio | Uso | Directiva CSP |
|---|---|---|
| `*.supabase.co` (proyecto) | API REST + Auth (+ wss para Realtime si se usara) | `connect-src` |
| `generativelanguage.googleapis.com` | Gemini ("Datos con IA") | `connect-src` |
| `api.mistral.ai` | Respaldo de la cascada de IA | `connect-src` |
| `world.openfoodfacts.org` | Open Food Facts (EAN) | `connect-src` |
| `api.nal.usda.gov` | USDA FoodData Central | `connect-src` |
| `api.mymemory.translated.net` | Traducción EN→ES (ayuda visual) | `connect-src` |
| `fonts.googleapis.com` | CSS de Google Fonts | `style-src` |
| `fonts.gstatic.com` | Archivos de fuente | `font-src` |

Base: `default-src 'self'`; `img-src 'self' data: blob:`; `frame-ancestors
'none'`; el script inline de tema en `index.html` se autoriza por **hash**
(sha256), nunca con `'unsafe-inline'` en `script-src`.

## Anexo B — Checklists rápidos

**Dependencia nueva (incluye devDependencies):**
justificación de una línea en el commit → añadida a P3 → `npm audit` limpio →
impacto en bundle medido (§5.1).

**Tabla/vista/función nueva:** checklist §3.2 completo + advisors.

**Dominio externo nuevo:** Anexo A + CSP + patrón de degradación (§4.3: `null` +
aviso, nunca bloquear captura manual) + nota de riesgo de la key si la hay
(§3.1).

**Página nueva:** `lazy()` por defecto (§5.1) + ruta en `App.jsx` + acciones en
el menú de sección si aplica + checklist responsive/a11y (§4.4).
