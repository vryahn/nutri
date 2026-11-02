// Prueba de `api/ai.js` (el proxy). Vive en src/ porque Vercel publica como
// función serverless CUALQUIER archivo dentro de api/, test incluido.
//
// El único punto del proxy donde datos del cliente tocan una URL: sin el guardia
// de `fdcId`, un payload como '1?x=' o '../' saldría de la ruta prevista.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('jose', () => ({
  createRemoteJWKSet: () => null,
  jwtVerify: async () => ({ payload: { sub: 'a9706349-25dd-4d10-bb34-7b8e5770789a' } }),
}));

let usdaUrl, handler;
beforeAll(async () => {
  // api/ai.js arma el issuer con VITE_SUPABASE_URL al importarse.
  vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-key');
  vi.stubEnv('FDC_KEY', 'private-test-key');
  ({ usdaUrl, default: handler } = await import('../../api/ai.js'));
});

function response() {
  return Object.assign(new EventEmitter(), {
    status: vi.fn(function (code) { this.code = code; return this; }),
    json: vi.fn(function (body) { this.body = body; return this; }),
    send: vi.fn(function (body) { this.body = body; return this; }),
    setHeader: vi.fn(),
  });
}

const request = (body) => ({ method: 'POST', headers: { authorization: 'Bearer test' }, body });
const usdaBody = { kind: 'usda', model: 'food', payload: { fdcId: 171688 } };

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

describe('proxy resource limits', () => {
  it('returns 413 before spending quota for an oversized body', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const res = response();
    await handler(request({ ...usdaBody, payload: { query: 'x'.repeat(4_000_000) } }), res);
    expect(res.code).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 429 when shared quota denies and never calls the provider', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => false });
    vi.stubGlobal('fetch', fetch);
    const res = response();
    await handler(request(usdaBody), res);
    expect(res.code).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('/rest/v1/rpc/claim_ai_quota');
  });

  it('fails closed when the quota RPC is unavailable', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network unavailable'));
    vi.stubGlobal('fetch', fetch);
    const res = response();
    await handler(request(usdaBody), res);
    expect(res.code).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts an upstream request and returns 504', async () => {
    const realTimeout = AbortSignal.timeout;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
      ms === 45_000 ? AbortSignal.abort(new DOMException('timed out', 'TimeoutError')) : realTimeout(ms));
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => true })
      .mockImplementationOnce((_url, options) => Promise.reject(options.signal.reason));
    vi.stubGlobal('fetch', fetch);
    const res = response();
    try {
      await handler(request(usdaBody), res);
      expect(res.code).toBe(504);
      expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    } finally {
      timeout.mockRestore();
    }
  });

  it('releases the provider request when the client disconnects', async () => {
    const res = response();
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => true })
      .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        res.emit('close');
      }));
    vi.stubGlobal('fetch', fetch);
    await handler(request(usdaBody), res);
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });
});
