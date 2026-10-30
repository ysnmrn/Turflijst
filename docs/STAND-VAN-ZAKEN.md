# Stand van zaken

*Laatst bijgewerkt: 30 oktober 2026 — alle 4 mijlpalen klaar, nog niet gepusht naar GitHub*

## Wat is de app?

Een turflijst voor de drankenlijst van de A-kern van Racing Mechelen. Spelers, doelmannen, trainerstaf en gasten kunnen per drank geturfd worden; de app houdt totalen en afrekeningen bij.

Versie 1 was één `index.html` met alle gegevens in `localStorage` (één toestel, geen login). Versie 2 gebruikt **Supabase** als gedeelde database met login.

## Mijlpalen

| # | Mijlpaal | Status |
|---|---|---|
| 1 | Datamodel + RLS (Supabase) | ✅ klaar |
| 2 | UI omgebouwd naar Supabase | ✅ klaar |
| 3 | Offline + PWA | ✅ klaar |
| 4 | GitHub Action (keep-alive + export) | ✅ klaar (secrets nog in te stellen) |

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

## Mijlpaal 2: UI omgebouwd

**Bestanden**

| Bestand | Inhoud |
|---|---|
| `index.html` | Opmaak en CSS (zelfde groen-witte look als versie 1) |
| `app.js` | Alle logica (vanilla JS, geen build-stap) |
| `config.js` | Supabase-URL en publishable key |
| `vendor/supabase.js` | supabase-js (vaste versie, zie `vendor/VERSION.txt`), lokaal zodat de app ook offline opent |
| `supabase/templates/*.html` | Login-mails met link én code (nog niet actief, zie "Wat nog openstaat") |

**Schermen**

- **Inloggen**: e-mailadres → magic link. Er is ook een veld voor een code uit de mail (werkt pas als de mailsjablonen actief zijn).
- **Beheerder** (onderaan 3 of 4 tabbladen):
  - *Turven*: spelers per groep, tik → drankjes-sheet (+1, −1, "Ongedaan"), knop *Afrekenen* met optionele opmerking. *+ Gast toevoegen* onder de groep met "gast" in de naam.
  - *Overzicht*: tabel met wat openstaat per speler; daaronder de afrekeningen, filterbaar per maand, per periode (van–tot) of alles, en per speler, met totalen per drankje.
  - *Mijn rekening*: enkel als de beheerder zelf aan een speler gekoppeld is.
  - *Beheer*: spelers (naam, groep, e-mail, actief/archief), drankjes (naam, volgorde ▲▼, archief), groepen (naam, volgorde, verwijderen als leeg), clublogo (per toestel), back-up downloaden (JSON), uitloggen. Als er nog gegevens van versie 1 op het toestel staan, verschijnt een knop om die te importeren.
- **Speler**: enkel *Mijn rekening* (openstaand + vorige afrekeningen) en uitloggen.
- **Login zonder gekoppelde speler**: melding "nog niet gekoppeld".

**Beslissingen**

- **`config.js` staat in de repo** (was eerst in `.gitignore`). GitHub Pages heeft het nodig, en de publishable key is bedoeld om publiek te zijn: elke bezoeker ziet hem toch in de browser. De beveiliging zit volledig in RLS.
- **Elke turf gaat eerst in een lokale wachtrij** (IndexedDB) en wordt dan naar Supabase gestuurd. Het toestel maakt zelf het id (UUID), dus opnieuw versturen na een netwerkfout maakt nooit een dubbele turf (`upsert ... ignoreDuplicates`). −1 en "Ongedaan" op een turf die nog in de wachtrij zit, halen die gewoon uit de wachtrij; anders wordt een verwijder-opdracht in de wachtrij gezet.
- **Afrekenen, spelers/drankjes/groepen wijzigen en gasten toevoegen kan enkel online.** Vóór het afrekenen wordt eerst de wachtrij verstuurd, zodat de afrekening alles bevat.
- **Statuslabel rechtsboven**: *Online*, *Sync · n*, *Offline · n* (n = wachtende turven) of *n mislukt*. Tik erop voor details en om meteen te synchroniseren.
- **Verversen**: bij terugkeren naar de app, bij terug online komen, en elke minuut zolang de app open staat. (Geen realtime-abonnement: niet nodig voor een turflijst en spaart het gratis plan.)
- **Logo** wordt per toestel bewaard (localStorage), zoals in versie 1. Een bestand `logo.png` naast `index.html` wordt automatisch gebruikt als er geen eigen logo gekozen is.
- **Mailsjablonen**: Supabase weigert aangepaste sjablonen op het Free-plan zolang de ingebouwde mailserver gebruikt wordt. De sjablonen staan klaar maar zijn uitgeschakeld in `config.toml`.

