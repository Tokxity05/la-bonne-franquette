"""Les membres de La Bonne Franquette d'après l'armurerie officielle de Blizzard (publique), pour la rubrique Membres du site.
Lancé par GitHub Actions (.github/workflows/membres.yml) toutes les heures : écrit data/membres.json seulement si la liste a changé, et
data/equipement.json (l'équipement de chacun, sur sa fiche officielle) pour ceux dont le niveau d'objet ou le niveau a bougé, ou lus il y a plus
d'un jour : 12 fiches au plus par passage, les nouveaux d'abord.
Python standard, aucune dépendance. Les noms des rangs viennent d'ailleurs (data/rangs.json, lus en jeu par l'addon de Tokxity)."""
import json
import os
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
EQUIPEMENT = SORTIE.parent / "equipement.json"
MAX_FICHES = int(os.environ.get("LBF_MAX_FICHES") or 12)  # fiches lues par passage, pour ménager l'armurerie
JOUR = 24 * 3600


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
        fiche = {"adresse": adresse, "nom": c.get("name"), "surnom": c.get("surname"), "niveau": c.get("level"), "classe": ((c.get("class") or {}).get("enum") or "").lower() or None,
                 "race": (c.get("race") or {}).get("name"), "rang": (m.get("rank") or {}).get("rankId"), "ilvl": c.get("averageItemLevel"),
                 "armurerie": f"{BASE}/fr-fr/forever/{REGION}/armory/character/{urllib.parse.quote(adresse)}" if c.get("url") else None}
        membres.append({k: v for k, v in fiche.items() if v is not None})
    membres.sort(key=lambda x: (x.get("rang", 99), -(x.get("niveau") or 0), x["nom"]))
    return membres


def piece(it):
    """Une pièce portée, en bref : emplacement, objet, nom, qualité, niveau d'objet, icône (numéro du fichier), enchantements, stats en clair."""
    icone = next((a.get("value") for a in ((it.get("media") or {}).get("content") or {}).get("assets") or [] if a.get("key") == "icon"), None)
    m = re.search(r"/icons/\d+/(\d+)\.jpg", icone or "")
    p = {"s": (it.get("slot") or {}).get("type"), "id": it.get("id"), "n": it.get("name"), "q": ((it.get("quality") or {}).get("type") or "").lower() or None,
         "l": (it.get("level") or {}).get("value"), "i": int(m.group(1)) if m else None,
         "t": " ".join(x for x in [(it.get("item_subclass") or {}).get("name") if not it.get("is_subclass_hidden") else None, (it.get("inventory_type") or {}).get("name")] if x) or None,
         "e": [e.get("display_string") for e in it.get("enchantments") or [] if isinstance(e, dict) and e.get("display_string")] or None,
         "st": [((s.get("display") or {}).get("display_string")) for s in it.get("stats") or [] if isinstance(s, dict) and (s.get("display") or {}).get("display_string")] or None}
    return {k: v for k, v in p.items() if v is not None}


def equipement(adresse):
    page = obtenir(f"{BASE}/fr-fr/forever/{REGION}/armory/character/{urllib.parse.quote(adresse)}")
    i = page.find("var characterProfileInitialState = ")
    if i < 0:
        return None
    etat = json.JSONDecoder().raw_decode(page, i + len("var characterProfileInitialState = "))[0]
    c = (etat or {}).get("character") or {}
    # la spé : l'arbre qui a le plus de points (l'armurerie marque « active » tous ceux qui en ont) ; « » sans talent
    specs = [s for s in c.get("specs") or [] if isinstance(s, dict) and s.get("id") and (s.get("spentPoints") or 0) > 0]
    spe = max(specs, key=lambda s: s.get("spentPoints") or 0)["id"] if specs else ""
    return [piece(it) for it in (c.get("gear") or {}).values() if isinstance(it, dict) and it.get("id")], spe


def maj_equipement(membres):
    """Relit l'équipement de ceux qui en ont besoin (nouveaux, niveau d'objet ou niveau changé, plus d'un jour), 12 au plus ; écrit si ça change."""
    ancien = json.loads(EQUIPEMENT.read_text(encoding="utf-8")) if EQUIPEMENT.exists() else {}
    persos = dict(ancien.get("persos") or {})
    presents = {m["adresse"] for m in membres if m.get("adresse") and m.get("armurerie")}
    persos = {k: v for k, v in persos.items() if k in presents}  # un membre parti s'en va
    maintenant = time.time()

    def priorite(m):
        e = persos.get(m["adresse"])
        if not e:
            return (0, 0)
        if e.get("ilvl") != m.get("ilvl") or e.get("niveau") != m.get("niveau") or "spe" not in e:
            return (1, e.get("lu") or 0)
        if maintenant - (e.get("lu") or 0) > JOUR:
            return (2, e.get("lu") or 0)
        return None
    file = sorted((m for m in membres if m.get("adresse") in presents and priorite(m) is not None), key=priorite)[:MAX_FICHES]
    lus = 0
    for m in file:
        try:
            res = equipement(m["adresse"])
        except Exception as err:  # une fiche absente ou refusée : on garde l'ancienne, on réessaiera
            print(f"  {m['nom']} : {type(err).__name__}")
            continue
        if res is None:
            continue
        pieces, spe = res
        persos[m["adresse"]] = {"lu": int(maintenant), "ilvl": m.get("ilvl"), "niveau": m.get("niveau"), "spe": spe, "pieces": pieces}
        lus += 1
    if persos == (ancien.get("persos") or {}):
        print(f"Équipement : rien de changé ({lus} fiche(s) relue(s)).")
        return
    d = {"_meta": {"source": "Armurerie officielle de Blizzard (publique), fiche de chaque personnage, relue par GitHub Actions",
                   "updated": datetime.now(timezone.utc).date().isoformat()},
         "maj": datetime.now(timezone.utc).isoformat(timespec="seconds"), "region": REGION, "persos": persos}
    EQUIPEMENT.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Équipement : {lus} fiche(s) relue(s), {len(persos)} perso(s) en tout.")


def main():
    try:
        membres = roster()
    except Exception as err:  # l'armurerie ne répond pas ou a changé : on réessaiera au prochain passage, sans faire échouer le robot
        print(f"::warning::Armurerie injoignable ({type(err).__name__} : {err}) : rien de changé, on réessaiera.")
        return 0
    if not membres:
        print("Liste vide : rien d'écrit.")
        return 0
    ancien = json.loads(SORTIE.read_text(encoding="utf-8")) if SORTIE.exists() else {}
    if ancien.get("membres") == membres:
        print(f"{len(membres)} membres, rien de changé.")
    else:
        d = {"_meta": {"source": "Armurerie officielle de Blizzard (publique), relue par GitHub Actions", "updated": datetime.now(timezone.utc).date().isoformat()},
             "maj": datetime.now(timezone.utc).isoformat(timespec="seconds"), "membres": membres}
        SORTIE.parent.mkdir(parents=True, exist_ok=True)
        SORTIE.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{len(membres)} membres écrits.")
    try:
        maj_equipement(membres)
    except Exception as err:
        print(f"::warning::Équipement non relu ({type(err).__name__} : {err}) : on réessaiera.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
