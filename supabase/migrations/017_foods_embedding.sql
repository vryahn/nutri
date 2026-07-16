-- 017: búsqueda semántica del catálogo — pgvector + embeddings Gemini (768 dims, L2-normalizados)
-- El embedding se calcula client-side al guardar un food (embedText en src/lib/ai.js);
-- null = food sin embedding (creado por MCP/REST o sin VITE_GEMINI_KEY): sigue saliendo por ilike.

create extension if not exists vector with schema extensions;

alter table nutri.foods add column if not exists embedding extensions.vector(768);

-- ponytail: sin índice HNSW — catálogo ~300 filas, seq scan sobra; añadirlo si supera ~10k.
-- security invoker: RLS vigente (propios + catálogo base owner null, migración 015).
-- Con vectores L2-normalizados, distancia coseno <=> es la métrica correcta; max_dist recorta ruido.
create or replace function nutri.match_foods(q extensions.vector(768), n int default 8, max_dist float default 0.65)
returns setof nutri.foods
language sql stable
security invoker
set search_path = ''
as $$
  select * from nutri.foods
  where embedding is not null
    and embedding operator(extensions.<=>) q < max_dist
  order by embedding operator(extensions.<=>) q
  limit n;
$$;

grant execute on function nutri.match_foods(extensions.vector(768), int, float) to authenticated;
