-- 003 — Reconstruir recetas migradas desde Cronometer.
-- Convierte los "alimentos-receta" compuestos importados de Cronometer en recetas reales
-- (nutri.recipes + recipe_items desde ingredientes ya auditados en el catálogo),
-- reasigna sus registros históricos al recipe_id, y borra el alimento-receta compuesto.
-- Solo las 4 recetas cuyos ingredientes YA existen en el catálogo. Las 3 saladas
-- (pollo/papas/carne) quedan pendientes: sus 9 ingredientes crudos no se migraron.
-- owner: a9706349-25dd-4d10-bb34-7b8e5770789a (único dueño del catálogo).

do $$
declare rid uuid;
begin
  -- A · Yoghurt con nuez (peso cocido 270 g)
  insert into nutri.recipes(owner, name, cooked_weight_g)
    values ('a9706349-25dd-4d10-bb34-7b8e5770789a', 'Yoghurt con nuez', 270)
    returning id into rid;
  insert into nutri.recipe_items(recipe_id, food_id, grams) values
    (rid, 'b3334cb3-8090-43b7-8245-0f96342993d1', 250),  -- Yoghurt natural Skyr
    (rid, 'c74faee8-7696-4c5c-8928-9a27bee1d562', 20);   -- Nuez de Castilla
  update nutri.entries set food_id = null, recipe_id = rid
    where food_id = '8dbb642c-aca0-4e90-a76c-2888c04b27e4';
  delete from nutri.foods where id = '8dbb642c-aca0-4e90-a76c-2888c04b27e4';

  -- B · Pan con crema de cacahuate (peso 35 g)
  insert into nutri.recipes(owner, name, cooked_weight_g)
    values ('a9706349-25dd-4d10-bb34-7b8e5770789a', 'Pan con crema de cacahuate', 35)
    returning id into rid;
  insert into nutri.recipe_items(recipe_id, food_id, grams) values
    (rid, 'db000994-e9f2-41b9-9f45-0b377ef262c5', 25),   -- Pan de masa madre
    (rid, '0b0be940-4e90-458f-bd63-e4218e2fd671', 10);   -- Crema de cacahuate natural
  update nutri.entries set food_id = null, recipe_id = rid
    where food_id = '5a4ecb20-6b7c-47dc-914d-355487fb1500';
  delete from nutri.foods where id = '5a4ecb20-6b7c-47dc-914d-355487fb1500';

  -- C · Batido de proteína con zarzamoras (peso 330 g)
  insert into nutri.recipes(owner, name, cooked_weight_g)
    values ('a9706349-25dd-4d10-bb34-7b8e5770789a', 'Batido de proteína con zarzamoras', 330)
    returning id into rid;
  insert into nutri.recipe_items(recipe_id, food_id, grams) values
    (rid, '2b75b173-46ad-4182-982b-4982bfbeb683', 50),   -- Proteína WP100
    (rid, '2a132afa-fa5e-47c0-ac88-206300f6a4da', 250),  -- Leche alta en fibra
    (rid, 'ad7bcffe-e8f9-4732-9f2b-3e064e46486e', 30);   -- Zarzamoras
  update nutri.entries set food_id = null, recipe_id = rid
    where food_id = '9edb3051-e75c-4080-a643-2f51cb11abe1';
  delete from nutri.foods where id = '9edb3051-e75c-4080-a643-2f51cb11abe1';

  -- D · Batido post-entreno (peso 54 g)
  insert into nutri.recipes(owner, name, cooked_weight_g)
    values ('a9706349-25dd-4d10-bb34-7b8e5770789a', 'Batido post-entreno', 54)
    returning id into rid;
  insert into nutri.recipe_items(recipe_id, food_id, grams) values
    (rid, '2b75b173-46ad-4182-982b-4982bfbeb683', 50),   -- Proteína WP100
    (rid, '2a65c9f4-dc8a-4f54-aaee-869ce5a5d7ef', 2),    -- Café
    (rid, '222edf15-43fb-41f7-8fc9-4a80d3378398', 2);    -- Canela molida
  update nutri.entries set food_id = null, recipe_id = rid
    where food_id = '1d27799c-2412-487d-9c26-b0bfcd8cc190';
  delete from nutri.foods where id = '1d27799c-2412-487d-9c26-b0bfcd8cc190';
end $$;
