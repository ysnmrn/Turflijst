# Stand van zaken

*Laatst bijgewerkt: 30 oktober 2026 — alle 4 mijlpalen klaar en online; look "D" online; spelers staan in de database; nieuwe lay-out (pil "Alle", nieuw Overzicht) online; "consumpties" met categorieën online*

## Wat is de app?

Een turflijst voor de drankenlijst van de A-kern van Racing Mechelen. Spelers, doelmannen, trainerstaf en gasten kunnen per drank geturfd worden; de app houdt totalen en afrekeningen bij.

Versie 1 was één `index.html` met alle gegevens in `localStorage` (één toestel, geen login). Versie 2 gebruikt **Supabase** als gedeelde database met login.

## Mijlpalen

| # | Mijlpaal | Status |
|---|---|---|
| 1 | Datamodel + RLS (Supabase) | ✅ klaar |
| 2 | UI omgebouwd naar Supabase | ✅ klaar |
| 3 | Offline + PWA | ✅ klaar |
| 4 | GitHub Action (keep-alive + export) | ✅ klaar en actief |

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
| `20261031090000_categorie_consumpties.sql` | Kolom `drinks.categorie` + indeling, zie "Consumpties en categorieën" |

**Tabellen**

- `profiles(user_id, naam, rol)` — één rij per login, automatisch aangemaakt bij de eerste login (rol `speler`).
- `groups(id, naam, volgorde)`
- `players(id, naam, group_id, email, user_id, actief, created_at)` — wordt nooit verwijderd, enkel `actief = false`.
- `drinks(id, naam, volgorde, actief, categorie)` — idem. In de app heten ze **consumpties**. `categorie` is Fris, Warm, Bier of Snacks.
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
- `supabase db advisors --linked` — één waarschuwing: "Leaked Password Protection" staat uit. Niet relevant: inloggen gebeurt alleen via een maillink (geen wachtwoorden).

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
  - *Overzicht*: tegels, wat openstaat per speler en de afrekeningen per dag (zie "Lay-out: pil Alle en nieuw Overzicht").
  - *Mijn rekening*: enkel als de beheerder zelf aan een speler gekoppeld is.
  - *Beheer*: spelers (naam, groep, e-mail, actief/archief), drankjes (naam, volgorde ▲▼, archief), groepen (naam, volgorde, verwijderen als leeg), back-up downloaden (JSON), uitloggen. Als er nog gegevens van versie 1 op het toestel staan, verschijnt een knop om die te importeren.
- **Speler**: enkel *Mijn rekening* (openstaand + vorige afrekeningen) en uitloggen.
- **Login zonder gekoppelde speler**: melding "nog niet gekoppeld".

**Beslissingen**

- **`config.js` staat in de repo** (was eerst in `.gitignore`). GitHub Pages heeft het nodig, en de publishable key is bedoeld om publiek te zijn: elke bezoeker ziet hem toch in de browser. De beveiliging zit volledig in RLS.
- **Elke turf gaat eerst in een lokale wachtrij** (IndexedDB) en wordt dan naar Supabase gestuurd. Het toestel maakt zelf het id (UUID), dus opnieuw versturen na een netwerkfout maakt nooit een dubbele turf (`upsert ... ignoreDuplicates`). −1 en "Ongedaan" op een turf die nog in de wachtrij zit, halen die gewoon uit de wachtrij; anders wordt een verwijder-opdracht in de wachtrij gezet.
- **Afrekenen, spelers/drankjes/groepen wijzigen en gasten toevoegen kan enkel online.** Vóór het afrekenen wordt eerst de wachtrij verstuurd, zodat de afrekening alles bevat.
- **Statuslabel rechtsboven**: *Online*, *Sync · n*, *Offline · n* (n = wachtende turven) of *n mislukt*. Tik erop voor details en om meteen te synchroniseren.
- **Verversen**: bij terugkeren naar de app, bij terug online komen, en elke minuut zolang de app open staat. (Geen realtime-abonnement: niet nodig voor een turflijst en spaart het gratis plan.)
- **Logo**: altijd het clublogo `logo.png`. (Een eigen logo per toestel kiezen kon vroeger; dat is weggehaald, zie hieronder.)
- **Mailsjablonen**: Supabase weigert aangepaste sjablonen op het Free-plan zolang de ingebouwde mailserver gebruikt wordt. De sjablonen staan klaar maar zijn uitgeschakeld in `config.toml`.

