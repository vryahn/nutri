-- 004 — Reconstruir las 3 recetas saladas migradas desde Cronometer.
-- Los 9 ingredientes crudos no se migraron (en Cronometer vivían solo dentro de la
-- receta). Se crean aquí con valores por 100 g de USDA FoodData Central (Foundation/
-- SR Legacy, mismo mapeo que src/lib/sources.js), source='usda'. Pollo = pechuga CRUDA
-- (el peso cocido ya concentra la pérdida de agua). "Hierba de Provence" = tomillo seco
-- (proxy; no existe en FDC; impacto ínfimo, 2-3 g por lote).
-- Luego: construir recetas, reasignar registros históricos y borrar los compuestos viejos.
-- owner: a9706349-25dd-4d10-bb34-7b8e5770789a.

insert into nutri.foods (owner, name, source, kcal, protein_g, carbs_g, fat_g, micros) values
('a9706349-25dd-4d10-bb34-7b8e5770789a',$$Cubos de pechuga de pollo$$,'usda',120,22.5,0,2.62,'{"calcio_mg":5,"hierro_mg":0.37,"vit_b3_mg":9.6,"vit_b5_mg":1.5,"vit_b6_mg":0.811,"potasio_mg":334,"zinc_mg":0.68,"selenio_mcg":22.8,"vit_e_mg":0.56,"agua_ml":73.9,"grasa_sat_g":0.563,"vit_c_mg":0,"vit_b1_mg":0.094,"vit_b2_mg":0.177,"magnesio_mg":28,"fosforo_mg":213,"sodio_mg":45,"cobre_mg":0.037,"manganeso_mg":0.011,"vit_b12_mcg":0.21,"colesterol_mg":73,"grasa_trans_g":0.007,"azucar_g":0,"colina_mg":82.1,"vit_b9_mcg":9,"fibra_g":0,"alcohol_g":0,"vit_d_mcg":0,"vit_a_mcg":9,"vit_k_mcg":0,"luteina_zeaxantina_mcg":0,"beta_caroteno_mcg":0,"licopeno_mcg":0}'::jsonb),
('a9706349-25dd-4d10-bb34-7b8e5770789a',$$Pimiento morrón$$,'usda',26,0.99,6.03,0.3,'{"fibra_g":2.1,"vit_b9_mcg":46,"grasa_trans_g":0,"grasa_sat_g":0.059,"beta_caroteno_mcg":1620,"alcohol_g":0,"vit_c_mg":128,"colina_mg":5.6,"sodio_mg":4,"colesterol_mg":0,"vit_a_mcg":157,"licopeno_mcg":0,"azucar_g":4.2,"luteina_zeaxantina_mcg":51,"vit_k_mcg":4.9,"manganeso_mg":0.112,"vit_e_mg":1.58,"vit_b5_mg":0.317,"cobre_mg":0.017,"hierro_mg":0.43,"magnesio_mg":12,"fosforo_mg":26,"vit_b1_mg":0.054,"vit_b2_mg":0.085,"vit_b12_mcg":0,"agua_ml":92.2,"calcio_mg":7,"potasio_mg":211,"zinc_mg":0.25,"selenio_mcg":0.1,"vit_b3_mg":0.979,"vit_b6_mg":0.291,"vit_d_mcg":0}'::jsonb),
('a9706349-25dd-4d10-bb34-7b8e5770789a',$$Hierba de Provence$$,'usda',276,9.11,63.9,7.43,'{"agua_ml":7.79,"calcio_mg":1890,"potasio_mg":814,"zinc_mg":6.18,"vit_b3_mg":4.94,"hierro_mg":124,"magnesio_mg":220,"fosforo_mg":201,"sodio_mg":55,"cobre_mg":0.86,"manganeso_mg":7.87,"vit_b1_mg":0.513,"vit_b2_mg":0.399,"vit_b12_mcg":0,"grasa_sat_g":2.73,"colesterol_mg":0,"fibra_g":37,"selenio_mcg":4.6,"vit_k_mcg":1710,"beta_caroteno_mcg":2260,"vit_e_mg":7.48,"azucar_g":1.71,"vit_b6_mg":0.55,"alcohol_g":0,"vit_b9_mcg":274,"vit_c_mg":50,"licopeno_mcg":0,"vit_a_mcg":190,"luteina_zeaxantina_mcg":1900,"grasa_trans_g":0,"vit_d_mcg":0,"colina_mg":43.6}'::jsonb),
('a9706349-25dd-4d10-bb34-7b8e5770789a',$$Pimienta negra$$,'usda',251,10.4,64,3.26,'{"vit_b12_mcg":0,"colesterol_mg":0,"azucar_g":0.64,"vit_k_mcg":164,"alcohol_g":0,"colina_mg":11.3,"agua_ml":12.5,"selenio_mcg":4.9,"vit_e_mg":1.04,"calcio_mg":443,"potasio_mg":1330,"zinc_mg":1.19,"luteina_zeaxantina_mcg":454,"vit_b3_mg":1.14,"vit_b5_mg":1.4,"vit_b6_mg":0.291,"fibra_g":25.3,"hierro_mg":9.71,"magnesio_mg":171,"fosforo_mg":158,"sodio_mg":20,"cobre_mg":1.33,"manganeso_mg":12.8,"licopeno_mcg":20,"vit_c_mg":0,"vit_b1_mg":0.108,"vit_b2_mg":0.18,"vit_b9_mcg":17,"grasa_trans_g":0,"grasa_sat_g":1.39,"vit_a_mcg":27,"beta_caroteno_mcg":310,"vit_d_mcg":0}'::jsonb),
('a9706349-25dd-4d10-bb34-7b8e5770789a',$$Papas Idaho$$,'usda',79,2.14,18.1,0.08,'{"vit_c_mg":5.7,"colina_mg":12.6,"vit_b1_mg":0.082,"vit_b2_mg":0.033,"vit_b9_mcg":14,"vit_b12_mcg":0,"vit_k_mcg":1.8,"colesterol_mg":0,"hierro_mg":0.86,"magnesio_mg":23,"fosforo_mg":55,"sodio_mg":5,"cobre_mg":0.103,"manganeso_mg":0.157,"vit_b3_mg":1.04,"vit_b5_mg":0.301,"vit_b6_mg":0.345,"agua_ml":78.6,"calcio_mg":13,"potasio_mg":417,"zinc_mg":0.29,"selenio_mcg":0.4,"vit_e_mg":0.01,"beta_caroteno_mcg":0,"licopeno_mcg":0,"fibra_g":1.3,"azucar_g":0.62,"vit_a_mcg":0,"grasa_sat_g":0.026,"luteina_zeaxantina_mcg":5,"grasa_trans_g":0,"vit_d_mcg":0}'::jsonb),
('a9706349-25dd-4d10-bb34-7b8e5770789a',$$Jitomate$$,'usda',18,0.88,3.89,0.2,'{"colina_mg":6.7,"grasa_trans_g":0,"alcohol_g":0,"licopeno_mcg":2570,"vit_c_mg":13.7,"agua_ml":94.5,"colesterol_mg":0,"vit_b12_mcg":0,"azucar_g":2.63,"vit_a_mcg":42,"grasa_sat_g":0.028,"calcio_mg":10,"potasio_mg":237,"zinc_mg":0.17,"selenio_mcg":0,"vit_e_mg":0.54,"luteina_zeaxantina_mcg":123,"vit_b3_mg":0.594,"vit_b5_mg":0.089,"vit_b6_mg":0.08,"vit_k_mcg":7.9,"fibra_g":1.2,"hierro_mg":0.27,"magnesio_mg":11,"fosforo_mg":24,"sodio_mg":5,"cobre_mg":0.059,"manganeso_mg":0.114,"beta_caroteno_mcg":449,"vit_b1_mg":0.037,"vit_b2_mg":0.019,"vit_b9_mcg":15,"vit_d_mcg":0}'::jsonb),
('a9706349-25dd-4d10-bb34-7b8e5770789a',$$Cebolla blanca$$,'usda',40,1.1,9.34,0.1,'{"luteina_zeaxantina_mcg":4,"vit_b3_mg":0.116,"vit_b5_mg":0.123,"vit_b6_mg":0.12,"colina_mg":6.1,"azucar_g":4.24,"calcio_mg":23,"potasio_mg":146,"zinc_mg":0.17,"selenio_mcg":0.5,"vit_e_mg":0.02,"agua_ml":89.1,"licopeno_mcg":0,"vit_c_mg":7.4,"vit_b1_mg":0.046,"vit_b2_mg":0.027,"vit_b9_mcg":19,"vit_k_mcg":0.4,"grasa_sat_g":0.042,"alcohol_g":0,"fibra_g":1.7,"hierro_mg":0.21,"magnesio_mg":10,"fosforo_mg":29,"sodio_mg":4,"cobre_mg":0.039,"manganeso_mg":0.129,"beta_caroteno_mcg":1,"vit_a_mcg":0,"grasa_trans_g":0,"colesterol_mg":0,"vit_b12_mcg":0,"vit_d_mcg":0}'::jsonb),
('a9706349-25dd-4d10-bb34-7b8e5770789a',$$Ajo$$,'usda',149,6.36,33.1,0.5,'{"vit_e_mg":0.08,"colina_mg":23.2,"luteina_zeaxantina_mcg":16,"vit_a_mcg":0,"beta_caroteno_mcg":5,"vit_k_mcg":1.7,"licopeno_mcg":0,"alcohol_g":0,"azucar_g":1,"grasa_trans_g":0,"grasa_sat_g":0.089,"colesterol_mg":0,"vit_c_mg":31.2,"vit_b1_mg":0.2,"vit_b2_mg":0.11,"vit_b9_mcg":3,"vit_b12_mcg":0,"fibra_g":2.1,"hierro_mg":1.7,"magnesio_mg":25,"fosforo_mg":153,"sodio_mg":17,"cobre_mg":0.299,"manganeso_mg":1.67,"calcio_mg":181,"potasio_mg":401,"zinc_mg":1.16,"vit_b3_mg":0.7,"vit_b5_mg":0.596,"vit_b6_mg":1.24,"agua_ml":58.6,"vit_d_mcg":0,"selenio_mcg":14.2}'::jsonb),
('a9706349-25dd-4d10-bb34-7b8e5770789a',$$Carne picada pulpa bola de res$$,'usda',124,23.6,0,3.26,'{"alcohol_g":0,"fibra_g":0,"hierro_mg":2.35,"magnesio_mg":12,"fosforo_mg":221,"sodio_mg":56,"cobre_mg":0.048,"manganeso_mg":0.004,"vit_a_mcg":2,"beta_caroteno_mcg":0,"vit_d_mcg":0,"licopeno_mcg":0,"vit_c_mg":0,"vit_b1_mg":0.064,"vit_b2_mg":0.227,"vit_b9_mcg":4,"vit_b12_mcg":1.66,"vit_k_mcg":1.6,"colesterol_mg":61,"grasa_trans_g":0.144,"grasa_sat_g":1.25,"agua_ml":72.7,"azucar_g":0,"calcio_mg":13,"potasio_mg":309,"zinc_mg":3.78,"selenio_mcg":21.9,"vit_e_mg":0.24,"luteina_zeaxantina_mcg":0,"vit_b3_mg":6.67,"vit_b5_mg":0.35,"vit_b6_mg":0.641,"colina_mg":65.4}'::jsonb);

