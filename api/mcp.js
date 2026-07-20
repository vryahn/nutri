// api/mcp.js — Nutrimetry remote MCP server (Streamable HTTP, stateless).
// Transport + auth (Supabase Auth JWT via JWKS) + Supabase calls with RLS
// as the ONLY authorization filter (never service_role). The pure logic (validators,
// warnings, fork/update, recipe computation) lives in src/lib/mcp.js.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { resolveTarget } from '../src/lib/domain.js';
import {
  assertValidMicros,
  assertNonNegative,
  assertValidPortions,
  assertValidBodyMetrics,
  bodyMetricWarnings,
  buildWarnings,
  resolveKcal,
  decideUpdatePath,
  recipeResponse,
} from '../src/lib/mcp.js';

// ponytail: the serverless runtime and Postgres both run in UTC, but both users are
// in Mexico — without an explicit zone the MCP writes to the next day from 18:00.
// Hardcoded rather than a TZ env var so the fix lives in the repo; make it a per-user
// preference only if someone actually logs from another zone.
const APP_TZ = 'America/Mexico_City';
const todayLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: APP_TZ });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const RESOURCE_METADATA_URL = 'https://nutri.vryahn.com/.well-known/oauth-protected-resource';

const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

// Returns the JWT's uid (`sub` claim) if valid, or null. Fixed iss/aud: tokens
// from the OAuth server and those from the password grant share both claims (see the
// Supabase oauth-server/token-security docs: default aud = 'authenticated').
async function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const { payload } = await jwtVerify(authHeader.slice(7), JWKS, {
      issuer: ISSUER,
      audience: 'authenticated',
    });
    return payload.sub || null;
  } catch {
    return null;
  }
}

