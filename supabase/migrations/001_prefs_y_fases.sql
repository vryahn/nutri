-- 001: tabla prefs (preferencias por usuario, jsonb) + nombre de fase en targets.
-- Aplicada en producción el 2026-07-07.

create table nutri.prefs (
  owner uuid primary key default auth.uid() references auth.users(id),
  data  jsonb not null default '{}'
);

alter table nutri.prefs enable row level security;

create policy prefs_own on nutri.prefs for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- El "grant all on all tables" de la migración 000 fue puntual; las tablas
-- nuevas necesitan grant explícito.
grant all on nutri.prefs to authenticated;

-- Nombre de fase (cosmético) para versiones de semana en targets.
-- resolveTarget NO cambia: la resolución sigue siendo day > dow + valid_from.
alter table nutri.targets add column label text;