do $do$
declare rid uuid;
  poll  uuid := (select id from nutri.foods where name=$n$Cubos de pechuga de pollo$n$ and source='usda');
  pim   uuid := (select id from nutri.foods where name=$n$Pimiento morrón$n$ and source='usda');
  prov  uuid := (select id from nutri.foods where name=$n$Hierba de Provence$n$ and source='usda');
  pn    uuid := (select id from nutri.foods where name=$n$Pimienta negra$n$ and source='usda');
  papa  uuid := (select id from nutri.foods where name=$n$Papas Idaho$n$ and source='usda');
  jito  uuid := (select id from nutri.foods where name=$n$Jitomate$n$ and source='usda');
  ceb   uuid := (select id from nutri.foods where name=$n$Cebolla blanca$n$ and source='usda');
  ajo   uuid := (select id from nutri.foods where name=$n$Ajo$n$ and source='usda');
  carne uuid := (select id from nutri.foods where name=$n$Carne picada pulpa bola de res$n$ and source='usda');
  aceite_oliva uuid := 'e43c3580-4d41-427e-8e06-173cb72739d7';
  aceite_agua  uuid := '0935160f-661a-4b6b-af60-08ced15ad0c5';
  sal          uuid := '65a4b96a-12ef-4500-a46e-2e24368c21eb';
