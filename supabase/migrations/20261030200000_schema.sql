-- Turflijst: datamodel
-- Tabellen: profiles, groups, players, drinks, settlements, entries.
-- Spelers en drankjes worden nooit verwijderd, enkel op inactief gezet (actief = false),
-- zodat oude turven en afrekeningen blijven kloppen.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  naam       text,
  rol        text not null default 'speler' check (rol in ('beheerder', 'speler')),
  created_at timestamptz not null default now()
);
comment on table public.profiles is 'Eén rij per login. Nieuwe logins krijgen rol speler; een beheerder maak je met SQL (zie README).';

-- ---------------------------------------------------------------- groups
create table public.groups (
  id       uuid primary key default gen_random_uuid(),
  naam     text not null check (length(btrim(naam)) > 0),
  volgorde integer not null default 0
);
create unique index groups_naam_uniek on public.groups (lower(naam));

-- ---------------------------------------------------------------- players
create table public.players (
  id         uuid primary key default gen_random_uuid(),
  naam       text not null check (length(btrim(naam)) > 0),
  group_id   uuid not null references public.groups (id) on delete restrict,
  email      text,
  user_id    uuid references auth.users (id) on delete set null,
  actief     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index players_email_uniek on public.players (lower(email)) where email is not null;
create index players_group_id_idx on public.players (group_id);
create index players_user_id_idx on public.players (user_id);
comment on column public.players.email is 'Als iemand met dit e-mailadres inlogt, wordt user_id automatisch ingevuld.';

-- ---------------------------------------------------------------- drinks
create table public.drinks (
  id       uuid primary key default gen_random_uuid(),
  naam     text not null check (length(btrim(naam)) > 0),
  volgorde integer not null default 0,
  actief   boolean not null default true
);
create unique index drinks_naam_uniek on public.drinks (lower(naam));

-- ---------------------------------------------------------------- settlements
create table public.settlements (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.players (id) on delete restrict,
  settled_at timestamptz not null default now(),
  settled_by uuid default auth.uid() references auth.users (id) on delete set null,
  opmerking  text
);
create index settlements_player_id_idx on public.settlements (player_id);
create index settlements_settled_at_idx on public.settlements (settled_at desc);
create index settlements_settled_by_idx on public.settlements (settled_by);

-- ---------------------------------------------------------------- entries
-- Eén rij = één geturfd drankje. settlement_id is null zolang het openstaat.
-- id en created_at mag de app zelf meegeven (offline turven: id wordt op het toestel gemaakt).
create table public.entries (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players (id) on delete restrict,
  drink_id      uuid not null references public.drinks (id) on delete restrict,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  settlement_id uuid references public.settlements (id) on delete restrict
);
create index entries_open_idx on public.entries (player_id) where settlement_id is null;
create index entries_player_id_idx on public.entries (player_id);
create index entries_drink_id_idx on public.entries (drink_id);
create index entries_settlement_id_idx on public.entries (settlement_id);
create index entries_created_by_idx on public.entries (created_by);

-- ---------------------------------------------------------------- triggers

-- Nieuwe login: profiel aanmaken en koppelen aan een speler met hetzelfde e-mailadres.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;

  if new.email is not null then
    update public.players
       set user_id = new.id
     where lower(email) = lower(new.email)
       and user_id is null;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- E-mail van een speler invullen of wijzigen: netjes maken en meteen koppelen
-- als er al een login met dat adres bestaat.
create function public.players_koppel_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email := nullif(lower(btrim(new.email)), '');
  if tg_op = 'INSERT' or new.email is distinct from old.email then
    if new.email is null then
      new.user_id := null;
    else
      new.user_id := (select u.id from auth.users u where lower(u.email) = new.email limit 1);
    end if;
  end if;
  return new;
end;
$$;

create trigger players_koppel_email
  before insert or update of email on public.players
  for each row execute function public.players_koppel_email();

-- Trigger-functies hoeven niet via de API aanroepbaar te zijn.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.players_koppel_email() from public, anon, authenticated;
