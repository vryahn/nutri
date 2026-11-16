import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import console from 'node:console'
import * as domain from '../../src/lib/domain.js'

const fixture = JSON.parse(readFileSync(new URL('../Tests/NutriChecks/Fixtures/web-domain.json', import.meta.url)))
for (const test of fixture.cases) {
  assert.equal(typeof domain[test.fn], 'function', `Missing web function: ${test.fn}`)
  // JSON is the contract consumed by Swift (including the normalization of -0).
  const actual = JSON.parse(JSON.stringify(domain[test.fn](...test.args)))
  assert.deepEqual(actual, test.expected, `Web reference changed: ${test.name}`)
}
console.log(`${fixture.cases.length} native oracle fixtures match the current web implementation.`)
