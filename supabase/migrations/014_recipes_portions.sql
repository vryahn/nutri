-- 014: recipes.portions — porciones custom [{name, grams}], chips que SUMAN gramos al registrar.
-- Paridad con foods.portions (migración 002). No afecta el cálculo nutricional (recipe_per_100g).
-- RLS/grants: cubiertos por las policies existentes de nutri.recipes; añadir columna no requiere policy nueva.
alter table nutri.recipes add column portions jsonb not null default '[]';
