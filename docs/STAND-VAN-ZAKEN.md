# Stand van zaken

*Laatst bijgewerkt: 30 oktober 2026*

## Wat is de app?

Een turflijst voor de drankenlijst van de A-kern van Racing Mechelen. Spelers, doelmannen, trainerstaf en gasten kunnen per drank geturfd worden; de app houdt totalen en afrekeningen bij.

Technisch: één `index.html` met vanilla JavaScript. Alle gegevens staan in `localStorage` van de browser waarin de app geopend wordt.

## Versie 1 (nu in de repo)

- De werkende app staat in `index.html`.
- **Zonder echte spelersnamen**: de startlijst bevat enkel placeholders, met dezelfde groepen als in het origineel:
  - A-kern: `Speler 1`, `Speler 2`
  - Doelmannen: `Keeper 1`
  - Trainerstaf: `Trainer 1`
- Beperking: gegevens staan maar op één toestel/browser. Er is geen gedeelde database en geen login.

## Supabase-project (opgezet op 30 oktober 2026)

| | |
|---|---|
| Projectnaam | `turflijst` |
| Project-ref | `cwzntyygjgnikphbfpei` |
| Project URL | `https://cwzntyygjgnikphbfpei.supabase.co` |
| Regio | `eu-central-1` (Frankfurt) |
| Plan | Free |
| Dashboard | https://supabase.com/dashboard/project/cwzntyygjgnikphbfpei |

**Wat is ingesteld**

- Auth: e-mail-login aan (magic link via `signInWithOtp`), nieuwe registraties toegestaan, e-mailbevestiging aan.
- `site_url`: `https://ysnmrn.github.io/Turflijst/`
- Toegestane redirect-URL's: `http://localhost:5500/**`, `http://127.0.0.1:5500/**` (lokaal testen, bv. met Live Server).
- `supabase/config.toml` is gelijkgezet met de live instellingen; `supabase config push` wijzigt dus enkel wat er bewust in aangepast wordt. Draai altijd eerst `supabase config diff`.
- De repo is gelinkt aan het project (`supabase link`), zodat migraties later met `supabase db push` kunnen.

**Sleutels en geheimen**

- `config.js` (lokaal, in `.gitignore`) bevat de Project URL en de publishable key. Sjabloon: `config.example.js`.
- De secret/service_role key en het databasewachtwoord staan **nergens** in deze repo. Het databasewachtwoord staat in de wachtwoordmanager van de beheerder.

**Aandachtspunt**

- De ingebouwde e-mailserver van Supabase verstuurt maar **2 e-mails per uur** en is enkel voor testen bedoeld. Voor magic links naar het hele team is een eigen SMTP-dienst nodig (bv. Resend, Brevo), in te stellen via het dashboard (Authentication → Emails → SMTP).

## Volgende stap

Ombouw naar een gedeelde online versie:

- **Supabase (regio EU)** als database en voor authenticatie, zodat iedereen dezelfde gegevens ziet.
- **GitHub Pages** voor de hosting van de frontend.
- **Rollen**:
  - **Beheerder**: beheert spelers, dranken en prijzen, turft voor iedereen en registreert afrekeningen.
  - **Speler**: ziet en turft enkel voor zichzelf (afhankelijk van de uiteindelijke afspraken).
- Spelersnamen komen dan in de database terecht, niet in de code. Supabase-sleutels gaan in `config.js` / `.env`, die in `.gitignore` staan.
