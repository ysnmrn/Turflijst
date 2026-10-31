-- Afgerekende afrekeningen verwijderen (enkel beheerder), samen met hun turven.
--
-- Waarom SECURITY DEFINER: de tabelrechten en RLS staan bewust niet toe dat iemand afrekeningen
-- of afgerekende turven verwijdert (zie 20261030200100_rls.sql). Die regels blijven ongewijzigd.
-- Het verwijderen gebeurt daarom enkel via deze functies:
--   * private.*  doen het werk (SECURITY DEFINER, search_path leeg, eigen beheerderscontrole).
--     Het schema private is niet via de API bereikbaar.
--   * public.*   zijn de enige ingang via de API (SECURITY INVOKER) en controleren ook zelf.
--
-- Veiligheid:
--   * Enkel turven met settlement_id = de gevraagde afrekening worden verwijderd. Open turven
--     (settlement_id is null) kunnen hier nooit geraakt worden.
--   * Eerst de turven, dan de afrekening, in één transactie. De foreign key entries.settlement_id
--     is ON DELETE RESTRICT: hangt er nog iets aan, dan mislukt alles en wordt er niets
--     verwijderd. Turven kunnen dus nooit terug "open" worden.
--   * De afrekening wordt vergrendeld (FOR UPDATE), zodat niets er tegelijk aan gekoppeld wordt.

-- ---------------------------------------------------------------- één afrekening
create function private.afrekening_verwijderen(p_settlement_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not private.is_beheerder() then
    raise exception 'Alleen een beheerder kan afrekeningen verwijderen' using errcode = '42501';
  end if;
  if p_settlement_id is null then
    raise exception 'Geen afrekening opgegeven' using errcode = '22004';
  end if;

  perform 1 from public.settlements where id = p_settlement_id for update;
  if not found then
    raise exception 'Afrekening niet gevonden' using errcode = 'P0002';
  end if;

  delete from public.entries where settlement_id = p_settlement_id;
  get diagnostics v_n = row_count;

  delete from public.settlements where id = p_settlement_id;
  return v_n;   -- aantal verwijderde consumpties
end;
$$;

create function public.afrekening_verwijderen(p_settlement_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_beheerder() then
    raise exception 'Alleen een beheerder kan afrekeningen verwijderen' using errcode = '42501';
  end if;
  return private.afrekening_verwijderen(p_settlement_id);
end;
$$;

-- ---------------------------------------------------------------- oude afrekeningen opruimen
-- p_maanden: 3, 6 of 12. p_uitvoeren = false telt enkel (voor de bevestigingsvraag).
create function private.afrekeningen_opruimen(p_maanden integer, p_uitvoeren boolean)
returns table (afrekeningen integer, consumpties integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grens timestamptz;
  v_ids   uuid[];
begin
  if not private.is_beheerder() then
    raise exception 'Alleen een beheerder kan afrekeningen verwijderen' using errcode = '42501';
  end if;
  if p_maanden is null or p_maanden not in (3, 6, 12) then
    raise exception 'Kies 3, 6 of 12 maanden' using errcode = '22023';
  end if;

  v_grens := now() - make_interval(months => p_maanden);

  if p_uitvoeren then
    select coalesce(array_agg(id), '{}') into v_ids
      from (select id from public.settlements where settled_at < v_grens for update) s;
  else
    select coalesce(array_agg(id), '{}') into v_ids
      from public.settlements where settled_at < v_grens;
  end if;

  afrekeningen := cardinality(v_ids);
  select count(*)::integer into consumpties from public.entries where settlement_id = any (v_ids);

  if p_uitvoeren and afrekeningen > 0 then
    delete from public.entries where settlement_id = any (v_ids);
    delete from public.settlements where id = any (v_ids);
  end if;
  return next;
end;
$$;

create function public.afrekeningen_opruimen(p_maanden integer, p_uitvoeren boolean default false)
returns table (afrekeningen integer, consumpties integer)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_beheerder() then
    raise exception 'Alleen een beheerder kan afrekeningen verwijderen' using errcode = '42501';
  end if;
  return query select * from private.afrekeningen_opruimen(p_maanden, p_uitvoeren);
end;
$$;

-- ---------------------------------------------------------------- rechten
revoke execute on function private.afrekening_verwijderen(uuid)           from public, anon;
revoke execute on function private.afrekeningen_opruimen(integer, boolean) from public, anon;
revoke execute on function public.afrekening_verwijderen(uuid)            from public, anon;
revoke execute on function public.afrekeningen_opruimen(integer, boolean)  from public, anon;
grant execute on function private.afrekening_verwijderen(uuid)            to authenticated;
grant execute on function private.afrekeningen_opruimen(integer, boolean) to authenticated;
grant execute on function public.afrekening_verwijderen(uuid)             to authenticated;
grant execute on function public.afrekeningen_opruimen(integer, boolean)  to authenticated;
