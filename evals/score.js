// Scoring puro del eval de extracción con IA — sin red, sin dependencias.
// scoreCase compara la salida de estimateFoodFromParts contra el ground truth del caso;
// compareToBaseline detecta regresiones (par caso/campo que pasaba y ahora falla).

// Los 7 REQUERIDOS que el prompt exige estimar SIEMPRE (deben venir numéricos aunque
// el caso no traiga valor esperado). Exentos del chequeo de "extras" en strict_extras.
const OBLIG_TOP = ['kcal', 'protein_g', 'carbs_g', 'fat_g'];
const OBLIG_MICRO = ['sodio_mg', 'potasio_mg', 'magnesio_mg'];

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Tolerancia ABSOLUTA permitida para un campo, según modo y overrides del caso.
// override = fracción (0.1 = ±10 %). etiqueta = transcripción (holgura fija mínima).
// estimacion = ±30 % macros, ±40 % micros.
function toleranceFor(field, mode, expected, isMicro, overrides) {
  const abs = Math.abs(expected);
  if (overrides && overrides[field] != null) return abs * overrides[field];
  if (mode === 'etiqueta') {
    return field === 'kcal' ? Math.max(0.02 * abs, 2) : Math.max(0.02 * abs, 0.5);
  }
  return abs * (isMicro ? 0.4 : 0.3); // estimacion
}

// Un campo: numérico obligatorio, y si hay valor esperado, dentro de tolerancia.
function scoreField(field, expectedVal, gotVal, mode, isMicro, overrides) {
  const numeric = isNum(gotVal);
  if (expectedVal == null) return { expected: null, got: gotVal, pass: numeric }; // obligatorio sin GT: solo numérico
  const tol = toleranceFor(field, mode, expectedVal, isMicro, overrides);
  const pass = numeric && Math.abs(gotVal - expectedVal) <= tol;
  return { expected: expectedVal, got: gotVal, pass };
}

// caseDef: { text, expected: { mode, basis, values }, strict_extras, tolerances }
// got: salida de estimateFoodFromParts (kcal/protein_g/… números o '', micros {}, mode, basis)
export function scoreCase(caseDef, got) {
  const exp = caseDef.expected;
  const overrides = caseDef.tolerances || {};
  const vals = exp.values || {};
  const expMicros = vals.micros || {};
  const gotMicros = got.micros || {};

  const modeOk = got.mode === exp.mode;
  const basisOk = got.basis === exp.basis;
  const caseValid = modeOk && basisOk; // mode/basis mal → todo el caso falla

  const fields = {};
  // Campos top-level: unión de REQUERIDOS + los esperados.
  const topKeys = [...new Set([...OBLIG_TOP, ...Object.keys(vals).filter((k) => k !== 'micros')])];
  for (const k of topKeys) {
    const f = scoreField(k, k in vals ? vals[k] : null, got[k], exp.mode, false, overrides);
    if (!caseValid) f.pass = false;
    fields[k] = f;
  }
  // Micros: unión de REQUERIDOS micro + los esperados.
  const microKeys = [...new Set([...OBLIG_MICRO, ...Object.keys(expMicros)])];
  for (const k of microKeys) {
    const f = scoreField(k, k in expMicros ? expMicros[k] : null, gotMicros[k], exp.mode, true, overrides);
    if (!caseValid) f.pass = false;
    fields[k] = f;
  }

  // strict_extras: micro devuelto por la IA que NO está en el GT (y no es requerido) = alucinación.
  const extras = [];
  if (caseDef.strict_extras) {
    for (const k of Object.keys(gotMicros)) {
      if (!isNum(gotMicros[k])) continue;
      if (k in expMicros || OBLIG_MICRO.includes(k)) continue;
      extras.push(k);
    }
  }

  const passed = Object.values(fields).filter((f) => f.pass).length;
  const total = Object.keys(fields).length + extras.length; // cada extra cuenta como fallo
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

// Regresión = par (caso, campo) que pasaba en baseline y ahora falla, o caso presente en
// baseline y ausente en la corrida. Campos/casos nuevos → "nuevo" (no falla). Mejoras → se reportan.
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