function toolResult(summary, structured) {
  return {
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(structured)}` }],
    structuredContent: structured,
  };
}

const portionSchema = z.object({ name: z.string().min(1), grams: z.number().positive() });
const microsSchema = z.record(z.string(), z.number());

// ── Supabase calls (I/O). Validation/decision logic lives in src/lib/mcp.js. ──

async function searchCatalog(supabase, uid, query, limit) {
  const like = `%${query}%`;
  const [{ data: foods, error: foodsErr }, { data: recipes, error: recipesErr }] = await Promise.all([
    supabase
      .from('foods')
      .select('id,name,brand,kcal,protein_g,carbs_g,fat_g,portions,density_g_ml,source,owner')
      .or(`name.ilike.${like},brand.ilike.${like}`)
      .limit(limit),
    supabase.from('recipes').select('id,name,portions,source,owner').ilike('name', like).limit(limit),
  ]);
  if (foodsErr) throw new Error(foodsErr.message);
  if (recipesErr) throw new Error(recipesErr.message);

  let nutrientsByRecipe = {};
  if (recipes.length) {
    const { data, error } = await supabase
      .from('recipe_per_100g')
      .select('recipe_id,kcal,protein_g,carbs_g,fat_g')
      .in('recipe_id', recipes.map((r) => r.id));
    if (error) throw new Error(error.message);
    nutrientsByRecipe = Object.fromEntries(data.map((n) => [n.recipe_id, n]));
  }

  const items = [
    ...foods.map((f) => ({
      type: 'food',
      id: f.id,
      name: f.name,
      brand: f.brand,
      kcal: f.kcal,
      protein_g: f.protein_g,
      carbs_g: f.carbs_g,
      fat_g: f.fat_g,
      portions: f.portions,
      density_g_ml: f.density_g_ml,
      source: f.source,
      is_mine: f.owner === uid,
    })),
    ...recipes.map((r) => {
      const n = nutrientsByRecipe[r.id] || {};
      return {
        type: 'recipe',
        id: r.id,
        name: r.name,
        brand: null,
        kcal: n.kcal ?? null,
        protein_g: n.protein_g ?? null,
        carbs_g: n.carbs_g ?? null,
        fat_g: n.fat_g ?? null,
        portions: r.portions,
        density_g_ml: null,
        source: r.source,
        is_mine: r.owner === uid,
      };
    }),
  ];
  return items.slice(0, limit);
}

async function logEntry(supabase, { food_id, recipe_id, item, grams, label, day }) {
  if (!food_id && !recipe_id && !item) {
    throw new Error('se requiere food_id, recipe_id o item');
  }
  // Signature from migration 016 (log_entry_by_id): explicit ids with priority
  // p_food_id > p_recipe_id > p_item; name matching prefers the user's own items.
  const params = { p_grams: grams };
  if (item != null) params.p_item = item;
  if (label != null) params.p_label = label;
  params.p_day = day ?? todayLocal();
  if (food_id != null) params.p_food_id = food_id;
  if (recipe_id != null) params.p_recipe_id = recipe_id;
  const { data, error } = await supabase.rpc('log_entry', params);
  if (error) throw new Error(error.message);
  return data;
}

async function deleteEntry(supabase, entryId) {
  const { data, error } = await supabase.from('entries').delete().eq('id', entryId).select('id');
  if (error) throw new Error(error.message);
  return { deleted: data.length > 0, entry_id: entryId };
}

async function getDay(supabase, day) {
  const d = day || todayLocal();
  const [{ data: totals, error: e1 }, { data: entries, error: e2 }] = await Promise.all([
    supabase.from('daily_totals').select('*').eq('day', d).maybeSingle(),
    supabase
      .from('entry_nutrients')
      .select('id,item,meal,grams,kcal,protein_g,carbs_g,fat_g,micros,created_at')
      .eq('day', d)
      .order('created_at'),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  if (!totals && (!entries || entries.length === 0)) {
    return { day: d, logged: false, message: `Sin registros para ${d}.` };
  }
  return { day: d, logged: true, totals: totals || null, entries: entries || [] };
}

async function getTargets(supabase, day) {
  const d = day || todayLocal();
  const { data: targets, error } = await supabase.from('targets').select('*');
  if (error) throw new Error(error.message);
  const resolved = resolveTarget(targets || [], d);
  if (!resolved) return { day: d, resolved: null, message: `Sin objetivo que aplique al ${d}.` };
  return { day: d, resolved };
}

async function createFood(supabase, uid, input) {
  assertValidMicros(input.micros);
  assertNonNegative({
    kcal: input.kcal,
    protein_g: input.protein_g,
    carbs_g: input.carbs_g,
    fat_g: input.fat_g,
    density_g_ml: input.density_g_ml,
  });
  assertValidPortions(input.portions);

  const draft = {
    protein_g: input.protein_g,
    carbs_g: input.carbs_g,
    fat_g: input.fat_g,
    micros: input.micros || {},
  };
  const food = {
    name: input.name,
    brand: input.brand ?? null,
    kcal: resolveKcal({ kcal: input.kcal, ...draft }),
    ...draft,
    portions: input.portions || [],
    density_g_ml: input.density_g_ml ?? null,
  };
  const warnings = buildWarnings(food);

  const { data, error } = await supabase
    .from('foods')
    .insert({ ...food, owner: uid, source: 'ia_personal' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { ...data, warnings };
}

async function createRecipe(supabase, uid, input) {
  assertValidPortions(input.portions);
  const ids = input.items.map((i) => i.food_id);
  const { data: foods, error: foodsErr } = await supabase
    .from('foods')
    .select('id,kcal,protein_g,carbs_g,fat_g,micros')
    .in('id', ids);
  if (foodsErr) throw new Error(foodsErr.message);
  if (foods.length !== new Set(ids).size) throw new Error('algún food_id no existe o no es visible');
  const byId = Object.fromEntries(foods.map((f) => [f.id, f]));
  const ingredients = input.items.map((i) => ({ food: byId[i.food_id], grams: i.grams }));
  const per100g = recipeResponse(ingredients, input.cooked_weight_g);

  const { data: recipe, error: recErr } = await supabase
    .from('recipes')
    .insert({
      owner: uid,
      name: input.name,
      cooked_weight_g: input.cooked_weight_g,
      source: 'ia_personal',
      portions: input.portions || [],
    })
    .select()
    .single();
  if (recErr) throw new Error(recErr.message);

  const { error: itemsErr } = await supabase
    .from('recipe_items')
    .insert(input.items.map((i) => ({ recipe_id: recipe.id, food_id: i.food_id, grams: i.grams })));
  if (itemsErr) {
    // ponytail: no real transaction over REST — best-effort rollback of the orphaned recipe.
    await supabase.from('recipes').delete().eq('id', recipe.id);
    throw new Error(itemsErr.message);
  }
  return { id: recipe.id, name: recipe.name, ...per100g };
}

async function updateFood(supabase, uid, foodId, patch) {
  const { data: existing, error: getErr } = await supabase.from('foods').select('*').eq('id', foodId).maybeSingle();
  if (getErr) throw new Error(getErr.message);
  if (!existing) throw new Error('food no encontrado');

  if (patch.micros !== undefined) assertValidMicros(patch.micros);
  assertNonNegative({
    kcal: patch.kcal,
    protein_g: patch.protein_g,
    carbs_g: patch.carbs_g,
    fat_g: patch.fat_g,
    density_g_ml: patch.density_g_ml,
  });
  if (patch.portions !== undefined) assertValidPortions(patch.portions);

  const merged = {
    name: patch.name ?? existing.name,
    brand: patch.brand !== undefined ? patch.brand : existing.brand,
    kcal: patch.kcal !== undefined ? Number(patch.kcal) : existing.kcal,
    protein_g: patch.protein_g ?? existing.protein_g,
    carbs_g: patch.carbs_g ?? existing.carbs_g,
    fat_g: patch.fat_g ?? existing.fat_g,
    micros: patch.micros ?? existing.micros,
    portions: patch.portions ?? existing.portions,
    density_g_ml: patch.density_g_ml !== undefined ? patch.density_g_ml : existing.density_g_ml,
  };
  const warnings = buildWarnings(merged);
  const changedFields = Object.keys(patch).filter((k) => patch[k] !== undefined);
  const path = decideUpdatePath(existing.owner, uid, changedFields);

  if (path === 'fork') {
    const { data, error } = await supabase
      .from('foods')
      .insert({ ...merged, owner: uid, source: 'ia_personal', reviewed_at: null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { forked: true, ...data, warnings };
  }

  const updatePayload = { ...merged, reviewed_at: null };
  if (path === 'update') updatePayload.source = 'ia_personal';
  const { data, error } = await supabase.from('foods').update(updatePayload).eq('id', foodId).select().single();
  if (error) throw new Error(error.message);
  return { forked: false, ...data, warnings };
}

// log_measurement: merge onto body_metrics (unique owner,day — same table as the
// Medidas tab). Merge instead of a blind upsert: a partial measurement does not
// overwrite the keys already saved that day (project priority: never lose data).
async function logMeasurement(supabase, uid, { day, metrics }) {
  assertValidBodyMetrics(metrics);
  const d = day || todayLocal();
  const { data: existing, error: getErr } = await supabase
    .from('body_metrics')
    .select('metrics')
    .eq('day', d)
    .maybeSingle();
  if (getErr) throw new Error(getErr.message);
  const merged = { ...(existing?.metrics || {}), ...metrics };
  const { data, error } = await supabase
    .from('body_metrics')
    .upsert({ owner: uid, day: d, metrics: merged }, { onConflict: 'owner,day' })
    .select('id,day,metrics')
    .single();
  if (error) throw new Error(error.message);
  return { ...data, warnings: bodyMetricWarnings(metrics) };
}

async function getMeasurements(supabase, { from, to }) {
  let q = supabase.from('body_metrics').select('id,day,metrics,note').order('day', { ascending: false });
  if (from) q = q.gte('day', from);
  if (to) q = q.lte('day', to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

// ── MCP server: a fresh instance per request (stateless) ───────────────────

function buildServer(supabase, uid) {
  const server = new McpServer(
    {
      name: 'nutrimetry',
      title: 'Nutrimetry',
      version: '1.0.0',
      websiteUrl: 'https://nutri.vryahn.com',
      icons: [{ src: 'https://nutri.vryahn.com/icon.svg', mimeType: 'image/svg+xml' }],
    },
    {
      instructions:
        'Registro nutricional personal. Valores por 100 g; cantidades siempre en gramos. Busca con search_catalog antes de registrar y usa food_id/recipe_id en log_entry.',
    }
  );

  server.registerTool(
    'search_catalog',
    {
      title: 'Buscar en el catálogo',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'Busca alimentos y recetas por nombre/marca (ilike). Valores por 100 g. is_mine indica si el ítem es propio (owner del food/receta); el catálogo base compartido (owner NULL) aparece con is_mine:false.',
      inputSchema: {
        query: z.string().min(1).describe('texto a buscar en name/brand'),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ query, limit }) => {
      const items = await searchCatalog(supabase, uid, query, limit);
      return toolResult(`${items.length} resultado(s) para "${query}".`, { items });
    }
  );

  server.registerTool(
    'log_entry',
    {
      title: 'Registrar consumo',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description:
        'Registra un consumo (cantidad SIEMPRE en gramos; el agua se registra con el food "Agua", grams = ml). Preferir food_id/recipe_id (de search_catalog); item (nombre) es fallback y puede enganchar un homónimo.',
      inputSchema: {
        food_id: z.string().uuid().optional(),
        recipe_id: z.string().uuid().optional(),
        item: z.string().optional().describe('nombre del alimento/receta, fallback si no hay id'),
        grams: z.number().positive(),
        label: z.string().optional().describe('nombre de la sección/etiqueta de comida'),
        day: z.string().optional().describe('AAAA-MM-DD, default hoy'),
      },
    },
    async (input) => {
      const entries = await logEntry(supabase, input);
      return toolResult('Registrado.', { entries });
    }
  );

  server.registerTool(
    'delete_entry',
    {
      title: 'Borrar registro',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description: 'Borra un registro de consumo por id (RLS limita a los propios).',
      inputSchema: { entry_id: z.string().uuid() },
    },
    async ({ entry_id }) => {
      const result = await deleteEntry(supabase, entry_id);
      return toolResult(result.deleted ? 'Borrado.' : 'No encontrado.', result);
    }
  );

  server.registerTool(
    'get_day',
    {
      title: 'Ver registros del día',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: 'Totales del día (daily_totals) + registros individuales (entry_nutrients), con etiqueta y nombre. Default hoy.',
      inputSchema: { day: z.string().optional().describe('AAAA-MM-DD, default hoy') },
    },
    async ({ day }) => {
      const result = await getDay(supabase, day);
      return toolResult(result.logged ? `Día ${result.day}: ${result.entries.length} registro(s).` : result.message, result);
    }
  );

  server.registerTool(
    'get_targets',
    {
      title: 'Ver objetivo del día',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: 'Objetivo resuelto para una fecha (día específico si existe, si no la fase dow vigente), con label/goal de la fase. Default hoy.',
      inputSchema: { day: z.string().optional().describe('AAAA-MM-DD, default hoy') },
    },
    async ({ day }) => {
      const result = await getTargets(supabase, day);
      return toolResult(result.resolved ? `Objetivo resuelto para ${result.day}.` : result.message, result);
    }
  );

  server.registerTool(
    'create_food',
    {
      title: 'Crear alimento',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description:
        'Crea un alimento en tu catálogo, TODO por 100 g. Guarda bajo responsabilidad del usuario; los avisos ⚠ (kcal vs macros, valores implausibles, componentes inconsistentes) se muestran también en la app y NO bloquean el guardado. Las claves de micros inválidas SÍ bloquean (error).',
      inputSchema: {
        name: z.string().min(1),
        brand: z.string().optional(),
        kcal: z.number().optional().describe('si se omite, se calcula por Atwater desde los macros'),
        protein_g: z.number(),
        carbs_g: z.number(),
        fat_g: z.number(),
        micros: microsSchema.optional().describe('claves EXACTAS de MICROS en domain.js, valores por 100 g'),
        portions: z.array(portionSchema).optional(),
        density_g_ml: z.number().positive().optional().describe('solo líquidos'),
      },
    },
    async (input) => {
      const food = await createFood(supabase, uid, input);
      return toolResult(`Alimento "${food.name}" creado.`, food);
    }
  );

  server.registerTool(
    'create_recipe',
    {
      title: 'Crear receta',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description:
        'Crea una receta a partir de ingredientes existentes en el catálogo (food_id + gramos). cooked_weight_g es el peso final tras cocinar; si se omite o es 0 se usa la suma de gramos de los ingredientes. Devuelve los valores por 100 g calculados.',
      inputSchema: {
        name: z.string().min(1),
        cooked_weight_g: z.number().positive(),
        items: z.array(z.object({ food_id: z.string().uuid(), grams: z.number().positive() })).min(1),
        portions: z.array(portionSchema).optional(),
      },
    },
    async (input) => {
      const recipe = await createRecipe(supabase, uid, input);
      return toolResult(`Receta "${recipe.name}" creada.`, recipe);
    }
  );

  server.registerTool(
    'update_food',
    {
      title: 'Editar alimento',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description:
        'Edita un food. Si es propio, actualiza en sitio (portions-only no cambia la fuente; cualquier otro campo marca source:"ia_personal" y limpia reviewed_at). Si es del catálogo base o de otro dueño (no editable), crea tu propia copia (forked:true) sin tocar el original. Prohibido: borrar foods o editar recetas vía MCP — hazlo en la app.',
      inputSchema: {
        food_id: z.string().uuid(),
        name: z.string().optional(),
        brand: z.string().optional(),
        kcal: z.number().optional(),
        protein_g: z.number().optional(),
        carbs_g: z.number().optional(),
        fat_g: z.number().optional(),
        micros: microsSchema.optional(),
        portions: z.array(portionSchema).optional(),
        density_g_ml: z.number().positive().optional(),
      },
    },
    async ({ food_id, ...patch }) => {
      const result = await updateFood(supabase, uid, food_id, patch);
      return toolResult(result.forked ? 'Se creó tu propia copia (fork).' : 'Actualizado.', result);
    }
  );

  server.registerTool(
    'log_measurement',
    {
      title: 'Registrar medición corporal',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description:
        'Guarda mediciones corporales (bioimpedancia, circunferencias) del día en la tab Medidas. Claves EXACTAS de BODY_METRICS en domain.js (peso_kg, grasa_pct, musculo_kg, agua_pct, grasa_visceral, metabolismo_basal_kcal, …); claves libres se rechazan. Merge con lo ya guardado ese día: solo pisa las claves enviadas.',
      inputSchema: {
        day: z.string().optional().describe('AAAA-MM-DD, default hoy'),
        metrics: z.record(z.string(), z.number()).describe('claves de BODY_METRICS, valores numéricos'),
      },
    },
    async (input) => {
      const result = await logMeasurement(supabase, uid, input);
      return toolResult(`Medición guardada para ${result.day}.`, result);
    }
  );

  server.registerTool(
    'get_measurements',
    {
      title: 'Ver mediciones corporales',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: 'Mediciones corporales por rango de fechas (ambos extremos opcionales), orden descendente por día.',
      inputSchema: {
        from: z.string().optional().describe('AAAA-MM-DD, inicio del rango'),
        to: z.string().optional().describe('AAAA-MM-DD, fin del rango'),
      },
    },
    async (input) => {
      const rows = await getMeasurements(supabase, input);
      return toolResult(`${rows.length} medición(es).`, { measurements: rows });
    }
  );

  return server;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
    return;
  }

  const authHeader = req.headers.authorization;
  const uid = await verifyToken(authHeader);
  if (!uid) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`);
    res.status(401).json({ error: 'unauthorized', error_description: 'Bearer token requerido o inválido.' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    db: { schema: 'nutri' },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  const server = buildServer(supabase, uid);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP handler error:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
}
