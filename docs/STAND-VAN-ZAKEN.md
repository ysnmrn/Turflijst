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

## Volgende stap

Ombouw naar een gedeelde online versie:

- **Supabase (regio EU)** als database en voor authenticatie, zodat iedereen dezelfde gegevens ziet.
- **GitHub Pages** voor de hosting van de frontend.
- **Rollen**:
  - **Beheerder**: beheert spelers, dranken en prijzen, turft voor iedereen en registreert afrekeningen.
  - **Speler**: ziet en turft enkel voor zichzelf (afhankelijk van de uiteindelijke afspraken).
- Spelersnamen komen dan in de database terecht, niet in de code. Supabase-sleutels gaan in `config.js` / `.env`, die in `.gitignore` staan.