**Getest** (Microsoft Edge headless, schermformaat 390×844, met tijdelijke testlogins die achteraf verwijderd zijn): inloggen, spelers/drankjes/groepen toevoegen en wijzigen, volgorde, groep verwijderen, turven, −1, ongedaan maken, offline turven en automatisch synchroniseren, afrekenen met opmerking, geschiedenis met alle filters, gast toevoegen, archiveren, en "Mijn rekening" als speler (ziet enkel zichzelf; schrijven wordt geweigerd).

## Mijlpaal 3: offline en installeerbaar (PWA)

**Bestanden**

| Bestand | Inhoud |
|---|---|
| `sw.js` | Service worker: bewaart de app-bestanden zodat ze zonder internet openen |
| `manifest.webmanifest` | Naam, kleuren en iconen voor "Zet op beginscherm" |
| `icons/` | App-iconen en favicons, gemaakt uit het clublogo (zie "Look D") |

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

## Look "D" (30 oktober 2026)

Nieuwe vormgeving. **Enkel uitzicht en weergave zijn veranderd**: datamodel, RLS, offline-wachtrij, synchronisatie, rollen en de GitHub Action zijn exact hetzelfde gebleven (de wijziging in `app.js` raakt alleen de weergavefuncties).

**Wat er veranderd is**

- **Kleuren** (CSS-variabelen bovenaan `index.html`): clubgroen `--groen #007852`, streep `--streep #0a8a5f`, donker `--donker #00553a`, zacht groen `--zacht #e3f2ea`, achtergrond `--bg #f4f7f5`, rand `--rand #d8e4dc`, tekst `--tekst #13201a`, grijze tekst `--grijs #4f5e55`, afrekenen `--rood #b42318`.
- **Kop** op elk scherm: verticaal gestreept als een clubshirt (30px-strepen), 4px wit randje, logo in een wit vak van 54px, "RACING MECHELEN", "Drankenlijst A-kern" (sinds 31 oktober "Turflijst A-kern") en het statuspilletje.
- **Turven** (later uitgebreid met de pil "Alle", zie verder): zoekbalk, groepen als pillen (uit de database, in hun volgorde), één groep tegelijk met kopje "GROEP ──── x open". De laatst gekozen groep wordt per toestel onthouden. Zoeken toont spelers uit alle groepen. Spelers als kaarten in 2 kolommen; met open drankjes een groene rand en een groen bolletje met het aantal. In de gastengroep een kaart "+ Gast toevoegen".
- **Drankjes van een speler**: nu een volledig scherm (was een uitschuifpaneel) met gestreepte kop, terugknop (44px), groep, naam (max. 2 regels), wit vakje met het totaal en het logo. Tegels in 3 kolommen; tik = +1, "−" = één minder. Onderaan chips ("2× Cola") en een rode knop "Afrekenen (n)" van 52px.
- **Onderbalk**: grote tabs (50px) met lijn-icoon; actief = zacht groen vlak met groene, vette tekst. Is de beheerder ook aan een speler gekoppeld, dan is er een 4e tab "Rekening" (dan zonder iconen, zodat het op 360px past).
- Overzicht, Beheer, Mijn rekening en het loginscherm gebruiken dezelfde kleuren, kop en kaarten.

**Logo, iconen, fonts**

- `logo.png` = het clublogo (706×706, groen schild op wit), aangeleverd als `Logo-krc-mechelen.png` en hernoemd zodat de app het vanzelf gebruikt.
- `icons/`: `icon-192.png` en `icon-512.png` (logo op wit), `icon-maskable-512.png` (logo op 56% met witte marge, valt binnen de veilige zone van Android), `apple-touch-icon.png` (180) en `favicon-32/48.png`. Gegenereerd uit `logo.png` met een headless browser.
- `fonts/`: Barlow (400, 500, 600, 700) en Barlow Condensed (600, 700), subset *latin*, als woff2 in de repo, licentie SIL OFL (`fonts/OFL.txt`, herkomst in `fonts/BRON.txt`). Geen link naar Google Fonts: geen externe verzoeken en de fonts werken offline.
- Service worker: cache naar `v2`; logo, iconen en fonts zitten in de cache. Wie de app al gebruikte, krijgt de nieuwe look bij de tweede keer openen.

**Contrast** (WCAG, minimum 4.5:1 voor gewone tekst): alle combinaties halen dat (bv. grijze tekst op achtergrond 6.35, wit op clubgroen 5.51, clubgroen op zacht groen 4.77, wit op rood 6.57), behalve **wit op de lichte streep #0a8a5f: 4.36**. Oplossing zonder de streepkleuren te veranderen: de titel is groot en vet (daarvoor volstaat 3:1), en kleine tekst in de gestreepte kop krijgt een dunne donkergroene rand (`--halo`), zodat elke letter op #00553a staat (8.9:1).

