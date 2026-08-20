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

// Allowlist cerrada: un modelo fuera de esta lista se rechaza (400) antes de
// tocar al proveedor — el proxy no es un relay abierto a cualquier endpoint.
const ALLOWED = {
  gemini: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'],
  groq: ['qwen/qwen3.6-27b'],
  mistral: ['mistral-small-latest'],
  embed: ['gemini-embedding-001'],
};

const KEY = {
  gemini: () => process.env.GEMINI_KEY ?? process.env.VITE_GEMINI_KEY,
  embed: () => process.env.GEMINI_KEY ?? process.env.VITE_GEMINI_KEY,
  groq: () => process.env.GROQ_KEY ?? process.env.VITE_GROQ_KEY,
  mistral: () => process.env.MISTRAL_KEY ?? process.env.VITE_MISTRAL_KEY,
};

const UPSTREAM = {
  gemini: (model, key) => [`${GEMINI_BASE}/${model}:generateContent`, { 'x-goog-api-key': key }],
  embed: (model, key) => [`${GEMINI_BASE}/${model}:embedContent`, { 'x-goog-api-key': key }],
  groq: (_model, key) => ['https://api.groq.com/openai/v1/chat/completions', { Authorization: `Bearer ${key}` }],
  mistral: (_model, key) => ['https://api.mistral.ai/v1/chat/completions', { Authorization: `Bearer ${key}` }],
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

  const { kind, model, payload } = req.body || {};
  if (!ALLOWED[kind]?.includes(model) || !payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  const key = KEY[kind]();
  // Sin key configurada para ese proveedor: 501 y el cliente sigue con el
  // siguiente eslabón de la cascada (mismo efecto que el viejo skip por key).
  if (!key) {
    res.status(501).json({ error: 'not_configured' });
    return;
  }

  const [url, headers] = UPSTREAM[kind](model, key);
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(body);
  } catch {
    res.status(502).json({ error: 'upstream_unreachable' });
  }
}
