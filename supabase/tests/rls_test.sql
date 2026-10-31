-- RLS-test voor de turflijst.
-- Draaien:   supabase db query --linked -f supabase/tests/rls_test.sql
-- Alles gebeurt in één transactie die op het einde wordt teruggedraaid (ROLLBACK):
-- er blijven geen testgebruikers of testgegevens achter.
-- Uitvoer: één rij per test met ok = true/false. Alle rijen moeten true zijn.

begin;

create temp table r (nr serial, test text, ok boolean);
grant select, insert on r to anon, authenticated;
grant usage on sequence r_nr_seq to anon, authenticated;

-- ------------------------------------------------------------ testdata (als postgres)
-- Speler A krijgt eerst een speler-rij met e-mail, daarna een login -> koppeling via auth-trigger.
insert into public.players (id, naam, group_id, email)
select '10000000-0000-4000-a000-00000000000a', 'Test A', id, 'Speler-A@Example.test'
  from public.groups order by volgorde limit 1;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-a000-000000000001', 'beheerder@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000002', 'speler-a@example.test',  'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000003', 'speler-b@example.test',  'authenticated', 'authenticated'),
  ('00000000-0000-4000-a000-000000000004', 'los@example.test',       'authenticated', 'authenticated');

update public.profiles set rol = 'beheerder' where user_id = '00000000-0000-4000-a000-000000000001';

-- Speler B: login bestaat al, speler-rij komt erna -> koppeling via players-trigger.
insert into public.players (id, naam, group_id, email)
select '10000000-0000-4000-a000-00000000000b', 'Test B', id, ' speler-b@example.test '
  from public.groups order by volgorde limit 1;

insert into public.settlements (id, player_id) values
  ('20000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-00000000000a'),
  ('20000000-0000-4000-a000-00000000000b', '10000000-0000-4000-a000-00000000000b');

insert into public.entries (id, player_id, drink_id, settlement_id)
select gen_random_uuid(), p, (select id from public.drinks order by volgorde limit 1), s
  from (values
    ('10000000-0000-4000-a000-00000000000a'::uuid, null::uuid),
    ('10000000-0000-4000-a000-00000000000a', null),
    ('10000000-0000-4000-a000-00000000000a', '20000000-0000-4000-a000-00000000000a'),
    ('10000000-0000-4000-a000-00000000000b', null),
    ('10000000-0000-4000-a000-00000000000b', null),
    ('10000000-0000-4000-a000-00000000000b', '20000000-0000-4000-a000-00000000000b')
  ) v(p, s);

insert into r (test, ok) values
  ('trigger: profiel aangemaakt voor elke login',
     (select count(*) from public.profiles where user_id::text like '00000000-0000-4000-a000-00000000000%') = 4),
  ('trigger: nieuwe login wordt gekoppeld aan speler met zelfde e-mail (hoofdletters negeren)',
     (select user_id from public.players where id = '10000000-0000-4000-a000-00000000000a') = '00000000-0000-4000-a000-000000000002'),
  ('trigger: nieuwe speler wordt gekoppeld aan bestaande login, e-mail genormaliseerd',
     (select user_id = '00000000-0000-4000-a000-000000000003' and email = 'speler-b@example.test'
        from public.players where id = '10000000-0000-4000-a000-00000000000b'));

-- ------------------------------------------------------------ RLS staat aan op elke tabel
insert into r (test, ok)
select 'RLS aan op public.' || c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relname;

