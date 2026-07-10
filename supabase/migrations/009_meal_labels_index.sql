-- 009_meal_labels_index.sql
-- Índice (owner, sort_order) en meal_labels. YA APLICADO en prod como
-- meal_labels_owner_sort_order_idx; este archivo solo deja el repo alineado.
-- Nota: la tabla ronda las 12 filas, así que el planner sigue haciendo seq scan.
-- No aporta rendimiento hoy; se conserva por si la tabla crece.

create index if not exists meal_labels_owner_sort_order_idx
  on nutri.meal_labels (owner, sort_order);
