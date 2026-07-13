# evals — golden set de la extracción con IA

Regresiones puntuadas de la ruta `estimateFoodFromParts` (`src/lib/ai.js`, cascada
Gemini→Mistral que transcribe etiquetas o estima valores por 100 g). Sirve para saber si un
cambio de prompt/modelo/schema/normalización **empeora** la extracción antes de pushear.

## Correr

```sh
npm run eval                      # corre los casos, puntúa, compara vs baseline.json
UPDATE_BASELINE=1 npm run eval    # además reescribe baseline.json desde esta corrida
```

Necesita `VITE_GEMINI_KEY` (o `VITE_MISTRAL_KEY`) en `.env`. Sin ninguna key: skip limpio, no
falla.

**Presupuesto de cuota (crítico):** el free tier de Gemini es **20 requests/día/modelo**. Cada
corrida = 1 request por caso (hoy 7 → 7/20). No corras el eval en loop: es una herramienta
**deliberada de antes/después** de un cambio de prompt, no un check continuo. ~2 corridas/día caben
en el presupuesto. Si lo agotas, el 429 no recupera hasta el reset diario (medianoche Pacific). **Nunca corre en CI** (cuesta cuota y no es determinista): config aparte
(`vitest.eval.config.js`), fuera del include de `npm test`. El scoring sí se testea en CI vía
`score.test.js` (sin red).

Salida: tabla por caso (id, modelo que respondió, `passed/total`, campos fallados con esperado
vs got), `evals/last-run.json` (gitignoreado) y comparación vs `baseline.json`. Cualquier
**regresión** (par caso/campo que pasaba y ahora falla, o caso del baseline ausente) hace fallar
el suite.

## Formato de caso — `cases/<id>/case.json`

```json
{
  "text": "manzana fuji cruda",
  "photos": [],
  "expected": {
    "mode": "estimacion",
    "basis": "100g",
    "values": {
      "kcal": 63, "protein_g": 0.2, "carbs_g": 15.2, "fat_g": 0.18,
      "micros": { "sodio_mg": 1, "potasio_mg": 109, "magnesio_mg": 5, "fibra_g": 2.1 }
    }
  },
  "strict_extras": false,
  "tolerances": {},
  "notes": "FDC <id> (SR Legacy/Foundation), consultado <fecha>."
}
```

- **REQUERIDOS** (`kcal, protein_g, carbs_g, fat_g` + micros `sodio_mg, potasio_mg,
  magnesio_mg`): deben venir numéricos siempre, y dentro de tolerancia si `values` trae valor.
- Resto de campos en `values` (incl. micros): dentro de tolerancia.
- **Tolerancias default por modo:** `etiqueta` → `max(2 %, 0.5 u)` (kcal `max(2 %, 2)`) —
  transcribir no es estimar; `estimacion` → ±30 % macros, ±40 % micros.
  Override por campo en `tolerances` (`{"kcal": 0.1}` = ±10 %).
- `strict_extras: true` (solo casos `etiqueta` con transcripción COMPLETA del empaque):
  cualquier micro devuelto por la IA fuera de `values` = fallo "extra" (alucinación). Los 7
  requeridos quedan exentos.
- **Ground truth SIEMPRE real, nunca de memoria.** Para genéricos: USDA FDC
  (`https://api.nal.usda.gov/fdc/v1/foods/search`, `SR Legacy`/`Foundation`). Anota fdcId +
  dataType en `notes`. Ojo: los `Foundation` no traen el nutriente 1008 (Energy) — usa el factor
  Atwater 2048/2047.

## Política de baseline

`baseline.json` se committea (es la última corrida aceptada). Se actualiza **solo
deliberadamente** con `UPDATE_BASELINE=1 npm run eval`, y el commit explica el porqué (mejora de
prompt, cambio de modelo, caso nuevo). Un caso semilla que falla contra FDC **no se maquilla
bajando la tolerancia**: es señal real de calidad del modelo; se documenta en `notes` y el
baseline captura el estado real.

## Determinismo del gate

El eval fija **un solo modelo + `temperature: 0`** (`EVAL_MODEL`, default `gemini-3.5-flash` — el
primario real de la app). Sin esto, la cascada de `ai.js` cae a otro modelo ante un 503 y el
modelo que contesta cambia por llamada: 3.5 vs 2.5 dan números distintos y el re-run marca
regresiones falsas. Al fijar el modelo, el baseline mide un objetivo consistente. Reintenta en
error transitorio (3.5-flash se satura) para no morir en un 503. Sobrescribir:
`EVAL_MODEL=gemini-2.5-flash npm run eval`.

Aun con modelo fijo, la generación no es 100 % determinista: un campo de **estimación** en el
borde de la tolerancia puede oscilar entre corridas.

## Flakiness

Una corrida por defecto. Ante un fallo sospechoso, re-correr **una** vez; si el fallo persiste,
es real (no lo tapes subiendo tolerancias). El delay de ~4 s entre casos respeta el RPM del free
tier.

## Añadir un caso de foto (`mode: "etiqueta"`)

Las fotos son **local-only** (gitignoreadas: `evals/cases/**/*.jpg`) — el repo es público y las
tomas suelen mostrar mano/cocina. El repo lleva la transcripción (`case.json`) y el
`baseline.json`; las fotos viven solo en tu máquina. El runner **salta limpio** un caso cuya foto
falte, así que un clon queda verde aunque no tenga las imágenes.

1. Foto **frontal** de la tabla nutrimental, buena luz, sin ángulo. Comprímela a ≤1024 px lado
   mayor y guárdala junto al `case.json` como `label.jpg`:
   ```sh
   sips -Z 1024 origen.jpg --out evals/cases/<id>/label.jpg --setProperty formatOptions 80
   ```
2. En `case.json`: `"photos": ["label.jpg"]`, `"mode": "etiqueta"`.
3. Transcribe **a mano TODOS** los valores declarados del empaque a `expected.values` (por 100 g;
   si la etiqueta declara por porción, normaliza). Transcribir todo habilita `strict_extras: true`
   (así una alucinación de micro se detecta).
4. `npm run eval` para ver el score, y `UPDATE_BASELINE=1 npm run eval` para fijarlo. Committea
   `baseline.json` explicando el caso nuevo.
