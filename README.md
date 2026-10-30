# Turflijst

Digitale turflijst voor de A-kern van Racing Mechelen.

- **Frontend**: `index.html` + `app.js` (vanilla JavaScript, geen build-stap), gehost op GitHub Pages:
  https://ysnmrn.github.io/Turflijst/
- **Backend**: [Supabase](https://supabase.com) (Postgres + login met magic link), regio EU (Frankfurt).
- **Offline**: turven gaan eerst in een lokale wachtrij en worden verstuurd zodra er internet is. De app is installeerbaar ("Zet op beginscherm").
- **Geen spelersnamen in de code**: spelers voeg je toe in de app. Ze staan enkel in de database.

Status, beslissingen en volgende stappen: [docs/STAND-VAN-ZAKEN.md](docs/STAND-VAN-ZAKEN.md).

## Rollen

| Rol | Kan |
|---|---|
| **Beheerder** | Turven voor iedereen, afrekenen, spelers/consumpties/groepen beheren, overzicht en geschiedenis bekijken |
| **Speler** | Enkel "Mijn rekening": eigen openstaande consumpties en vorige afrekeningen. Kan niets wijzigen. |

Iedereen die inlogt krijgt eerst de rol *speler*. Een speler ziet zijn rekening pas als de beheerder bij die speler zijn e-mailadres invult (Beheer → Spelers → Wijzig).

## Mappen

```
index.html, app.js        de app
config.js                 Supabase-URL + publishable key (publiek, mag in de repo)
sw.js, manifest.webmanifest, icons/   offline + installeerbaar
vendor/supabase.js        supabase-js (vaste versie)
supabase/migrations/      datamodel, RLS, startgegevens (groepen + consumpties)
supabase/tests/           RLS-tests
supabase/templates/       login-mails (actief zodra eigen SMTP is ingesteld)
scripts/supabase_ops.py   keep-alive en export (gebruikt door de GitHub Action)
.github/workflows/        de GitHub Action
docs/                     stand van zaken, keepalive.txt
```

## Setup

### 1. Supabase-project (EU)

1. Maak een project aan op https://supabase.com/dashboard → *New project*. Kies regio **Central EU (Frankfurt) – eu-central-1**. Bewaar het databasewachtwoord in een wachtwoordmanager.
2. Installeer de Supabase CLI (Windows: `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git` en `scoop install supabase`).
3. In deze map:
   ```sh
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push              # maakt tabellen, RLS, en zet groepen + consumpties klaar
   supabase config diff          # bekijk wat er aan de auth-instellingen verandert
   supabase config push          # site_url en redirect-URL's uit supabase/config.toml
   ```
4. Controleer de rechten:
   ```sh
   supabase db query --linked -f supabase/tests/rls_test.sql   # alle rijen ok = true
   python supabase/tests/anon_http_test.py                       # 0 fout(en)
   ```
5. **E-mail (belangrijk)**: de ingebouwde mailserver van Supabase verstuurt maar 2 mails per uur. Stel voor gebruik met het hele team eigen SMTP in: *Authentication → Emails → SMTP Settings* (bv. Resend of Brevo, gratis volume volstaat). Haal daarna in `supabase/config.toml` de `#` weg bij de twee `[auth.email.template...]`-blokken en draai `supabase config push`: dan staat er ook een code in de login-mail (nodig voor de app op het beginscherm van een iPhone).

### 2. config.js

Kopieer `config.example.js` naar `config.js` en vul in:
- `SUPABASE_URL`: *Project Settings → API* → Project URL
- `SUPABASE_PUBLISHABLE_KEY`: *Project Settings → API Keys* → **publishable** key (`sb_publishable_...`)

> **Nooit** de secret/service_role key in `config.js` of ergens anders in de frontend. Die key negeert alle rechten.

### 3. Eerste beheerder

1. Open de app en log in met jouw e-mailadres (magic link).
2. Maak jezelf beheerder, via *SQL Editor* in het dashboard of met de CLI:
   ```sql
   update public.profiles set rol = 'beheerder'
    where user_id = (select id from auth.users where email = 'jouw@adres.be');
   ```
3. Herlaad de app: je ziet nu Turven, Overzicht en Beheer.

Een beheerder terug speler maken: dezelfde query met `rol = 'speler'`.

### 4. GitHub Pages

1. Repo → *Settings → Pages* → *Build and deployment*: **Deploy from a branch**, branch `main`, map `/ (root)`.
2. Na een minuut staat de app op `https://<gebruiker>.github.io/<repo>/`.
3. Zet die URL in `supabase/config.toml` bij `site_url` en `additional_redirect_urls` en draai `supabase config push` (voor deze repo is dat al gebeurd).

### 5. GitHub Action (keep-alive + export)

De workflow `.github/workflows/supabase-onderhoud.yml` draait elke maandag en donderdag (en met de hand via *Actions → Supabase onderhoud → Run workflow*). Hij:

1. doet een lichte query, zodat het gratis project niet pauzeert (Supabase pauzeert na 7 dagen zonder activiteit). Lukt dat niet, dan **faalt de run met een duidelijke melding** en krijg je een mail van GitHub;
2. exporteert alle tabellen naar één JSON-bestand, **versleuteld** met gpg, en bewaart het 90 dagen als artefact;
3. maakt een kleine commit in `docs/keepalive.txt`, zodat GitHub de geplande workflow niet uitzet na 60 dagen zonder activiteit.

Instellen: repo → *Settings → Secrets and variables → Actions → New repository secret*:

| Secret | Waarde |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → *Project Settings → API Keys* → **secret** key (`sb_secret_...`) of de legacy `service_role` key |
| `BACKUP_PASSPHRASE` | een lang wachtwoord naar keuze (bewaar het in je wachtwoordmanager: zonder dit wachtwoord is de export onleesbaar) |

Optioneel een *variable* `SUPABASE_URL` (standaard staat de URL van dit project in de workflow).

Waarom versleuteld? De repo is publiek, en artefacten van een publieke repo zijn downloadbaar voor iedereen met een GitHub-account. De export bevat namen en e-mailadressen.

Mails bij een mislukte run: GitHub mailt standaard bij een mislukte geplande workflow naar wie de workflow laatst wijzigde. Controleer *GitHub → Settings → Notifications → Actions*.

**Export terugzetten of bekijken**: download het artefact (zip) bij de run, pak uit en ontsleutel:

```sh
gpg --decrypt turflijst-export-JJJJ-MM-DD.json.gpg > export.json
```

`gpg` zit bij Git for Windows (in *Git Bash*). Het JSON-bestand heeft per tabel een lijst rijen (`tables.groups`, `tables.players`, ...).

## Lokaal testen

```sh
python -m http.server 5500
```

Open http://localhost:5500/ (staat in de toegestane redirect-URL's, dus inloggen met magic link werkt ook lokaal).

## Een nieuwe versie uitrollen

- Wijzig de bestanden en push naar `main`; GitHub Pages publiceert automatisch.
- De service worker toont eerst de bewaarde versie en haalt op de achtergrond de nieuwe: gebruikers zien een update bij de tweede keer openen. Verhoog `VERSION` in `sw.js` om de cache volledig te vervangen.
- Wijziging aan de database: nieuwe migratie in `supabase/migrations/` (bv. `supabase migration new naam`), `supabase db push`, en de RLS-test opnieuw draaien.
