// Refresh native reference data from the web client contracts.
import { readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { URL } from 'node:url'
import {
  MICROS, MICRO_MAX, ADHERENCE_BANDS,
  SODIUM_HIGH_MG, POTASSIUM_HIGH_MG, DEFICIT_RATE_CAP, ADHERENCE_TOL,
  MIN_DAYS_MEDIAN, MIN_DAYS_STDDEV, MIN_DAYS_TREND, MIN_DAYS_BAYES,
  STRUCTURAL_ZERO_FRACTION, BAYES_KCAL_TOL, KCAL_HARD_FLOOR, COMPLETE_RATIO,
  HIST_MIN_DAYS, MIN_MEALS_SIGNAL, SODIUM_FLOOR_MG, SODIUM_CEILING_MG,
} from '../../src/lib/domain.js'

const i18n = readFileSync(new URL('../../src/lib/i18n.js', import.meta.url), 'utf8')
const strings = runInNewContext('(' + i18n.split('const EN = ')[1].split('\n};')[0] + '\n})')

// ai.js cannot be imported in node (supabase/import.meta.env): its prompt builders are
// extracted as text and evaluated with placeholders for the runtime-only parts.
const ai = readFileSync(new URL('../../src/lib/ai.js', import.meta.url), 'utf8')
function extract(start, end, what) {
  const from = ai.indexOf(start)
  const to = from < 0 ? -1 : ai.indexOf(end, from)
  if (to < 0) throw new Error(`sync-domain: no se pudo extraer ${what} de src/lib/ai.js`)
  return ai.slice(from, to + end.length)
}
const fn = (name) => extract(`function ${name}(`, '`;\n}', name)
const presets = extract('export const DENSITY_PRESETS = [', '];', 'DENSITY_PRESETS').replace('export ', '')
const prompts = runInNewContext(
  `${presets}\n${fn('geminiPrompt')}\n${fn('recipePrompt')}\n({ food: geminiPrompt(), recipe: recipePrompt(['{{catalog}}']) })`,
  { MICROS, nameLangInstruction: () => '{{name_lang}}' },
)

// Constantes numéricas de dominio: la web es la única fuente; el nativo las lee de aquí.
const constants = {
  SODIUM_HIGH_MG, POTASSIUM_HIGH_MG, DEFICIT_RATE_CAP, ADHERENCE_TOL,
  MIN_DAYS_MEDIAN, MIN_DAYS_STDDEV, MIN_DAYS_TREND, MIN_DAYS_BAYES,
  STRUCTURAL_ZERO_FRACTION, BAYES_KCAL_TOL, KCAL_HARD_FLOOR, COMPLETE_RATIO,
  HIST_MIN_DAYS, MIN_MEALS_SIGNAL, SODIUM_FLOOR_MG, SODIUM_CEILING_MG,
}
const data = { micros: MICROS, microMax: MICRO_MAX, bands: ADHERENCE_BANDS, constants, strings, prompts }
writeFileSync(new URL('../Sources/NutriCore/Resources/Contracts.json', import.meta.url), JSON.stringify(data, null, 2) + '\n')
