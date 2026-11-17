// Fingerprint of everything the native macOS app copies from the web (contracts, AI proxy, schema).
// Baked into the app by build-app.sh and published by `vite build` as /native-contract.json.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import console from 'node:console'
import process from 'node:process'

const root = fileURLToPath(new URL('..', import.meta.url))

export function nativeContract() {
  const migrations = readdirSync(root + 'supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  const files = [
    'macos/Sources/NutriCore/Resources/Contracts.json',
    'api/ai.js',
    ...migrations.map((f) => 'supabase/migrations/' + f),
  ]
  const hash = createHash('sha256')
  for (const file of files) hash.update(file + '\0').update(readFileSync(root + file)).update('\0')
  return hash.digest('hex').slice(0, 16)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(nativeContract())
