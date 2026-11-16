// Refresh native reference data from the web client contracts.
import { readFileSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { URL } from 'node:url'
import { MICROS, MICRO_MAX, ADHERENCE_BANDS } from '../../src/lib/domain.js'

const i18n = readFileSync(new URL('../../src/lib/i18n.js', import.meta.url), 'utf8')
const strings = runInNewContext('(' + i18n.split('const EN = ')[1].split('\n};')[0] + '\n})')
const data = { micros: MICROS, microMax: MICRO_MAX, bands: ADHERENCE_BANDS, strings }
writeFileSync(new URL('../Sources/NutriCore/Resources/Contracts.json', import.meta.url), JSON.stringify(data, null, 2) + '\n')
