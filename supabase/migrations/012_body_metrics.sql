-- 012: tabla body_metrics — medidas corporales por día (peso, %grasa, cintura…).
-- Anula SPEC §11 por decisión explícita del usuario (2026-07-11): peso/composición
-- corporal vivían en Notion/Hevy; ahora también se registran aquí.
-- Patrón idéntico a prefs/entries: privada por usuario. `metrics` jsonb extensible
-- como foods.micros — claves nuevas (BODY_METRICS en domain.js) NO requieren migración.

create table nutri.body_metrics (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id),
  day        date not null default current_date,
  metrics    jsonb not null default '{}',   -- claves de BODY_METRICS, valores numéricos
  note       text,
  created_at timestamptz not null default now(),
  unique (owner, day)                        -- una fila por día; su índice cubre la FK owner
);

alter table nutri.body_metrics enable row level security;

-- Privada por usuario; idiom (select auth.uid()) para no re-evaluar por fila (migración 011).
create policy body_metrics_own on nutri.body_metrics for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

-- Las tablas nuevas necesitan grant explícito (el "grant all" de la 000 fue puntual).
grant all on nutri.body_metrics to authenticated;
