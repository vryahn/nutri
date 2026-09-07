-- 021: reglas de ajuste por fase + procedencia de versiones creadas por regla.
-- `rules` = jsonb { paused_until?: date, kcal_min?: number, kcal_max?: number,
--   items: [ { id, kind, value, weeks?|days?, delta_carbs_g?, scope?: int[] (dows) | null, auto: bool } ] }.
-- Se escribe igual en las 7 filas dow de la fase (patrón de label/goal/bounds); los
-- overrides `day` la dejan en '{}'. La evaluación es cliente (domain.js evalRules);
-- al disparar, la app inserta una versión nueva de la fase con valid_from = mañana y
-- `applied_rule` = texto de procedencia (id de regla + valores). Manual = null.
-- Aditiva y retrocompatible. Sin cambios de RLS, grants ni vistas.

alter table nutri.targets add column rules jsonb not null default '{}';
alter table nutri.targets add column applied_rule text;