**Getest** (Edge headless, 390×800 en 360×800, met een nagebootste backend en verzonnen namen, zodat er geen echte gegevens op screenshots kwamen en niets in de live database veranderde): login, turven (pillen, groep wisselen, gastengroep, zoeken over groepen), drankjesscherm (+1, −1, totaal, chips, Afrekenen (n)), offline turven + synchroniseren, afrekenen, overzicht en geschiedenis, beheer en dialoog, Mijn rekening als speler. Gemeten: 2 kolommen spelers, 3 kolommen tegels, kaarten ≥ 60px, pillen ≥ 38px, tabs ≥ 50px, terugknop 44px, afrekenknop 52px, logo 54/46px, geen horizontaal scrollen. Offline geopend (webserver en netwerk uit): fonts en logo laden uit de cache. axe-core (contrastregel) vond 0 fouten op alle schermen.

## Lay-out: pil "Alle" en nieuw Overzicht (30 oktober 2026)

Look D blijft. Enkel weergave is veranderd: datamodel, RLS, offline-wachtrij, synchronisatie en rollen zijn dezelfde. Eén extra leesquery: bij elke verversing haalt de beheerder ook het tijdstip van de laatste afrekening op (voor de tegel "Laatst afgerekend"); dat wordt mee in de lokale kopie bewaard, zodat het ook offline zichtbaar is.

**Turven**
- Vooraan een pil **"Alle"**, standaard gekozen: alle groepen onder elkaar in hun volgorde, elk met kopje "GROEP ──── x open" en spelerskaarten in 2 kolommen. Groepen zonder actieve spelers worden overgeslagen, behalve de gastengroep (met "+ Gast toevoegen").
- Een groeppil toont enkel die groep, zoals voordien. De gekozen pil wordt per toestel onthouden (`localStorage` `turflijst-groep`, waarde `alle` of een groep-id).
- Zoeken doorzoekt altijd alle groepen.

**Overzicht** (de brede tabel en de maandkiezer zijn weg)
- Titel "Overzicht" in de gestreepte kop (de andere schermen houden de gewone titel).
- 3 tegels naast elkaar: *Open drankjes*, *Spelers open*, *Laatst afgerekend* (bv. "28 okt", "–" als er nog geen is; in een ander jaar "28 okt ’25").
- Segmentschakelaar *Openstaand* / *Geschiedenis* (`role=tablist/tab`, `aria-selected`, pijltjestoetsen wisselen). De gekozen tab wordt per toestel onthouden (`turflijst-overzicht-tab`).
- *Openstaand*: per groep met iets open een kopje; per speler één kaart (meeste eerst, bij gelijkstand alfabetisch) met totaal, pijltje en chips per drankje (meeste eerst). Tik = drankjesscherm (daar is Afrekenen). Onderaan een kaart met stippelrand "Alle spelers samen". Leeg: "Niets open."
- *Geschiedenis*: pillen *Deze maand* (standaard), *Vorige maand*, *Alles* en een keuzelijst *Speler*. Afrekeningen per dag, nieuwste eerst, kopje "WO 28 OKT ──── x drankjes", per dag één kaart met naam, uur, totaal, drankjes ("3× Cola · 2× Duvel") en eventuele opmerking. Onderaan "Meer filters (periode kiezen)": klapt de periodefilter (van–tot) open; die verschijnt bovenaan onder de spelerkeuze, zodat je de resultaten eronder meteen ziet. Een pil kiezen sluit hem weer. Leeg: "Nog geen afrekeningen in deze periode." Offline: "Afrekeningen bekijken kan enkel met internet."

**Beheer**
- Het onderdeel "Logo op dit toestel" is weg (opmaak en code). Een vroeger opgeslagen logo (`localStorage` `turflijst-logo`) wordt bij het opstarten verwijderd. Bij het importeren van versie 1 wordt het logo uit die gegevens niet meer overgenomen.

**Service worker**: cache naar `v3`.

**Getest** (Edge headless, 390×800 en 360×800, nagebootste backend met verzonnen namen, waaronder een heel lange; niets in de live database aangeraakt): pil Alle (volgorde groepen, kopjes, 2 kolommen, gastenkaart), groep kiezen en onthouden na herladen, zoeken over groepen; Overzicht: tegels (waarden, naast elkaar), tabs (40px, aria-selected, onthouden na herladen), sortering kaarten en chips, tik naar drankjesscherm, totaalkaart; Geschiedenis: elke filterpil, spelerfilter, lege toestand, periodefilter open/dicht; offline (tegels uit de lokale kopie, offline turven, melding bij geschiedenis, daarna synchroniseren); afrekenen werkt "Laatst afgerekend" bij; lege database ("Niets open.", "–"); Beheer zonder logo-onderdeel en logo-data opgeruimd; Mijn rekening als speler; offline openen met cache `v3`. Geen horizontaal scrollen. axe-core (contrast): 0 fouten op Turven, Overzicht (beide tabs), drankjesscherm, Beheer en Mijn rekening.

