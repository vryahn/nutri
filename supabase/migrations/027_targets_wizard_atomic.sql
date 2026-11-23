-- The wizard compares database-generated fingerprints so legacy numeric values
-- and nullable metadata round-trip without client-side normalization.
create function nutri.targets_wizard_snapshot()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'dow', t.dow, 'day', t.day, 'valid_from', t.valid_from, 'label', t.label, 'goal', t.goal,
    'revision', encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex')
  )), '[]'::jsonb)
  from nutri.targets t
  where t.owner = (select auth.uid());
$$;

create function nutri.save_targets_wizard(
  p_valid_from date, p_phase jsonb, p_exceptions jsonb, p_expected jsonb, p_confirmed boolean
)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_phase nutri.targets[];
  v_exceptions nutri.targets[];
  v_rows nutri.targets[];
  v_current_ids uuid[];
  v_current text[];
  v_expected text[];
begin
  if v_owner is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_valid_from is null or not isfinite(p_valid_from)
     or jsonb_typeof(p_phase) is distinct from 'array'
     or jsonb_typeof(p_exceptions) is distinct from 'array'
     or jsonb_typeof(p_expected) is distinct from 'array' then
    raise exception 'Invalid targets wizard payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_phase) <> 7 or exists (
    select 1 from jsonb_array_elements_text(p_expected) as j(revision)
    where revision is null or revision !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Invalid phase weekdays or snapshot' using errcode = '22023';
  end if;

  select array_agg(r) into v_phase from jsonb_populate_recordset(null::nutri.targets, p_phase) r;
  select coalesce(array_agg(r), '{}'::nutri.targets[]) into v_exceptions
    from jsonb_populate_recordset(null::nutri.targets, p_exceptions) r;
  v_rows := v_phase || v_exceptions;

  if exists (
    select 1 from unnest(v_rows) r
    where r.owner is distinct from v_owner or r.id is not null or r.applied_rule is not null
       or (r.kcal is not null and (r.kcal < 0 or r.kcal >= 'Infinity'::numeric))
       or (r.protein_g is not null and (r.protein_g < 0 or r.protein_g >= 'Infinity'::numeric))
       or (r.carbs_g is not null and (r.carbs_g < 0 or r.carbs_g >= 'Infinity'::numeric))
       or (r.fat_g is not null and (r.fat_g < 0 or r.fat_g >= 'Infinity'::numeric))
       or coalesce(jsonb_typeof(r.micros), 'object') <> 'object'
       or coalesce(jsonb_typeof(r.bounds), 'object') <> 'object'
       or coalesce(jsonb_typeof(r.rules), 'object') <> 'object'
  ) or (select count(distinct r.dow) from unnest(v_phase) r
        where r.dow between 0 and 6 and r.day is null
          and r.valid_from = p_valid_from and r.kcal > 0) <> 7
    or (select count(distinct r.day) from unnest(v_exceptions) r
        where r.dow is null and isfinite(r.day) and r.valid_from is null
          and r.description is null and r.goal is null and r.rules is null
          and r.micros is null and r.bounds is null) <> cardinality(v_exceptions) then
    raise exception 'Invalid target owner, scope or values' using errcode = '22023';
  end if;

  select coalesce(array_agg(revision order by revision), '{}'::text[]) into v_expected
    from jsonb_array_elements_text(p_expected) as j(revision);
  select coalesce(array_agg(locked.id), '{}'::uuid[]),
         coalesce(array_agg(locked.revision order by locked.revision), '{}'::text[])
    into v_current_ids, v_current
  from (
    select t.id, encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') as revision
    from nutri.targets t
    where t.owner = v_owner and (
      (t.valid_from = p_valid_from and t.dow is not null)
      or t.day in (select r.day from unnest(v_exceptions) r)
    )
    order by t.id
    for update
  ) locked;

  if v_current is distinct from v_expected then
    raise exception 'Targets changed after review' using errcode = 'PT409';
  end if;
  if cardinality(v_current) > 0 and not coalesce(p_confirmed, false) then
    raise exception 'Target replacement requires confirmation' using errcode = 'PT422';
  end if;

  -- Only touch IDs read under the row locks. The wizard edits macros and label
  -- on specific dates, so retain their metadata, micros and bounds.
  update nutri.targets t
  set kcal = r.kcal, protein_g = r.protein_g, carbs_g = r.carbs_g, fat_g = r.fat_g, label = r.label,
      description = case when r.dow is null then t.description else r.description end,
      goal = case when r.dow is null then t.goal else r.goal end,
      micros = case when r.dow is null then t.micros else coalesce(r.micros, '{}'::jsonb) end,
      bounds = case when r.dow is null then t.bounds else coalesce(r.bounds, '{}'::jsonb) end,
      rules = case when r.dow is null then t.rules else coalesce(r.rules, '{}'::jsonb) end
  from unnest(v_rows) r
  where t.owner = v_owner and t.id = any(v_current_ids)
    and ((t.dow = r.dow and t.valid_from = r.valid_from) or t.day = r.day);

  -- Missing natural keys are inserts. A concurrent insert or move that claims
  -- one of them fails the unique constraint and rolls back the entire save.
  insert into nutri.targets (owner, dow, day, valid_from, kcal, protein_g, carbs_g, fat_g,
                             label, description, goal, micros, bounds, rules)
  select v_owner, r.dow, r.day, coalesce(r.valid_from, current_date),
         r.kcal, r.protein_g, r.carbs_g, r.fat_g, r.label, r.description, r.goal,
         coalesce(r.micros, '{}'::jsonb), coalesce(r.bounds, '{}'::jsonb), coalesce(r.rules, '{}'::jsonb)
  from unnest(v_rows) r
  where not exists (
    select 1 from nutri.targets t
    where t.id = any(v_current_ids)
      and ((t.dow = r.dow and t.valid_from = r.valid_from) or t.day = r.day)
  );
exception
  when unique_violation or deadlock_detected or serialization_failure then
    raise exception 'Targets changed after review' using errcode = 'PT409';
end;
$$;

revoke all on function nutri.targets_wizard_snapshot() from public, anon;
revoke all on function nutri.save_targets_wizard(date, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function nutri.targets_wizard_snapshot() to authenticated;
grant execute on function nutri.save_targets_wizard(date, jsonb, jsonb, jsonb, boolean) to authenticated;
