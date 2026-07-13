// Runner del golden set: llama la ruta REAL de extracción con IA (estimateFoodFromParts)
// caso por caso y puntúa contra ground truth. SOLO vía `npm run eval` (config aparte);
// nunca entra al `npm test` normal ni a CI (cuesta cuota y no es determinista).
import { describe, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { scoreCase, compareToBaseline } from './score.js';

const DIR = import.meta.dirname;
const CASES_DIR = path.join(DIR, 'cases');
const BASELINE = path.join(DIR, 'baseline.json');
const LAST_RUN = path.join(DIR, 'last-run.json');

function loadCases() {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs.readdirSync(CASES_DIR)
    .filter((d) => fs.existsSync(path.join(CASES_DIR, d, 'case.json')))
    .sort()
    .map((id) => ({ id, dir: path.join(CASES_DIR, id), ...JSON.parse(fs.readFileSync(path.join(CASES_DIR, id, 'case.json'), 'utf8')) }));
}

function buildParts(c) {
  const parts = [{ text: (c.text || '').trim() || 'Analiza las imágenes.' }];
  for (const photo of c.photos || []) {
    const data = fs.readFileSync(path.join(c.dir, photo)).toString('base64');
    parts.push({ inline_data: { mime_type: 'image/jpeg', data } });
  }
  return parts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cases = loadCases();
const hasAI = !!(import.meta.env.VITE_GEMINI_KEY || import.meta.env.VITE_MISTRAL_KEY);
const results = [];

describe.skipIf(!hasAI)('eval extracción IA', () => {
  let estimateFoodFromParts;
  beforeAll(async () => {
    // i18n.js lee localStorage al importar; se stubea mínimo (patrón de ai.test.js).
    globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
    ({ estimateFoodFromParts } = await import('../src/lib/ai.js'));
  });

  for (const [i, c] of cases.entries()) {
    it(c.id, async () => {
      if (i > 0) await sleep(4000); // free tier RPM: separa las llamadas
      const got = await estimateFoodFromParts(buildParts(c));
      results.push(scoreCase(c, got));
    }, 120000);
  }

  afterAll(() => {
    if (results.length === 0) return;
    results.sort((a, b) => a.id.localeCompare(b.id));

    // Tabla legible por caso + campos fallados (esperado vs got).
    let table = '\n=== eval extracción IA ===\n';
    for (const r of results) {
      table += `\n[${r.id}] ${r.model || '?'}  ${r.passed}/${r.total}  ${r.mode_ok ? '' : 'MODE✗ '}${r.basis_ok ? '' : 'BASIS✗ '}\n`;
      for (const [k, f] of Object.entries(r.fields)) {
        if (!f.pass) table += `    ✗ ${k}: esperado ${f.expected}, got ${f.got}\n`;
      }
      for (const e of r.extras) table += `    ✗ extra ${e} (alucinación)\n`;
    }
    const agg = results.reduce((a, r) => ({ p: a.p + r.passed, t: a.t + r.total }), { p: 0, t: 0 });
    table += `\nAgregado: ${agg.p}/${agg.t} campos\n`;
    console.log(table);

    fs.writeFileSync(LAST_RUN, JSON.stringify({ generated_at: new Date().toISOString(), cases: results }, null, 2));

    if (process.env.UPDATE_BASELINE) {
      fs.writeFileSync(BASELINE, JSON.stringify({ generated_at: new Date().toISOString(), cases: results }, null, 2));
      console.log(`baseline.json actualizado (${agg.p}/${agg.t}).`);
      return;
    }

    const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')).cases : [];
    const { regressions, improvements, newItems } = compareToBaseline(baseline, results);
    for (const n of newItems) console.log(`nuevo: ${n.id}${n.field ? ' · ' + n.field : ''}`);
    for (const im of improvements) console.log(`mejora: ${im.id} · ${im.field}`);
    if (regressions.length) {
      const lines = regressions.map((r) => `  ${r.id}${r.field ? ' · ' + r.field : ''}: ${r.reason}`).join('\n');
      throw new Error(`Regresiones vs baseline.json (${regressions.length}):\n${lines}\nSi es intencional: UPDATE_BASELINE=1 npm run eval`);
    }
  });
});

if (!hasAI) {
  console.warn('eval: sin VITE_GEMINI_KEY ni VITE_MISTRAL_KEY — casos omitidos (skip limpio).');
}
