-- Run after 025_ai_quota.sql in a SQL session; all usage is rolled back.
begin;

do $$
begin
  if has_function_privilege('anon', 'nutri.claim_ai_quota(text)', 'execute') then
    raise exception 'anon can execute claim_ai_quota';
  end if;
  if not has_function_privilege('authenticated', 'nutri.claim_ai_quota(text)', 'execute') then
    raise exception 'authenticated cannot execute claim_ai_quota';
  end if;
  if has_table_privilege('authenticated', 'nutri.ai_daily_usage', 'insert')
    or has_table_privilege('authenticated', 'nutri.ai_daily_usage', 'update') then
    raise exception 'authenticated can bypass quota table';
  end if;
end $$;

set local role anon;
do $$
begin
  begin
    perform nutri.claim_ai_quota('gemini');
    raise exception 'anon RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ffffffff-ffff-4fff-8fff-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-4fff-8fff-000000000001","role":"authenticated"}', true);

do $$
declare
  n integer;
begin
  for n in 1..29 loop
    if not nutri.claim_ai_quota('gemini') then raise exception 'Gemini denied at %', n; end if;
  end loop;
  if not nutri.claim_ai_quota('embed') then raise exception 'embedding does not share Gemini budget'; end if;
  if nutri.claim_ai_quota('gemini') then raise exception 'Gemini accepted request 31'; end if;

  for n in 1..15 loop
    if not nutri.claim_ai_quota('mistral') then raise exception 'Mistral denied at %', n; end if;
  end loop;
  if nutri.claim_ai_quota('mistral') then raise exception 'Mistral accepted request 16'; end if;

  for n in 1..100 loop
    if not nutri.claim_ai_quota('usda') then raise exception 'USDA denied at %', n; end if;
  end loop;
  if nutri.claim_ai_quota('usda') then raise exception 'USDA accepted request 101'; end if;

  begin
    perform nutri.claim_ai_quota('unknown');
    raise exception 'invalid provider unexpectedly accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', 'ffffffff-ffff-4fff-8fff-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-4fff-8fff-000000000002","role":"authenticated"}', true);
do $$
begin
  if not nutri.claim_ai_quota('gemini') then raise exception 'second user inherited first user quota'; end if;
end $$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
do $$
begin
  begin
    perform nutri.claim_ai_quota('gemini');
    raise exception 'missing UID unexpectedly accepted';
  exception when sqlstate '28000' then null;
  end;
end $$;

reset role;
do $$
begin
  if (select count(*) from nutri.ai_daily_usage
      where owner = 'ffffffff-ffff-4fff-8fff-000000000001'
        and day_utc = (now() at time zone 'utc')::date
        and ((provider = 'gemini' and requests = 30)
          or (provider = 'mistral' and requests = 15)
          or (provider = 'usda' and requests = 100))) <> 3 then
    raise exception 'first user quota counters incorrect';
  end if;
  if (select requests from nutri.ai_daily_usage
      where owner = 'ffffffff-ffff-4fff-8fff-000000000002'
        and day_utc = (now() at time zone 'utc')::date
        and provider = 'gemini') <> 1 then
    raise exception 'second user quota counter incorrect';
  end if;
end $$;

rollback;
