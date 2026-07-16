// api/well-known.js — OAuth Protected Resource Metadata (RFC 9728) para el
// conector MCP. Descubierto por los clientes MCP a partir del header
// WWW-Authenticate que devuelve api/mcp.js en un 401 (ver resource_metadata).
// CORS abierto: cualquier cliente MCP externo necesita poder leer esto.
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    resource: 'https://nutri.vryahn.com/api/mcp',
    resource_name: 'Nutrimetry',
    authorization_servers: ['https://shzoiqbahfmfszjsrkzy.supabase.co/auth/v1'],
    bearer_methods_supported: ['header'],
  });
}
