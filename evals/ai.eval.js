// Golden-set runner: calls the REAL AI extraction path (estimateFoodFromParts)
// case by case and scores against ground truth. ONLY via `npm run eval` (separate config);
// never part of the regular `npm test` or CI (it costs quota and is not deterministic).
import { describe, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { scoreCase, compareToBaseline } from './score.js';

const DIR = import.meta.dirname;
const CASES_DIR = path.join(DIR, 'cases');

// Pinned model + temp 0: without this, the gate depends on which model answered after a 503
// (3.5 vs 2.5 give different numbers → false regressions on the re-run). EVAL_MODEL can
// override it via env; each model has its own baseline (the default goes to baseline.json,
// the rest — e.g. Mistral, coverage of the cascade's last step — to baseline.<model>.json).
const DEFAULT_MODEL = 'gemini-3.5-flash';
const EVAL_MODEL = process.env.EVAL_MODEL || DEFAULT_MODEL;
const EVAL_OPTS = { model: EVAL_MODEL, temperature: 0 };
const suffix = EVAL_MODEL === DEFAULT_MODEL ? '' : `.${EVAL_MODEL}`;
const BASELINE = path.join(DIR, `baseline${suffix}.json`);
const LAST_RUN = path.join(DIR, `last-run${suffix}.json`);

function loadCases() {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs.readdirSync(CASES_DIR)
    .filter((d) => fs.existsSync(path.join(CASES_DIR, d, 'case.json')))
    .sort()
    .map((id) => {
      const dir = path.join(CASES_DIR, id);
      const def = { id, dir, ...JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8')) };
      // Local-only photos (they do not go into the public repo): a case whose photo is
      // missing is skipped cleanly instead of breaking the runner.
      def.ready = (def.photos || []).every((p) => fs.existsSync(path.join(dir, p)));
      return def;
    });
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
// The required key depends on the pinned model: with only the "wrong" key in .env, running
// anyway would blow up all 7 cases as false regressions instead of a clean skip.
const NEED_KEY = EVAL_MODEL.startsWith('mistral') ? 'VITE_MISTRAL_KEY' : 'VITE_GEMINI_KEY';
const hasAI = !!import.meta.env[NEED_KEY];
const results = [];

describe.skipIf(!hasAI)('eval extracción IA', () => {
  let estimateFoodFromParts;
  // Retries ONLY on a transient 5xx (typically a 503 from a saturated 3.5-flash); without
  // the fallback cascade (pinned model), a 503 would kill the case. A 429 (daily quota,
  // free tier = 20 req/day/model) is NOT retried: it does not recover within seconds and
  // would burn the RPM window.
  async function estimateWithRetry(parts, tries = 4) {
    for (let a = 1; ; a++) {
      try { return await estimateFoodFromParts(parts, EVAL_OPTS); }
      catch (e) {
        const transient = /\b(500|502|503|504)\b/.test(String(e.message));
        if (!transient || a >= tries) throw e;
        await sleep(6000);
      }
    }
  }
  beforeAll(async () => {
    // i18n.js reads localStorage on import; minimally stubbed (same pattern as ai.test.js).
    globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
    ({ estimateFoodFromParts } = await import('../src/lib/ai.js'));
  });

  for (const [i, c] of cases.entries()) {
    if (!c.ready) console.warn(`eval: caso '${c.id}' sin sus fotos en disco — omitido.`);
    it.skipIf(!c.ready)(c.id, async () => {
      if (i > 0) await sleep(4000); // free tier RPM: space out the calls
      const got = await estimateWithRetry(buildParts(c));
      results.push(scoreCase(c, got));
    }, 120000);
  }

  afterAll(() => {
    if (results.length === 0) return;
    results.sort((a, b) => a.id.localeCompare(b.id));

    // Human-readable table per case + failed fields (expected vs got).
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

    const readyIds = new Set(cases.filter((c) => c.ready).map((c) => c.id));

    if (process.env.UPDATE_BASELINE) {
      // An incomplete run (a case died midway, typically a 429) must NOT set the baseline:
      // it would be silently truncated and the lost cases would score as "new" forever.
      if (results.length !== readyIds.size) {
        throw new Error(`UPDATE_BASELINE: corrida incompleta (${results.length}/${readyIds.size} casos ready) — baseline NO escrito.`);
      }
      fs.writeFileSync(BASELINE, JSON.stringify({ generated_at: new Date().toISOString(), cases: results }, null, 2));
      console.log(`baseline.json actualizado (${agg.p}/${agg.t}).`);
      return;
    }

    // Skipped cases (missing local-only photo) are excluded from the comparison: a clone with
    // keys but no photos stays green. The absence of a READY case (throw/429) does gate.
    const baseline = (fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')).cases : [])
      .filter((b) => readyIds.has(b.id));
    const { regressions, improvements, newItems } = compareToBaseline(baseline, results);
    for (const n of newItems) console.log(`nuevo: ${n.id}${n.field ? ' · ' + n.field : ''}`);
    for (const im of improvements) console.log(`mejora: ${im.id} · ${im.field}`);
    if (regressions.length) {
      const lines = regressions.map((r) => `  ${r.id}${r.field ? ' · ' + r.field : ''}: ${r.reason}`).join('\n');
      throw new Error(`Regresiones vs ${path.basename(BASELINE)} (${regressions.length}):\n${lines}\nSi es intencional: UPDATE_BASELINE=1 EVAL_MODEL=${EVAL_MODEL} npm run eval`);
    }
  });
});

if (!hasAI) {
  console.warn(`eval: sin ${NEED_KEY} (la key de ${EVAL_MODEL}) — casos omitidos (skip limpio).`);
}
