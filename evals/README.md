# evals — golden set for the AI extraction

Scored regression tests for the `estimateFoodFromParts` path (`src/lib/ai.js`, the
Gemini→Mistral cascade that transcribes labels or estimates values per 100 g). Their purpose is
to know whether a prompt/model/schema/normalization change **degrades** the extraction before
pushing.

## Running

```sh
npm run eval                      # runs the cases, scores them, compares vs baseline.json
UPDATE_BASELINE=1 npm run eval    # also rewrites baseline.json from this run
```

Requires `VITE_GEMINI_KEY` (or `VITE_MISTRAL_KEY`) in `.env`. With no key at all: clean skip, no
failure.

**Quota budget (critical):** the Gemini free tier is **20 requests/day/model**. Each
run = 1 request per case (currently 7 → 7/20). Do not run the eval in a loop: it is a
**deliberate before/after tool** for a prompt change, not a continuous check. ~2 runs/day fit
within the budget. If you exhaust it, the 429 does not recover until the daily reset (midnight Pacific). **It never runs in CI** (it costs quota and is not deterministic): separate config
(`vitest.eval.config.js`), outside the include of `npm test`. The scoring itself is tested in CI via
`score.test.js` (no network).

Output: a table per case (id, model that answered, `passed/total`, failed fields with expected
vs got), `evals/last-run.json` (gitignored), and a comparison against `baseline.json`. Any
**regression** fails the suite: a case/field pair that passed and now fails, a READY case from the
baseline absent from the run (cases skipped due to a missing local photo do NOT count), or an
extras (hallucinations) count growing beyond `1.5× + 3` vs the baseline — the identity of the
invented micros varies between runs; the count is the stable signal.

## Case format — `cases/<id>/case.json`

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

- **REQUIRED fields** (`kcal, protein_g, carbs_g, fat_g` + micros `sodio_mg, potasio_mg,
  magnesio_mg`): must always come back numeric, and within tolerance if `values` provides a value.
- Remaining fields in `values` (incl. micros): within tolerance.
- **Default tolerances by mode:** `etiqueta` → `max(2 %, 0.5 u)` (kcal `max(2 %, 2)`) —
  transcribing is not estimating; `estimacion` → ±30 % macros, ±40 % micros, with an absolute
  floor of 0.5 u (an expected 0 does not demand exactly 0). Per-field override in `tolerances`
  (`{"kcal": 0.1}` = ±10 %).
- `strict_extras: true` (only for `etiqueta` cases with a COMPLETE transcription of the package):
  any micro returned by the AI outside of `values` = an "extra" failure (hallucination). The 7
  required fields are exempt.
- **Ground truth ALWAYS real, never from memory.** For generic foods: USDA FDC
  (`https://api.nal.usda.gov/fdc/v1/foods/search`, `SR Legacy`/`Foundation`). Record fdcId +
  dataType in `notes`. Beware: `Foundation` entries do not include nutrient 1008 (Energy) — use
  the Atwater factor 2048/2047.

## Baseline policy

`baseline.json` is committed (it is the last accepted run). It is updated **only
deliberately** with `UPDATE_BASELINE=1 npm run eval`, and the commit explains why (prompt
improvement, model change, new case). A seed case that fails against FDC is **not papered over
by lowering the tolerance**: it is a real signal of model quality; it is documented in `notes` and
the baseline captures the real state.

## Gate determinism

The eval pins **a single model + `temperature: 0`** (`EVAL_MODEL`, default `gemini-3.5-flash` —
the app's actual primary). Without this, the cascade in `ai.js` falls back to another model on a
503 and the answering model changes per call: 3.5 vs 2.5 give different numbers and the re-run
flags false regressions. By pinning the model, the baseline measures a consistent target. It
retries on a transient 5xx error (3.5-flash gets saturated) so it does not die on a 503; a 429
(quota) is NOT retried.

**One baseline per model.** The default goes to `baseline.json`; any other `EVAL_MODEL` goes to
`baseline.<modelo>.json` (both committed). This also covers the **last step of the cascade,
Mistral** (`mistral-small-latest`, which does support vision — verified), which would otherwise go
untested (including the `toJsonSchema` Gemini→Mistral translation):
`EVAL_MODEL=mistral-small-latest npm run eval` (requires `VITE_MISTRAL_KEY`). The pin routes to
Gemini or Mistral based on the model name's prefix.

Beware: `mistral-small-latest` turned out to be **weak and not reproducible even at temp 0** (it
hallucinates almost the entire micros panel; mis-transcribes labels — reads the "per serving"
column, ignores declared values —; the kcal of one and the same label oscillated 47→37 between
runs). Its `baseline.mistral-small-latest.json` is a **quality snapshot of the cascade's last
step, not a strict gate**: it can flag a false regression due to its own variance. Treat it as a
smoke test (is the Mistral path still alive and returning valid JSON?), not as a blocking
criterion.

Even with a pinned model, generation is not 100 % deterministic: an **estimation** field at the
edge of the tolerance can oscillate between runs.

## Flakiness

One run by default. On a suspicious failure, re-run **once**; if the failure persists, it is real
(do not cover it up by raising tolerances). The ~4 s delay between cases respects the free tier's
RPM.

## Adding a photo case (`mode: "etiqueta"`)

Photos are **local-only** (gitignored: `evals/cases/**/*.jpg`) — the repo is public and the shots
usually show a hand/kitchen. The repo carries the transcription (`case.json`) and the
`baseline.json`; the photos live only on your machine. The runner **skips cleanly** any case whose
photo is missing, so a clone stays green even without the images.

1. **Front-facing** photo of the nutrition facts table, good light, no angle. Compress it to
   ≤1024 px on the longest side and save it next to `case.json` as `label.jpg`:
   ```sh
   sips -Z 1024 origen.jpg --out evals/cases/<id>/label.jpg --setProperty formatOptions 80
   ```
2. In `case.json`: `"photos": ["label.jpg"]`, `"mode": "etiqueta"`.
3. Transcribe **by hand ALL** the declared values from the package into `expected.values` (per
   100 g; if the label declares per serving, normalize). Transcribing everything enables
   `strict_extras: true` (so a micro hallucination gets detected).
4. `npm run eval` to see the score, and `UPDATE_BASELINE=1 npm run eval` to lock it in. Commit
   `baseline.json` explaining the new case.