begin
  -- Pollo con verduras alto en proteína (1707 g)
  insert into nutri.recipes(owner,name,cooked_weight_g)
    values ('a9706349-25dd-4d10-bb34-7b8e5770789a','Pollo con verduras alto en proteína',1707) returning id into rid;
  insert into nutri.recipe_items(recipe_id,food_id,grams) values
    (rid,poll,1800),(rid,pim,120),(rid,prov,2.6),(rid,pn,2),(rid,aceite_oliva,30);
  update nutri.entries set food_id=null, recipe_id=rid where food_id='1974c91c-536b-42b7-bd9c-1522be4b6207';
  delete from nutri.foods where id='1974c91c-536b-42b7-bd9c-1522be4b6207';

  -- Papas fritas caseras (615.09 g)
  insert into nutri.recipes(owner,name,cooked_weight_g)
    values ('a9706349-25dd-4d10-bb34-7b8e5770789a','Papas fritas caseras',615.09) returning id into rid;
  insert into nutri.recipe_items(recipe_id,food_id,grams) values
    (rid,papa,1400),(rid,aceite_agua,14);
  update nutri.entries set food_id=null, recipe_id=rid where food_id='9d3fbb01-4744-42aa-b5c2-6972828474fd';
  delete from nutri.foods where id='9d3fbb01-4744-42aa-b5c2-6972828474fd';

  -- Carne con verduras alta en proteína (1648.2 g)
  insert into nutri.recipes(owner,name,cooked_weight_g)
    values ('a9706349-25dd-4d10-bb34-7b8e5770789a','Carne con verduras alta en proteína',1648.2) returning id into rid;
  insert into nutri.recipe_items(recipe_id,food_id,grams) values
    (rid,jito,960),(rid,ceb,458),(rid,ajo,6.5),(rid,prov,1.7),(rid,carne,1000),(rid,pn,1),(rid,aceite_oliva,20),(rid,sal,4.6);
  update nutri.entries set food_id=null, recipe_id=rid where food_id='a20f4c39-df85-467b-a3eb-5b289e53d412';
  delete from nutri.foods where id='a20f4c39-df85-467b-a3eb-5b289e53d412';
end $do$;
