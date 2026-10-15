-- Shared daily budget for /api/ai across serverless instances. No direct table access:
-- callers can only atomically claim one request through the JWT-bound RPC.
create table nutri.ai_daily_usage (
  owner uuid not null,
  day_utc date not null,
  provider text not null check (provider in ('gemini', 'mistral', 'usda')),
  requests integer not null check (requests > 0),
  primary key (owner, day_utc, provider)
);

alter table nutri.ai_daily_usage enable row level security;
revoke all on nutri.ai_daily_usage from public, anon, authenticated;

create function nutri.claim_ai_quota(request_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  provider_name text;
  max_requests integer;
  claimed integer;
begin
  if caller is null then
    raise exception 'authenticated user required' using errcode = '28000';
  end if;

  if request_kind in ('gemini', 'embed') then
    provider_name := 'gemini';
    max_requests := 30;
  elsif request_kind = 'mistral' then
    provider_name := 'mistral';
    max_requests := 15;
  elsif request_kind = 'usda' then
    provider_name := 'usda';
    max_requests := 100;
  else
    raise exception 'invalid provider' using errcode = '22023';
  end if;

  insert into nutri.ai_daily_usage (owner, day_utc, provider, requests)
  values (caller, (now() at time zone 'utc')::date, provider_name, 1)
  on conflict (owner, day_utc, provider) do update
    set requests = nutri.ai_daily_usage.requests + 1
    where nutri.ai_daily_usage.requests < max_requests
  returning requests into claimed;

  return claimed is not null;
end;
$$;

revoke all on function nutri.claim_ai_quota(text) from public, anon;
grant execute on function nutri.claim_ai_quota(text) to authenticated;
