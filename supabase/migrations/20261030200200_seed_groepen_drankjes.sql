-- Startgegevens: enkel groepen en drankjes. Spelers voeg je toe in de app
-- (geen namen in deze publieke repo).

insert into public.groups (naam, volgorde) values
  ('A-kern', 1),
  ('Doelmannen', 2),
  ('Trainerstaf', 3),
  ('Extra / gasten', 4)
on conflict do nothing;

insert into public.drinks (naam, volgorde) values
  ('Water', 1),
  ('Aquarius', 2),
  ('Fuze Tea', 3),
  ('Ice Tea', 4),
  ('Cola', 5),
  ('Fanta', 6),
  ('Sprite', 7),
  ('Minute Maid', 8),
  ('Fristi', 9),
  ('Cecemel', 10),
  ('Warme choco', 11),
  ('Nalu', 12),
  ('Red Bull', 13),
  ('Stella Artois', 14),
  ('Carolus', 15),
  ('Kriek', 16),
  ('Duvel', 17),
  ('Chips / snoep', 18)
on conflict do nothing;