## Spelers in de database (30 oktober 2026)

- De spelerslijst van de A-kern staat in de live database: **A-kern spelers 24**, **A-kern doelmannen 3**, **A-kern trainerstaf 4**, **Extra / gasten 0**. Rechtstreeks met een tijdelijke SQL-query ingevoerd; de namen staan bewust nergens in deze repo.
- Namen in de vorm "Achternaam Voornaam" (de staf enkel voornaam), met accenten.
- Twee spelers stonden er al met voornaam eerst; die zijn hernoemd naar dezelfde vorm (zelfde rij, dus geen dubbels en eventuele turven blijven bij hen).
- Binnen een groep toont de app spelers **alfabetisch**; er is geen aparte volgorde-kolom voor spelers.
- Nog geen e-mailadressen ingevuld: wie "Mijn rekening" moet zien, krijgt dat via Beheer → speler → e-mail.

## Consumpties en categorieën (31 oktober 2026)

Look D blijft; RLS, offline-wachtrij, synchronisatie en rollen werken zoals voordien.

**Woorden**
- Overal in de app "consumptie(s)" i.p.v. "drankje(s)": kop-ondertitel ("10 consumpties open"), tegel "Open consumpties", "Tik op een consumptie voor +1", Beheer → "Consumpties" / "+ Consumptie", meldingen en Mijn rekening.
- Titel "Turflijst A-kern" i.p.v. "Drankenlijst A-kern": kop, loginscherm, `<title>`, manifest (`name` "Turflijst A-kern – Racing Mechelen", `short_name` "Turflijst", kort genoeg om onder het icoon op een gsm niet afgekort te worden).
- Interne namen bleven: tabel `drinks`, `drink_id`, functienamen, de sleutel van versie 1.

**Datamodel** (migratie `20261031090000_categorie_consumpties.sql`, toegepast op het live project)
- Kolom `drinks.categorie text not null default 'Fris'`, met een check op Fris, Warm, Bier, Snacks. De volgorde van de categorieën staat vast in de app (`CATS` in `app.js`).
- RLS en rechten niet aangepast: de rechten op `drinks` gelden per tabel, dus ook voor de nieuwe kolom. Na de migratie: RLS-tests 54/54 ok, anon-API-test 0 fouten.
- Indeling: **Fris** Water, Aquarius, Fuze Tea, Ice Tea, Cola, Fanta, Sprite, Minute Maid, Fristi, Nalu, Red Bull · **Warm** Cecemel, Warme choco · **Bier** Stella Artois, Carolus, Kriek, Duvel · **Snacks** Chips, Snoep, Koek.
- "Chips / snoep" is **gearchiveerd, niet verwijderd** (categorie Snacks), zodat oude afrekeningen kloppen. Er stonden geen open turven op. Chips, Snoep en Koek zijn nieuw (volgorde 19–21).

**App**
- *Consumptiescherm*: tegels per categorie onder kopjes "FRIS ────", "WARM ────", "BIER ────", "SNACKS ────" (zelfde stijl als de groepkopjes), 3 kolommen per categorie. Lege categorieën worden niet getoond. De chips onderaan en de afrekenvraag volgen dezelfde volgorde.
- *Beheer*: consumpties per categorie; ▲▼ verschuift binnen de categorie. In de dialoog een keuzelijst "Categorie"; nieuwe consumpties staan standaard op Fris.
- *Overzicht*: chips per speler blijven "meeste eerst"; "Alle spelers samen" is per categorie gesorteerd (daarbinnen meeste eerst). Geschiedenis toont ook gearchiveerde items (bv. "2× Chips / snoep").
- Een lokale kopie van vóór de update (zonder categorie) toont alles als Fris tot de eerstvolgende verversing.
- Service worker: cache naar `v4`.

**Getest** (Edge headless, 390×800 en 360×800, nagebootste backend met verzonnen namen; niets in de live database aangeraakt behalve de migratie): kop/title/manifest/loginscherm zonder "drank"; 4 categoriekopjes in de goede volgorde en stijl, 3 kolommen per categorie, gearchiveerd item niet als tegel; offline turven op een nieuw item (Koek) en een bestaand (Duvel), −1 uit de wachtrij, daarna correct verstuurd; "Alle spelers samen" per categorie; geschiedenis met gearchiveerd item; Beheer: categoriekopjes, ▲▼ past enkel de eigen categorie aan, categorie wijzigen, nieuw item standaard Fris en zichtbaar in het consumptiescherm; Mijn rekening als speler; offline openen met cache `v4` en turven op een nieuw item. Geen horizontaal scrollen. axe-core (contrast): 0 fouten.