-- ============================================================ ANON (geen login)
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare t text; n bigint; gezien boolean;
begin
  foreach t in array array['profiles','groups','players','drinks','settlements','entries'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      gezien := n > 0;
    exception when insufficient_privilege then
      gezien := false;
    end;
    insert into r (test, ok) values ('anon: ziet niets in ' || t, not gezien);
  end loop;

  begin
    insert into public.drinks (naam) values ('anon-drankje');
    insert into r (test, ok) values ('anon: kan niet schrijven', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('anon: kan niet schrijven', true);
  end;

  begin
    perform public.afrekenen('10000000-0000-4000-a000-00000000000a', array[]::uuid[]);
    insert into r (test, ok) values ('anon: kan afrekenen() niet aanroepen', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('anon: kan afrekenen() niet aanroepen', true);
  end;

  begin
    perform public.afrekening_verwijderen('20000000-0000-4000-a000-00000000000a');
    insert into r (test, ok) values ('anon: kan afrekening_verwijderen() niet aanroepen', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('anon: kan afrekening_verwijderen() niet aanroepen', true);
  end;

  begin
    perform private.afrekening_verwijderen('20000000-0000-4000-a000-00000000000a');
    insert into r (test, ok) values ('anon: kan private.afrekening_verwijderen() niet aanroepen', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('anon: kan private.afrekening_verwijderen() niet aanroepen', true);
  end;

  begin
    perform * from public.afrekeningen_opruimen(3, true);
    insert into r (test, ok) values ('anon: kan afrekeningen_opruimen() niet aanroepen', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('anon: kan afrekeningen_opruimen() niet aanroepen', true);
  end;
end $$;

reset role;

-- ============================================================ SPELER A
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);

insert into r (test, ok) values
  ('speler A: ziet enkel eigen turven (3 van 6)',
     (select count(*) from public.entries) = 3
     and not exists (select 1 from public.entries where player_id <> '10000000-0000-4000-a000-00000000000a')),
  ('speler A: ziet enkel eigen afrekening',
     (select count(*) from public.settlements) = 1
     and (select player_id from public.settlements) = '10000000-0000-4000-a000-00000000000a'),
  ('speler A: ziet enkel eigen speler-rij',
     (select count(*) from public.players) = 1),
  ('speler A: ziet enkel eigen profiel',
     (select count(*) from public.profiles) = 1),
  ('speler A: ziet geen groepen',
     (select count(*) from public.groups) = 0),
  ('speler A: ziet de drankjes (namen tonen)',
     (select count(*) from public.drinks) > 0),
  ('speler A: is geen beheerder',
     not private.is_beheerder());

do $$
declare n integer;
begin
  -- turf toevoegen
  begin
    insert into public.entries (player_id, drink_id)
    values ('10000000-0000-4000-a000-00000000000a', (select id from public.drinks limit 1));
    insert into r (test, ok) values ('speler A: kan geen turf toevoegen', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('speler A: kan geen turf toevoegen', true);
  end;

  -- eigen turf verwijderen
  delete from public.entries where player_id = '10000000-0000-4000-a000-00000000000a';
  get diagnostics n = row_count;
  insert into r (test, ok) values ('speler A: kan geen turven verwijderen', n = 0);

  -- turf van iemand anders "afrekenen" via update
  update public.entries set settlement_id = '20000000-0000-4000-a000-00000000000a';
  get diagnostics n = row_count;
  insert into r (test, ok) values ('speler A: kan geen turven wijzigen', n = 0);

  -- zichzelf beheerder maken
  update public.profiles set rol = 'beheerder' where user_id = '00000000-0000-4000-a000-000000000002';
  get diagnostics n = row_count;
  insert into r (test, ok) values ('speler A: kan zichzelf geen beheerder maken', n = 0);

  -- zichzelf aan speler B koppelen
  update public.players set user_id = '00000000-0000-4000-a000-000000000002';
  get diagnostics n = row_count;
  insert into r (test, ok) values ('speler A: kan spelers niet wijzigen', n = 0);

  begin
    insert into public.settlements (player_id) values ('10000000-0000-4000-a000-00000000000a');
    insert into r (test, ok) values ('speler A: kan geen afrekening maken', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('speler A: kan geen afrekening maken', true);
  end;

  begin
    perform public.afrekenen('10000000-0000-4000-a000-00000000000a',
      array(select id from public.entries where settlement_id is null));
    insert into r (test, ok) values ('speler A: kan afrekenen() niet gebruiken', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('speler A: kan afrekenen() niet gebruiken', true);
  end;

  begin
    insert into public.drinks (naam) values ('speler-drankje');
    insert into r (test, ok) values ('speler A: kan geen drankje toevoegen', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('speler A: kan geen drankje toevoegen', true);
  end;

  -- eigen afrekening verwijderen: via de API-functie, rechtstreeks via private, en opruimen
  begin
    perform public.afrekening_verwijderen('20000000-0000-4000-a000-00000000000a');
    insert into r (test, ok) values ('speler A: kan eigen afrekening niet verwijderen', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('speler A: kan eigen afrekening niet verwijderen', true);
  end;

  begin
    perform private.afrekening_verwijderen('20000000-0000-4000-a000-00000000000a');
    insert into r (test, ok) values ('speler A: kan private.afrekening_verwijderen() niet misbruiken', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('speler A: kan private.afrekening_verwijderen() niet misbruiken', true);
  end;

  begin
    perform * from public.afrekeningen_opruimen(3, true);
    insert into r (test, ok) values ('speler A: kan afrekeningen niet opruimen', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('speler A: kan afrekeningen niet opruimen', true);
  end;
end $$;

reset role;
insert into r (test, ok) values ('speler A: eigen afrekening en turven staan er nog',
  exists (select 1 from public.settlements where id = '20000000-0000-4000-a000-00000000000a')
  and (select count(*) from public.entries where settlement_id = '20000000-0000-4000-a000-00000000000a') = 1);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);

reset role;

-- ============================================================ SPELER B
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000003","role":"authenticated"}', true);

insert into r (test, ok) values
  ('speler B: ziet geen turven van speler A',
     not exists (select 1 from public.entries where player_id = '10000000-0000-4000-a000-00000000000a')
     and (select count(*) from public.entries) = 3),
  ('speler B: ziet geen afrekening van speler A',
     not exists (select 1 from public.settlements where player_id = '10000000-0000-4000-a000-00000000000a')),
  ('speler B: ziet speler A niet',
     not exists (select 1 from public.players where id = '10000000-0000-4000-a000-00000000000a'));

reset role;

-- ============================================================ LOS (login zonder gekoppelde speler)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000004","role":"authenticated"}', true);

insert into r (test, ok) values
  ('losse login: ziet geen turven',      (select count(*) from public.entries) = 0),
  ('losse login: ziet geen afrekeningen', (select count(*) from public.settlements) = 0),
  ('losse login: ziet geen spelers',      (select count(*) from public.players) = 0),
  ('losse login: ziet geen drankjes',     (select count(*) from public.drinks) = 0);

reset role;

-- ============================================================ BEHEERDER
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);

insert into r (test, ok) values
  ('beheerder: ziet alle testturven',
     (select count(*) from public.entries
       where player_id in ('10000000-0000-4000-a000-00000000000a', '10000000-0000-4000-a000-00000000000b')) = 6),
  ('beheerder: ziet alle profielen',
     (select count(*) from public.profiles where user_id::text like '00000000-0000-4000-a000-00000000000%') = 4),
  ('beheerder: ziet groepen', (select count(*) from public.groups) >= 4);

do $$
declare n integer; g uuid; d uuid; p uuid; s uuid;
begin
  insert into public.groups (naam, volgorde) values ('Testgroep', 99) returning id into g;
  insert into public.drinks (naam, volgorde) values ('Testdrank', 99) returning id into d;
  insert into public.players (naam, group_id) values ('Test C', g) returning id into p;
  insert into public.entries (player_id, drink_id) values (p, d), (p, d), (p, d);
  insert into r (test, ok) values ('beheerder: kan groep, drankje, speler en turven toevoegen', true);

  insert into r (test, ok) values ('beheerder: created_by wordt automatisch ingevuld',
    (select bool_and(created_by = '00000000-0000-4000-a000-000000000001') from public.entries where player_id = p));

  begin
    insert into public.entries (player_id, drink_id, created_by)
    values (p, d, '00000000-0000-4000-a000-000000000002');
    insert into r (test, ok) values ('beheerder: kan geen turf op naam van iemand anders zetten', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('beheerder: kan geen turf op naam van iemand anders zetten', true);
  end;

  -- één open turf verwijderen (= -1)
  delete from public.entries where id = (select id from public.entries where player_id = p limit 1);
  get diagnostics n = row_count;
  insert into r (test, ok) values ('beheerder: kan open turf verwijderen', n = 1);

  -- afrekenen
  s := public.afrekenen(p, array(select id from public.entries where player_id = p), ' betaald cash ');
  insert into r (test, ok) values ('beheerder: afrekenen() koppelt de 2 open turven',
    (select count(*) from public.entries where settlement_id = s) = 2
    and (select opmerking from public.settlements where id = s) = 'betaald cash'
    and (select settled_by from public.settlements where id = s) = '00000000-0000-4000-a000-000000000001');

  begin
    perform public.afrekenen(p, array(select id from public.entries where player_id = p));
    insert into r (test, ok) values ('beheerder: twee keer afrekenen geeft fout', false);
  exception when raise_exception then
    insert into r (test, ok) values ('beheerder: twee keer afrekenen geeft fout', true);
  end;

  delete from public.entries where player_id = p;
  get diagnostics n = row_count;
  insert into r (test, ok) values ('beheerder: kan afgerekende turven niet verwijderen', n = 0);

  begin
    delete from public.players where id = p;
    insert into r (test, ok) values ('beheerder: kan speler niet verwijderen (enkel archiveren)', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('beheerder: kan speler niet verwijderen (enkel archiveren)', true);
  end;

  begin
    delete from public.drinks where id = d;
    insert into r (test, ok) values ('beheerder: kan drankje niet verwijderen (enkel archiveren)', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('beheerder: kan drankje niet verwijderen (enkel archiveren)', true);
  end;

  begin
    delete from public.settlements where id = s;
    insert into r (test, ok) values ('beheerder: kan afrekening niet verwijderen', false);
  exception when insufficient_privilege then
    insert into r (test, ok) values ('beheerder: kan afrekening niet verwijderen', true);
  end;

  update public.players set actief = false where id = p;
  update public.drinks set actief = false where id = d;
  insert into r (test, ok) values ('beheerder: kan speler en drankje archiveren',
    (select not actief from public.players where id = p) and (select not actief from public.drinks where id = d));

  begin
    delete from public.groups where id = g;
    insert into r (test, ok) values ('beheerder: groep met spelers kan niet weg', false);
  exception when foreign_key_violation then
    insert into r (test, ok) values ('beheerder: groep met spelers kan niet weg', true);
  end;
end $$;

-- ------------------------------------------------------------ BEHEERDER: afrekeningen verwijderen
do $$
declare
  n integer; open_voor bigint; p uuid; d uuid; s uuid; s_oud uuid; s_nieuw uuid; ids uuid[];
  t record;
begin
  select id into d from public.drinks order by volgorde limit 1;
  insert into public.players (naam, group_id) select 'Test D', id from public.groups order by volgorde limit 1 returning id into p;
  insert into public.entries (player_id, drink_id) values (p, d), (p, d), (p, d);
  s := public.afrekenen(p, array(select id from public.entries where player_id = p));
  ids := array(select id from public.entries where settlement_id = s);
  insert into public.entries (player_id, drink_id) values (p, d), (p, d);          -- 2 nieuwe open turven
  open_voor := (select count(*) from public.entries where settlement_id is null);

  n := public.afrekening_verwijderen(s);
  insert into r (test, ok) values ('beheerder: afrekening_verwijderen() geeft het aantal consumpties terug', n = 3);
  insert into r (test, ok) values ('beheerder: afrekening en haar turven zijn weg (niet terug open)',
    not exists (select 1 from public.settlements where id = s)
    and not exists (select 1 from public.entries where id = any (ids)));
  insert into r (test, ok) values ('beheerder: open turven blijven staan na verwijderen',
    (select count(*) from public.entries where settlement_id is null) = open_voor
    and (select count(*) from public.entries where player_id = p and settlement_id is null) = 2);

  begin
    perform public.afrekening_verwijderen(s);
    insert into r (test, ok) values ('beheerder: onbestaande afrekening geeft fout', false);
  exception when no_data_found then
    insert into r (test, ok) values ('beheerder: onbestaande afrekening geeft fout', true);
  end;

  -- een open turf is geen afrekening: id van een open turf wordt geweigerd
  begin
    perform public.afrekening_verwijderen((select id from public.entries where player_id = p and settlement_id is null limit 1));
    insert into r (test, ok) values ('beheerder: open turf kan niet via afrekening_verwijderen()', false);
  exception when no_data_found then
    insert into r (test, ok) values ('beheerder: open turf kan niet via afrekening_verwijderen()',
      (select count(*) from public.entries where player_id = p and settlement_id is null) = 2);
  end;

  begin
    perform public.afrekening_verwijderen(null);
    insert into r (test, ok) values ('beheerder: lege afrekening-id geeft fout', false);
  exception when null_value_not_allowed then
    insert into r (test, ok) values ('beheerder: lege afrekening-id geeft fout', true);
  end;

  -- opruimen: een oude (7 maanden) en een recente (1 maand) afrekening
  insert into public.settlements (player_id, settled_at) values (p, now() - interval '7 months') returning id into s_oud;
  insert into public.settlements (player_id, settled_at) values (p, now() - interval '1 month') returning id into s_nieuw;
  insert into public.entries (player_id, drink_id, settlement_id) values (p, d, s_oud), (p, d, s_oud), (p, d, s_nieuw);
  open_voor := (select count(*) from public.entries where settlement_id is null);

  select * into t from public.afrekeningen_opruimen(6, false);
  insert into r (test, ok) values ('beheerder: opruimen (tellen) verwijdert niets',
    t.afrekeningen >= 1 and t.consumpties >= 2 and exists (select 1 from public.settlements where id = s_oud));

  select * into t from public.afrekeningen_opruimen(6, true);
  insert into r (test, ok) values ('beheerder: opruimen ouder dan 6 maanden verwijdert enkel oude afrekeningen',
    t.afrekeningen >= 1
    and not exists (select 1 from public.settlements where id = s_oud)
    and not exists (select 1 from public.entries where settlement_id = s_oud)
    and exists (select 1 from public.settlements where id = s_nieuw)
    and not exists (select 1 from public.settlements where settled_at < now() - interval '6 months'));
  insert into r (test, ok) values ('beheerder: open turven blijven staan na opruimen',
    (select count(*) from public.entries where settlement_id is null) = open_voor);

  begin
    perform * from public.afrekeningen_opruimen(1, true);
    insert into r (test, ok) values ('beheerder: opruimen enkel voor 3, 6 of 12 maanden', false);
  exception when invalid_parameter_value then
    insert into r (test, ok) values ('beheerder: opruimen enkel voor 3, 6 of 12 maanden',
      exists (select 1 from public.settlements where id = s_nieuw));
  end;
end $$;

reset role;

select nr, ok, test from r order by nr;

rollback;
