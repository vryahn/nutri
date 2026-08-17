-- 018: límites explícitos mín/máx por nutriente en targets.
-- `bounds` = jsonb { <clave>: { min?: number, max?: number } } con claves de macro
-- (kcal, protein_g, carbs_g, fat_g) o de MICROS. Complementa al objetivo (que sigue
-- siendo el número contra el que se mide el % y la barra): cuando una clave trae
-- bound explícito, Hoy y Dashboard clasifican contra [min, max]; si no, aplica el
-- arquetipo implícito de NUTRIENT_KIND (piso/techo/rango/diana) como hasta ahora.
-- Se escribe igual en las 7 filas dow de la fase (patrón de label/goal); los
-- overrides `day` llevan el suyo. Aditiva y retrocompatible: default '{}'.
-- Sin cambios de RLS, grants ni vistas (ninguna vista lee targets).

alter table nutri.targets add column bounds jsonb not null default '{}';
