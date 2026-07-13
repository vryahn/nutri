-- 014: merge atómico de prefs.data — fiabilidad de la persistencia de preferencias.
--
-- Problema: los escritores de prefs hacían read-modify-write desde el cliente
-- (SELECT data → {...data, clave} → UPSERT), 2 round-trips y dependiendo del
-- userId resuelto por auth.getUser() (llamada de RED: si tarda o falla, el id
-- queda null y el guardado se descartaba en silencio). Además Today.savePrefs
-- reemplazaba el jsonb COMPLETO desde su estado local parcial, pudiendo pisar
-- claves que no rastrea (p. ej. dashboards). Resultado: gráficas del Dashboard
-- que "no se guardaban" al refrescar.
--
-- Solución: un merge server-side atómico en UN solo round-trip, con el uid
-- derivado de auth.uid() en el servidor (no del cliente). `||` fusiona solo las
-- claves del patch; nunca pisa el resto de data. security invoker → respeta la
-- RLS de prefs (owner = auth.uid()). search_path='' por el lint del advisor.
create or replace function nutri.merge_prefs(patch jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  insert into nutri.prefs (owner, data)
  values ((select auth.uid()), patch)
  on conflict (owner) do update set data = nutri.prefs.data || excluded.data
  returning data;
$$;

grant execute on function nutri.merge_prefs(jsonb) to authenticated;
