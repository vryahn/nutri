-- 020: seed_demo(lang) — demo en el idioma del visitante. YA APLICADA en
-- producción vía MCP (2026-08-20). Con 'en' siembra etiquetas, recetas, fases y
-- COPIAS propias en inglés de los alimentos usados (el catálogo base en español
-- no se toca). El cliente pasa getLang(). Sustituye a seed_demo() de la 019.

drop function if exists nutri.seed_demo();

create or replace function nutri.seed_demo(lang text default 'es')
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  en boolean := (lang = 'en');
  lbl uuid[];
  agua_id uuid;
  r_chil uuid;
  r_avena uuid;
  d int;
  ord int;
  rec record;
  jit numeric;
begin
  if uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) is distinct from true then
    raise exception 'seed_demo: solo cuentas demo anónimas';
  end if;
  if exists (select 1 from nutri.prefs where owner = uid) then
    return; -- idempotente
  end if;

  if en then
    insert into nutri.meal_labels (owner, name, sort_order) values
      (uid,'Breakfast',0),(uid,'Lunch',1),(uid,'Dinner',2),(uid,'Snack',3);
  else
    insert into nutri.meal_labels (owner, name, sort_order) values
      (uid,'Desayuno',0),(uid,'Comida',1),(uid,'Cena',2),(uid,'Snack',3);
  end if;
  select array_agg(id order by sort_order) into lbl from nutri.meal_labels where owner = uid;

  insert into nutri.foods (owner, name, kcal, protein_g, carbs_g, fat_g, micros, source)
  values (uid, case when en then 'Water' else 'Agua' end, 0,0,0,0,'{"agua_ml":100}'::jsonb,'manual')
  returning id into agua_id;

  insert into nutri.prefs (owner, data) values (uid, jsonb_build_object(
    'water_food_id', agua_id,
    'water_glass_ml', 250,
    'fav_micros', jsonb_build_array('fibra_g','azucar_g','grasa_sat_g'),
    'fav_body', jsonb_build_array('peso_kg','cintura_cm','grasa_pct')));

  insert into nutri.targets (owner, dow, valid_from, kcal, protein_g, carbs_g, fat_g, micros, label, goal)
  select uid, dw, current_date - 34, 1900, 145, 190, 60,
    '{"sodio_mg":2300,"potasio_mg":3500,"magnesio_mg":400,"fibra_g":30,"azucar_g":50,"grasa_sat_g":20,"agua_ml":2500}'::jsonb,
    case when en then 'Cutting' else 'Definición' end, 'deficit'
  from generate_series(0,6) dw;
  insert into nutri.targets (owner, dow, valid_from, kcal, protein_g, carbs_g, fat_g, micros, label, goal)
  select uid, dw, current_date - 13, 2150, 150, 225, 70,
    '{"sodio_mg":2300,"potasio_mg":3500,"magnesio_mg":400,"fibra_g":32,"azucar_g":55,"grasa_sat_g":22,"agua_ml":2500}'::jsonb,
    case when en then 'Recomposition' else 'Recomposición' end, 'recomposicion'
  from generate_series(0,6) dw;

  -- Traducciones de los alimentos que usa el plan (base catalog es → en)
  create temp table _en(es text primary key, en text) on commit drop;
  insert into _en values
    ('Café, preparado','Coffee, brewed'),('Huevo entero, crudo','Egg, whole, raw'),
    ('Tortilla de maíz','Corn tortilla'),('Frijol negro, cocido','Black beans, cooked'),
    ('Aguacate, crudo','Avocado, raw'),('Yogur griego natural','Greek yogurt, plain'),
    ('Fresa, cruda','Strawberries, raw'),('Almendra','Almonds'),('Miel de abeja','Honey'),
    ('Pan integral','Whole wheat bread'),('Naranja, cruda','Orange, raw'),
    ('Hojuelas de maíz (cereal)','Corn flakes cereal'),('Leche descremada','Skim milk'),
    ('Plátano, crudo','Banana, raw'),('Pechuga de pollo, cruda','Chicken breast, raw'),
    ('Arroz blanco, cocido','White rice, cooked'),('Bistec de res (sirloin), crudo','Beef sirloin steak, raw'),
    ('Papa, cruda','Potato, raw'),('Ejote, crudo','Green beans, raw'),('Salmón, crudo','Salmon, raw'),
    ('Quinoa, cocida','Quinoa, cooked'),('Brócoli, crudo','Broccoli, raw'),('Aceite de oliva','Olive oil'),
    ('Lenteja, cocida','Lentils, cooked'),('Arroz integral, cocido','Brown rice, cooked'),
    ('Jitomate, crudo','Tomato, raw'),('Queso fresco (panela)','Queso fresco (panela cheese)'),
    ('Tostada de maíz','Corn tostada'),('Tilapia, cruda','Tilapia, raw'),
    ('Lechuga romana, cruda','Romaine lettuce, raw'),('Pepino, crudo','Cucumber, raw'),
    ('Queso oaxaca','Oaxaca cheese'),('Champiñón, crudo','Mushrooms, raw'),
    ('Pechuga de pavo, cruda','Turkey breast, raw'),('Yogur natural','Plain yogurt'),
    ('Nuez de la India','Cashews'),('Caldo de pollo, bajo en sodio','Chicken broth, low sodium'),
    ('Zanahoria, cruda','Carrot, raw'),('Calabacita, cruda','Zucchini, raw'),
    ('Manzana, cruda','Apple, raw'),('Cacahuate','Peanuts'),('Limón, crudo','Lime, raw'),
    ('Zarzamora, cruda','Blackberries, raw'),('Chocolate amargo (70% cacao)','Dark chocolate (70% cacao)'),
    ('Aceite de canola','Canola oil'),('Cebolla, cruda','Onion, raw'),
    ('Chile jalapeño, crudo','Jalapeño pepper, raw'),('Crema ácida','Sour cream'),
    ('Avena, cocida','Oatmeal, cooked'),('Leche entera','Whole milk'),
    ('Semilla de chía','Chia seeds');

  -- _map: nombre-es del plan → food_id a usar (base en es; copia propia en en)
  create temp table _map(es text primary key, fid uuid) on commit drop;
  if en then
    insert into nutri.foods (owner, name, brand, kcal, protein_g, carbs_g, fat_g, micros, source, portions, density_g_ml)
    select uid, e.en, f.brand, f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.micros, f.source, f.portions, f.density_g_ml
    from nutri.foods f join _en e on f.name = e.es where f.owner is null;
    insert into _map select e.es, f.id from nutri.foods f join _en e on f.name = e.en where f.owner = uid;
  else
    insert into _map select f.name, f.id from nutri.foods f join _en e on f.name = e.es where f.owner is null;
  end if;

  insert into nutri.recipes (owner, name, cooked_weight_g, source)
  values (uid, case when en then 'Green chilaquiles with chicken' else 'Chilaquiles verdes con pollo' end, 700, 'manual')
  returning id into r_chil;
  insert into nutri.recipe_items (recipe_id, food_id, grams)
  select r_chil, m.fid, v.g::numeric from (values
    ('Tortilla de maíz',240),('Aceite de canola',20),('Jitomate, crudo',250),('Cebolla, cruda',50),
    ('Chile jalapeño, crudo',20),('Queso fresco (panela)',60),('Crema ácida',40),('Pechuga de pollo, cruda',180)
  ) v(n,g) join _map m on m.es = v.n;

  insert into nutri.recipes (owner, name, cooked_weight_g, source)
  values (uid, case when en then 'Oatmeal with fruit and chia' else 'Avena con fruta y chía' end, 560, 'manual')
  returning id into r_avena;
  insert into nutri.recipe_items (recipe_id, food_id, grams)
  select r_avena, m.fid, v.g::numeric from (values
    ('Avena, cocida',250),('Leche entera',200),('Plátano, crudo',100),('Semilla de chía',15),('Miel de abeja',10)
  ) v(n,g) join _map m on m.es = v.n;

  create temp table _plan (slot int, variant int, item text, grams numeric, is_recipe boolean default false) on commit drop;
  insert into _plan (slot, variant, item, grams, is_recipe) values
    (0,0,'avena',350,true),(0,0,'Café, preparado',250,false),
    (0,1,'Huevo entero, crudo',110,false),(0,1,'Tortilla de maíz',60,false),(0,1,'Frijol negro, cocido',90,false),(0,1,'Aguacate, crudo',50,false),(0,1,'Café, preparado',250,false),
    (0,2,'Yogur griego natural',170,false),(0,2,'Fresa, cruda',100,false),(0,2,'Almendra',20,false),(0,2,'Miel de abeja',10,false),(0,2,'Café, preparado',250,false),
    (0,3,'Pan integral',70,false),(0,3,'Huevo entero, crudo',110,false),(0,3,'Aguacate, crudo',60,false),(0,3,'Naranja, cruda',150,false),
    (0,4,'Hojuelas de maíz (cereal)',40,false),(0,4,'Leche descremada',240,false),(0,4,'Plátano, crudo',100,false),(0,4,'Café, preparado',250,false),
    (1,0,'Pechuga de pollo, cruda',180,false),(1,0,'Arroz blanco, cocido',150,false),(1,0,'Frijol negro, cocido',100,false),(1,0,'Tortilla de maíz',60,false),(1,0,'Aguacate, crudo',40,false),
    (1,1,'chilaquiles',400,true),
    (1,2,'Bistec de res (sirloin), crudo',160,false),(1,2,'Papa, cruda',200,false),(1,2,'Ejote, crudo',100,false),(1,2,'Tortilla de maíz',30,false),
    (1,3,'Salmón, crudo',150,false),(1,3,'Quinoa, cocida',150,false),(1,3,'Brócoli, crudo',120,false),(1,3,'Aceite de oliva',10,false),
    (1,4,'Lenteja, cocida',250,false),(1,4,'Arroz integral, cocido',120,false),(1,4,'Jitomate, crudo',80,false),(1,4,'Queso fresco (panela)',40,false),(1,4,'Tostada de maíz',30,false),
    (2,0,'Tilapia, cruda',140,false),(2,0,'Lechuga romana, cruda',60,false),(2,0,'Jitomate, crudo',80,false),(2,0,'Pepino, crudo',60,false),(2,0,'Aceite de oliva',10,false),(2,0,'Tortilla de maíz',30,false),
    (2,1,'Tortilla de maíz',90,false),(2,1,'Queso oaxaca',60,false),(2,1,'Champiñón, crudo',80,false),(2,1,'Aguacate, crudo',40,false),
    (2,2,'Pechuga de pavo, cruda',120,false),(2,2,'Pan integral',60,false),(2,2,'Jitomate, crudo',50,false),(2,2,'Queso fresco (panela)',30,false),
    (2,3,'Yogur natural',170,false),(2,3,'Nuez de la India',25,false),(2,3,'Plátano, crudo',80,false),
    (2,4,'Caldo de pollo, bajo en sodio',300,false),(2,4,'Pechuga de pollo, cruda',80,false),(2,4,'Zanahoria, cruda',60,false),(2,4,'Calabacita, cruda',80,false),(2,4,'Arroz blanco, cocido',60,false),
    (3,0,'Manzana, cruda',150,false),(3,0,'Cacahuate',30,false),
    (3,1,'Plátano, crudo',120,false),
    (3,2,'Zanahoria, cruda',100,false),(3,2,'Pepino, crudo',100,false),(3,2,'Limón, crudo',20,false),
    (3,3,'Yogur griego natural',150,false),(3,3,'Zarzamora, cruda',80,false),
    (3,4,'Chocolate amargo (70% cacao)',20,false),(3,4,'Almendra',20,false);

  for d in 0..34 loop
    ord := 0;
    for rec in
      select p.* from _plan p
      where p.variant = case when p.slot = 0 then d % 5
                             when p.slot = 1 then (d + 2) % 5
                             when p.slot = 2 then (d + 3) % 5
                             else (d + 1) % 5 end
        and not (p.slot = 2 and d in (6, 20))   -- dos cenas omitidas: días incompletos realistas
        and not (p.slot = 3 and d % 3 = 0)      -- snack no diario
      order by p.slot
    loop
      jit := greatest(5, round((rec.grams * (0.9 + random() * 0.2)) / 5) * 5);
      if rec.is_recipe then
        insert into nutri.entries (owner, day, meal_label_id, recipe_id, grams, sort_order)
        values (uid, current_date - d, lbl[rec.slot + 1],
                case rec.item when 'chilaquiles' then r_chil else r_avena end, jit, ord);
      else
        insert into nutri.entries (owner, day, meal_label_id, food_id, grams, sort_order)
        select uid, current_date - d, lbl[rec.slot + 1], m.fid, jit, ord
        from _map m where m.es = rec.item;
      end if;
      ord := ord + 1;
    end loop;

    insert into nutri.entries (owner, day, food_id, grams, sort_order)
    select uid, current_date - d, agua_id, round(w.g * (0.85 + random() * 0.3)), ord + w.rn
    from (values (500, 1), (400, 2), (350, 3)) w(g, rn);

    if d % 3 = 0 then
      insert into nutri.body_metrics (owner, day, metrics) values (uid, current_date - d,
        jsonb_build_object(
          'peso_kg',    round((76.8 + d * 0.045 + (random() - 0.5) * 0.4)::numeric, 1),
          'cintura_cm', round((86.2 + d * 0.05  + (random() - 0.5) * 0.6)::numeric, 1),
          'grasa_pct',  round((20.8 + d * 0.035 + (random() - 0.5) * 0.4)::numeric, 1)));
    end if;
  end loop;
end
$fn$;

revoke all on function nutri.seed_demo(text) from public;
revoke all on function nutri.seed_demo(text) from anon;
grant execute on function nutri.seed_demo(text) to authenticated;
