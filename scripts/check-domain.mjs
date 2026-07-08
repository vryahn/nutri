// ponytail: check-domain — runnable self-check for the pure stats added to
// domain.js (no test framework in this stack). Run: node scripts/check-domain.mjs
import assert from 'node:assert/strict';
import { median, quantile, stddev, cv, olsSlope, bayesAdherence } from '../src/lib/domain.js';

assert.equal(median([1, 2, 3, 4]), 2.5);
assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
assert.equal(stddev([2, 4]), Math.sqrt(2));
assert.equal(stddev([5]), null);
assert.ok(Math.abs(cv([2, 4]) - (Math.sqrt(2) / 3) * 100) < 1e-9);
assert.equal(olsSlope([1, 2, 3, 4]), 1);
assert.equal(olsSlope([4, 3, 2, 1]), -1);

const b = bayesAdherence(3, 3);
assert.ok(Math.abs(b.mean - 0.8) < 1e-9);
assert.ok(b.lower < b.mean && b.mean < b.upper);
assert.ok(b.lower >= 0 && b.upper <= 1);

// Con más éxitos y más días, el intervalo debe ser más angosto (honesto por diseño).
const narrow = bayesAdherence(30, 30);
assert.ok(narrow.upper - narrow.lower < b.upper - b.lower);

console.log('check-domain: OK');
