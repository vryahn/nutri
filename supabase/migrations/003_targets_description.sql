-- 003: descripción de fase en targets.
-- Añade una columna de texto libre para describir el objetivo de una fase
-- (p. ej. "Superávit ligero (+250 kcal). Prioridad: proteína ≥ 1.8 g/kg").
-- Se escribe en las 7 filas dow de cada versión de semana, mismo patrón que
-- `label`. Las filas de overrides (day != null) la dejan en null.
-- Aditiva y retrocompatible: el código en producción la ignora sin romperse.
-- Sin cambios de RLS, grants ni vistas (ninguna vista lee targets).

alter table nutri.targets add column description text;
