"""Les membres de La Bonne Franquette d'après l'armurerie officielle de Blizzard (publique), pour la rubrique Membres du site.
Lancé par GitHub Actions (.github/workflows/membres.yml) toutes les 6 heures : écrit data/membres.json seulement si la liste a changé.
Python standard, aucune dépendance. Les noms des rangs viennent d'ailleurs (data/rangs.json, lus en jeu par l'addon d'un officier)."""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://worldofwarcraft.blizzard.com"
REGION, GUILDE = "eu", "la-bonne-franquette"
UA = "LBF-site-de-guilde/1.0 (+https://tokxity05.github.io/la-bonne-franquette/)"
SORTIE = Path(__file__).resolve().parents[2] / "data" / "membres.json"


def obtenir(url, corps=None, entetes=None):
    time.sleep(2)  # une requête à la fois, sans presser l'armurerie
    h = {"User-Agent": UA, "Accept-Language": "fr-FR"}
    h.update(entetes or {})
    req = urllib.request.Request(url, data=corps, headers=h, method="POST" if corps is not None else "GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def id_requete():
    page = obtenir(f"{BASE}/fr-fr/forever/{REGION}/armory/guild/{GUILDE}")
    m = re.search(r'src="(https://assets-bwa\.worldofwarcraft\.blizzard\.com/guild-profile\.[0-9a-f]+\.js)"', page)
    if not m:
        raise RuntimeError("script de la page de guilde introuvable")
    js = obtenir(m.group(1))
    m = re.search(r'"GetGuildRoster"\),t\.documentId="([0-9a-f]{64})"', js) or re.search(r'GetGuildRoster[^"]{0,4000}?documentId="([0-9a-f]{64})"', js)
    if not m:
        raise RuntimeError("identifiant de la requête du roster introuvable")
    return m.group(1)


def roster():
    corps = json.dumps({"operationName": "GetGuildRoster",
                        "variables": {"guild": {"nameSlug": GUILDE, "region": REGION}, "showMessageOfTheDay": False, "showRoles": False},
                        "extensions": {"persistedQuery": {"version": 1, "sha256Hash": id_requete()}}}).encode("utf-8")
    rep = json.loads(obtenir(f"{BASE}/fr-fr/graphql", corps, {"Content-Type": "application/json", "Accept": "application/graphql-response+json,application/json;q=0.9",
                                                               "x-static": "false", "Referer": f"{BASE}/fr-fr/forever/{REGION}/armory/guild/{GUILDE}"}))
    if rep.get("errors"):
        raise RuntimeError("; ".join(str(e.get("message")) for e in rep["errors"]))
    g = (rep.get("data") or {}).get("Guild") or {}
    membres = []
    for m in g.get("roster") or []:
        c = (m or {}).get("character") or {}
        if not c.get("name"):
            continue
        adresse = (f"{c['name']}-{c['surname']}" if c.get("surname") else c["name"]).strip().lower().replace(" ", "-")
        fiche = {"nom": c.get("name"), "surnom": c.get("surname"), "niveau": c.get("level"), "classe": ((c.get("class") or {}).get("enum") or "").lower() or None,
                 "race": (c.get("race") or {}).get("name"), "rang": (m.get("rank") or {}).get("rankId"), "ilvl": c.get("averageItemLevel"),
                 "armurerie": f"{BASE}/fr-fr/forever/{REGION}/armory/character/{urllib.parse.quote(adresse)}" if c.get("url") else None}
        membres.append({k: v for k, v in fiche.items() if v is not None})
    membres.sort(key=lambda x: (x.get("rang", 99), -(x.get("niveau") or 0), x["nom"]))
    return membres


def main():
    membres = roster()
    if not membres:
        print("Liste vide : rien d'écrit.")
        return 0
    ancien = json.loads(SORTIE.read_text(encoding="utf-8")) if SORTIE.exists() else {}
    if ancien.get("membres") == membres:
        print(f"{len(membres)} membres, rien de changé.")
        return 0
    d = {"_meta": {"source": "Armurerie officielle de Blizzard (publique), relue par GitHub Actions", "updated": datetime.now(timezone.utc).date().isoformat()},
         "maj": datetime.now(timezone.utc).isoformat(timespec="seconds"), "membres": membres}
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(membres)} membres écrits.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
