# Stand van zaken

*Laatst bijgewerkt: 30 oktober 2026 — mijlpaal 1 (datamodel + RLS) klaar*

## Wat is de app?

Een turflijst voor de drankenlijst van de A-kern van Racing Mechelen. Spelers, doelmannen, trainerstaf en gasten kunnen per drank geturfd worden; de app houdt totalen en afrekeningen bij.

Versie 1 was één `index.html` met alle gegevens in `localStorage` (één toestel, geen login). Versie 2 (in opbouw) gebruikt **Supabase** als gedeelde database met login.

## Mijlpalen

| # | Mijlpaal | Status |
|---|---|---|
| 1 | Datamodel + RLS (Supabase) | ✅ klaar |
| 2 | UI omgebouwd naar Supabase | ⏳ |
| 3 | Offline + PWA | ⏳ |
| 4 | GitHub Action (keep-alive + export) | ⏳ |

## Supabase-project

| | |
|---|---|
| Projectnaam | `turflijst` |
| Project-ref | `cwzntyygjgnikphbfpei` |
| Project URL | `https://cwzntyygjgnikphbfpei.supabase.co` |
| Regio | `eu-central-1` (Frankfurt) |
| Plan | Free |
| Dashboard | https://supabase.com/dashboard/project/cwzntyygjgnikphbfpei |

- Auth: e-mail-login (magic link via `signInWithOtp`), nieuwe registraties toegestaan, e-mailbevestiging aan.
- `supabase/config.toml` is gelijkgezet met de live instellingen. Draai altijd eerst `supabase config diff` vóór `supabase config push`.
- De repo is gelinkt (`supabase link`). Migraties: `supabase db push`.
- De secret/service_role key en het databasewachtwoord staan **nergens** in deze repo.
- Aandachtspunt: de ingebouwde mailserver van Supabase verstuurt maar **2 e-mails per uur**. Voor het hele team is eigen SMTP nodig (Authentication → Emails → SMTP, bv. Resend of Brevo).

## Mijlpaal 1: datamodel en RLS

Migraties in `supabase/migrations/` (al toegepast op het live project):

| Bestand | Inhoud |
|---|---|
| `20261030200000_schema.sql` | Tabellen, indexen, triggers |
| `20261030200100_rls.sql` | Rechten, RLS-policies, functie `afrekenen()` |
| `20261030200200_seed_groepen_drankjes.sql` | 4 groepen en 18 drankjes (geen spelers) |
| `20261030200300_hulpfuncties_private.sql` | Hulpfuncties naar schema `private` |

**Tabellen**

- `profiles(user_id, naam, rol)` — één rij per login, automatisch aangemaakt bij de eerste login (rol `speler`).
- `groups(id, naam, volgorde)`
- `players(id, naam, group_id, email, user_id, actief, created_at)` — wordt nooit verwijderd, enkel `actief = false`.
- `drinks(id, naam, volgorde, actief)` — idem.
- `entries(id, player_id, drink_id, created_at, created_by, settlement_id)` — één rij = één drankje. Open zolang `settlement_id` leeg is.
- `settlements(id, player_id, settled_at, settled_by, opmerking)`

**Beslissingen**

- **Koppeling login ↔ speler via e-mail.** Vult de beheerder bij een speler een e-mailadres in, dan wordt die speler gekoppeld zodra iemand met dat adres inlogt (of meteen, als die login al bestaat). Dat doen twee triggers: `handle_new_user` (op `auth.users`) en `players_koppel_email` (op `players`).
- **Beheerder maken gebeurt met SQL**, niet in de app (zie README). Zo kan niemand zichzelf promoveren.
- **Afrekenen gebeurt via de functie `afrekenen(player_id, entry_ids[], opmerking)`.** Die maakt de afrekening en koppelt precies de turven die de beheerder op het scherm zag, in één transactie. Twee keer afrekenen geeft een fout.
- **Verwijderen**: niemand kan spelers, drankjes of afrekeningen verwijderen (de tabelrechten staan het niet eens toe). Een beheerder kan wél een *open* turf verwijderen (−1 / ongedaan maken). Groepen kunnen weg zolang er geen spelers in zitten.
- **Spelers zien de drankjeslijst** (enkel als ze aan een speler gekoppeld zijn), anders kan "Mijn rekening" geen namen tonen. Groepen en andere spelers zien ze niet.
- **`entries.id` en `created_at` mag de app meegeven.** Nodig voor offline turven: het toestel maakt zelf het id, zodat een turf nooit dubbel wordt opgeslagen en het tijdstip klopt.
- **Prijzen** zitten (nog) niet in het model; de app telt aantallen, net als versie 1.

**Rechten (RLS)** — RLS staat aan op elke tabel.

| | anon (niet ingelogd) | speler | beheerder |
|---|---|---|---|
| profiles | – | eigen lezen | alles lezen, wijzigen |
| groups | – | – | alles |
| players | – | eigen rij lezen | lezen, toevoegen, wijzigen |
| drinks | – | lezen (als gekoppeld) | lezen, toevoegen, wijzigen |
| entries | – | eigen lezen | lezen, toevoegen, wijzigen, open turven verwijderen |
| settlements | – | eigen lezen | lezen, toevoegen, wijzigen |

**Tests**

- `supabase db query --linked -f supabase/tests/rls_test.sql` — 54 tests (anon, speler A, speler B, login zonder speler, beheerder, triggers). Draait in één transactie met `ROLLBACK`: er blijft niets achter. Alle rijen moeten `ok = true` zijn.
- `python supabase/tests/anon_http_test.py` — test via de echte API met de publieke key dat niet-ingelogde bezoekers niets lezen of schrijven.
- `supabase db advisors --linked` — geeft geen waarschuwingen.

## Wat nog openstaat

- Mijlpaal 2–4 (zie tabel).
- Eigen SMTP instellen vóór het hele team uitgenodigd wordt.

## Hoe verder

1. Bouw de UI om (mijlpaal 2): login, turven, overzicht, beheer, "Mijn rekening".
2. Na elke wijziging aan het datamodel: nieuwe migratie in `supabase/migrations/`, `supabase db push`, en de RLS-test opnieuw draaien.
