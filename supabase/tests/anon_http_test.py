"""Test of de publieke (anon/publishable) key zonder login niets kan lezen of schrijven.

Draaien vanuit de repo-root:  python supabase/tests/anon_http_test.py
Leest SUPABASE_URL en de key uit config.js. Enkel de standaardbibliotheek van Python.
"""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

cfg = Path(__file__).resolve().parents[2].joinpath("config.js").read_text(encoding="utf-8")
URL = re.search(r"SUPABASE_URL:\s*'([^']+)'", cfg).group(1)
KEY = re.search(r"SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'", cfg).group(1)
TABLES = ["profiles", "groups", "players", "drinks", "settlements", "entries"]


def call(method, path, body=None):
    req = urllib.request.Request(
        URL + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"apikey": KEY, "Content-Type": "application/json", "Prefer": "return=minimal"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


fouten = 0


def check(naam, ok, info=""):
    global fouten
    fouten += not ok
    print(("OK  " if ok else "FOUT"), naam, "" if ok else info)


for t in TABLES:
    st, body = call("GET", f"/rest/v1/{t}?select=*&limit=5")
    # Ofwel geweigerd (401/403), ofwel een lege lijst.
    check(f"anon leest niets uit {t}", st in (401, 403) or (st == 200 and json.loads(body) == []), f"{st} {body[:200]}")

st, body = call("POST", "/rest/v1/drinks", {"naam": "anon-test"})
check("anon kan geen drankje toevoegen", st in (401, 403), f"{st} {body[:200]}")

st, body = call("POST", "/rest/v1/entries", {"player_id": "00000000-0000-0000-0000-000000000000",
                                              "drink_id": "00000000-0000-0000-0000-000000000000"})
check("anon kan geen turf toevoegen", st in (401, 403), f"{st} {body[:200]}")

st, body = call("PATCH", "/rest/v1/profiles?user_id=not.is.null", {"rol": "beheerder"})
check("anon kan geen profiel wijzigen", st in (401, 403),f"{st} {body[:200]}")

st, body = call("POST", "/rest/v1/rpc/afrekenen", {"p_player_id": "00000000-0000-0000-0000-000000000000",
                                                   "p_entry_ids": []})
check("anon kan afrekenen() niet aanroepen", st in (401, 403, 404), f"{st} {body[:200]}")

print(f"\n{fouten} fout(en)")
sys.exit(1 if fouten else 0)
