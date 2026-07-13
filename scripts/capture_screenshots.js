const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT_DIR || '.';
const BASE = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickHref(page, href) {
  return page.evaluate((h) => {
    const a = [...document.querySelectorAll('a,button')].find(
      (x) => x.getAttribute('href') === h);
    if (a) { a.click(); return true; } return false;
  }, href);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--force-color-profile=srgb'],
    defaultViewport: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('nutri-units', 'metric');
    localStorage.setItem('nutri.dash.preset', JSON.stringify('mes')); // Month → charts densos
  });

  // Auto-login (dev flag), luego navegación client-side para no perder sesión
  await page.goto(BASE + '/?dev=1', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => /Targets|Current status|Today/i.test(document.body.innerText), { timeout: 60000 });
  // ocultar tab bar fijo (evita el artefacto de position:fixed en fullPage)
  await page.addStyleTag({ content: 'nav.fixed.bottom-0{display:none !important}' });
  await sleep(1500);

  // fuerza render de Recharts (ResponsiveContainer mide 0 fuera de viewport)
  const scrollRender = async () => {
    await page.evaluate(async () => {
      const h = document.body.scrollHeight;
      for (let y = 0; y < h; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 200)); }
      window.dispatchEvent(new Event('resize'));
      window.scrollTo(0, 0);
    });
    await sleep(1800);
  };

  const shot = async (name, full = false) => {
    await sleep(700);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
    console.log('✓', name);
  };

  // 1. Today (full page: status + water + meals)
  await clickHref(page, '/');
  await page.waitForFunction(() => /Targets|Current status/i.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
  await sleep(1200);
  await shot('today', true);

  // 2. Dashboard (scroll para renderizar todos los charts)
  await clickHref(page, '/dashboard');
  await sleep(2500);
  await scrollRender();
  await shot('dashboard', true);

  // 3. Foods list
  await clickHref(page, '/foods');
  await sleep(1500);
  await shot('foods', true);

  // 4. Datos con IA: abrir form + correr estimación (Gemini en vivo)
  try {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => /Add food|Añadir alimento/i.test(x.getAttribute('aria-label') || ''));
      b && b.click();
    });
    await sleep(1400);
    const ta = await page.$('textarea');
    if (ta) await ta.type('grilled salmon fillet');
    await sleep(500);
    await shot('ai-input', true);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => /Get data|Obtener datos/i.test(x.textContent || ''));
      b && b.click();
    });
    // prefill completo: ≥3 inputs numéricos llenos (no solo "100" de Values per) y sin "Fetching"
    const filled = await page.waitForFunction(() => {
      const fetching = [...document.querySelectorAll('button')].some((b) => /Fetching|Obteniendo/.test(b.textContent || ''));
      const nums = [...document.querySelectorAll('input')].filter((i) => i.value && Number(i.value) > 0).length;
      return !fetching && nums >= 3;
    }, { timeout: 75000 }).then(() => true).catch(() => false);
    console.log('  prefill ok:', filled);
    await sleep(1200);
    if (filled) await shot('ai-result', true);
    else console.log('  (uso ai-input como shot de la feature)');
  } catch (e) { console.log('AI shot failed:', e.message); }

  await browser.close();
  console.log('DONE');
})();
