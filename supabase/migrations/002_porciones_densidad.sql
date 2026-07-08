-- 002: porciones custom y densidad por alimento.
-- portions: jsonb [{name, grams}] — chips de cantidad al registrar.
-- density_g_ml: solo líquidos; al registrar permite capturar ml (ml × densidad → g).
-- Aditiva: no toca vistas ni RLS (foods ya está cubierta por policies y grants).

alter table nutri.foods add column portions jsonb not null default '[]';
alter table nutri.foods add column density_g_ml numeric check (density_g_ml > 0);
