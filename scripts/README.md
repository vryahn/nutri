# scripts

Dev/portfolio tooling. Not part of the app build; excluded from ESLint (`scripts/**` in `eslint.config.js`).

## `seed_test_data.py` — poblar la cuenta de prueba

Siembra datos dummy (inglés, métrico) en la cuenta de PRUEBA (nunca en la real): ~17 foods, una fase de `targets`, 21 días de `entries` vía `rpc/log_entry` (con `p_day` para backdatear) y `prefs.water_food_id`. Hace WIPE de esa cuenta antes de sembrar.

```bash
set -a && . ./.env && set +a   # VITE_SUPABASE_URL, ANON_KEY, VITE_DEV_EMAIL/PASSWORD
python3 scripts/seed_test_data.py
```

Solo stdlib (urllib). Usa las credenciales de la cuenta de prueba de `.env` (`VITE_DEV_*`). Idempotente: vuelve a vaciar y sembrar en cada corrida.

## `capture_screenshots.js` — capturas de la app

Genera PNGs móviles (375@2x) de Today, Dashboard, Foods y el módulo "Datos con IA" (con estimación real de Gemini). Requiere el dev server corriendo (`npm run dev`) y datos sembrados (arriba).

```bash
npm run dev            # en otra terminal (o el preview integrado)
npm i -g puppeteer-core   # dep ad-hoc, NO va en package.json
OUT_DIR=/tmp/shots node scripts/capture_screenshots.js
```

Notas: auto-login por `/?dev=1` (efecto dev-only, ver CLAUDE.md); fuerza unidades métricas y rango "Month" por `localStorage`; oculta el tab bar fijo (`nav.fixed.bottom-0`) para evitar el artefacto de `position:fixed` en `fullPage`; hace scroll para que los charts de Recharts (`ResponsiveContainer`) midan y rendericen. `executablePath` apunta al Chrome del sistema (macOS) — ajústalo en otro SO.

Post-proceso usado para el caso de portafolio (`vryahn.com/work/nutri`): `cwebp -q 82` + recortes de región del dashboard con `cwebp -crop`.
