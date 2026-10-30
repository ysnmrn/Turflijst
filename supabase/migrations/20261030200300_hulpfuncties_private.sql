-- Hulpfuncties voor RLS uit het publieke API-schema halen (advisor-waarschuwing 0029).
-- Policies verwijzen naar de functie zelf (niet naar de naam), dus die blijven werken.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.is_beheerder() set schema private;
alter function public.mijn_speler_ids() set schema private;

-- afrekenen() roept de functie bij naam aan, dus die body aanpassen.
create or replace function public.afrekenen(p_player_id uuid, p_entry_ids uuid[], p_opmerking text default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_n  integer;
begin
  if not private.is_beheerder() then
    raise exception 'Alleen een beheerder kan afrekenen' using errcode = '42501';
  end if;

  insert into public.settlements (player_id, settled_by, opmerking)
  values (p_player_id, auth.uid(), nullif(btrim(p_opmerking), ''))
  returning id into v_id;

  update public.entries
     set settlement_id = v_id
   where id = any (p_entry_ids)
     and player_id = p_player_id
     and settlement_id is null;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'Er staat niets open om af te rekenen' using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;
