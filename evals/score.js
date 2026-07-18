// Pure scoring for the AI extraction eval — no network, no dependencies.
// scoreCase compares the output of estimateFoodFromParts against the case's ground truth;
// compareToBaseline detects regressions (a case/field pair that passed and now fails).

// The 7 REQUIRED fields the prompt demands to estimate ALWAYS (they must come back numeric
// even if the case has no expected value). Exempt from the "extras" check in strict_extras.
const OBLIG_TOP = ['kcal', 'protein_g', 'carbs_g', 'fat_g'];
const OBLIG_MICRO = ['sodio_mg', 'potasio_mg', 'magnesio_mg'];

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ABSOLUTE tolerance allowed for a field, based on mode and the case's overrides.
// override = fraction (0.1 = ±10 %). etiqueta = transcription (minimal fixed slack).
// estimacion = ±30 % macros, ±40 % micros.
function toleranceFor(field, mode, expected, isMicro, overrides) {
  const abs = Math.abs(expected);
  if (overrides && overrides[field] != null) return abs * overrides[field];
  if (mode === 'etiqueta') {
    return field === 'kcal' ? Math.max(0.02 * abs, 2) : Math.max(0.02 * abs, 0.5);
  }
  // estimacion, with an absolute floor: without it, an expected 0 would demand exactly 0 and
  // a tiny value (0.2 g) would tolerate less than etiqueta mode.
  return Math.max(abs * (isMicro ? 0.4 : 0.3), 0.5);
}

// One field: must be numeric, and if there is an expected value, within tolerance.
function scoreField(field, expectedVal, gotVal, mode, isMicro, overrides) {
  const numeric = isNum(gotVal);
  if (expectedVal == null) return { expected: null, got: gotVal, pass: numeric }; // required without GT: numeric only
  const tol = toleranceFor(field, mode, expectedVal, isMicro, overrides);
  const pass = numeric && Math.abs(gotVal - expectedVal) <= tol;
  return { expected: expectedVal, got: gotVal, pass };
}

// caseDef: { text, expected: { mode, basis, values }, strict_extras, tolerances }
// got: output of estimateFoodFromParts (kcal/protein_g/… numbers or '', micros {}, mode, basis)
export function scoreCase(caseDef, got) {
  const exp = caseDef.expected;
  const overrides = caseDef.tolerances || {};
  const vals = exp.values || {};
  const expMicros = vals.micros || {};
  const gotMicros = got.micros || {};

  const modeOk = got.mode === exp.mode;
  const basisOk = got.basis === exp.basis;
  const caseValid = modeOk && basisOk; // wrong mode/basis → the whole case fails

  const fields = {};
  // Top-level fields: union of REQUIRED + the expected ones.
  const topKeys = [...new Set([...OBLIG_TOP, ...Object.keys(vals).filter((k) => k !== 'micros')])];
  for (const k of topKeys) {
    const f = scoreField(k, k in vals ? vals[k] : null, got[k], exp.mode, false, overrides);
    if (!caseValid) f.pass = false;
    fields[k] = f;
  }
  // Micros: union of REQUIRED micros + the expected ones.
  const microKeys = [...new Set([...OBLIG_MICRO, ...Object.keys(expMicros)])];
  for (const k of microKeys) {
    const f = scoreField(k, k in expMicros ? expMicros[k] : null, gotMicros[k], exp.mode, true, overrides);
    if (!caseValid) f.pass = false;
    fields[k] = f;
  }

  // strict_extras: a micro returned by the AI that is NOT in the GT (and not required) = hallucination.
  const extras = [];
  if (caseDef.strict_extras) {
    for (const k of Object.keys(gotMicros)) {
      if (!isNum(gotMicros[k])) continue;
      if (k in expMicros || OBLIG_MICRO.includes(k)) continue;
      extras.push(k);
    }
  }

  const passed = Object.values(fields).filter((f) => f.pass).length;
  const total = Object.keys(fields).length + extras.length; // each extra counts as a failure
  return {
    id: caseDef.id,
    model: got.ai_model || null,
    mode_ok: modeOk,
    basis_ok: basisOk,
    fields,
    extras,
    passed,
    total,
  };
}

// Regression = a (case, field) pair that passed in the baseline and now fails, or a case
// present in the baseline and absent from the run, or an extras (hallucinations) count that
// grows beyond the slack. New fields/cases → "new" (not a failure). Improvements → reported.
export function compareToBaseline(baseline, run) {
  const runById = Object.fromEntries(run.map((r) => [r.id, r]));
  const baseById = Object.fromEntries(baseline.map((r) => [r.id, r]));
  const regressions = [];
  const improvements = [];
  const newItems = [];

  for (const b of baseline) {
    const r = runById[b.id];
    if (!r) { regressions.push({ id: b.id, field: null, reason: 'caso ausente en la corrida' }); continue; }
    for (const [field, bf] of Object.entries(b.fields)) {
      const rf = r.fields[field];
      if (!rf) { if (bf.pass) regressions.push({ id: b.id, field, reason: 'campo ausente en la corrida' }); continue; }
      if (bf.pass && !rf.pass) {
        regressions.push({ id: b.id, field, reason: `pasaba, ahora got=${rf.got} esperado=${rf.expected}` });
      } else if (!bf.pass && rf.pass) {
        improvements.push({ id: b.id, field });
      }
    }
    // Hallucinations (extras): the identity of the invented micros varies between runs,
    // the COUNT much less so. Regression only if it grows beyond the slack (0→many or a big
    // jump), so fine variation does not trip the gate but re-introducing hallucination does.
    const bx = (b.extras || []).length;
    const rx = (r.extras || []).length;
    if (rx > bx * 1.5 + 3) {
      regressions.push({ id: b.id, field: 'extras', reason: `alucinaciones ${bx} → ${rx} (umbral ${Math.floor(bx * 1.5 + 3)})` });
    }
  }

  for (const r of run) {
    const b = baseById[r.id];
    if (!b) { newItems.push({ id: r.id, field: null }); continue; }
    for (const field of Object.keys(r.fields)) {
      if (!(field in b.fields)) newItems.push({ id: r.id, field });
    }
  }

  return { regressions, improvements, newItems };
}
