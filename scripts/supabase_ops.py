#!/usr/bin/env python3
"""Onderhoud voor de turflijst, gebruikt door .github/workflows/supabase-onderhoud.yml.

  python scripts/supabase_ops.py keepalive
      Lichte query (1 drankje ophalen), zodat het gratis Supabase-project niet pauzeert.
      Faalt met een duidelijke melding als Supabase niet antwoordt.

  python scripts/supabase_ops.py export <uitvoermap>
      Exporteert alle tabellen naar één JSON-bestand en versleutelt dat met gpg
      (AES256, wachtwoord uit BACKUP_PASSPHRASE). Het onversleutelde bestand wordt
      meteen verwijderd. Er komen geen gegevens in de log, enkel aantallen.

Omgevingsvariabelen:
  SUPABASE_URL                 bv. https://<ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY    secret key (sb_secret_...) of legacy service_role JWT. NOOIT in de frontend.
  BACKUP_PASSPHRASE            wachtwoord voor de versleutelde export
  SUPABASE_BEARER              (optioneel, enkel om lokaal te testen) JWT voor de Authorization-header

Enkel de standaardbibliotheek van Python + het programma gpg.
"""
import datetime as dt
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

TABLES = {  # tabel -> sorteerkolom
    "groups": "id",
    "players": "id",
    "drinks": "id",
    "settlements": "id",
    "entries": "id",
    "profiles": "user_id",
}
PAGE = 1000


def gh_error(title, msg):
    """Foutmelding die GitHub Actions bovenaan de run toont."""
    print(f"::error title={title}::{msg}", flush=True)


def config():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        gh_error("Secret ontbreekt",
                 "SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY is niet ingesteld. "
                 "Zet ze bij Settings > Secrets and variables > Actions (zie README).")
        sys.exit(1)
    headers = {"apikey": key, "Accept": "application/json"}
    bearer = os.environ.get("SUPABASE_BEARER") or (None if key.startswith("sb_") else key)
    if bearer:
        headers["Authorization"] = "Bearer " + bearer
    return url, headers


def get(url, headers, tries=3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:300]
            last = f"HTTP {e.code}: {body}"
            if e.code in (400, 401, 403, 404):
                break  # opnieuw proberen helpt niet
        except Exception as e:  # netwerk, DNS, timeout
            last = f"{type(e).__name__}: {e}"
        time.sleep(5 * (i + 1))
    raise RuntimeError(last)


def keepalive():
    url, headers = config()
    try:
        rows = get(f"{url}/rest/v1/drinks?select=id&limit=1", headers)
    except RuntimeError as e:
        gh_error("Supabase-query mislukt",
                 f"De keep-alive-query naar {url} is mislukt ({e}). "
                 "Mogelijk is het project gepauzeerd of is de key ongeldig. "
                 "Open het Supabase-dashboard, herstel het project (Restore) en controleer de secret.")
        sys.exit(1)
    print(f"Keep-alive OK ({len(rows)} rij opgehaald).")


def export(outdir):
    url, headers = config()
    passphrase = os.environ.get("BACKUP_PASSPHRASE", "")
    if not passphrase:
        gh_error("Secret ontbreekt",
                 "BACKUP_PASSPHRASE is niet ingesteld. De export wordt NIET onversleuteld bewaard, "
                 "want artefacten van een publieke repo zijn downloadbaar.")
        sys.exit(1)

    data = {"exported_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "tables": {}}
    for table, order in TABLES.items():
        rows, offset = [], 0
        while True:
            try:
                page = get(f"{url}/rest/v1/{table}?select=*&order={order}&limit={PAGE}&offset={offset}", headers)
            except RuntimeError as e:
                gh_error("Supabase-export mislukt", f"Tabel {table} kon niet gelezen worden ({e}).")
                sys.exit(1)
            rows += page
            if len(page) < PAGE:
                break
            offset += PAGE
        data["tables"][table] = rows
        print(f"  {table}: {len(rows)} rijen")

    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    stamp = dt.date.today().isoformat()
    plain = out / f"turflijst-export-{stamp}.json"
    enc = out / f"turflijst-export-{stamp}.json.gpg"
    plain.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    try:
        subprocess.run(
            ["gpg", "--batch", "--yes", "--quiet", "--pinentry-mode", "loopback", "--passphrase-fd", "0",
             "--symmetric", "--cipher-algo", "AES256", "--output", str(enc), str(plain)],
            input=passphrase.encode(), check=True)
    finally:
        plain.unlink(missing_ok=True)
    print(f"Export versleuteld: {enc.name} ({enc.stat().st_size} bytes)")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"### Export {stamp}\n\n| tabel | rijen |\n|---|---|\n")
            for t, rows in data["tables"].items():
                f.write(f"| {t} | {len(rows)} |\n")


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "keepalive":
        keepalive()
    elif len(sys.argv) >= 3 and sys.argv[1] == "export":
        export(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(2)
