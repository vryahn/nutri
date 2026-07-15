-- 015_catalogo_base_compartido.sql
-- Catálogo base compartido a nivel app: filas de nutri.foods con owner NULL,
-- visibles para todos los usuarios e inmutables desde clientes (las policies de
-- escritura siguen exigiendo owner = auth.uid(), que nunca matchea NULL).
-- Consolida el lote USDA sembrado el 2026-07-15 (144 alimentos duplicados por
-- usuario) en un único set base: el set del usuario maestro pasa a owner NULL y
-- las copias de los demás owners se borran, remapeando antes sus referencias.

-- A. owner admite NULL (= fila del catálogo base).
alter table nutri.foods alter column owner drop not null;

-- B. Lectura: catálogo propio + catálogo base. Escrituras sin cambio.
alter policy foods_sel on nutri.foods using (owner = auth.uid() or owner is null);

-- C. Consolidación del lote 2026-07-15.
-- Maestro = el owner cuyo lote se insertó primero (las demás copias se
-- duplicaron server-side después).
create temporary table _lote as
  select id, owner, name, created_at
  from nutri.foods
  where source = 'usda' and created_at::date = date '2026-07-15';

create temporary table _master as
  select owner from _lote group by owner order by min(created_at) limit 1;

create temporary table _base as
  select id, name from _lote where owner = (select owner from _master);

-- Copias de otros owners, mapeadas a su fila base por nombre.
create temporary table _dupes as
  select l.id as dup_id, l.owner as dup_owner, b.id as base_id
  from _lote l
  join _base b on b.name = l.name
  where l.owner <> (select owner from _master);

-- Remapear referencias existentes a las copias antes de borrarlas.
update nutri.entries e
set food_id = d.base_id
from _dupes d
where e.food_id = d.dup_id;

update nutri.recipe_items ri
set food_id = d.base_id
from _dupes d
where ri.food_id = d.dup_id;

delete from nutri.foods f using _dupes d where f.id = d.dup_id;

-- El set del maestro se convierte en catálogo base.
update nutri.foods set owner = null where id in (select id from _base);

drop table _dupes;
drop table _base;
drop table _master;
drop table _lote;