**Getest** (Microsoft Edge headless, schermformaat 390×844, met tijdelijke testlogins die achteraf verwijderd zijn): inloggen, spelers/drankjes/groepen toevoegen en wijzigen, volgorde, groep verwijderen, turven, −1, ongedaan maken, offline turven en automatisch synchroniseren, afrekenen met opmerking, geschiedenis met alle filters, gast toevoegen, archiveren, en "Mijn rekening" als speler (ziet enkel zichzelf; schrijven wordt geweigerd).

## Mijlpaal 3: offline en installeerbaar (PWA)

**Bestanden**

| Bestand | Inhoud |
|---|---|
| `sw.js` | Service worker: bewaart de app-bestanden zodat ze zonder internet openen |
| `manifest.webmanifest` | Naam, kleuren en iconen voor "Zet op beginscherm" |
| `icons/` | App-iconen (groen-wit gestreept met "RM"; gegenereerd, geen clublogo) |

**Hoe het werkt**

- **Openen zonder internet**: de service worker geeft de app-bestanden uit zijn cache. De gegevens (spelers, drankjes, open turven, "Mijn rekening") komen uit een lokale kopie in IndexedDB die bij elke succesvolle verversing wordt bijgewerkt. Voorwaarde: de app is minstens één keer met internet geopend en je was ingelogd.
- **Turven zonder internet**: komt in de wachtrij (IndexedDB) en blijft bewaard, ook als je de app sluit of de gsm herstart. Zodra er weer internet is (of bij openen van de app, of elke 20 seconden) wordt de wachtrij verstuurd. Het statuslabel toont hoeveel er nog wachten.
- **Updates**: de service worker gebruikt "stale-while-revalidate": hij toont meteen de bewaarde versie en haalt op de achtergrond de nieuwe. Een nieuwe versie zie je dus pas bij de **tweede** keer openen. Wil je de cache helemaal vervangen, verhoog dan `VERSION` in `sw.js`.
- De app vraagt de browser om de opslag "persistent" te maken, zodat de wachtrij niet zomaar opgeruimd wordt.
- Supabase-verzoeken gaan nooit via de cache van de service worker.

**Getest** (Edge headless, 390×844): app-bestanden in de cache; manifest en iconen laden; met webserver én netwerk uit opent de app, turven gaan in de wachtrij, na nogmaals herladen staat de wachtrij er nog, en na terug online worden ze verstuurd (op de server gecontroleerd). Een speler ziet offline "Mijn rekening" met de melding "Offline – gegevens van …".

**Aandachtspunt iPhone**: een app op het beginscherm heeft op iOS een eigen opslag, los van Safari. Een login-link uit de mail opent in Safari, niet in de app. Oplossing: de code uit de mail typen (zie "Wat nog openstaat": vraagt eigen SMTP), of tot dan in Safari inloggen. Op Android (Chrome) is er geen probleem.

## Mijlpaal 4: GitHub Action

**Bestanden**

| Bestand | Inhoud |
|---|---|
| `.github/workflows/supabase-onderhoud.yml` | De workflow |
| `scripts/supabase_ops.py` | Keep-alive-query en export (enkel standaard-Python + gpg) |
| `docs/keepalive.txt` | Wordt bij elke run overschreven en gecommit |
| `.nojekyll` | GitHub Pages serveert de bestanden zoals ze zijn (geen Jekyll) |

**Wat de workflow doet** (maandag en donderdag 05:17 UTC, en met de hand via *Actions → Run workflow*):

