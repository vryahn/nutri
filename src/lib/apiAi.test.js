// Prueba de `api/ai.js` (el proxy). Vive en src/ porque Vercel publica como
// función serverless CUALQUIER archivo dentro de api/, test incluido.
//
// El único punto del proxy donde datos del cliente tocan una URL: sin el guardia
// de `fdcId`, un payload como '1?x=' o '../' saldría de la ruta prevista.
import { describe, it, expect, vi, beforeAll } from 'vitest';

let usdaUrl;
beforeAll(async () => {
  // api/ai.js arma el issuer con VITE_SUPABASE_URL al importarse.
  vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co');
  ({ usdaUrl } = await import('../../api/ai.js'));
});

describe('usdaUrl', () => {
  it('arma las dos formas válidas con la key del servidor', () => {
    expect(usdaUrl('search', { query: 'apples fuji' }, 'K')).toBe(
      'https://api.nal.usda.gov/fdc/v1/foods/search?query=apples%20fuji&dataType=Foundation,SR%20Legacy&pageSize=6&api_key=K'
    );
    expect(usdaUrl('food', { fdcId: 171688 }, 'K')).toBe(
      'https://api.nal.usda.gov/fdc/v1/food/171688?api_key=K'
    );
  });

  it('rechaza payloads que saldrían de la ruta o irían vacíos', () => {
    for (const bad of ['1?api_key=x', '../../v1/foods/search', '', null, undefined, '12a']) {
      expect(usdaUrl('food', { fdcId: bad }, 'K')).toBeNull();
    }
    for (const bad of ['', '   ', 42, null, undefined]) {
      expect(usdaUrl('search', { query: bad }, 'K')).toBeNull();
    }
  });
});
