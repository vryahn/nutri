-- 010: meta de la fase en targets.
-- Marca el régimen de una fase (déficit / volumen / recomposición / mantenimiento)
-- para poder filtrar el Dashboard por régimen y ver el histórico de todas las
-- fases con la misma meta, aunque no sean contiguas.
-- Se escribe en las 7 filas dow de cada versión de semana, mismo patrón que
-- `label` y `description`. Las filas de override (day != null) la dejan en null.
-- Nullable: las fases previas a esta migración no tienen meta y siguen válidas.
-- CHECK cerrado: el filtro del Dashboard depende de que el valor sea uno de los
-- cuatro; un typo silencioso dejaría días fuera de su régimen.
-- Aditiva y retrocompatible. Sin cambios de RLS, grants ni vistas.

alter table nutri.targets add column goal text
  check (goal in ('deficit', 'volumen', 'recomposicion', 'mantenimiento'));
