-- Categorie per consumptie (tabel drinks). Vaste volgorde in de app: Fris, Warm, Bier, Snacks.
-- RLS en rechten blijven ongewijzigd: de rechten op drinks gelden per tabel, dus ook voor deze kolom.

alter table public.drinks
  add column categorie text not null default 'Fris'
  constraint drinks_categorie_geldig check (categorie in ('Fris', 'Warm', 'Bier', 'Snacks'));

comment on column public.drinks.categorie is 'Fris, Warm, Bier of Snacks (volgorde staat in de app).';

-- Bestaande consumpties in de juiste categorie (niet-genoemde blijven Fris).
update public.drinks set categorie = 'Warm' where lower(naam) in ('cecemel', 'warme choco');
update public.drinks set categorie = 'Bier' where lower(naam) in ('stella artois', 'carolus', 'kriek', 'duvel');

-- "Chips / snoep" wordt niet verwijderd maar gearchiveerd (geschiedenis blijft kloppen)
-- en vervangen door drie aparte items.
update public.drinks set categorie = 'Snacks', actief = false where lower(naam) = 'chips / snoep';

insert into public.drinks (naam, volgorde, categorie)
select v.naam, coalesce((select max(volgorde) from public.drinks), 0) + v.nr, 'Snacks'
  from (values (1, 'Chips'), (2, 'Snoep'), (3, 'Koek')) as v(nr, naam)
on conflict do nothing;