1. **Keep-alive**: haalt 1 drankje op met de service key. Mislukt dat (project gepauzeerd, key fout, netwerk), dan faalt de run met een `::error`-melding die uitlegt wat te doen → GitHub stuurt een mail.
2. **Export**: alle 6 tabellen in één JSON-bestand, versleuteld met gpg (AES256), bewaard als artefact (90 dagen). In de log staan enkel aantallen rijen.
3. **Keep-alive-commit**: schrijft datum + resultaat in `docs/keepalive.txt` en commit dat met de `GITHUB_TOKEN` (`permissions: contents: write`). Gebeurt **ook als stap 1 of 2 faalde**, zodat GitHub de geplande workflow niet uitschakelt na 60 dagen zonder activiteit (dan zou je net geen foutmails meer krijgen).

**Beslissingen**

- **Twee keer per week i.p.v. wekelijks.** Supabase pauzeert een gratis project na 7 dagen zonder activiteit, en GitHub start geplande runs soms uren te laat. Een wekelijkse run zit dus precies op de grens.
- **Export versleuteld.** De repo is publiek; artefacten van een publieke repo kan iedereen met een GitHub-account downloaden. Zonder `BACKUP_PASSPHRASE` weigert de workflow te exporteren (en faalt de run), in plaats van onversleuteld te bewaren.
- **Python i.p.v. bash + jq**: makkelijker lokaal te testen (ook op Windows). De nieuwe `sb_secret_...`-keys en de oude `service_role`-JWT werken allebei.
- De service key staat **enkel** als GitHub-secret, nooit in de repo of de frontend.

**Getest** (lokaal): ontbrekende secret, key zonder rechten (HTTP 401), onbestaand project (DNS-fout) en ontbrekend export-wachtwoord geven elk een duidelijke `::error` en exitcode 1. De succesroute is getest met een tijdelijk beheerders-token i.p.v. de service key; de versleutelde export werd daarna met `gpg --decrypt` correct ingelezen. De workflow zelf heeft nog niet op GitHub gedraaid (eerst pushen en secrets instellen).

## Wat nog openstaat

1. **Pushen naar GitHub** (wacht op toestemming van de eigenaar).
2. **GitHub Pages aanzetten**: *Settings → Pages* → Deploy from a branch → `main` / root (zie README).
3. **Secrets instellen**: `SUPABASE_SERVICE_ROLE_KEY` en `BACKUP_PASSPHRASE` (zie README), daarna de workflow één keer met de hand starten en controleren dat hij groen is en een commit maakt.
4. **Eerste beheerder aanduiden**: inloggen in de app, daarna de SQL uit de README.
5. **Eigen SMTP instellen** vóór het hele team uitgenodigd wordt (de ingebouwde mailserver haalt maar 2 mails per uur). Daarna in `supabase/config.toml` de twee `[auth.email.template...]`-blokken aanzetten en `supabase config push` draaien: dan staat er ook een code in de login-mail (nodig voor de app op het beginscherm van een iPhone).
6. Spelers toevoegen in de app (Beheer → + Speler), met e-mailadres voor wie "Mijn rekening" moet kunnen zien. Staan er nog gegevens van versie 1 op de gsm waarop tot nu geturfd werd? Open de nieuwe app op díe gsm als beheerder: onder Beheer verschijnt dan een knop om die te importeren.

**Mogelijke uitbreidingen** (niet gevraagd, niet gebouwd): prijzen per drankje en bedragen bij afrekenen; beheerders aanduiden vanuit de app; een rol "turver" die enkel mag turven.

## Hoe verder (voor wie dit oppikt)

- Lees eerst de README (setup) en dan dit document van boven naar onder.
- Lokaal draaien: `python -m http.server 5500` en open http://localhost:5500/.
- Datamodel wijzigen: nieuwe migratie in `supabase/migrations/`, `supabase db push`, daarna `supabase db query --linked -f supabase/tests/rls_test.sql` (alle rijen `ok = true`) en `python supabase/tests/anon_http_test.py`.
- Frontend wijzigen: `index.html` (opmaak) en `app.js` (logica). Test op een smal scherm (± 390 px breed). Verhoog `VERSION` in `sw.js` bij grote wijzigingen.
- Auth-instellingen: wijzig `supabase/config.toml`, draai `supabase config diff` en dan `supabase config push`.
