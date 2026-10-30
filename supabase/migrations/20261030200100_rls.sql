-- Turflijst: rechten en Row Level Security
--
-- Regels:
--   * anon (niet ingelogd): ziet en schrijft niets.
--   * beheerder: leest en schrijft alles (behalve verwijderen van spelers, drankjes en afrekeningen).
--   * speler: leest enkel eigen speler-rij, eigen turven en eigen afrekeningen,
--     plus de drankjeslijst (nodig om namen te tonen). Schrijft niets.

-- ---------------------------------------------------------------- hulpfuncties
-- security definer: zo kunnen policies de rol opvragen zonder zelf door RLS te moeten.
create function public.is_beheerder()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
     where user_id = (select auth.uid()) and rol = 'beheerder'
  );
$$;

create function public.mijn_speler_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.players where user_id = (select auth.uid());
$$;

revoke execute on function public.is_beheerder() from public, anon;
revoke execute on function public.mijn_speler_ids() from public, anon;
grant execute on function public.is_beheerder() to authenticated;
grant execute on function public.mijn_speler_ids() to authenticated;

-- ---------------------------------------------------------------- tabelrechten
-- Eerst alles dicht, dan enkel openzetten wat nodig is. RLS beperkt daarna per rij.
revoke all on public.profiles, public.groups, public.players, public.drinks,
              public.settlements, public.entries
  from anon, authenticated;

grant select, update                 on public.profiles    to authenticated;
grant select, insert, update, delete on public.groups      to authenticated;
grant select, insert, update         on public.players     to authenticated;  -- nooit delete
grant select, insert, update         on public.drinks      to authenticated;  -- nooit delete
grant select, insert, update         on public.settlements to authenticated;  -- geschiedenis blijft
grant select, insert, update, delete on public.entries     to authenticated;  -- delete enkel open turven (zie policy)

-- ---------------------------------------------------------------- RLS aan
alter table public.profiles    enable row level security;
alter table public.groups      enable row level security;
alter table public.players     enable row level security;
alter table public.drinks      enable row level security;
alter table public.settlements enable row level security;
alter table public.entries     enable row level security;

-- ---------------------------------------------------------------- profiles
create policy "profiel: eigen of beheerder leest" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_beheerder()));

create policy "profiel: beheerder wijzigt" on public.profiles
  for update to authenticated
  using ((select public.is_beheerder()))
  with check ((select public.is_beheerder()));

-- ---------------------------------------------------------------- groups
create policy "groepen: beheerder leest" on public.groups
  for select to authenticated using ((select public.is_beheerder()));
create policy "groepen: beheerder voegt toe" on public.groups
  for insert to authenticated with check ((select public.is_beheerder()));
create policy "groepen: beheerder wijzigt" on public.groups
  for update to authenticated
  using ((select public.is_beheerder())) with check ((select public.is_beheerder()));
create policy "groepen: beheerder verwijdert" on public.groups
  for delete to authenticated using ((select public.is_beheerder()));

-- ---------------------------------------------------------------- players
create policy "spelers: beheerder of zichzelf leest" on public.players
  for select to authenticated
  using ((select public.is_beheerder()) or user_id = (select auth.uid()));
create policy "spelers: beheerder voegt toe" on public.players
  for insert to authenticated with check ((select public.is_beheerder()));
create policy "spelers: beheerder wijzigt" on public.players
  for update to authenticated
  using ((select public.is_beheerder())) with check ((select public.is_beheerder()));

-- ---------------------------------------------------------------- drinks
create policy "drankjes: beheerder of gekoppelde speler leest" on public.drinks
  for select to authenticated
  using ((select public.is_beheerder()) or exists (select 1 from public.mijn_speler_ids()));
create policy "drankjes: beheerder voegt toe" on public.drinks
  for insert to authenticated with check ((select public.is_beheerder()));
create policy "drankjes: beheerder wijzigt" on public.drinks
  for update to authenticated
  using ((select public.is_beheerder())) with check ((select public.is_beheerder()));

-- ---------------------------------------------------------------- settlements
create policy "afrekeningen: beheerder of eigen leest" on public.settlements
  for select to authenticated
  using ((select public.is_beheerder())
         or player_id in (select public.mijn_speler_ids()));
create policy "afrekeningen: beheerder voegt toe" on public.settlements
  for insert to authenticated with check ((select public.is_beheerder()));
create policy "afrekeningen: beheerder wijzigt" on public.settlements
  for update to authenticated
  using ((select public.is_beheerder())) with check ((select public.is_beheerder()));

-- ---------------------------------------------------------------- entries
create policy "turven: beheerder of eigen leest" on public.entries
  for select to authenticated
  using ((select public.is_beheerder())
         or player_id in (select public.mijn_speler_ids()));
create policy "turven: beheerder voegt toe" on public.entries
  for insert to authenticated
  with check ((select public.is_beheerder()) and created_by = (select auth.uid()));
create policy "turven: beheerder wijzigt" on public.entries
  for update to authenticated
  using ((select public.is_beheerder())) with check ((select public.is_beheerder()));
create policy "turven: beheerder verwijdert open turven" on public.entries
  for delete to authenticated
  using ((select public.is_beheerder()) and settlement_id is null);

-- ---------------------------------------------------------------- afrekenen
-- Rekent precies de turven af die de beheerder op het scherm zag (p_entry_ids),
-- in één transactie. Draait met de rechten van de aanroeper, dus RLS geldt.
create function public.afrekenen(p_player_id uuid, p_entry_ids uuid[], p_opmerking text default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_n  integer;
begin
  if not public.is_beheerder() then
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

revoke execute on function public.afrekenen(uuid, uuid[], text) from public, anon;
grant execute on function public.afrekenen(uuid, uuid[], text) to authenticated;
