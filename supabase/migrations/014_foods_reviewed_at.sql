-- 014: marca de "revisado por el usuario" para los avisos ⚠ de un alimento.
-- Los avisos (kcal vs Atwater, macros implausibles, componentes inconsistentes) se
-- calculan al vuelo en cliente; esta columna NO los desactiva: solo registra que el
-- usuario ya verificó esos valores y decidió que son correctos. Cualquier guardado
-- del alimento la limpia (null), así una edición vuelve a exponer el aviso.
alter table nutri.foods add column reviewed_at timestamptz;
