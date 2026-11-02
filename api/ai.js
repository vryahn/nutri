// api/ai.js — proxy de la cascada de IA. Existe para que las API keys de los
// proveedores vivan en el servidor y NO en el bundle público (antes eran VITE_*).
// Auth: el mismo JWT de Supabase que usa api/mcp.js (JWKS, ES256, aud
// 'authenticated'); nunca service_role. El cuerpo (`payload`) puede traer fotos:
// no se registra en logs, ni entero ni recortado.
import { createRemoteJWKSet, jwtVerify } from 'jose';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_BODY_BYTES = 4_000_000; // two 2048 px label photos fit; Vercel hard cap is 4.5 MB
const UPSTREAM_TIMEOUT_MS = 45_000;

// Allowlist cerrada: un modelo fuera de esta lista se rechaza (400) antes de
// tocar al proveedor — el proxy no es un relay abierto a cualquier endpoint.
const ALLOWED = {
  // Keep Gemini aliases accepted for cached clients; Google redirects them.
  gemini: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'],
  mistral: ['mistral-small-latest'],
  embed: ['gemini-embedding-001'],
  // No es IA: los chips de coincidencias USDA. Van por aquí solo para que la key
  // de FDC deje de viajar en el bundle público (antes era VITE_FDC_KEY).
  usda: ['search', 'food'],
};

// Cuentas con IA real: las 5 existentes al 2026-08-20, previas a abrir signups.
const AI_USERS = new Set([
  'a9706349-25dd-4d10-bb34-7b8e5770789a',
  'cad61d8e-6f59-4c94-97b4-740faea18c60',
  '972e774e-019e-4fb7-8f03-6ae43a5fac73',
  'aebb890e-23bf-46bc-9934-063cbc2643f2',
  'd0f95b41-cbfa-4571-b1a2-3861bf4151ae',
]);

const KEY = {
  gemini: () => process.env.GEMINI_KEY ?? process.env.VITE_GEMINI_KEY,
  embed: () => process.env.GEMINI_KEY ?? process.env.VITE_GEMINI_KEY,
  groq: () => process.env.GROQ_KEY ?? process.env.VITE_GROQ_KEY,
  mistral: () => process.env.MISTRAL_KEY ?? process.env.VITE_MISTRAL_KEY,
  usda: () => process.env.FDC_KEY ?? process.env.VITE_FDC_KEY,
};

// FDC es GET con la key en el query string. La URL se arma AQUÍ, del lado
// servidor, y solo con dos formas fijas: nada del cliente entra en la ruta.
// Devuelve null si el payload no encaja (el handler responde 400).
export function usdaUrl(model, payload, key) {
  if (model === 'search') {
    const q = typeof payload.query === 'string' ? payload.query.trim() : '';
    if (!q) return null;
    return `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&dataType=Foundation,SR%20Legacy&pageSize=6&api_key=${key}`;
  }
  if (!/^\d+$/.test(String(payload.fdcId ?? ''))) return null;
  return `https://api.nal.usda.gov/fdc/v1/food/${payload.fdcId}?api_key=${key}`;
}

const UPSTREAM = {
  gemini: (model, key) => [`${GEMINI_BASE}/${model}:generateContent`, { 'x-goog-api-key': key }],
  embed: (model, key) => [`${GEMINI_BASE}/${model}:embedContent`, { 'x-goog-api-key': key }],
  groq: (_model, key) => ['https://api.groq.com/openai/v1/chat/completions', { Authorization: `Bearer ${key}` }],
  mistral: (_model, key) => ['https://api.mistral.ai/v1/chat/completions', { Authorization: `Bearer ${key}` }],
  usda: (model, key, payload) => [usdaUrl(model, payload, key), {}],
};

// Claims del JWT si es válido, o null. Mismos iss/aud/alg que api/mcp.js.
async function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const { payload } = await jwtVerify(authHeader.slice(7), JWKS, {
      issuer: ISSUER,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    return payload;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const claims = await verifyToken(req.headers.authorization);
  if (!claims) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  // La demo (cuenta anónima) no consume IA real: el cliente ya devuelve fixtures,
  // esto es el cinturón del lado servidor.
  if (claims.is_anonymous === true) {
    res.status(403).json({ error: 'demo' });
    return;
  }
  // Check both advertised and parsed size: Content-Length is optional and untrusted.
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES
    || Buffer.byteLength(JSON.stringify(req.body ?? {})) > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'payload_too_large' });
    return;
  }
  const { kind, model, payload } = req.body || {};
  if (!ALLOWED[kind]?.includes(model) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  // El demo obligó a abrir signups (los usuarios anónimos cuentan como signup),
  // así que "no anónimo" ya no implica "de confianza": cualquiera puede crearse
  // una cuenta con email. La IA real queda cerrada a las cuentas que existían
  // antes de abrir signups. Los uids no son secretos (opacos, RLS no depende de
  // ellos); los emails NO van aquí porque el repo es público. `usda` no es IA
  // (catálogo público, cuota generosa): abierto a cualquier cuenta autenticada.
  if (kind !== 'usda' && !AI_USERS.has(claims.sub)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const key = KEY[kind]();
  // Sin key configurada para ese proveedor: 501 y el cliente sigue con el
  // siguiente eslabón de la cascada (mismo efecto que el viejo skip por key).
  if (!key) {
    res.status(501).json({ error: 'not_configured' });
    return;
  }

  const [url, headers] = UPSTREAM[kind](model, key, payload);
  if (!url) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  const clientAbort = new AbortController();
  const onClose = () => clientAbort.abort();
  res.on?.('close', onClose);
  try {
    // SQL claim is atomic across Vercel instances. A quota-store failure must
    // not silently become an unlimited provider call.
    try {
      const quota = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_ai_quota`, {
        method: 'POST',
        headers: {
          apikey: process.env.VITE_SUPABASE_ANON_KEY,
          Authorization: req.headers.authorization,
          'Content-Profile': 'nutri',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ request_kind: kind }),
        signal: AbortSignal.any([clientAbort.signal, AbortSignal.timeout(5_000)]),
      });
      if (!quota.ok) throw new Error('quota_unavailable');
      if (await quota.json() !== true) {
        res.status(429).json({ error: 'quota_exceeded' });
        return;
      }
    } catch {
      if (clientAbort.signal.aborted) return;
      res.status(503).json({ error: 'quota_unavailable' });
      return;
    }
    try {
      // usda es GET (sin cuerpo); el resto de la cascada es POST con JSON.
      const upstream = await fetch(url, {
        ...(kind === 'usda' ? {} : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(payload),
        }),
        signal: AbortSignal.any([clientAbort.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      });
      const body = await upstream.text();
      res.status(upstream.status);
      res.setHeader('Content-Type', 'application/json');
      res.send(body);
    } catch (error) {
      if (clientAbort.signal.aborted) return;
      res.status(error.name === 'TimeoutError' ? 504 : 502)
        .json({ error: error.name === 'TimeoutError' ? 'upstream_timeout' : 'upstream_unreachable' });
    }
  } finally {
    res.off?.('close', onClose);
  }
}
