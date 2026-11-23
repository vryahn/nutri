-- Run as an admin in one SQL batch. Synthetic users and targets are rolled back.
begin;

do $$
begin
  if has_function_privilege('anon', 'nutri.targets_wizard_snapshot()', 'EXECUTE')
     or has_function_privilege('anon', 'nutri.save_targets_wizard(date,jsonb,jsonb,jsonb,boolean)', 'EXECUTE') then
    raise exception 'Anon can execute a targets wizard RPC';
  end if;
end $$;

insert into auth.users (id) values
  ('02700000-0000-4000-8000-000000000001'),
  ('02700000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '02700000-0000-4000-8000-000000000002', true);
insert into nutri.targets (day, kcal, label) values ('2099-01-03', 3500, 'Fixture owner B');

select set_config('request.jwt.claim.sub', '02700000-0000-4000-8000-000000000001', true);
insert into nutri.targets (dow, valid_from, kcal, applied_rule) values
  (0, '2099-01-01', 2100.333333333333333333333333, 'Fixture rule'),
  (0, '2099-02-01', 3100, null);
insert into nutri.targets (day, valid_from, kcal, label, description, goal, micros, bounds, rules, applied_rule)
values ('2099-01-03', '2098-01-01', 2300, null, 'Fixture exception', 'mantenimiento',
        '{"agua_ml": 3000}', '{"kcal": {"max": 2600}}', '{"items": []}', 'Fixture annotation');

do $$
declare
  v_start date := '2099-01-01';
  v_existing date := '2099-01-03';
  v_new date := '2099-01-04';
  v_phase jsonb;
  v_exceptions jsonb;
  v_expected jsonb;
  v_before jsonb;
  v_phase_id uuid;
  v_exception_id uuid;
begin
  if jsonb_array_length(nutri.targets_wizard_snapshot()) <> 3 then
    raise exception 'Snapshot leaks foreign targets or loses owned targets';
  end if;
  select id into strict v_phase_id from nutri.targets where dow = 0 and valid_from = v_start;
  select id into strict v_exception_id from nutri.targets where day = v_existing;
  select jsonb_agg(jsonb_build_object('owner', auth.uid(), 'dow', dow, 'valid_from', v_start,
      'kcal', 2000, 'protein_g', null, 'rules', '{"paused_until": "2099-02-01"}'::jsonb))
  into v_phase from generate_series(0, 6) dow;
  v_exceptions := jsonb_build_array(
    jsonb_build_object('owner', auth.uid(), 'day', v_existing, 'kcal', null, 'label', 'Previous'),
    jsonb_build_object('owner', auth.uid(), 'day', v_new, 'kcal', 2400, 'label', 'New')
  );
  select jsonb_agg(row -> 'revision') into v_expected
  from jsonb_array_elements(nutri.targets_wizard_snapshot()) row
  where row ->> 'valid_from' = v_start::text or row ->> 'day' = v_existing::text;
  v_before := nutri.targets_wizard_snapshot();

  begin
    perform nutri.save_targets_wizard(v_start, v_phase, v_exceptions, v_expected, false);
    raise exception 'Replacement succeeded without confirmation';
  exception when sqlstate 'PT422' then null;
  end;
  begin
    perform nutri.save_targets_wizard(v_start, v_phase, v_exceptions || v_exceptions, v_expected, true);
    raise exception 'Replacement accepted duplicate exceptions';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform nutri.save_targets_wizard(v_start, v_phase, jsonb_set(v_exceptions, '{0,owner}',
      '"02700000-0000-4000-8000-000000000002"'), v_expected, true);
    raise exception 'Replacement accepted a foreign owner';
  exception when sqlstate '22023' then null;
  end;
  begin
    -- Dow 1 is an insert. The invalid goal fails its CHECK after the update.
    perform nutri.save_targets_wizard(v_start, jsonb_set(v_phase, '{1,goal}', '"invalid"', true),
      v_exceptions, v_expected, true);
    raise exception 'Replacement accepted an invalid phase';
  exception when check_violation then null;
  end;
  if nutri.targets_wizard_snapshot() is distinct from v_before then
    raise exception 'Rejected save left a partial edit';
  end if;

  update nutri.targets set kcal = 2900 where id = v_phase_id;
  begin
    perform nutri.save_targets_wizard(v_start, v_phase, v_exceptions, v_expected, true);
    raise exception 'Stale same-ID replacement succeeded';
  exception when sqlstate 'PT409' then null;
  end;
  if not exists (select 1 from nutri.targets where id = v_phase_id and kcal = 2900)
     or exists (select 1 from nutri.targets where day = v_new) then
    raise exception 'Stale save changed existing targets or inserted the exception';
  end if;

  select jsonb_agg(row -> 'revision') into v_expected
  from jsonb_array_elements(nutri.targets_wizard_snapshot()) row
  where row ->> 'valid_from' = v_start::text or row ->> 'day' = v_existing::text;
  update nutri.targets set kcal = 3200 where dow = 0 and valid_from = '2099-02-01';
  perform nutri.save_targets_wizard(v_start, v_phase, v_exceptions, v_expected, true);
  if (select count(*) from nutri.targets where valid_from = v_start and dow is not null
      and kcal = 2000 and protein_g is null and rules ->> 'paused_until' = '2099-02-01') <> 7
     or not exists (select 1 from nutri.targets where id = v_phase_id and applied_rule = 'Fixture rule')
     or not exists (select 1 from nutri.targets where id = v_exception_id and kcal is null and label = 'Previous'
          and valid_from = '2098-01-01' and description = 'Fixture exception' and goal = 'mantenimiento'
          and micros = '{"agua_ml": 3000}' and bounds = '{"kcal": {"max": 2600}}'
          and rules = '{"items": []}' and applied_rule = 'Fixture annotation')
     or not exists (select 1 from nutri.targets where day = v_new and kcal = 2400)
     or not exists (select 1 from nutri.targets where dow = 0 and valid_from = '2099-02-01' and kcal = 3200) then
    raise exception 'Valid replacement did not preserve scope, metadata or nulls';
  end if;

  select jsonb_agg(row || jsonb_build_object('valid_from', '2099-03-01'))
  into v_phase from jsonb_array_elements(v_phase) row;
  perform nutri.save_targets_wizard('2099-03-01', v_phase, '[]', '[]', false);
  if (select count(*) from nutri.targets where valid_from = '2099-03-01' and dow is not null) <> 7 then
    raise exception 'New phase did not create the seven weekdays';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '02700000-0000-4000-8000-000000000002', true);
do $$
begin
  if (select count(*) from nutri.targets where day = '2099-01-03' and kcal = 3500) <> 1
     or jsonb_array_length(nutri.targets_wizard_snapshot()) <> 1 then
    raise exception 'Wizard write escaped owner scope';
  end if;
end $$;

rollback;
select 'targets wizard atomic rollback check passed' as result;