## Online (30 oktober 2026)

- **App**: https://ysnmrn.github.io/Turflijst/ — GitHub Pages, branch `main`, map `/` (root).
- **Beheerder**: de eigenaar van de repo (GitHub `ysnmrn`). Het e-mailadres staat bewust niet in deze publieke repo. Opzoeken wie beheerder is:
  ```sql
  select u.email, p.rol from auth.users u join public.profiles p on p.user_id = u.id where p.rol = 'beheerder';
  ```
- **GitHub-secrets** (ingesteld; waarden staan enkel in GitHub en in de wachtwoordmanager van de beheerder, nooit in de repo):
  - `SUPABASE_SERVICE_ROLE_KEY` — de nieuwe Supabase *secret key* (`sb_secret_...`), rechtstreeks van de Supabase CLI naar `gh secret set` gepijpt.
  - `BACKUP_PASSPHRASE` — wachtwoord van de versleutelde export. Is op 30 oktober één keer vervangen (het eerste was per ongeluk gedeeld); de exports die met het oude wachtwoord versleuteld waren, zijn verwijderd. Wie dit wachtwoord kwijt is, kan de exports niet meer openen: maak dan een nieuw aan met `gh secret set BACKUP_PASSPHRASE` (oude exports blijven dan onleesbaar).
- **Workflow**: drie handmatige runs op 30 oktober, alle drie geslaagd (keep-alive, export, artefact, commit). Gecontroleerd dat het artefact met AES256 versleuteld is en enkel met het huidige wachtwoord opent. Actions bijgewerkt naar `checkout@v7` en `upload-artifact@v7` (Node 24). Daarna draait hij vanzelf elke maandag en donderdag.
- **Databasefuncties** (gecontroleerd in de live database): `afrekenen()` is SECURITY INVOKER (RLS blijft gelden), controleert zelf dat de aanroeper beheerder is en heeft een vaste `search_path`. De SECURITY DEFINER-functies (`private.is_beheerder`, `private.mijn_speler_ids`, en de triggers `handle_new_user` en `players_koppel_email`) hebben allemaal `search_path = ''`; de triggers zijn niet via de API aanroepbaar.

## Wat nog openstaat

1. **De site op een echte gsm in daglicht bekijken** (nieuwe lay-out sinds 30 oktober, consumpties en categorieën sinds 31 oktober online; wie de app al gebruikte, ziet ze bij de tweede keer openen).
2. **Eigen SMTP instellen** vóór het hele team uitgenodigd wordt (de ingebouwde mailserver haalt maar 2 mails per uur). Daarna in `supabase/config.toml` de twee `[auth.email.template...]`-blokken aanzetten en `supabase config push` draaien: dan staat er ook een code in de login-mail (nodig voor de app op het beginscherm van een iPhone).
3. **E-mailadressen invullen** (Beheer → speler) voor wie "Mijn rekening" moet kunnen zien; de spelers zelf staan al in de database. Staan er nog gegevens van versie 1 op de gsm waarop tot nu geturfd werd? Open de nieuwe app op díe gsm als beheerder: onder Beheer verschijnt dan een knop om die te importeren.
4. Over een paar dagen nakijken of de eerste **geplande** run (maandag of donderdag) vanzelf gestart en geslaagd is.

**Mogelijke uitbreidingen** (niet gevraagd, niet gebouwd): prijzen per drankje en bedragen bij afrekenen; beheerders aanduiden vanuit de app; een rol "turver" die enkel mag turven.

## Hoe verder (voor wie dit oppikt)

- Lees eerst de README (setup) en dan dit document van boven naar onder.
- Lokaal draaien: `python -m http.server 5500` en open http://localhost:5500/.
- Datamodel wijzigen: nieuwe migratie in `supabase/migrations/`, `supabase db push`, daarna `supabase db query --linked -f supabase/tests/rls_test.sql` (alle rijen `ok = true`) en `python supabase/tests/anon_http_test.py`.
- Frontend wijzigen: `index.html` (opmaak) en `app.js` (logica). Test op een smal scherm (± 390 px breed). Verhoog `VERSION` in `sw.js` bij grote wijzigingen.
- Auth-instellingen: wijzig `supabase/config.toml`, draai `supabase config diff` en dan `supabase config push`.
