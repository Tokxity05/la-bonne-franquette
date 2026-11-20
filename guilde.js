/* Le site de la guilde La Bonne Franquette (LBF, World of Warcraft: Forever). « Métiers LBF » ne désigne que l'addon des métiers.
   Trois fichiers, lus chacun de leur côté (un fichier absent n'éteint que sa rubrique) :
     site.json            RÉDIGÉ : la guilde (nom, court, accroche, présentation), les rubriques de l'accueil et du menu, les addons, le nom des rangs
     data/membres.json    les membres d'après l'armurerie officielle de Blizzard (niveau, race, rang, niveau d'objet, fiche officielle)
     data/guilde.json     les métiers, d'après l'addon Métiers LBF des membres : rangs, recettes connues, recharges, historique, infos de l'addon
   Et le relais (site.json > service, un Worker Cloudflare : service/worker.js) : les codes que les membres collent eux-mêmes (/lbf code en jeu,
   page Envoyer mes métiers) ; une fiche du relais plus récente que guilde.json passe devant tout de suite, ses recettes lues dans data/catalogue.json.
   Une rubrique de plus = une entrée dans site.json > rubriques et sa page dans RUBRIQUES (plus bas) ; un addon de plus = une entrée dans
   site.json > addons (menu, liste et page génériques ; une page propre se déclare dans PAGES_ADDONS).
   Site statique (GitHub Pages) : chemins relatifs, routage par hash, JavaScript sans bibliothèque.
     #/                          Accueil de la guilde
     #/membres[?q=…&classe=…]   les membres
     #/membre/<clé>[/<métier>[/<recette>]]   un membre : son profil, puis sa fenêtre de métier s'il partage ses métiers (clé = nom, nom-surnom si deux membres portent le même nom)
     #/metiers[?q=…]             la rubrique Métiers : « Qui sait faire… ? », les métiers, les nouveautés, les derniers membres vus
     #/metiers/envoyer           coller son code (/lbf code) pour apparaître tout de suite
     #/metiers/emplacement/<clé> ce que la guilde sait faire pour un emplacement (tête, torse, armes…) : pièces et enchantements
     #/metier/<clé>              un métier : ses recettes dans la guilde, ses membres
     #/recette/<id>              une recette et qui sait la faire
     #/addons                    les addons de la guilde
     #/addons/<id>               un addon (metier-lbf : transparence, téléchargement, nouveautés, commandes)
   Anciennes adresses : #/addon -> #/addons/metier-lbf ; #/?q=… -> #/metiers?q=…
   Tout ce qui vient des données passe par textContent (jamais innerHTML) : les noms des membres viennent du jeu. */
(() => {
  "use strict";

  const FICHIERS = { site: "site.json", membres: "data/membres.json", metiers: "data/guilde.json", catalogue: "data/catalogue.json" };
  const ZIP_DEFAUT = "MetierLBF.zip";
  const ADDON_METIERS = "metier-lbf";           // l'addon des métiers : ses infos viennent aussi de data/guilde.json > addon
  const NOM_ADDON_METIERS = "Métiers LBF";   // repli : le nom affiché vient de site.json, puis de data/guilde.json > addon.nom
  const GUILDE_DEFAUT = { nom: "La Bonne Franquette", court: "LBF" };
  const TZ = "Europe/Paris";
  const SURVOL = !window.matchMedia || window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const ETROIT = window.matchMedia ? window.matchMedia("(max-width: 900px)") : { matches: false };

  const CLASSES = { warrior: "Guerrier", paladin: "Paladin", hunter: "Chasseur", rogue: "Voleur", priest: "Prêtre", shaman: "Chaman", mage: "Mage",
    warlock: "Démoniste", druid: "Druide" };
  const METIERS = { enchanting: ["Enchantement", "trade_engraving"], tailoring: ["Couture", "trade_tailoring"], alchemy: ["Alchimie", "trade_alchemy"],
    blacksmithing: ["Forge", "trade_blacksmithing"], engineering: ["Ingénierie", "trade_engineering"], leatherworking: ["Travail du cuir", "trade_leatherworking"],
    cooking: ["Cuisine", "inv_misc_food_15"], firstaid: ["Secourisme", "spell_holy_sealofsacrifice"], herbalism: ["Herboristerie", "trade_herbalism"],
    mining: ["Minage", "trade_mining"], skinning: ["Dépeçage", "inv_misc_pelt_wolf_01"], fishing: ["Pêche", "trade_fishing"] };
  const ORDRE = Object.keys(METIERS);
  // Ligne de compétence du jeu -> métier : les fiches au format de l'addon (codes collés)
  const LIGNES = { 129: "firstaid", 164: "blacksmithing", 165: "leatherworking", 171: "alchemy", 182: "herbalism", 185: "cooking", 186: "mining",
    197: "tailoring", 202: "engineering", 333: "enchanting", 356: "fishing", 393: "skinning" };
  // La Pêche n'en est plus : dans Forever, elle fabrique (bocal, râtelier, hutte de pêche)
  const RECOLTE = new Set(["herbalism", "mining", "skinning"]);
  const QUALITES = new Set(["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact"]);
  const EMPLACEMENTS = { Head: "Tête", Neck: "Cou", Shoulder: "Épaules", Back: "Dos", Cloak: "Dos", Chest: "Torse", Robe: "Torse", Shirt: "Chemise", Tabard: "Tabard",
    Wrist: "Poignets", Hands: "Mains", Waist: "Taille", Legs: "Jambes", Feet: "Pieds", Finger: "Doigt", Trinket: "Bijou", "Main Hand": "Main droite",
    "Off Hand": "Main gauche", "One-Hand": "Une main", "Two-Hand": "Deux mains", "Held In Off-hand": "Tenu en main gauche", Shield: "Bouclier",
    Ranged: "À distance", Thrown: "Armes de jet", Relic: "Relique", Bag: "Sac", Ammo: "Projectiles" };
  // Les stats d'un objet créé, dans l'ordre de son infobulle : les caractéristiques en blanc, puis les effets « Équipé » en vert
  const STATS = [
    ["armure", (v) => `${v} Armure`, 1], ["force", (v) => `+${v} Force`, 1], ["agilite", (v) => `+${v} Agilité`, 1], ["endurance", (v) => `+${v} Endurance`, 1],
    ["intelligence", (v) => `+${v} Intelligence`, 1], ["esprit", (v) => `+${v} Esprit`, 1],
    ["resistance_feu", (v) => `+${v} Résistance au Feu`, 1], ["resistance_givre", (v) => `+${v} Résistance au Givre`, 1],
    ["resistance_nature", (v) => `+${v} Résistance à la Nature`, 1], ["resistance_ombre", (v) => `+${v} Résistance à l'Ombre`, 1],
    ["resistance_arcanes", (v) => `+${v} Résistance aux Arcanes`, 1],
    ["defense", (v) => `Équipé : défense +${v}`], ["degats_sorts", (v) => `Équipé : dégâts et soins des sorts +${v}`],
    ["degats_feu", (v) => `Équipé : dégâts des sorts de Feu +${v}`], ["degats_givre", (v) => `Équipé : dégâts des sorts de Givre +${v}`],
    ["degats_nature", (v) => `Équipé : dégâts des sorts de Nature +${v}`], ["degats_ombre", (v) => `Équipé : dégâts des sorts d'Ombre +${v}`],
    ["degats_arcanes", (v) => `Équipé : dégâts des sorts des Arcanes +${v}`], ["degats_sacre", (v) => `Équipé : dégâts des sorts du Sacré +${v}`],
    ["puissance_attaque", (v) => `Équipé : puissance d'attaque +${v}`], ["mp5", (v) => `Équipé : ${v} points de mana toutes les 5 s`],
    ["critique_pct", (v) => `Équipé : coup critique +${v} %`], ["critique_sorts_pct", (v) => `Équipé : critique des sorts +${v} %`],
    ["toucher_pct", (v) => `Équipé : toucher +${v} %`], ["toucher_sorts_pct", (v) => `Équipé : toucher des sorts +${v} %`],
  ];

  // site.json, mis en forme par lireSite (sans fichier : le nom de la guilde, et les rubriques connues ici)
  let CFG = { nom: GUILDE_DEFAUT.nom, court: GUILDE_DEFAUT.court, accroche: null, presentation: [], rubriques: [], addons: [], rangs: {}, nouveautesMin: 200, nouveautesForeverMin: 100 };
  let R = null;            // data/membres.json : { membres, rangs, maj }
  let ERREUR_R = null;     // "lecture" ou "fichier"
  let D = null;            // data/guilde.json : les métiers de la guilde, une fois lus
  let ADDON = null;        // le champ « addon » de data/guilde.json (même quand le carnet est vide)
  let ERREUR = null;       // métiers : "vide", "lecture" ou "fichier"
  const IX = {};           // les index bâtis à la lecture
  const FICHES = new Map(); // clé d'adresse -> { p (membres.json), m (guilde.json) }

  // ---------------------------------------------------------------- Petits outils
  function h(tag, attrs, ...enfants) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "value") el.value = v;
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    ajouter(el, enfants);
    return el;
  }
  function ajouter(el, enfants) {
    for (const c of enfants) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) ajouter(el, c);
      else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }
  function fill(el, ...enfants) { el.textContent = ""; ajouter(el, enfants); return el; }
  const pousser = (map, cle, v) => { const L = map.get(cle); if (L) L.push(v); else map.set(cle, [v]); };
  // Sans accents ni casse, pour chercher : « Poussière » = « poussiere », « vrai-argent » = « vrai argent »
  const plat = (s) => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/œ/g, "oe").replace(/æ/g, "ae")
    .replace(/[’ʼ`]/g, "'").replace(/[-_]/g, " ").replace(/\s+/g, " ");
  const pl = (n, mot, pluriel) => `${n} ${n > 1 ? (pluriel || `${mot}s`) : mot}`;
  const qualite = (q) => (QUALITES.has(q) ? q : "common");
  const classeCss = (m) => (CLASSES[m.classe] ? `c-${m.classe}` : "c-inconnue");
  const nomMetier = (cle) => (D && D.metiers[cle] && D.metiers[cle].nom) || (METIERS[cle] || [])[0] || cle;
  const iconeMetier = (cle) => (D && D.metiers[cle] && D.metiers[cle].icone) || (METIERS[cle] || [])[1] || "inv_misc_book_09";
  // m : un membre de guilde.json ou de membres.json ; sa clé d'adresse est posée par lier()
  const lienMembre = (m, ...suite) => `#/membre/${[m.cle || m.nom, ...suite].map((x) => encodeURIComponent(String(x))).join("/")}`;
  // L'addon ne relève pas le niveau du perso : il vient de l'armurerie quand le membre y est
  const identite = (m) => [CLASSES[m.classe] || null, m.perso && m.perso.niveau ? `niveau ${m.perso.niveau}` : null].filter(Boolean).join(" · ");
  const rubrique = (id) => CFG.rubriques.find((r) => r.id === id) || { id, titre: (defRubrique(id) || {}).titre || id, icone: null, desc: null };
  // Le nom d'un rang : celui que l'addon a lu en jeu, sinon « Chef de guilde » pour 0 et « Rang N »
  function nomRang(n) {
    if (n == null || !Number.isFinite(Number(n))) return null;
    const nom = R && R.rangs ? R.rangs[String(n)] : null;
    return typeof nom === "string" && nom.trim() ? nom.trim() : Number(n) === 0 ? "Chef de guilde" : `Rang ${n}`;
  }
  // Une adresse de fiche officielle : https et le site de Blizzard seulement
  function adresseOfficielle(u) {
    try { const x = new URL(String(u)); return x.protocol === "https:" && /(^|\.)blizzard\.com$/i.test(x.hostname) ? x.href : null; } catch (e) { return null; }
  }
  const majuscule = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  // Les icônes du jeu (zamimg) ; un nom douteux devient le point d'interrogation
  const srcIcone = (nom, taille) => `https://wow.zamimg.com/images/wow/icons/${taille}/${/^[a-z0-9_-]+$/i.test(nom || "") ? String(nom).toLowerCase() : "inv_misc_questionmark"}.jpg`;
  function icone(nom, taille = "md", q = null) {
    const t = taille === "xs" || taille === "sm" ? "medium" : "large";
    return h("img", { class: `icon ${taille}${q ? ` qb-${qualite(q)}` : ""}`, src: srcIcone(nom, t), alt: "", loading: "lazy", decoding: "async",
      onerror() { if (!this.dataset.repli) { this.dataset.repli = "1"; this.src = srcIcone(null, t); } } });
  }

  // Wowhead Forever en français : un lien qui ouvre la fiche, avec son infobulle au survol
  const cleWh = (type, id) => `${type}=${id}&domain=fr.forever`;
  const whDe = (r, id) => (r && r.id ? [r.k === "spell" ? "spell" : "item", r.id] : ["spell", id]);
  function lienWh(type, id, contenu, cls) {
    return h("a", { href: `https://www.wowhead.com/forever/fr/${type}=${encodeURIComponent(id)}`, "data-wowhead": cleWh(type, id), target: "_blank", rel: "noopener", class: cls }, contenu);
  }
  // Un lien vers la page d'une recette ; à la souris, l'infobulle de Wowhead aussi (au doigt, le premier appui doit ouvrir la page)
  function lienRecette(id, contenu, cls) {
    const [t, n] = whDe(D.recettes[id], id);
    return h("a", { href: `#/recette/${encodeURIComponent(id)}`, class: cls, "data-wowhead": SURVOL ? cleWh(t, n) : null }, contenu);
  }
  const couleurNom = (r) => (r.k === "spell" ? "uncommon" : qualite(r.q));
  function infobulles() { try { if (window.$WowheadPower && window.$WowheadPower.refreshLinks) window.$WowheadPower.refreshLinks(); } catch (e) { /* infobulles absentes */ } }

  // ---------------------------------------------------------------- Dates (heure de Paris : le serveur est français)
  const fJour = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const fHeure = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const fJourMois = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "numeric", month: "long" });
  const fJourMoisAn = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
  function dateDe(iso) { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : d; }
  const jourFr = (fmt, d) => fmt.formatToParts(d).map((p) => (p.type === "day" && p.value === "1" ? "1er" : p.value)).join("");
  // « aujourd'hui à 18:23 », « hier à 09:10 », « le 16 novembre à 21:02 », « le 3 mars 2025 »
  function quand(iso) {
    const d = dateDe(iso);
    if (!d) return null;
    const j = fJour.format(d), maintenant = new Date(), auj = fJour.format(maintenant);
    if (j === auj) return `aujourd'hui à ${fHeure.format(d)}`;
    if (j === fJour.format(new Date(maintenant.getTime() - 864e5))) return `hier à ${fHeure.format(d)}`;
    return j.slice(0, 4) === auj.slice(0, 4) ? `le ${jourFr(fJourMois, d)} à ${fHeure.format(d)}` : `le ${jourFr(fJourMoisAn, d)}`;
  }
  const dateLongue = (iso) => { const d = dateDe(iso); return d ? jourFr(fJourMoisAn, d) : null; };
  // Une date seule (AAAA-MM-JJ, l'historique) : « aujourd'hui », « hier », « le 16 novembre »
  function quandJour(jour) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(jour || ""))) return null;
    const j = String(jour).slice(0, 10), maintenant = new Date(), auj = fJour.format(maintenant);
    if (j === auj) return "aujourd'hui";
    if (j === fJour.format(new Date(maintenant.getTime() - 864e5))) return "hier";
    const d = new Date(`${j}T12:00:00Z`);
    return `le ${jourFr(j.slice(0, 4) === auj.slice(0, 4) ? fJourMois : fJourMoisAn, d)}`;
  }
  const vu = (m) => { const q = quand(m.vu || m.maj); return q ? `vu ${q}` : ""; };
  function duree(ms) {
    const j = Math.floor(ms / 864e5), hr = Math.floor((ms % 864e5) / 36e5), mn = Math.floor((ms % 36e5) / 6e4);
    if (j) return `${j} j${hr ? ` ${hr} h` : ""}`;
    if (hr) return `${hr} h${mn ? ` ${mn} min` : ""}`;
    return `${Math.max(1, mn)} min`;
  }
  const dureeRecharge = (heures) => (heures >= 24 ? `${String(Math.round((heures / 24) * 10) / 10).replace(".", ",")} j` : `${heures} h`);
  // Une recette à recharge : prête, ou prête dans … (d'après le dernier relevé du membre ; sans heure relevée, elle est prête).
  // Un membre dont on ne connaît pas les recharges (recharges absent : pas relevé par l'addon) : la durée de la recharge seule, jamais « Prête »
  function etatRecharge(m, id) {
    if (!m.recharges || typeof m.recharges !== "object") {
      const r = (D.recettes || {})[id] || {};
      return { pret: false, reste: Number.MAX_SAFE_INTEGER, texte: r.cd ? `Recharge de ${dureeRecharge(r.cd)}` : "Recharge inconnue", titre: `Pas encore relevée par l'addon ${nomAddonMetiers()}` };
    }
    let d = dateDe((m.recharges || {})[id]);
    let reste = d ? d.getTime() - Date.now() : 0;
    // L'horloge du jeu (GetTime, en millisecondes sur 32 bits) fait un tour tous les 2^32 ms, environ 49,7 jours : une recharge lancée avant la
    // session revenait d'un tour trop tard dans l'addon (1.7.2 et avant). Une attente plus longue que la recharge elle-même perd ce tour.
    const cd = ((D.recettes || {})[id] || {}).cd;
    if (d && cd && reste > cd * 36e5 + 6e4) {
      reste -= 2 ** 32;
      d = new Date(d.getTime() - 2 ** 32);
    }
    return reste > 0 ? { pret: false, reste, texte: `Prête dans ${duree(reste)}`, titre: `Prête ${quand(d.toISOString())}` }
      : { pret: true, reste: 0, texte: "Prête", titre: "D'après son dernier relevé" };
  }

  // ---------------------------------------------------------------- Les données
  function preparer(d) {
    D = d;
    D.metiers = d.metiers && typeof d.metiers === "object" ? d.metiers : {};
    D.recettes = d.recettes && typeof d.recettes === "object" ? d.recettes : {};
    D.composants = d.composants && typeof d.composants === "object" ? d.composants : {};
    D.specialites = d.specialites && typeof d.specialites === "object" ? d.specialites : {};
    D.membres = (Array.isArray(d.membres) ? d.membres : []).filter((m) => m && typeof m.nom === "string" && m.nom);
    IX.quiSait = new Map();       // recette -> [{ m, x }]
    IX.parMetier = new Map();     // métier -> [{ m, x }], meilleur rang d'abord
    IX.categorie = new Map();     // recette -> { cle, nom }
    IX.emplacements = null;       // emplacement -> [recettes] (989), bâti au premier usage
    IX.dansRecettes = new Map();  // composant -> [recettes]
    for (const m of D.membres) {
      m.metiers = (Array.isArray(m.metiers) ? m.metiers : []).filter((x) => x && typeof x.cle === "string");
      m.spes = (Array.isArray(m.spes) ? m.spes : []).map(String).filter((s) => D.specialites[s]);
      for (const x of m.metiers) {
        x.recettes = (Array.isArray(x.recettes) ? x.recettes : []).map(String);
        pousser(IX.parMetier, x.cle, { m, x });
        for (const id of x.recettes) if (D.recettes[id]) pousser(IX.quiSait, id, { m, x });
      }
    }
    for (const L of IX.parMetier.values()) L.sort(parRang);
    for (const L of IX.quiSait.values()) L.sort(parRang);
    for (const [cle, mt] of Object.entries(D.metiers)) {
      for (const c of (mt && mt.categories) || []) for (const id of c.recettes || []) if (!IX.categorie.has(String(id))) IX.categorie.set(String(id), { cle, nom: c.nom });
    }
    for (const [id, r] of Object.entries(D.recettes)) for (const [cid] of r.co || []) pousser(IX.dansRecettes, String(cid), id);
    // L'historique (le plus récent en tête) : les recettes apparues depuis moins de 2 jours portent « nouveau » (20/11, Melvin : « 2 jours max »)
    D.historique = (Array.isArray(d.historique) ? d.historique : []).filter((e) => e && typeof e.qui === "string" && (e.type === "arrivee" || e.type === "recette"));
    IX.nouvelles = new Set();      // recettes apparues dans la guilde depuis moins de 2 jours
    IX.nouvellesDe = new Set();    // « membre\nrecette » : ce qu'un membre a appris depuis moins de 2 jours
    // 20/11 : les recettes avec lesquelles un membre arrive dans le carnet (le jour de son arrivée) ne sont pas « nouvelles » : il les savait
    // peut-être depuis longtemps ; seules celles qu'il apprend ensuite le sont
    const arrivees = new Set(D.historique.filter((e) => e.type === "arrivee").map((e) => `${e.qui}\n${String(e.date || "").slice(0, 10)}`));
    for (const e of D.historique) {
      const d7 = dateDe(e.date);
      if (e.type !== "recette" || e.r == null || !d7 || Date.now() - d7.getTime() > 2 * 864e5) continue;
      if (arrivees.has(`${e.qui}\n${String(e.date || "").slice(0, 10)}`)) continue;
      IX.nouvelles.add(String(e.r));
      IX.nouvellesDe.add(`${e.qui}\n${e.r}`);
    }
    // La recherche d'une recette porte sur son nom, sa catégorie et son métier (« enchantement force »)
    IX.recherche = {
      recettes: Object.entries(D.recettes).filter(([id, r]) => r && r.n && IX.quiSait.has(id)).map(([id, r]) => ({ id, t: plat(r.n),
        autour: plat(`${(IX.categorie.get(id) || {}).nom || ""} ${nomMetier(r.m)}`) })),
      composants: Object.entries(D.composants).filter(([id, c]) => c && c.n && IX.dansRecettes.has(id)).map(([id, c]) => ({ id, t: plat(c.n) })),
      membres: D.membres.map((m) => ({ id: m.nom, m, t: plat(m.nom) })),
      metiers: listeMetiers().map((cle) => ({ id: cle, t: plat(nomMetier(cle)) })),
    };
  }
  const parRang = (a, b) => (b.x.rang == null ? -1 : b.x.rang) - (a.x.rang == null ? -1 : a.x.rang) || a.m.nom.localeCompare(b.m.nom, "fr");
  // Les métiers présents dans la guilde : ceux du fichier, dans son ordre, puis ceux qu'un membre a sans recette connue
  function listeMetiers() {
    const L = Object.keys(D.metiers).filter((c) => IX.parMetier.has(c) || ((D.metiers[c] || {}).categories || []).length);
    for (const c of [...ORDRE, ...IX.parMetier.keys()]) if (!L.includes(c) && IX.parMetier.has(c)) L.push(c);
    return L;
  }
  // 996 · Les spécialisations d'un membre dans un métier (ingénieur gnome, fabricant d'armes…)
  const spesDe = (m, cle) => (m.spes || []).filter((s) => (D.specialites[s] || {}).m === cle).map((s) => D.specialites[s].n);
  const pastilleSpe = (m, cle) => { const L = spesDe(m, cle); return L.length ? h("span", { class: "gd-spe", title: "Spécialisation" }, L.join(" · ")) : null; };
  const idsDuMetier = (cle) => [...new Set(((D.metiers[cle] || {}).categories || []).flatMap((c) => (c.recettes || []).map(String)))].filter((id) => D.recettes[id] && IX.quiSait.has(id));
  const avecRecettes = (x) => x.recettes.some((id) => D.recettes[id]);

  // ---------------------------------------------------------------- Morceaux communs
  function cadre(titre, ...contenu) {
    return h("section", { class: `frame${titre ? " titre" : ""}` }, titre ? h("h2", { class: "frame-title" }, titre) : null, contenu);
  }
  // Le logo de WoW Forever en tête de page : un halo qui respire derrière, une lente flottaison, un reflet qui le traverse (guilde.css, gd-logo-)
  function logoHero() {
    return h("div", { class: "gd-logo-scene" }, h("span", { class: "gd-logo-halo", "aria-hidden": "true" }),
      h("span", { class: "gd-logo-flotte" }, h("img", { class: "gd-logo", src: "img/wow-forever-logo.png", alt: "World of Warcraft: Forever", width: 360, height: 293 }),
        h("span", { class: "gd-logo-reflet", "aria-hidden": "true" })));
  }
  function setTitre(t) { document.title = t ? `${t} · ${CFG.court}` : `${CFG.nom} · ${CFG.court}`; }
  function fil(...etapes) {
    const L = [h("a", { href: "#/" }, "Accueil")];
    for (const e of etapes.filter(Boolean)) L.push(" › ", e);
    return h("nav", { class: "gd-fil", "aria-label": "Fil d'Ariane" }, L);
  }
  const filMetiers = (...etapes) => fil(h("a", { href: "#/metiers" }, rubrique("metiers").titre), ...etapes);
  // L'en-tête d'une rubrique : son icône, son titre (site.json), une ligne, et ce qu'on veut à droite
  function enteteRubrique(id, ligne, ...plus) {
    const r = rubrique(id);
    return h("section", { class: "frame gd-entete" }, h("div", { class: "gd-tete-metier gd-tete-rubrique" }, r.icone ? icone(r.icone, "xl") : null,
      h("div", { class: "gd-tete-txt" }, h("h1", {}, r.titre), ligne ? h("p", {}, ligne) : null), plus));
  }
  // Le rang dans un métier en petite barre, la compétence du jeu en miniature
  function barreRang(x, titre) {
    const pct = x.rang != null ? Math.max(0, Math.min(100, (x.rang / (x.max || 300)) * 100)) : 0;
    return h("span", { class: "gd-rang", title: titre || null }, h("span", { class: "gd-rang-barre" }, h("span", { class: "gd-rang-plein", style: { width: `${pct}%` } })),
      h("span", { class: "gd-rang-txt" }, `${x.rang == null ? "?" : x.rang}/${x.max || "?"}`));
  }
  function miniMetiers(m) {
    return h("span", { class: "gd-metiers-mini" }, m.metiers.map((x) => h("span", { class: "gd-mini-metier", title: `${nomMetier(x.cle)}${x.rang != null ? ` : ${x.rang}/${x.max || "?"}` : ""}` },
      icone(iconeMetier(x.cle), "xs"), x.rang != null ? x.rang : "?")));
  }
  // « nouveau » : une recette apparue dans l'historique depuis moins de 2 jours (sur la page d'un membre : apprise par lui)
  function pastille(id, membre) {
    const neuve = membre ? IX.nouvellesDe.has(`${membre.nom}\n${id}`) : IX.nouvelles.has(String(id));
    return neuve ? h("span", { class: "gd-neuf", title: membre ? "Apprise depuis moins de 2 jours" : "Apparue dans le carnet depuis moins de 2 jours" }, "nouveau") : null;
  }
  // Les noms de ceux qui savent la faire, à la couleur de leur classe : les premiers, puis « et N autres »
  function nomsQui(qui, max = 3) {
    const L = qui.slice(0, max).map(({ m }, i) => [i ? ", " : null, h("span", { class: classeCss(m) }, m.nom)]);
    const reste = qui.length - max;
    return [L, reste > 0 ? ` et ${reste} autre${reste > 1 ? "s" : ""}` : null];
  }
  function ligneMembre(m) {
    return h("a", { class: "gd-membre", href: lienMembre(m) },
      h("span", { class: "gd-membre-id" }, h("span", { class: `gd-membre-nom ${classeCss(m)}` }, m.nom), h("span", { class: "gd-membre-sous" }, identite(m))),
      miniMetiers(m), h("span", { class: "gd-membre-vu" }, vu(m)));
  }
  // Un fichier à télécharger : un .zip du site, en chemin relatif, sans remontée
  const fichierSur = (f) => (typeof f === "string" && /^[\w.-]+(\/[\w.-]+)*\.zip$/i.test(f) && !f.includes("..") ? f : null);
  // La page CurseForge d'un addon (site.json > addons[].curseforge, projet non répertorié : seuls ceux qui ont le lien le trouvent)
  const curseforgeSur = (u) => (typeof u === "string" && /^https:\/\/(www\.)?curseforge\.com\/[\w\/.-]+$/.test(u.trim()) ? u.trim() : null);
  // Sa page d'installation (…/install/<fichier>, data/guilde.json > addon.installer) : elle ouvre l'appli CurseForge sur l'installation
  const installerSur = (u) => (curseforgeSur(u) && /\/install\/\d+$/.test(u.trim()) ? u.trim() : null);
  // Un addon : son entrée de site.json (le nom affiché vient d'elle) ; pour Métiers LBF, data/guilde.json > addon (écrit avec le zip)
  // passe devant pour le fichier, la version et les nouveautés
  function infoAddon(id = ADDON_METIERS) {
    const a = CFG.addons.find((x) => x.id === id) || (id === ADDON_METIERS ? { id } : null);
    if (!a) return null;
    const G = id === ADDON_METIERS && ADDON ? ADDON : {};
    const nouveautes = Array.isArray(G.nouveautes) ? G.nouveautes : Array.isArray(a.nouveautes) ? a.nouveautes : [];
    // Sur CurseForge (19/11, Melvin) : on l'installe et on le met à jour depuis l'appli CurseForge, le site ne propose plus le zip
    const curseforge = curseforgeSur(a.curseforge);
    return { id, nom: a.nom || (typeof G.nom === "string" && G.nom.trim()) || NOM_ADDON_METIERS, icone: a.icone || "inv_misc_book_11", desc: a.desc || null,
      version: G.version || a.version ? String(G.version || a.version) : null, maj: G.maj || a.maj || null, curseforge, installer: curseforge ? installerSur(G.installer) : null,
      fichier: curseforge ? null : fichierSur(G.fichier) || fichierSur(a.fichier) || (id === ADDON_METIERS ? ZIP_DEFAUT : null),
      nouveautes: nouveautes.filter((n) => n && (n.texte || n.version)) };
  }
  const lienAddon = (id) => `#/addons/${encodeURIComponent(id)}`;
  const nomAddonMetiers = () => (infoAddon(ADDON_METIERS) || {}).nom || NOM_ADDON_METIERS;

  // Le détail d'une recette, comme le côté droit de la fenêtre de métier : icône ronde, nom, effet ou stats, composants, compétence
  function lignesStats(st) {
    if (!st || typeof st !== "object") return [];
    const base = [], equip = [], vus = new Set(["soins", "degats"]);
    for (const [k, f, blanc] of STATS) {
      vus.add(k);
      if (st[k]) (blanc ? base : equip).push(f(st[k]));
    }
    if (st.soins || st.degats) equip.unshift(`Équipé : ${[st.soins ? `soins +${st.soins}` : null, st.degats ? `dégâts des sorts +${st.degats}` : null].filter(Boolean).join(", ")}`);
    for (const [k, v] of Object.entries(st)) if (!vus.has(k) && typeof v === "number" && v) equip.push(`Équipé : ${k.replace(/_/g, " ")} +${v}`);
    return [...base.map((t) => [t, "blanc"]), ...equip.map((t) => [t, null])];
  }
  function paliers(r) {
    const vert = r.j && r.g ? Math.round((r.j + r.g) / 2) : null;
    const requise = r.s ? h("span", { class: "lv-requise", title: r.est ? "Estimée : le jeu ne la donne pas." : null }, "Compétence requise : ", h("b", { class: "o" }, `${r.est ? "≈" : ""}${r.s}`)) : null;
    // Un palier qui se confond avec le suivant (jaune = gris) ne s'écrit qu'une fois
    const j = r.j && (!r.g || r.j < r.g) ? r.j : null, v = vert && j && vert > j && vert < r.g ? vert : null;
    const pal = r.j || r.g ? h("span", { class: "rc-paliers", title: `Paliers de compétence : jaune à ${r.j || "?"}${vert ? `, vert à ${vert}` : ""}, gris à ${r.g || "?"} (passé ce dernier, plus aucun point à gagner).` },
      j ? h("b", { class: "j" }, j) : null, v ? h("b", { class: "v" }, v) : null, r.g ? h("b", { class: "g" }, r.g) : null) : null;
    return [requise, pal];
  }
  function detailRecette(id, { titre = "div", membre = null, lienQui = false } = {}) {
    const r = D.recettes[id];
    const [t, n] = whDe(r, id);
    const sous = r.k !== "spell" ? [EMPLACEMENTS[r.slot] || r.slot || null, r.req ? `niveau ${r.req} requis` : null, r.ilvl ? `niveau d'objet ${r.ilvl}` : null].filter(Boolean).join(" · ") : "";
    const stats = lignesStats(r.st);
    const co = (Array.isArray(r.co) ? r.co : []).filter((c) => Array.isArray(c) && c[0]);
    let quiLigne = null;
    if (lienQui) {
      const autres = (IX.quiSait.get(id) || []).filter((e) => e.m !== membre).length;
      quiLigne = h("a", { class: "lv-qui", href: `#/recette/${encodeURIComponent(id)}` },
        autres ? `${pl(autres, "autre membre", "autres membres")} la ${autres > 1 ? "connaissent" : "connaît"} ›` : "Personne d'autre ne la connaît dans la guilde ›");
    }
    const st = membre && r.cd ? etatRecharge(membre, id) : null;
    return h("div", { class: "lv-detail" },
      h("div", { class: "lv-tete" }, h("span", { class: "lv-rond" }, lienWh(t, n, icone(r.i, "lg"))),
        h("div", { class: "lv-tete-txt" }, h(titre, { class: "lv-nom" }, lienWh(t, n, r.n || `Recette ${id}`, `q-${couleurNom(r)}`)), sous ? h("div", { class: "lv-sous" }, majuscule(sous)) : null)),
      r.e ? h("p", { class: "lv-desc" }, r.e) : r.k === "spell" ? null : h("p", { class: "lv-desc" }, `Crée : ${r.n}.`),
      r.sp ? h("p", { class: "lv-spe-req" }, (D.specialites[String(r.sp)] || {}).n ? ["Demande la spécialisation ", h("b", {}, D.specialites[String(r.sp)].n), "."] : "Demande une spécialisation de métier.") : null,
      stats.length ? h("ul", { class: "lv-stats" }, stats.map(([txt, cls]) => h("li", { class: cls }, txt))) : null,
      co.length ? [h("div", { class: "lv-or" }, "Composants"), h("div", { class: "lv-comps" }, co.map(([cid, q]) => {
        const c = D.composants[String(cid)] || {};
        return h("div", { class: "lv-comp" }, h("span", { class: "lv-comp-ic" }, lienWh("item", cid, icone(c.i, "md")), q > 1 ? h("b", {}, q) : null),
          h("span", { class: "lv-comp-nom" }, lienWh("item", cid, c.n || `Objet ${cid}`)));
      }))] : null,
      h("div", { class: "lv-bas" }, paliers(r), r.cd ? h("span", { class: "lv-cd" }, `Recharge : ${dureeRecharge(r.cd)}`) : null,
        st ? h("span", { class: `gd-recharge${st.pret ? " pret" : ""}`, title: st.titre }, st.texte) : null),
      quiLigne);
  }

  // ---------------------------------------------------------------- Le menu du haut
  // Accueil, puis les rubriques de site.json que ce fichier sait dessiner (RUBRIQUES), dans leur ordre.
  // Une rubrique qui a des liens directs (Métiers, Addons) : son nom mène à sa page ; la flèche, ou le survol à la souris, déroule ses liens
  function dessinerMenu(page, params) {
    const lien = (href, nom, actif, courant) => h("a", { class: `gd-lien${actif ? " actif" : ""}`, href, "aria-current": courant ? "page" : null }, nom);
    const items = [lien("#/", "Accueil", page === "", page === "")];
    for (const r of rubriquesConnues()) {
      const def = defRubrique(r.id);
      const actif = aSoi(def.routes, page), courant = page === Object.keys(def.routes)[0] && !params.length;
      const liens = def.panneau ? def.panneau(actif && def.sous ? def.sous(page, params) : null) : [];
      if (!liens.length) { items.push(lien(def.href, r.titre, actif, courant)); continue; }
      const id = `gd-panneau-${r.id}`;
      items.push(h("div", { class: `gd-deroule${actif ? " actif" : ""}` },
        lien(def.href, r.titre, false, courant),
        h("button", { type: "button", class: "gd-ouvrir", "aria-expanded": "false", "aria-controls": id, "aria-label": `${r.titre} : ouvrir la liste`, onclick: basculerMenu },
          h("span", { class: "gd-fleche", "aria-hidden": "true" }, "▾")),
        h("div", { class: `gd-panneau${liens.length < 4 ? " une-colonne" : ""}`, id }, liens)));
    }
    fill(document.getElementById("menu"), h("div", { class: "gd-menu-in" },
      h("a", { class: "gd-marque", href: "#/" }, h("img", { class: "gd-marque-logo", src: "img/wow-forever-logo.png", alt: "", width: 36, height: 29 }),
        h("span", { class: "gd-marque-txt" }, h("span", { class: "gd-marque-nom" }, CFG.court), h("span", { class: "gd-marque-sous" }, CFG.nom))),
      h("nav", { class: "gd-nav", "aria-label": "Menu" }, items,
        // 20/11 (Melvin : « il ne faut pas que ce soit compliqué de trouver comment envoyer ses métiers ») : un bouton à part, sur toutes les pages
        CFG.service ? h("a", { class: `gd-envoyer-btn${page === "metiers" && params[0] === "envoyer" ? " actif" : ""}`, href: "#/metiers/envoyer",
          "aria-current": page === "metiers" && params[0] === "envoyer" ? "page" : null }, icone(ICONE_ENVOI, "xs"), h("span", {}, "Envoyer mes métiers")) : null)));
  }
  const lienPanneau = (href, ic, nom, droite, actif) => h("a", { class: `gd-panneau-lien${actif ? " actif" : ""}`, href, "aria-current": actif ? "page" : null, onclick: fermerMenu },
    icone(ic, "sm"), h("span", {}, nom), droite);
  function basculerMenu(e) {
    const d = e.currentTarget.parentElement, ouvrir = !d.classList.contains("ouvert");
    fermerMenu();
    if (ouvrir) { d.classList.add("ouvert"); e.currentTarget.setAttribute("aria-expanded", "true"); }
  }
  function fermerMenu() {
    for (const d of document.querySelectorAll(".gd-deroule.ouvert")) {
      d.classList.remove("ouvert");
      const b = d.querySelector(".gd-ouvrir");
      if (b) b.setAttribute("aria-expanded", "false");
    }
  }

  // ---------------------------------------------------------------- Accueil de la guilde
  const nomClasse = (c) => CLASSES[c] || "Classe inconnue";
  function pageAccueil() {
    setTitre(null);
    const nouveautes = D || ERREUR === "vide" ? blocNouveautes("Dernières nouveautés des métiers") : null;
    vue.append(
      h("div", { class: "gd-hero" }, logoHero(), h("h1", {}, CFG.nom), CFG.accroche ? h("p", { class: "gd-hero-guilde" }, CFG.accroche) : null,
        h("div", { class: "gd-separateur", "aria-hidden": "true" }),
        CFG.presentation.map((p) => h("p", { class: "gd-hero-presentation" }, p)),
        blocChiffres()),
      h("div", { class: "stack" }, tuilesRubriques(), nouveautes));
  }
  // Quelques chiffres de l'armurerie : les membres, ceux du niveau 60, les classes en petite barre (un clic sur une classe filtre la liste)
  function blocChiffres() {
    const M = R ? R.membres : [];
    if (!M.length) return null;
    const n60 = M.filter((p) => p.niveau >= 60).length;
    const compte = new Map();
    for (const p of M) compte.set(p.classe, (compte.get(p.classe) || 0) + 1);
    const classes = [...compte].sort((a, b) => b[1] - a[1] || nomClasse(a[0]).localeCompare(nomClasse(b[0]), "fr"));
    const css = (c) => (CLASSES[c] ? `c-${c}` : "c-inconnue");
    const chiffre = (href, n, mot) => h("a", { class: "gd-chiffre", href }, h("b", {}, n), h("span", {}, mot));
    return h("div", { class: "gd-chiffres" },
      h("div", { class: "gd-chiffres-ligne" }, chiffre("#/membres", M.length, M.length > 1 ? "membres" : "membre"), chiffre("#/membres", n60, "au niveau 60")),
      h("div", { class: "gd-classes" },
        h("div", { class: "gd-classes-barre", role: "img", "aria-label": `Les classes de la guilde : ${classes.map(([c, n]) => `${nomClasse(c)} ${n}`).join(", ")}` },
          classes.map(([c, n]) => h("span", { class: css(c), style: { flexGrow: String(n) }, title: `${nomClasse(c)} : ${n}` }))),
        h("ul", { class: "gd-classes-legende" }, classes.map(([c, n]) => h("li", {},
          h("a", { href: `#/membres?classe=${encodeURIComponent(c)}` }, h("span", { class: `gd-rond ${css(c)}`, "aria-hidden": "true" }), nomClasse(c), h("b", {}, n)))))));
  }
  // Les rubriques en grandes tuiles, d'après site.json : icône, titre, une ligne, un chiffre
  function tuilesRubriques() {
    const L = rubriquesConnues();
    if (!L.length) return null;
    return h("nav", { class: "gd-rubriques", "aria-label": "Les rubriques" }, L.map((r) => {
      const def = RUBRIQUES[r.id], n = def.compte ? def.compte() : null;
      return h("a", { class: "gd-tuile gd-rubrique", href: def.href }, r.icone ? icone(r.icone, "lg") : null, h("span", { class: "gd-tuile-nom" }, r.titre),
        r.desc ? h("span", { class: "gd-rubrique-desc" }, r.desc) : null, n ? h("span", { class: "gd-rubrique-chiffre" }, n) : null);
    }));
  }

  // ---------------------------------------------------------------- Les membres (data/membres.json, l'armurerie officielle)
  // La liste : les membres de l'armurerie, puis ceux qui partagent leurs métiers sans y être encore
  function listeRoster() {
    const L = R ? [...R.membres] : [];
    if (D) for (const m of D.membres) if (!m.perso) L.push({ nom: m.nom, surnom: null, classe: m.classe, niveau: null, race: null, rang: null, ilvl: null, cle: m.cle, partage: m, horsArmurerie: true });
    return L;
  }
  const parRangPerso = (a, b) => (a.rang == null ? 99 : a.rang) - (b.rang == null ? 99 : b.rang) || (b.niveau || 0) - (a.niveau || 0) || a.nom.localeCompare(b.nom, "fr");
  function pageMembres(params) {
    const titre = rubrique("membres").titre;
    setTitre(titre);
    const tous = listeRoster().sort(parRangPerso);
    // Melvin (20/11) : pas d'explication sous le titre, seulement un mot quand la liste manque
    const ligne = !R && ERREUR_R ? "La liste des membres n'a pas pu être lue." : null;
    vue.append(fil(h("span", {}, titre)), enteteRubrique("membres", ligne));
    if (!tous.length) {
      vue.append(h("div", { class: "stack" }, cadre(null, h("div", { class: "gd-vide" }, h("p", {}, ERREUR_R === "fichier"
        ? "Le navigateur refuse de lire les données depuis un fichier de ton disque : ouvre le site par son adresse web."
        : "La liste des membres n'a pas pu être lue. Réessaie dans un instant.")))));
      return;
    }
    // L'état des filtres vit dans l'adresse (#/membres?q=…&classe=…) : un lien partagé garde la même vue. Plus de filtre « Niveau 60 »
    // (Melvin, 19/11 : tout le monde finira 60 ; le compte des 60 reste sur l'Accueil le temps du rush)
    const etat = { q: params.get("q") || "", classe: CLASSES[params.get("classe")] || params.get("classe") === "inconnue" ? params.get("classe") : "" };
    const classes = [...new Set(tous.map((p) => (CLASSES[p.classe] ? p.classe : "inconnue")))].sort((a, b) => (CLASSES[a] || "~").localeCompare(CLASSES[b] || "~", "fr"));
    const champ = h("input", { type: "search", class: "lv-cherche gd-membres-cherche", value: etat.q, placeholder: "Chercher un nom…", "aria-label": "Chercher un membre par son nom",
      autocomplete: "off", spellcheck: "false", enterkeyhint: "search" });
    const pastilles = h("div", { class: "gd-pastilles", role: "group", "aria-label": "Filtrer par classe" });
    const compte = h("p", { class: "gd-roster-compte", "aria-live": "polite" });
    const liste = h("ul", { class: "gd-roster" });
    const garde = (p, sauf) => (sauf === "classe" || !etat.classe || (CLASSES[p.classe] ? p.classe : "inconnue") === etat.classe)
      && (!etat.q.trim() || plat(etat.q).trim().split(" ").every((w) => plat(`${p.nom} ${p.surnom || ""}`).includes(w)));
    function adresse() {
      const u = new URLSearchParams();
      if (etat.q.trim()) u.set("q", etat.q.trim());
      if (etat.classe) u.set("classe", etat.classe);
      const s = u.toString();
      history.replaceState(null, "", `#/membres${s ? `?${s}` : ""}`);
    }
    function dessiner() {
      const vus = tous.filter((p) => garde(p));
      const avant = tous.filter((p) => garde(p, "classe"));
      const pastille = (cle, nom, n, css) => h("button", { type: "button", class: `gd-pastille${etat.classe === cle ? " actif" : ""}`, "aria-pressed": String(etat.classe === cle),
        "data-cle": cle, onclick: () => { etat.classe = etat.classe === cle || !cle ? "" : cle; adresse(); dessiner(); } },
        css ? h("span", { class: `gd-rond ${css}`, "aria-hidden": "true" }) : null, nom, h("b", {}, n));
      // Les pastilles sont redessinées : celle qui avait le focus le garde (clavier)
      const focus = pastilles.contains(document.activeElement) ? document.activeElement.getAttribute("data-cle") : null;
      fill(pastilles, pastille("", "Toutes", avant.length, null),
        classes.map((c) => pastille(c, c === "inconnue" ? "Inconnue" : CLASSES[c], avant.filter((p) => (CLASSES[p.classe] ? p.classe : "inconnue") === c).length, c === "inconnue" ? "c-inconnue" : `c-${c}`)));
      if (focus != null) { const b = [...pastilles.children].find((x) => x.getAttribute("data-cle") === focus); if (b) b.focus(); }
      fill(compte, vus.length === tous.length ? pl(tous.length, "membre") : `${vus.length} sur ${pl(tous.length, "membre")}`);
      fill(liste, vus.length ? vus.map(lignePerso) : h("li", { class: "gd-roster-vide" }, h("p", {}, "Aucun membre ne correspond."),
        h("button", { type: "button", class: "btn ghost", onclick: () => { etat.q = ""; etat.classe = ""; champ.value = ""; adresse(); dessiner(); champ.focus(); } }, "Tout afficher")));
    }
    champ.addEventListener("input", () => { etat.q = champ.value; adresse(); dessiner(); });
    champ.addEventListener("keydown", (e) => { if (e.key === "Escape" && champ.value) { e.preventDefault(); champ.value = ""; etat.q = ""; adresse(); dessiner(); } });
    dessiner();
    vue.append(h("div", { class: "stack" }, h("section", { class: "frame gd-roster-cadre" },
      h("div", { class: "gd-roster-outils" }, champ, compte), pastilles, liste)));
  }
  // Un membre : nom à la couleur de sa classe et surnom, niveau, race et classe, rang, niveau d'objet, puis ses métiers partagés et sa fiche officielle
  function lignePerso(p) {
    const officielle = adresseOfficielle(p.armurerie);
    const m = p.partage;
    const chiffre = (n, mot, cls) => h("span", { class: `gd-perso-chiffre ${cls}` }, n != null ? h("b", {}, n) : h("b", { class: "muted" }, "—"), h("small", {}, mot));
    return h("li", { class: "gd-perso" },
      h("div", { class: "gd-perso-id" }, h("a", { class: `gd-perso-nom ${classeCss(p)}`, href: lienMembre(p) }, p.nom), p.surnom ? h("span", { class: "gd-perso-surnom" }, p.surnom) : null),
      chiffre(p.niveau, "niveau", "gd-perso-niv"),
      h("div", { class: "gd-perso-race" }, h("span", {}, p.race || (p.horsArmurerie ? "Pas encore dans l'armurerie" : "—")), h("small", {}, nomClasse(p.classe))),
      h("div", { class: "gd-perso-rang" }, nomRang(p.rang) ? h("span", { class: `gd-rang-badge${Number(p.rang) === 0 ? " chef" : ""}` }, nomRang(p.rang)) : null),
      chiffre(p.ilvl, "niv. d'objet", "gd-perso-ilvl"),
      h("div", { class: "gd-perso-liens" },
        m ? h("a", { class: "gd-badge-metiers", href: lienMembre(p), title: m.metiers.map((x) => `${nomMetier(x.cle)}${x.rang != null ? ` ${x.rang}/${x.max || "?"}` : ""}`).join(", ") || null },
          h("span", { class: "gd-badge-icones", "aria-hidden": "true" }, m.metiers.slice(0, 3).map((x) => icone(iconeMetier(x.cle), "xs"))), "Métiers partagés") : null,
        officielle ? lienOfficiel(officielle, p) : null));
  }
  const lienOfficiel = (href, p, cls = "gd-officielle") => h("a", { class: cls, href, target: "_blank", rel: "noopener", title: `La fiche de ${p.nom} sur l'armurerie officielle de Blizzard (nouvel onglet)` },
    "Fiche officielle", h("span", { class: "gd-ext", "aria-hidden": "true" }, " ↗"));

  // ---------------------------------------------------------------- Métiers : la rubrique
  function chercher(texte) {
    const q = plat(texte).trim();
    if (q.length < 2) return null;
    // Plusieurs mots, dans n'importe quel ordre : chacun doit se trouver quelque part (pour une recette : son nom, sa catégorie ou son métier)
    const mots = [...new Set(q.split(" "))];
    const ok = (e) => mots.every((w) => e.t.includes(w) || (e.autour != null && e.autour.includes(w)));
    // D'abord les noms qui portent tous les mots, puis ceux qui commencent par le premier, puis les plus courts
    const horsNom = (e) => mots.filter((w) => !e.t.includes(w)).length;
    const rang = (t) => (t.startsWith(mots[0]) ? 0 : t.includes(` ${mots[0]}`) ? 1 : 2);
    const tri = (a, b) => horsNom(a) - horsNom(b) || rang(a.t) - rang(b.t) || a.t.length - b.t.length || a.t.localeCompare(b.t, "fr");
    const S = IX.recherche;
    return { recettes: S.recettes.filter(ok).sort(tri), composants: S.composants.filter(ok).sort(tri), membres: S.membres.filter(ok).sort(tri), metiers: S.metiers.filter(ok).sort(tri) };
  }
  function groupe(titre, liste, rendu, limite) {
    if (!liste.length) return null;
    const corps = h("div", { class: "gd-groupe-corps" });
    const montrer = (n) => {
      fill(corps, liste.slice(0, n).map(rendu), liste.length > n
        ? h("button", { type: "button", class: "gd-plus", onclick: () => { montrer(liste.length); infobulles(); } }, `Voir les ${liste.length - n} autres`) : null);
    };
    montrer(limite);
    return h("section", { class: "gd-groupe" }, h("h3", { class: "gd-groupe-titre" }, titre, h("span", { class: "gd-compte" }, liste.length)), corps);
  }
  function resRecette({ id }) {
    const r = D.recettes[id], qui = IX.quiSait.get(id) || [], cat = IX.categorie.get(id);
    return lienRecette(id, [icone(r.i, "sm", r.k === "spell" ? null : r.q),
      h("span", { class: "gd-res-txt" }, h("span", { class: "gd-res-ligne" }, h("span", { class: `gd-res-nom q-${couleurNom(r)}` }, r.n), pastille(id)),
        h("span", { class: "gd-res-sous" }, [nomMetier(r.m), cat ? cat.nom : null, r.s ? `compétence ${r.est ? "≈" : ""}${r.s}` : null].filter(Boolean).join(" · "))),
      h("span", { class: "gd-res-qui" }, qui.length ? nomsQui(qui) : "personne")], "gd-res");
  }
  function resComposant({ id }) {
    const c = D.composants[id], ids = IX.dansRecettes.get(id) || [];
    return h("div", { class: "gd-res gd-res-comp" }, lienWh("item", id, icone(c.i, "sm", c.q), "gd-res-ic"),
      h("span", { class: "gd-res-txt" }, lienWh("item", id, c.n, `gd-res-nom q-${qualite(c.q)}`),
        h("span", { class: "gd-res-sous" }, `Entre dans ${pl(ids.length, "recette")} de la guilde :`),
        h("span", { class: "gd-puces" }, ids.slice(0, 10).map((rid) => lienRecette(rid, [icone(D.recettes[rid].i, "xs"), D.recettes[rid].n], "gd-puce")),
          ids.length > 10 ? h("span", { class: "muted small" }, `et ${ids.length - 10} autres`) : null)));
  }
  function resMetier({ id }) {
    const L = IX.parMetier.get(id) || [];
    return h("a", { class: "gd-res", href: `#/metier/${encodeURIComponent(id)}` }, icone(iconeMetier(id), "sm"),
      h("span", { class: "gd-res-txt" }, h("span", { class: "gd-res-nom" }, nomMetier(id)), h("span", { class: "gd-res-sous" }, [pl(L.length, "membre"), idsDuMetier(id).length ? pl(idsDuMetier(id).length, "recette") : null].filter(Boolean).join(" · "))));
  }
  function dessinerResultats(el, texte) {
    const R = chercher(texte);
    if (!R) {
      fill(el, texte.trim() ? h("p", { class: "gd-aide" }, "Encore une lettre…") : null);
      return;
    }
    const total = R.recettes.length + R.composants.length + R.membres.length + R.metiers.length;
    if (!total) { fill(el, h("p", { class: "gd-aucun" }, `Personne dans la guilde ne connaît « ${texte.trim()} » pour l'instant.`)); return; }
    fill(el,
      groupe("Recettes", R.recettes, resRecette, 12),
      groupe("Composants", R.composants, resComposant, 5),
      groupe("Membres", R.membres, ({ m }) => ligneMembre(m), 8),
      groupe("Métiers", R.metiers, resMetier, 12));
  }
  function blocRecherche(q0) {
    const resultats = h("div", { class: "gd-resultats", "aria-live": "polite" });
    const champ = h("input", { type: "search", class: "gd-cherche", value: q0 || "", placeholder: "Une recette, un composant, un membre…", "aria-label": "Qui sait faire… ?",
      autocomplete: "off", spellcheck: "false", enterkeyhint: "search" });
    const maj = () => {
      const q = champ.value.trim();
      history.replaceState(null, "", q ? `#/metiers?q=${encodeURIComponent(q)}` : "#/metiers");
      dessinerResultats(resultats, champ.value);
      infobulles();
    };
    champ.addEventListener("input", maj);
    champ.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const a = resultats.querySelector('a[href^="#/"]');
        if (a) { e.preventDefault(); location.hash = a.getAttribute("href"); }
      } else if (e.key === "Escape" && champ.value) { e.preventDefault(); champ.value = ""; maj(); }
    });
    if (q0) dessinerResultats(resultats, q0);
    if (SURVOL) setTimeout(() => { try { champ.focus({ preventScroll: true }); } catch (e) { champ.focus(); } }, 0);
    return h("section", { class: "frame titre gd-recherche" }, h("h2", { class: "frame-title" }, "Qui sait faire… ?"),
      h("p", { class: "muted small", style: { margin: "0 0 8px" } },"Le nom d'une recette, d'un composant ou d'un membre, sans te soucier des accents."),
      champ, D ? h("div", { class: "gd-empl-tete" }, h("span", { class: "gd-empl-titre" }, "Ou par emplacement"), rangeeEmplacements(null)) : null, resultats);
  }
  // L'encart de l'addon des métiers : son nom, sa version, le lien vers sa page
  function encartAddon() {
    const A = infoAddon();
    return A ? h("a", { class: "gd-encart", href: lienAddon(A.id) }, icone(A.icone, "sm"), h("b", {}, A.version ? `${A.nom} ${A.version}` : A.nom), h("span", {}, A.curseforge ? "· Installer" : "· Télécharger")) : null;
  }
  const ICONE_ENVOI = "inv_letter_15";
  const encartEnvoi = () => (CFG.service ? h("a", { class: "gd-encart", href: "#/metiers/envoyer" }, icone(ICONE_ENVOI, "sm"), h("b", {}, "Envoyer mes métiers"), h("span", {}, "· Ton code")) : null);
  // Le carnet des métiers vide ou illisible : ce qu'il faut faire
  function carnetVide() {
    const texte = ERREUR === "fichier"
      ? "Le navigateur refuse de lire les données depuis un fichier de ton disque : ouvre le site par son adresse web."
      : ERREUR === "lecture"
        ? "Les métiers de la guilde n'ont pas pu être lus. Réessaie dans un instant."
        : `Aucun membre n'a encore partagé ses métiers. Installe l'addon ${nomAddonMetiers()} et ouvre une fois chacun de tes métiers en jeu : le carnet se remplira à la prochaine mise à jour du site.`;
    return h("div", { class: "stack" }, cadre("Le carnet est encore vide", h("div", { class: "gd-vide" }, h("p", {}, texte),
      h("div", { class: "gd-docs" }, h("a", { class: "btn", href: lienAddon(ADDON_METIERS) }, (infoAddon() || {}).curseforge ? "Installer l'addon" : "Télécharger l'addon"),
        CFG.service ? h("a", { class: "btn ghost", href: "#/metiers/envoyer" }, "Envoyer mes métiers") : null))));
  }
  // 989 · Par emplacement : les pièces que la guilde sait fabriquer et ce qu'elle sait poser dessus (enchantements, renforts, lunettes)
  const EMPLACEMENTS_GUILDE = [["tete", "Tête", "inv_helmet_47"], ["cou", "Cou", "inv_jewelry_amulet_07"], ["epaules", "Épaules", "inv_shoulder_23"],
    ["dos", "Dos", "inv_misc_cape_02"], ["torse", "Torse", "inv_chest_chain_09"], ["poignets", "Poignets", "inv_bracer_07"], ["mains", "Mains", "inv_gauntlets_05"],
    ["taille", "Taille", "inv_belt_06"], ["jambes", "Jambes", "inv_pants_06"], ["pieds", "Pieds", "inv_boots_05"], ["bijou", "Bijou", "inv_misc_enggizmos_02"],
    ["armes", "Armes", "inv_weapon_shortblade_05"], ["main-gauche", "Main gauche", "inv_shield_22"], ["relique", "Relique", "inv_relics_libramofhope"],
    ["sacs", "Sacs", "inv_misc_bag_10_red"]];
  const SLOT_EMPLACEMENT = { Head: "tete", Neck: "cou", Shoulder: "epaules", Back: "dos", Cloak: "dos", Chest: "torse", Robe: "torse", Wrist: "poignets", Hands: "mains",
    Waist: "taille", Legs: "jambes", Feet: "pieds", Trinket: "bijou", "Main Hand": "armes", "One-Hand": "armes", "Two-Hand": "armes", Ranged: "armes", Thrown: "armes",
    "Off Hand": "main-gauche", "Held In Off-hand": "main-gauche", Shield: "main-gauche", Relic: "relique", Bag: "sacs" };
  // Sans emplacement relevé : la catégorie de la fenêtre de métier (sans accents ni majuscules) ; les huiles et les pierres, temporaires, n'y sont pas
  const CATEGORIE_EMPLACEMENT = [[/^enchantements de torse/, ["torse"]], [/^enchantements de brassards/, ["poignets"]], [/^enchantements de gants/, ["mains"]],
    [/^enchantements de bottes/, ["pieds"]], [/^enchantements d.arme/, ["armes"]], [/^enchantements (de bouclier|d.objet en main gauche)/, ["main-gauche"]],
    [/^enchantements d.amulette/, ["cou"]], [/^enchantements de cape/, ["dos"]], [/^lunettes de visee/, ["armes"]], [/^renforts d.armure/, ["torse", "mains", "jambes", "pieds"]],
    [/^(sacs|carquois|gibernes)/, ["sacs"]], [/^(casques|chaperons|couvre-chefs)/, ["tete"]], [/^(espauliers|spallieres)/, ["epaules"]], [/^capes/, ["dos"]],
    [/^(corselets|robes)/, ["torse"]], [/^brassards/, ["poignets"]], [/^(gantelets|gants)/, ["mains"]], [/^ceintures/, ["taille"]], [/^(garde-jambes|jambieres)/, ["jambes"]],
    [/^(bottes|chaussures)/, ["pieds"]]];
  // Ce qui se pose sur une pièce (enchantement, renfort, lunette), à part des pièces elles-mêmes
  const POSE = /^(enchantements|renforts d.armure|lunettes de visee)/;
  function emplacementsDe(id) {
    const r = D.recettes[id];
    if (!r) return [];
    if (r.k !== "spell" && SLOT_EMPLACEMENT[r.slot]) return [SLOT_EMPLACEMENT[r.slot]];
    const c = plat((IX.categorie.get(id) || {}).nom);
    const x = CATEGORIE_EMPLACEMENT.find(([re]) => re.test(c));
    return x ? x[1] : [];
  }
  function indexEmplacements() {
    if (IX.emplacements) return IX.emplacements;
    IX.emplacements = new Map();
    for (const id of IX.quiSait.keys()) for (const e of emplacementsDe(id)) pousser(IX.emplacements, e, id);
    return IX.emplacements;
  }
  // La rangée des emplacements où la guilde sait faire quelque chose (sous « Qui sait faire… ? » et en tête de la page)
  function rangeeEmplacements(actif) {
    const ix = indexEmplacements();
    const L = EMPLACEMENTS_GUILDE.filter(([cle]) => ix.has(cle));
    return L.length ? h("nav", { class: "gd-empl", "aria-label": "Par emplacement" }, L.map(([cle, nom, ic]) => h("a", {
      class: `gd-empl-lien${cle === actif ? " actif" : ""}`, href: `#/metiers/emplacement/${cle}`, "aria-current": cle === actif ? "page" : null, title: pl(ix.get(cle).length, "recette") },
      icone(ic, "sm"), h("span", {}, nom)))) : null;
  }
  // Une ligne : la recette, ce qu'elle donne (stats ou effet), qui sait la faire
  function statsCourtes(r) {
    if (r.k === "spell" || !r.st) return r.e || "";
    return STATS.filter(([k]) => r.st[k] != null).map(([k, f]) => f(r.st[k]).replace(/^Équipé : /, "")).join(", ");
  }
  function resEmplacement(id) {
    const r = D.recettes[id], qui = IX.quiSait.get(id) || [], cat = IX.categorie.get(id);
    const sous = [nomMetier(r.m), cat && r.k !== "spell" ? cat.nom : null, r.req ? `niveau ${r.req}` : null].filter(Boolean).join(" · ");
    const effet = statsCourtes(r);
    return lienRecette(id, [icone(r.i, "sm", r.k === "spell" ? null : r.q),
      h("span", { class: "gd-res-txt" }, h("span", { class: "gd-res-ligne" }, h("span", { class: `gd-res-nom q-${couleurNom(r)}` }, r.n), pastille(id)),
        effet ? h("span", { class: "gd-res-effet" }, effet) : null, h("span", { class: "gd-res-sous" }, sous)),
      h("span", { class: "gd-res-qui" }, nomsQui(qui))], "gd-res");
  }
  function pageEmplacement(cle) {
    const ix = indexEmplacements();
    const def = EMPLACEMENTS_GUILDE.find(([c]) => c === cle) || EMPLACEMENTS_GUILDE.find(([c]) => ix.has(c));
    const titre = "Par emplacement";
    setTitre(def ? `${def[1]} · ${titre}` : titre);
    if (!def || !ix.has(def[0])) {
      vue.append(filMetiers(h("span", {}, titre)), cadre(titre, h("div", { class: "gd-vide" }, h("p", {}, "La guilde ne sait encore rien fabriquer pour cet emplacement."),
        h("a", { class: "btn", href: "#/metiers" }, "Retour aux métiers"))));
      return;
    }
    const ids = ix.get(def[0]);
    const pose = ids.filter((id) => POSE.test(plat((IX.categorie.get(id) || {}).nom)));
    const pieces = ids.filter((id) => !pose.includes(id));
    const parNiveau = (a, b) => (D.recettes[b].req || 0) - (D.recettes[a].req || 0) || (D.recettes[b].ilvl || 0) - (D.recettes[a].ilvl || 0) || (D.recettes[b].s || 0) - (D.recettes[a].s || 0)
      || D.recettes[a].n.localeCompare(D.recettes[b].n, "fr");
    vue.append(filMetiers(h("a", { href: "#/metiers/emplacement" }, titre), h("span", {}, def[1])),
      h("section", { class: "frame gd-entete" }, h("div", { class: "gd-tete-metier" }, icone(def[2], "xl"),
        h("div", {}, h("h1", {}, def[1]), h("p", {}, [pieces.length ? pl(pieces.length, "pièce") : null, pose.length ? pl(pose.length, "amélioration") : null].filter(Boolean).join(" · ")
          + " que la guilde sait faire"))), rangeeEmplacements(def[0])),
      h("div", { class: "stack" },
        pose.length ? cadre(`À poser dessus (${pose.length})`, h("div", { class: "gd-res-liste" }, pose.sort(parNiveau).map(resEmplacement))) : null,
        pieces.length ? cadre(`Les pièces (${pieces.length})`, h("div", { class: "gd-res-liste" }, pieces.sort(parNiveau).map(resEmplacement))) : null));
  }

  // Les recettes à recharge de la guilde (étoffe lunaire, transmutations…) : qui peut les lancer aujourd'hui, les prêtes d'abord
  function blocRecharges() {
    const L = [];
    for (const [id, r] of Object.entries(D.recettes)) {
      if (!r || !r.cd) continue;
      const qui = (IX.quiSait.get(id) || []).map(({ m, x }) => ({ m, x, st: etatRecharge(m, id), sait: !!(m.recharges && typeof m.recharges === "object") }));
      if (!qui.length) continue;
      qui.sort((a, b) => a.st.reste - b.st.reste || parRang(a, b));
      L.push({ id, r, qui, pretes: qui.filter((e) => e.st.pret).length });
    }
    if (!L.length) return null;
    L.sort((a, b) => (b.pretes > 0) - (a.pretes > 0) || a.qui[0].st.reste - b.qui[0].st.reste || a.r.n.localeCompare(b.r.n, "fr"));
    // Melvin (20/11) : un titre court, rien dessous
    return cadre("Liste des CD",
      h("div", { class: "gd-rch" }, L.map(({ id, r, qui }) => h("div", { class: "gd-rch-ligne" },
        lienRecette(id, [icone(r.i, "sm", r.k === "spell" ? null : r.q), h("span", { class: `gd-res-nom q-${couleurNom(r)}` }, r.n),
          h("span", { class: "gd-res-sous" }, `${nomMetier(r.m)} · recharge de ${dureeRecharge(r.cd)}`)], "gd-rch-recette"),
        h("div", { class: "gd-rch-qui" }, qui.map(({ m, x, st, sait }) => h("a", { class: `gd-recharge${st.pret ? " pret" : sait ? "" : " inconnue"}`, href: lienMembre(m, x.cle, id), title: st.titre },
          h("span", { class: classeCss(m) }, m.nom), ` · ${st.pret ? "prête" : sait ? st.texte.replace(/^Prête dans /, "dans ") : "pas relevée"}`)))))));
  }
  function pageMetiers(q, voir) {
    const titre = rubrique("metiers").titre;
    setTitre(titre);
    if (!D) { vue.append(fil(h("span", {}, titre)), enteteRubrique("metiers", rubrique("metiers").desc, encartAddon(), encartEnvoi()), carnetVide()); return; }
    const nouveautes = blocNouveautes("Les dernières nouveautés");
    const nRec = IX.recherche.recettes.length;
    const resume = [pl(D.membres.length, "membre"), `${nRec} recette${nRec > 1 ? "s" : ""} connue${nRec > 1 ? "s" : ""}`, D.maj && quand(D.maj) ? `mis à jour ${quand(D.maj)}` : null].filter(Boolean).join(", ");
    const metiers = listeMetiers();
    const tries = [...D.membres].sort((a, b) => ((dateDe(b.vu || b.maj) || 0) - (dateDe(a.vu || a.maj) || 0)) || a.nom.localeCompare(b.nom, "fr"));
    const liste = h("div", { class: "gd-membres" });
    const montrer = (n) => fill(liste, tries.slice(0, n).map(ligneMembre),
      tries.length > n ? h("button", { type: "button", class: "gd-plus", onclick: () => montrer(tries.length) }, `Voir les ${tries.length} membres`) : null);
    montrer(8);
    vue.append(fil(h("span", {}, titre)),
      enteteRubrique("metiers", majuscule(resume), encartAddon(), encartEnvoi()),
      h("div", { class: "stack" },
        blocRecherche(q),
        blocRecharges(),
        metiers.length ? cadre("Les métiers de la guilde", h("div", { class: "gd-tuiles" }, metiers.map((cle) => {
          const L = IX.parMetier.get(cle) || [];
          const nR = idsDuMetier(cle).length;
          return h("a", { class: "gd-tuile", href: `#/metier/${encodeURIComponent(cle)}`, },
            icone(iconeMetier(cle), "lg"), h("span", { class: "gd-tuile-nom" }, nomMetier(cle)),
            h("span", { class: "gd-tuile-info" }, [pl(L.length, "membre"), nR ? pl(nR, "recette") : null].filter(Boolean).join(" · ")));
        }))) : null,
        nouveautes,
        cadre("Derniers membres vus", liste)));
    // « Tout voir » de l'accueil (#/metiers?voir=nouveautes) : la page s'ouvre sur les nouveautés
    if (voir) setTimeout(() => nouveautes.scrollIntoView({ block: "start" }), 0);
  }

  // Les dernières nouveautés des métiers (data/guilde.json > historique, le plus récent en tête), en groupes :
  // les recettes d'un même membre, d'un même métier et d'un même jour sur une ligne ; une arrivée sur la sienne
  function groupesHistorique() {
    if (!D) return [];
    const G = [], parCle = new Map();
    const L = D.historique.map((e, i) => ({ e, i })).sort((a, b) => String(b.e.date || "").localeCompare(String(a.e.date || "")) || a.i - b.i);
    for (const { e } of L) {
      const jour = /^\d{4}-\d{2}-\d{2}/.test(String(e.date || "")) ? String(e.date).slice(0, 10) : null;
      if (e.type === "arrivee") { G.push({ type: "arrivee", jour, qui: e.qui }); continue; }
      const id = e.r != null ? String(e.r) : null;
      // Une recette de bas niveau (compétence requise sous site.json > nouveautes.competenceMin) n'est une nouveauté que si elle est propre
      // à Forever (fv, à partir de nouveautes.foreverMin : pas les babioles de départ) ou BiS pour au moins une spé (bis : pièce des listes
      // pré-raid et raid, ou enchantement conseillé ; guilde.py > recettes_bis)
      const rc = id ? D.recettes[id] : null;
      if (id && !rc) continue;  // une recette que le carnet ne sait pas nommer n'est pas une nouveauté lisible
      if (rc && rc.s != null && rc.s < CFG.nouveautesMin && !rc.bis && !(rc.fv && rc.s >= CFG.nouveautesForeverMin)) continue;
      const m = e.m || (id && D.recettes[id] ? D.recettes[id].m : null);
      const cle = `${jour}\n${e.qui}\n${m}`;
      let g = parCle.get(cle);
      if (!g) { g = { type: "recette", jour, qui: e.qui, m, recettes: [] }; parCle.set(cle, g); G.push(g); }
      if (!id || !g.recettes.some((x) => x.id === id)) g.recettes.push({ id, neuf: e.neuf === true });
    }
    // Les recettes nouvelles pour la guilde d'abord : elles restent visibles quand la ligne se replie sur trois
    for (const g of G) if (g.recettes) g.recettes.sort((a, b) => b.neuf - a.neuf);
    return G;
  }
  // « aujourd'hui », « hier », « il y a 3 jours » (jours de Paris) ; au-delà d'un mois, « le 3 octobre »
  function ilYa(jour) {
    if (!jour) return "";
    const n = Math.round((Date.parse(`${fJour.format(new Date())}T00:00:00Z`) - Date.parse(`${jour}T00:00:00Z`)) / 864e5);
    return n === 0 ? "aujourd'hui" : n === 1 ? "hier" : n > 1 && n <= 30 ? `il y a ${n} jours` : quandJour(jour) || "";
  }
  const fDateComplete = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const dateComplete = (jour) => (jour ? majuscule(jourFr(fDateComplete, new Date(`${jour}T12:00:00Z`))) : null);
  // Un nom de l'historique : le membre qui partage ses métiers, sinon celui de l'armurerie s'il n'y en a qu'un de ce nom
  function membreDe(nom) {
    const m = D && D.membres.find((x) => x.nom === nom);
    if (m) return m;
    const L = R ? R.membres.filter((p) => p.nom === nom) : [];
    return L.length === 1 ? L[0] : null;
  }
  // Les nouveautés en lignes simples (20/11, Melvin : « max 5 lignes, et pas par personnage ») : une recette par ligne (icône, nom, métier,
  // qui l'a apprise, « Nouveau » si personne ne la savait), une arrivée « X partage maintenant ses métiers » ; la même recette apprise le même
  // jour par deux membres tient sur une ligne. Chaque jour, une ligne par membre d'abord (un nouveau venu et ses 40 recettes ne remplissent pas
  // tout), puis les nouvelles pour la guilde, puis les plus hautes.
  function lignesNouveautes() {
    const L = [], parCle = new Map();
    for (const g of groupesHistorique()) {
      if (g.type === "arrivee") { L.push({ type: "arrivee", jour: g.jour, qui: [g.qui] }); continue; }
      for (const r of g.recettes) {
        if (!r.id || !D.recettes[r.id]) continue;
        const cle = `${g.jour}\n${r.id}`;
        const x = parCle.get(cle);
        if (x) { if (!x.qui.includes(g.qui)) x.qui.push(g.qui); x.neuf = x.neuf || r.neuf; continue; }
        const l = { type: "recette", jour: g.jour, id: r.id, m: g.m, qui: [g.qui], neuf: r.neuf };
        parCle.set(cle, l);
        L.push(l);
      }
    }
    const niveau = (l) => (l.type === "recette" ? D.recettes[l.id].s || 0 : 0);
    const avant = (a, b) => (b.type === "arrivee") - (a.type === "arrivee") || b.neuf - a.neuf || niveau(b) - niveau(a);
    // le rang de chaque ligne parmi celles de son membre, le même jour
    const parMembre = new Map();
    for (const l of L) {
      const k = `${l.jour}\n${l.qui[0]}`;
      if (!parMembre.has(k)) parMembre.set(k, []);
      parMembre.get(k).push(l);
    }
    for (const lignes of parMembre.values()) lignes.sort(avant).forEach((l, i) => { l.rang = i; });
    return L.sort((a, b) => String(b.jour || "").localeCompare(String(a.jour || "")) || a.rang - b.rang || avant(a, b));
  }
  function ligneNouveaute(l) {
    const date = h("time", { class: "gd-nv-date", datetime: l.jour, title: dateComplete(l.jour) }, ilYa(l.jour));
    const nomQui = (nom) => {
      const x = membreDe(nom);
      return x ? h("a", { class: `gd-nv-qui ${classeCss(x)}`, href: lienMembre(x) }, nom) : h("b", { class: "gd-nv-qui" }, nom);
    };
    const qui = l.qui.flatMap((n, i) => [i ? (i === l.qui.length - 1 ? " et " : ", ") : null, nomQui(n)]);
    if (l.type === "arrivee") {
      const x = membreDe(l.qui[0]);
      const ic = x && Array.isArray(x.metiers) && x.metiers.length ? iconeMetier(x.metiers[0].cle) : "inv_misc_book_11";
      return h("li", { class: "gd-nv arrivee" }, h("span", { class: "gd-nv-texte" }, icone(ic, "xs"), " ", qui, " partage maintenant ses métiers"), date);
    }
    const r = D.recettes[l.id];
    return h("li", { class: `gd-nv${l.neuf ? " neuf" : ""}` },
      h("span", { class: "gd-nv-texte" },
        lienRecette(l.id, [icone(r.i, "xs", r.k === "spell" ? null : r.q), h("span", {}, r.n)], `gd-nv-rec q-${couleurNom(r)}`),
        h("span", { class: "gd-nv-sous" }, ` · ${nomMetier(l.m || r.m)} · `), qui,
        l.neuf ? h("span", { class: "gd-nv-neuf", title: "Personne dans la guilde ne la connaissait" }, "Nouveau") : null),
      date);
  }
  // Le bloc : les max dernières lignes, rien de plus (20/11, Melvin : « 5, 6 lignes, et après ça s'efface petit à petit, pas d'historique ») ;
  // vide, une phrase (le bloc reste, pour qu'on sache qu'il existe)
  const NOUVEAUTES_MAX = 6;
  function blocNouveautes(titre) {
    const L = lignesNouveautes().slice(0, NOUVEAUTES_MAX);
    const bloc = cadre(titre, L.length ? h("ul", { class: "gd-nv-liste" }, L.map(ligneNouveaute))
      : h("p", { class: "gd-histo-vide" }, "Les nouvelles recettes apprises par les membres apparaîtront ici."));
    bloc.classList.add("gd-nouveautes-metiers");
    return bloc;
  }

  // ---------------------------------------------------------------- Une recette
  function pageRecette(id) {
    id = String(id || "");
    const r = D.recettes[id];
    if (!r) {
      setTitre("Recette inconnue");
      vue.append(filMetiers(), cadre("Recette inconnue", h("div", { class: "gd-vide" }, h("p", {}, "Personne dans la guilde ne connaît cette recette, ou elle n'est pas encore dans le carnet."),
        h("a", { class: "btn", href: "#/metiers" }, "Chercher une recette"))));
      return;
    }
    setTitre(r.n);
    const cat = IX.categorie.get(id);
    const qui = [...(IX.quiSait.get(id) || [])];
    if (r.cd) qui.sort((a, b) => etatRecharge(a.m, id).reste - etatRecharge(b.m, id).reste || parRang(a, b));
    vue.append(
      filMetiers(h("a", { href: `#/metier/${encodeURIComponent(r.m)}` }, nomMetier(r.m)), cat ? h("span", {}, cat.nom) : null),
      h("div", { class: "lv-fenetre lv-seule" },
        h("div", { class: "lv-entete" }, h("span", { class: "lv-portrait" }, icone(iconeMetier(r.m), "lg")),
          h("div", { class: "lv-entete-txt" }, h("a", { class: "lv-titre-nom", href: `#/metier/${encodeURIComponent(r.m)}` }, cat ? `${nomMetier(r.m)} · ${cat.nom}` : nomMetier(r.m)))),
        h("div", { class: "lv-corps" }, h("div", { class: "lv-droite" }, detailRecette(id, { titre: "h1" })))),
      h("div", { class: "stack", style: { marginTop: "34px" } }, cadre(qui.length ? `Qui sait la faire (${qui.length})` : "Qui sait la faire",
        qui.length ? h("div", { class: "gd-membres" }, qui.map(({ m, x }) => {
          const st = r.cd ? etatRecharge(m, id) : null;
          return h("a", { class: "gd-qui", href: lienMembre(m, x.cle, id) },
            h("span", { class: "gd-qui-id" }, h("span", { class: `gd-membre-nom ${classeCss(m)}` }, m.nom), h("span", { class: "gd-membre-sous" }, identite(m))),
            pastilleSpe(m, x.cle), barreRang(x, `${nomMetier(x.cle)} : ${x.rang == null ? "?" : x.rang}/${x.max || "?"}`),
            st ? h("span", { class: `gd-recharge${st.pret ? " pret" : ""}`, title: st.titre }, st.texte) : null,
            h("span", { class: "gd-membre-vu" }, vu(m)));
        })) : h("p", { class: "muted center" }, "Plus personne ne la connaît dans le carnet."))));
  }

  // ---------------------------------------------------------------- Un membre : son profil (l'armurerie), puis sa fenêtre de métier, comme en jeu
  // La clé de l'adresse (lier) ; sinon la même sans accents ni casse ; sinon un nom seul que plusieurs membres portent : le premier, les autres en lien
  function trouverMembre(cle) {
    const k = plat(cle);
    const homonymes = (nom, f) => listeRoster().filter((p) => plat(p.nom) === plat(nom) && p.cle !== f).sort(parRangPerso);
    const f = FICHES.has(cle) ? cle : [...FICHES.keys()].find((c) => plat(c) === k);
    if (f) { const x = FICHES.get(f); return { ...x, homonymes: homonymes((x.p || x.m).nom, f) }; }
    const L = listeRoster().filter((p) => plat(p.nom) === k).sort(parRangPerso);
    if (!L.length) return null;
    const x = L.find((p) => p.partage) || L[0];
    return { p: x.horsArmurerie ? null : x, m: x.partage || null, homonymes: L.filter((p) => p !== x) };
  }
  // ---------------------------------------------------------------- L'équipement d'un membre (data/equipement.json, robot des Membres)
  const EQ_GAUCHE = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST"];
  const EQ_DROITE = ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"];
  const EQ_ARMES = ["MAIN_HAND", "OFF_HAND", "RANGED"];
  const EQ_NOMS = { HEAD: "Tête", NECK: "Cou", SHOULDER: "Épaules", BACK: "Dos", CHEST: "Torse", SHIRT: "Chemise", TABARD: "Tabard", WRIST: "Poignets",
    HANDS: "Mains", WAIST: "Taille", LEGS: "Jambes", FEET: "Pieds", FINGER_1: "Doigt", FINGER_2: "Doigt", TRINKET_1: "Bijou", TRINKET_2: "Bijou",
    MAIN_HAND: "Main droite", OFF_HAND: "Main gauche", RANGED: "À distance" };
  let EQUIPEMENT = null;
  const chargerEquipement = () => (EQUIPEMENT = EQUIPEMENT || lire("data/equipement.json").catch(() => null));
  // La clé d'un perso dans equipement.json : son adresse sur l'armurerie (« levieuxpala-titøu »)
  const adresseDe = (p) => p.adresse || (p.armurerie ? decodeURIComponent(String(p.armurerie).split("/").pop() || "") : null);
  function caseEquipement(x, slot, region) {
    if (!x) return h("div", { class: "gd-eq vide" }, h("span", { class: "gd-eq-ic gd-eq-trou", "aria-hidden": "true" }), h("span", { class: "gd-eq-sous" }, EQ_NOMS[slot] || slot));
    const q = qualite(x.q);
    const ic = x.i ? h("img", { class: `icon md qb-${q}`, src: `https://render.worldofwarcraft.com/forever-${region || "eu"}/icons/56/${encodeURIComponent(x.i)}.jpg`, alt: "",
      loading: "lazy", decoding: "async", onerror() { this.replaceWith(icone(null, "md", q)); } }) : icone(null, "md", q);
    return h("div", { class: "gd-eq" },
      lienWh("item", x.id, ic, "gd-eq-ic"),
      h("div", { class: "gd-eq-txt" },
        lienWh("item", x.id, x.n || `Objet ${x.id}`, `gd-eq-nom q-${q}`),
        h("span", { class: "gd-eq-sous" }, [x.l ? `Niv. ${x.l}` : null, x.t || EQ_NOMS[slot]].filter(Boolean).join(" · ")),
        (x.e || []).map((e) => h("span", { class: "gd-eq-ench" }, e))));
  }
  function blocEquipement(p) {
    const corps = h("div", { class: "gd-eq-corps" }, h("p", { class: "gd-eq-tete" }, "Lecture de l'équipement…"));
    const bloc = cadre("Équipement", corps);
    bloc.classList.add("gd-equipement");
    chargerEquipement().then((E) => {
      const e = E && E.persos && E.persos[adresseDe(p)];
      if (!e || !Array.isArray(e.pieces) || !e.pieces.length) {
        fill(corps, h("p", { class: "gd-eq-tete" }, "Pas encore relu : le site lit l'équipement des membres sur l'armurerie officielle, quelques-uns à chaque heure."));
        return;
      }
      const par = new Map(e.pieces.map((x) => [x.s, x]));
      const col = (L) => h("div", { class: "gd-eq-col" }, L.map((s) => caseEquipement(par.get(s), s, E.region)));
      const lu = e.lu ? quand(new Date(e.lu * 1000).toISOString()) : null;
      fill(corps,
        h("p", { class: "gd-eq-tete" }, e.ilvl != null ? ["Niveau d'objet moyen ", h("b", {}, String(e.ilvl))] : null, lu ? ` · relu sur l'armurerie ${lu}` : null),
        h("div", { class: "gd-eq-grille" }, col(EQ_GAUCHE), col(EQ_DROITE)),
        h("div", { class: "gd-eq-armes" }, EQ_ARMES.map((s) => caseEquipement(par.get(s), s, E.region))));
      infobulles();
    });
    return bloc;
  }

  function pageMembre(params) {
    const cle = params[0] || "";
    const t = trouverMembre(cle);
    const filMembres = (...etapes) => fil(h("a", { href: "#/membres" }, rubrique("membres").titre), ...etapes);
    if (!t) {
      setTitre("Membre introuvable");
      vue.append(filMembres(), cadre("Membre introuvable", h("div", { class: "gd-vide" }, h("p", {}, `Personne du nom de « ${cle} » dans la guilde.`),
        h("a", { class: "btn", href: "#/membres" }, "Voir les membres"))));
      return;
    }
    const { p, m, homonymes } = t;
    const qui = p || m;
    setTitre(qui.nom);
    const artisanat = m ? m.metiers.filter(avecRecettes) : [];
    const autres = m ? m.metiers.filter((x) => !artisanat.includes(x)) : [];
    const officielle = p ? adresseOfficielle(p.armurerie) : null;
    const fait = (titre, valeur) => (valeur != null && valeur !== "" ? h("div", { class: "gd-fait" }, h("dt", {}, titre), h("dd", {}, valeur)) : null);
    const vuLe = m ? quand(m.vu || m.maj) : null;
    vue.append(filMembres(h("span", {}, qui.nom)),
      h("section", { class: "frame gd-entete" },
        h("div", { class: "gd-tete-membre" }, h("h1", { class: classeCss(qui) }, qui.nom), p && p.surnom ? h("span", { class: "gd-tete-surnom" }, p.surnom) : null,
          p ? null : h("span", { class: "gd-membre-sous" }, [identite(m), vu(m)].filter(Boolean).join(" · "))),
        // D'après l'armurerie : classe, niveau, race, rang, niveau d'objet, et la fiche officielle
        p ? h("div", { class: "gd-profil" },
          h("dl", { class: "gd-faits" }, fait("Classe", h("span", { class: classeCss(p) }, nomClasse(p.classe))), fait("Niveau", p.niveau), fait("Race", p.race),
            fait("Rang", nomRang(p.rang)), fait("Niveau d'objet", p.ilvl), fait("Vu par l'addon", vuLe)),
          officielle ? lienOfficiel(officielle, p, "btn ghost gd-officielle-btn") : null) : null,
        homonymes.length ? h("p", { class: "gd-homonymes" }, homonymes.length > 1 ? "D'autres membres portent ce nom : " : "Un autre membre porte ce nom : ",
          homonymes.map((x, i) => [i ? ", " : null, h("a", { class: classeCss(x), href: lienMembre(x) }, x.surnom ? `${x.nom} ${x.surnom}` : x.nom)])) : null,
        autres.length ? h("div", { class: "gd-autres" }, h("span", {}, artisanat.length ? "Ses autres métiers :" : "Ses métiers :"), autres.map((x) => h("a", { class: "gd-autre", href: `#/metier/${encodeURIComponent(x.cle)}` },
          icone(iconeMetier(x.cle), "sm"), nomMetier(x.cle), h("i", {}, x.rang != null ? `${x.rang}/${x.max || "?"}` : "rang inconnu"),
          RECOLTE.has(x.cle) ? null : h("i", {}, "· recettes pas encore relevées")))) : null));
    // 20/11 : son équipement, lu sur l'armurerie officielle (un membre de l'armurerie seulement)
    if (p && p.armurerie) vue.append(blocEquipement(p));
    if (!m) {
      vue.append(h("p", { class: "gd-pas-partage" }, ERREUR === "lecture" || ERREUR === "fichier" ? "Les métiers de la guilde n'ont pas pu être lus pour l'instant."
        : ["Il ne partage pas encore ses métiers : ", h("a", { href: lienAddon(ADDON_METIERS) }, `l'addon ${nomAddonMetiers()} ›`)]));
      return;
    }
    if (!artisanat.length) {
      vue.append(h("p", { class: "muted center", style: { marginTop: "24px" } }, m.metiers.length
        ? `Aucune recette relevée pour l'instant : il suffit d'ouvrir une fois chacun de ses métiers en jeu, avec l'addon ${nomAddonMetiers()}.`
        : "Aucun métier relevé pour l'instant."));
      return;
    }
    vue.append(h("div", { class: "lv-page" }, fenetreMembre(m, artisanat, params[1], params[2])));
  }

  function fenetreMembre(m, artisanat, cleVoulue, idVoulu) {
    let x = artisanat.find((a) => a.cle === cleVoulue) || artisanat[0];
    let choisie = idVoulu && x.recettes.includes(String(idVoulu)) && D.recettes[String(idVoulu)] ? String(idVoulu) : null;
    let cherche = "";
    let premier = true;
    const replies = new Set();
    const fenetre = h("div", { class: "lv-fenetre" });
    const liste = h("div", { class: "lv-liste" });
    const droite = h("div", { class: "lv-droite" });
    const pied = h("div", { class: "lv-pied" });
    const champ = h("input", { type: "search", class: "lv-cherche", placeholder: "Recherche", "aria-label": "Chercher une recette", autocomplete: "off", spellcheck: "false",
      oninput: (e) => { cherche = e.target.value; const avant = choisie; dessinerListe(); if (choisie !== avant) { adresse(); dessinerDetail(); } } });
    const bouton = h("button", { type: "button", class: "lv-filtre" });
    const adresse = () => history.replaceState(null, "", lienMembre(m, x.cle, ...(choisie ? [choisie] : [])));

    // Les catégories de la fenêtre du jeu, avec seulement ce que le membre connaît (le reste en « Autres »)
    function groupes() {
      const sues = new Set(x.recettes), vues = new Set();
      const G = ((D.metiers[x.cle] || {}).categories || []).map((c) => ({ nom: c.nom || "Autres",
        ids: (c.recettes || []).map(String).filter((id) => sues.has(id) && D.recettes[id] && !vues.has(id) && vues.add(id)) })).filter((g) => g.ids.length);
      const reste = x.recettes.filter((id) => D.recettes[id] && !vues.has(id));
      if (reste.length) G.push({ nom: "Autres", ids: [...new Set(reste)] });
      return G;
    }
    // La couleur de difficulté, à la compétence du membre : orange, jaune, vert, gris
    const couleur = (r) => (!r.g || !r.j || x.rang == null ? "" : x.rang < r.j ? "orange" : x.rang < (r.j + r.g) / 2 ? "yellow" : x.rang < r.g ? "green" : "grey");

    function dessinerListe() {
      const G = groupes(), toutes = G.flatMap((g) => g.ids);
      const mots = plat(cherche).trim().split(" ").filter(Boolean);
      const garde = (id, g) => !mots.length || mots.every((w) => plat(D.recettes[id].n).includes(w) || plat(g.nom).includes(w));
      const visibles = G.map((g) => ({ ...g, ids: g.ids.filter((id) => garde(id, g)) })).filter((g) => g.ids.length);
      const montrees = visibles.flatMap((g) => g.ids);
      // La recette choisie reste tant qu'elle est montrée ; sinon la première montrée (une recherche sans résultat garde la dernière)
      if (!choisie || !montrees.includes(choisie)) choisie = montrees[0] || (toutes.includes(choisie) ? choisie : toutes[0]) || null;
      const defile = liste.scrollTop;
      const L = [];
      for (const g of visibles) {
        const fermee = replies.has(g.nom) && !mots.length;
        L.push(h("button", { type: "button", class: "lv-cat", "aria-expanded": String(!fermee),
          onclick: () => { if (replies.has(g.nom)) replies.delete(g.nom); else replies.add(g.nom); dessinerListe(); } },
          h("span", { class: "lv-cat-nom" }, g.nom), h("span", { class: "lv-plie", "aria-hidden": "true" })));
        if (fermee) continue;
        for (const id of g.ids) {
          const coul = couleur(D.recettes[id]);
          L.push(h("button", { type: "button", class: `lv-rec${coul ? ` qd-${coul}` : ""}${id === choisie ? " choisie" : ""}`, "aria-pressed": String(id === choisie),
            onclick: () => { choisie = id; adresse(); dessinerListe(); dessinerDetail(); if (ETROIT.matches) droite.scrollIntoView({ block: "nearest", behavior: "smooth" }); } },
            h("span", { class: "lv-rec-nom" }, D.recettes[id].n), pastille(id, m)));
        }
      }
      if (!visibles.length) L.push(h("p", { class: "lv-vide" }, "Aucune recette de ce nom."));
      fill(liste, L);
      liste.scrollTop = defile;
      const tout = G.length && G.every((g) => replies.has(g.nom));
      fill(bouton, tout ? "Tout déplier" : "Tout replier");
      bouton.onclick = () => { if (tout) replies.clear(); else for (const g of G) replies.add(g.nom); dessinerListe(); };
      const inconnues = x.recettes.filter((id) => !D.recettes[id]).length;
      const q = quand(m.maj);
      fill(pied, `${montrees.length} recette${montrees.length > 1 ? "s" : ""} montrée${montrees.length > 1 ? "s" : ""} sur les ${toutes.length} que ${m.nom} connaît`,
        inconnues ? ` (et ${inconnues} pas encore dans le carnet)` : null, q ? ` · relevées ${q}` : null);
    }
    function dessinerDetail() {
      fill(droite, choisie ? detailRecette(choisie, { membre: m, lienQui: true }) : h("div", { class: "lv-detail lv-vide" }, "Choisis une recette."));
      infobulles();
    }
    function dessiner() {
      fill(fenetre,
        // L'en-tête : le métier, sa barre de compétence (fine), puis un onglet par métier
        h("div", { class: "lv-entete" }, h("span", { class: "lv-portrait" }, icone(iconeMetier(x.cle), "lg")),
          h("div", { class: "lv-entete-txt" }, h("h2", { class: "lv-titre-nom" }, nomMetier(x.cle), spesDe(m, x.cle).length ? h("span", { class: "lv-titre-spe" }, spesDe(m, x.cle).join(" · ")) : null),
            x.rang != null ? h("div", { class: "lv-niveau" },
              h("span", { class: "lv-barre", role: "progressbar", "aria-label": `Compétence en ${nomMetier(x.cle)}`, "aria-valuemin": 0, "aria-valuemax": x.max || 300, "aria-valuenow": x.rang },
                h("span", { class: "lv-barre-plein", style: { width: `${Math.max(0, Math.min(100, (x.rang / (x.max || 300)) * 100))}%` } })),
              h("span", { class: "lv-barre-txt" }, h("b", {}, x.rang), ` / ${x.max || "?"}`)) : null),
          h("nav", { class: "lv-onglets", "aria-label": `Métiers de ${m.nom}` }, artisanat.map((a) => h("button", { type: "button", class: `lv-onglet${a === x ? " actif" : ""}`,
            "aria-pressed": String(a === x),
            onclick: () => { if (a === x) return; x = a; choisie = null; cherche = ""; champ.value = ""; replies.clear(); liste.scrollTop = 0; adresse(); dessiner(); } },
            icone(iconeMetier(a.cle), "sm"), h("span", { class: "lv-onglet-nom" }, nomMetier(a.cle)))))),
        h("div", { class: "lv-corps" }, h("div", { class: "lv-gauche" }, h("div", { class: "lv-outils" }, champ, bouton), liste), droite),
        pied);
      dessinerListe();
      dessinerDetail();
      if (premier) {
        premier = false;
        // La recette de l'adresse est amenée dans la liste, sans faire défiler la page
        requestAnimationFrame(() => {
          const el = liste.querySelector(".lv-rec.choisie");
          if (el && el.offsetTop > liste.clientHeight) liste.scrollTop = el.offsetTop - liste.clientHeight / 2;
        });
      }
    }
    dessiner();
    return fenetre;
  }

  // ---------------------------------------------------------------- Un métier
  function pageMetier(cle) {
    cle = String(cle || "");
    if (!listeMetiers().includes(cle)) {
      setTitre("Métier introuvable");
      vue.append(filMetiers(), cadre("Métier introuvable", h("div", { class: "gd-vide" }, h("p", {}, "Personne dans la guilde n'a ce métier pour l'instant."), h("a", { class: "btn", href: "#/metiers" }, "Tous les métiers"))));
      return;
    }
    setTitre(nomMetier(cle));
    const membres = IX.parMetier.get(cle) || [];
    const ids = idsDuMetier(cle);
    // Une recette n'apparaît que si au moins un membre la connaît
    const cats = ((D.metiers[cle] || {}).categories || []).map((c) => ({ nom: c.nom || "Autres",
      ids: [...new Set((c.recettes || []).map(String))].filter((id) => D.recettes[id] && (IX.quiSait.get(id) || []).length) })).filter((c) => c.ids.length);
    const replies = new Set();
    let filtre = "";
    const corps = h("div", {});
    function dessinerRecettes() {
      const mots = plat(filtre).trim().split(" ").filter(Boolean);
      const L = [];
      for (const c of cats) {
        const garde = c.ids.filter((id) => !mots.length || mots.every((w) => plat(D.recettes[id].n).includes(w) || plat(c.nom).includes(w)));
        if (!garde.length) continue;
        const fermee = replies.has(c.nom) && !mots.length;
        L.push(h("button", { type: "button", class: "lv-cat", "aria-expanded": String(!fermee), onclick: () => { if (replies.has(c.nom)) replies.delete(c.nom); else replies.add(c.nom); dessinerRecettes(); } },
          h("span", { class: "lv-cat-nom" }, c.nom), h("span", { class: "lv-cat-droite" }, h("span", { class: "gd-compte" }, garde.length), h("span", { class: "lv-plie", "aria-hidden": "true" }))));
        if (fermee) continue;
        // Chaque recette avec le nom de ceux qui l'ont (les patrons de tous les membres mis en commun)
        L.push(h("div", { class: "gd-cat-corps" }, garde.map((id) => {
          const r = D.recettes[id], qui = IX.quiSait.get(id) || [];
          return lienRecette(id, [icone(r.i, "sm", r.k === "spell" ? null : r.q),
            h("span", { class: "gd-res-txt" }, h("span", { class: "gd-res-ligne" }, h("span", { class: `gd-rec-nom q-${couleurNom(r)}` }, r.n), pastille(id)),
              r.s ? h("span", { class: "gd-res-sous" }, `compétence ${r.est ? "≈" : ""}${r.s}${r.cd ? ` · recharge ${dureeRecharge(r.cd)}` : ""}`) : null),
            h("span", { class: "gd-res-qui", title: qui.length > 4 ? qui.map((e) => e.m.nom).join(", ") : null }, nomsQui(qui, 4))], "gd-rec");
        })));
      }
      if (!L.length) L.push(h("p", { class: "lv-vide" }, "Aucune recette de ce nom."));
      fill(corps, L);
      infobulles();
    }
    const blocRecettes = cats.length
      ? cadre(`Les recettes de la guilde (${ids.length})`, h("div", { class: "gd-filtre" }, h("input", { type: "search", class: "lv-cherche", placeholder: "Filtrer les recettes",
        "aria-label": "Filtrer les recettes", autocomplete: "off", spellcheck: "false", oninput: (e) => { filtre = e.target.value; dessinerRecettes(); } })), corps)
      : cadre("Les recettes", h("p", { class: "muted center" }, RECOLTE.has(cle) ? "Un métier de récolte : pas de recettes, seulement le rang de chacun."
        : "Aucune recette relevée dans ce métier pour l'instant : il suffit d'ouvrir sa fenêtre de métier en jeu, avec l'addon."));
    if (cats.length) dessinerRecettes();
    const blocMembres = cadre(`Qui l'a (${membres.length})`, h("div", { class: "gd-membres" }, membres.map(({ m, x }) => {
      const n = x.recettes.filter((id) => D.recettes[id]).length;
      return h("a", { class: "gd-qui", href: avecRecettes(x) ? lienMembre(m, x.cle) : lienMembre(m) },
        h("span", { class: "gd-qui-id" }, h("span", { class: `gd-membre-nom ${classeCss(m)}` }, m.nom), h("span", { class: "gd-membre-sous" }, [identite(m), vu(m)].filter(Boolean).join(" · "))),
        pastilleSpe(m, cle), barreRang(x), n ? h("span", { class: "gd-nbrec" }, pl(n, "recette")) : null);
    })));
    blocMembres.classList.add("gd-metier-membres");
    vue.append(filMetiers(h("span", {}, nomMetier(cle))),
      h("section", { class: "frame gd-entete" }, h("div", { class: "gd-tete-metier" }, icone(iconeMetier(cle), "xl"),
        h("div", {}, h("h1", {}, nomMetier(cle)), h("p", {}, [pl(membres.length, "membre"), ids.length ? `${ids.length} recette${ids.length > 1 ? "s" : ""} connue${ids.length > 1 ? "s" : ""} dans la guilde` : null].filter(Boolean).join(" · "))))),
      h("div", { class: "gd-metier" }, blocRecettes, blocMembres));
  }

  // ---------------------------------------------------------------- L'addon
  const versionNum = (v) => String(v || "").split(/[^\d]+/).filter(Boolean).map(Number);
  function compareVersions(a, b) {
    const x = versionNum(a), y = versionNum(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
  }
  const filAddons = (...etapes) => fil(h("a", { href: "#/addons" }, rubrique("addons").titre), ...etapes);
  // Le téléchargement d'un addon : le bouton, la version et sa date, une ligne
  function blocTelecharger(A, texte) {
    const date = A.version && A.maj ? dateLongue(A.maj) : null;
    if (A.curseforge) {
      return cadre("Installer", h("div", { class: "gd-telecharger" },
        h("a", { class: "btn gd-gros-bouton", href: A.installer || A.curseforge, target: "_blank", rel: "noopener" }, icone(A.icone, "md"), A.installer ? "Installer avec l'appli CurseForge" : "Installer avec CurseForge"),
        A.version ? h("p", { class: "gd-version" }, "Version ", h("b", {}, A.version), date ? ` · ${date}` : null) : null,
        h("ol", { class: "gd-etapes-cf" },
          A.installer ? h("li", {}, "Clique sur le bouton : ton navigateur propose d'ouvrir l'appli CurseForge, qui installe l'addon dans WoW Forever.")
            : h("li", {}, "Ouvre la page de l'addon sur CurseForge et clique sur ", h("b", {}, "Installer"), " : l'appli CurseForge l'ajoute à ton jeu (WoW Forever)."),
          h("li", {}, "Les mises à jour arrivent ensuite d'elles-mêmes dans l'appli, comme pour tes autres addons.")),
        h("p", { class: "gd-texte muted" }, A.installer ? ["Pas encore l'appli ? La page qui s'ouvre propose de la télécharger. Ou passe par ", h("a", { href: A.curseforge, target: "_blank", rel: "noopener" }, "la page de l'addon"), " pour télécharger le zip. "] : null,
          "La page n'apparaît pas dans la recherche de CurseForge : seuls ceux qui ont ce lien la trouvent.", texte ? ` ${texte}` : null)));
    }
    return cadre("Télécharger", h("div", { class: "gd-telecharger" },
      A.fichier ? h("a", { class: "btn gd-gros-bouton", href: A.fichier, download: "" }, icone(A.icone, "md"), "Télécharger l'addon")
        : h("p", { class: "muted" }, "Pas encore de fichier à télécharger."),
      A.version ? h("p", { class: "gd-version" }, "Version ", h("b", {}, A.version), date ? ` · ${date}` : null) : null,
      texte ? h("p", { class: "gd-texte muted" }, texte) : null));
  }
  // Les nouveautés d'un addon en frise, la plus récente en tête
  function blocNouveautesAddon(A) {
    const L = [...A.nouveautes].sort((a, b) => (dateDe(b.date) || 0) - (dateDe(a.date) || 0) || compareVersions(b.version, a.version));
    return L.length ? cadre("Nouveautés", h("ul", { class: "gd-nouveautes" }, L.map((n) => h("li", {},
      h("div", { class: "gd-nv-tete" }, n.version ? h("b", {}, `Version ${n.version}`) : null, dateLongue(n.date) ? h("span", { class: "gd-nv-date" }, dateLongue(n.date)) : null),
      n.texte ? h("p", {}, Array.isArray(n.texte) ? n.texte.join(" ") : String(n.texte)) : null)))) : null;
  }
  // #/addons : les addons de site.json en cartes
  function pageAddons() {
    const titre = rubrique("addons").titre;
    setTitre(titre);
    vue.append(fil(h("span", {}, titre)), enteteRubrique("addons", rubrique("addons").desc));
    if (!CFG.addons.length) { vue.append(h("div", { class: "stack" }, cadre(null, h("p", { class: "muted center" }, "Aucun addon pour l'instant.")))); return; }
    vue.append(h("div", { class: "gd-addons" }, CFG.addons.map((a) => {
      const A = infoAddon(a.id);
      const date = A.version && A.maj ? dateLongue(A.maj) : null;
      return h("article", { class: "frame gd-addon" },
        h("div", { class: "gd-addon-tete" }, icone(A.icone, "lg"), h("div", { class: "gd-addon-txt" }, h("h2", {}, h("a", { href: lienAddon(A.id) }, A.nom)),
          A.version ? h("p", { class: "gd-version" }, "Version ", h("b", {}, A.version), date ? ` · ${date}` : null) : null)),
        A.desc ? h("p", { class: "gd-addon-desc" }, A.desc) : null,
        h("div", { class: "gd-addon-actions" }, A.curseforge ? h("a", { class: "btn", href: A.installer || A.curseforge, target: "_blank", rel: "noopener" }, A.installer ? "Installer avec l'appli CurseForge" : "Installer avec CurseForge")
          : A.fichier ? h("a", { class: "btn", href: A.fichier, download: "" }, "Télécharger") : null,
          h("a", { class: "btn ghost", href: lienAddon(A.id) }, "En savoir plus ›")));
    })));
  }
  // #/addons/<id> : la page propre de l'addon (PAGES_ADDONS), sinon la page générique d'après site.json
  function pageUnAddon(id) {
    const A = infoAddon(id);
    if (!A) { pageIntrouvable(filAddons()); return; }
    (Object.prototype.hasOwnProperty.call(PAGES_ADDONS, id) ? PAGES_ADDONS[id] : pageAddonGenerique)(A);
  }
  function pageAddonGenerique(A) {
    setTitre(A.nom);
    vue.append(filAddons(h("span", {}, A.nom)),
      h("div", { class: "gd-hero gd-hero-petit" }, h("h1", {}, A.nom), h("div", { class: "gd-separateur", "aria-hidden": "true" }), A.desc ? h("p", { class: "gd-hero-resume" }, A.desc) : null),
      h("div", { class: "stack" }, blocTelecharger(A), blocNouveautesAddon(A)));
  }
  // #/addons/metier-lbf : l'addon des métiers, en toute transparence (le fond de addon/LISEZMOI.txt)
  function pageAddonMetiers(A) {
    setTitre(A.nom);
    const point = (titre, ...contenu) => h("div", { class: "gd-point" }, h("h3", {}, titre), contenu);
    const doc = (href, texte) => h("a", { class: "btn ghost", href, target: "_blank", rel: "noopener" }, texte);
    vue.append(filAddons(h("span", {}, A.nom)),
      h("div", { class: "gd-hero gd-hero-petit" }, h("h1", {}, `L'addon ${A.nom}`), h("div", { class: "gd-separateur", "aria-hidden": "true" }),
        h("p", { class: "gd-hero-resume" }, "Il partage tes métiers avec la guilde : c'est lui qui remplit la rubrique Métiers du site.")),
      h("div", { class: "stack" },
        // D'abord ce qu'il fait, et seulement ça (le fond de addon/LISEZMOI.txt)
        cadre("En toute transparence",
          h("p", { class: "gd-pourquoi" }, h("b", {}, "Pourquoi ? "), "Pour savoir qui, dans la guilde, sait fabriquer quoi. Tu cherches un enchantement ou une pièce de couture : ce site te dit qui connaît la recette."),
          h("div", { class: "gd-transp" },
            h("div", { class: "gd-oui" }, h("h3", {}, "Ce qu'il partage, et seulement ça"),
              h("ul", {}, h("li", {}, "le nom de ton personnage ;"), h("li", {}, "sa classe ;"), h("li", {}, "tes métiers et leur niveau (« Enchantement 279/300 ») ;"), h("li", {}, "ta spécialisation de métier, si tu en as une (ingénieur gnome ou gobelin, fabricant d'armes ou d'armures…) ;"),
                h("li", {}, "les recettes que tu connais dans ces métiers ;"), h("li", {}, "les recharges de tes recettes (« prête dans 2 j ») ;"),
                h("li", {}, "et les fiches des autres membres qu'il a déjà reçues, les mêmes informations, pour que tout le monde arrive sur le site.")),
              h("p", { class: "muted small" }, "Ce que tes compagnons voient déjà quand tu leur montres ta fenêtre de métier : l'addon le rassemble au même endroit.")),
            h("div", { class: "gd-non" }, h("h3", {}, "Ce qu'il ne fait jamais"),
              h("ul", {}, h("li", {}, "Il ne lit ni tes sacs, ni ta banque, ni ton or."), h("li", {}, "Ni ta position, ni tes quêtes, ni tes discussions."),
                h("li", {}, "Ni le niveau de ton personnage, ni ton équipement (la rubrique Membres les prend sur l'armurerie officielle de Blizzard, qui est publique)."),
                h("li", {}, "Il n'envoie rien sur internet : il parle seulement aux addons des membres, par des messages d'addon cachés, sur le canal de la guilde ou d'un membre à l'autre, comme le font DBM ou Details."),
                h("li", {}, "Il ne touche à rien dans le jeu : il lit ta fenêtre de métier quand tu l'ouvres, sans rien y changer, et jamais en combat.")))),
          h("div", { class: "gd-points" },
            point("Comment les métiers sont mis à jour", h("p", {}, "Chaque exemplaire garde ce que les autres membres lui envoient, et le fait passer aux membres qu'il croise. Tes métiers arrivent ainsi sur le site tout seuls, petit à petit, au fil des connexions."),
              h("p", {}, "L'addon lit aussi la liste des membres de la guilde, sur place, sans l'envoyer : il oublie ainsi les fiches de ceux qui ont quitté la guilde.")),
            point("Apparaître tout de suite", h("p", {}, "Sans attendre : tape ", h("code", {}, "/lbf code"), " en jeu, copie le texte et colle-le dans ",
              CFG.service ? h("a", { href: "#/metiers/envoyer" }, "Métiers › Envoyer mes métiers") : "Métiers › Envoyer mes métiers", ". C'est toi qui le fais, quand tu veux : l'addon, lui, n'envoie toujours rien sur internet.")),
            point("Il ne ralentit pas le jeu", h("p", {}, "Rien en continu : une lecture quand tu ouvres une fenêtre de métier, et l'envoi de ta fiche à la connexion ou quand tu apprends une recette, en quelques petits messages espacés.")),
            point("Tu restes maître", h("p", {}, "Un bouton rond près de la mini-carte montre que l'addon tourne : au survol, ce qui est partagé et si le partage est actif ; clic droit pour le mettre en pause (l'icône devient grise)."), h("p", {}, h("code", {}, "/lbf pause"), " : plus rien ne part, et ta fiche s'efface chez les membres connectés. ", h("code", {}, "/lbf reprendre"), " relance le partage."),
              h("p", {}, "Pour que tes métiers disparaissent aussi du site, mets l'addon en pause, puis colle ton code de /lbf code dans Envoyer mes métiers (en pause, il efface ta fiche), ou demande à Tokxity : il l'efface sur demande. Personne n'est obligé de l'installer.")),
            point("Vérifier par toi-même", h("p", {}, A.curseforge ? "Le code est en clair dans le dossier de l'addon : tu peux l'ouvrir avec le Bloc-notes."
              : "Le code est en clair dans le zip : tu peux l'ouvrir avec le Bloc-notes."),
              h("div", { class: "gd-docs" }, doc("addon/LISEZMOI.txt", "Lire le LISEZMOI"))))),
        // Melvin (18/11) : « les gens savent installer un addon » ; reste la seule chose propre à celui-ci
        blocTelecharger(A, "Une fois installé, ouvre une fois chacun de tes métiers : c'est tout."),
        blocNouveautesAddon(A),
        cadre("Les commandes", h("dl", { class: "gd-commandes" },
          h("dt", {}, h("code", {}, "/lbf")), h("dd", {}, "Ce que l'addon partage, et combien de membres sont dans ton carnet."),
          h("dt", {}, h("code", {}, "/lbf qui <recette>")), h("dd", {}, "Qui sait faire cette recette, en jeu (par exemple : /lbf qui révélation). Marche aussi avec un objet lié : /lbf qui, puis Maj + clic sur l'objet."),
          h("dt", {}, h("code", {}, "/lbf envoyer")), h("dd", {}, "Renvoyer tes métiers maintenant."),
          h("dt", {}, h("code", {}, "/lbf code")), h("dd", {}, "Ton code à coller sur le site, rubrique Métiers › Envoyer mes métiers (aussi : Ctrl + clic sur le bouton)."),
          h("dt", {}, h("code", {}, "/lbf pause")), h("dd", {}, "Ne plus rien partager ; les addons des membres connectés effacent ta fiche."),
          h("dt", {}, h("code", {}, "/lbf reprendre")), h("dd", {}, "Relancer le partage."),
          h("dt", {}, h("code", {}, "/lbf bouton")), h("dd", {}, "Cacher ou remettre le bouton de la mini-carte.")))));
  }

  // Envoyer mes métiers : le code de /lbf code, collé ici, part au relais ; la fiche entre aussitôt dans le carnet affiché
  function lireCodeColle(brut) {
    const code = String(brut || "").replace(/\s+/g, "");
    if (!code) return null;
    const m = /^LBF1!([^!]+)!([0-9a-f]{16})$/.exec(code);
    if (!m) return { erreur: code.startsWith("LBF1!") ? "Il manque un morceau : copie tout le texte de la fenêtre." : "Ce n'est pas un code Métiers LBF." };
    if (m[1].startsWith("X;")) return { code, oubli: true, nom: m[1].slice(2) };
    const f = ficheDuCode(m[1]);
    return f && f.metiers.length ? { code, f } : { erreur: "Ce code est abîmé : refais /lbf code et copie tout le texte." };
  }
  function pageEnvoyer() {
    const titre = "Envoyer mes métiers";
    setTitre(titre);
    vue.append(filMetiers(h("span", {}, titre)),
      h("div", { class: "gd-hero gd-hero-petit" }, h("h1", {}, titre), h("div", { class: "gd-separateur", "aria-hidden": "true" }),
        h("p", { class: "gd-hero-resume" }, "Pour apparaître dans le carnet tout de suite, sans attendre que l'addon fasse passer ta fiche.")));
    if (!CFG.service) {
      vue.append(h("div", { class: "stack" }, cadre("Pas encore ouvert", h("div", { class: "gd-vide" },
        h("p", {}, `L'envoi par le site n'est pas encore en place. En attendant, l'addon ${nomAddonMetiers()} fait arriver tes métiers tout seul, au fil de tes connexions.`)))));
      return;
    }
    const champ = h("textarea", { class: "gd-code-champ", rows: 5, placeholder: "LBF1!…", spellcheck: "false", autocomplete: "off", autocapitalize: "off", "aria-label": "Ton code Métiers LBF" });
    const apercu = h("div", { class: "gd-code-apercu", "aria-live": "polite" });
    const bouton = h("button", { type: "button", class: "btn", disabled: true }, "Envoyer");
    const retour = h("div", { class: "gd-code-retour", role: "status", "aria-live": "polite" });
    let lu = null;
    const maj = () => {
      lu = lireCodeColle(champ.value);
      fill(retour);
      bouton.disabled = !lu || !!lu.erreur;
      bouton.textContent = lu && lu.oubli ? "Effacer ma fiche" : "Envoyer";
      if (!lu) { fill(apercu); return; }
      if (lu.erreur) { fill(apercu, h("p", { class: "gd-code-non" }, lu.erreur)); return; }
      if (lu.oubli) { fill(apercu, h("p", {}, "Ce code ", h("b", {}, "efface"), " la fiche de ", h("b", {}, lu.nom), " (ton addon est en pause).")); return; }
      const f = lu.f;
      fill(apercu, h("p", { class: "gd-code-qui" }, h("b", { class: classeCss(f) }, f.nom), ` · ${CLASSES[f.classe] || f.classe || "?"}`),
        h("ul", { class: "gd-code-metiers" }, f.metiers.map((x) => h("li", {}, icone(iconeMetier(x.cle), "xs"), h("span", {}, nomMetier(x.cle)),
          h("span", { class: "muted" }, `${x.rang == null ? "?" : x.rang}/${x.max || "?"}${x.recettes.length ? ` · ${pl(x.recettes.length, "recette")}` : ""}`)))));
    };
    champ.addEventListener("input", maj);
    bouton.addEventListener("click", async () => {
      if (!lu || lu.erreur) return;
      bouton.disabled = true;
      fill(retour, h("p", { class: "muted" }, "Envoi…"));
      let rep = null;
      try {
        // text/plain : une requête simple, sans aller-retour préalable du navigateur
        const r = await fetch(`${CFG.service}/envoyer`, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ code: lu.code }) });
        rep = await r.json().catch(() => null);
        if (!rep) rep = { ok: false, message: `Le relais a répondu ${r.status}.` };
      } catch (e) { rep = { ok: false, message: "Le relais ne répond pas : vérifie ta connexion et réessaie dans un instant." }; }
      bouton.disabled = false;
      if (!rep.ok) { fill(retour, h("p", { class: "gd-code-non" }, texte(rep.message) || "Refusé.")); return; }
      const doc = rep.oubli ? { oublis: { [rep.nom]: new Date().toISOString() } } : { fiches: { [rep.nom]: { f: rep.fiche, recu: rep.recu } } };
      try { if (await fusionnerService(doc)) { lier(); dessinerMenu("metiers", ["envoyer"]); } } catch (e) { /* le carnet affiché attend la prochaine visite */ }
      const m = !rep.oubli && D ? D.membres.find((x) => x.nom === rep.nom) : null;
      fill(retour, h("p", { class: "gd-code-oui" }, texte(rep.message) || "C'est fait."),
        m && m.cle ? h("a", { class: "btn ghost", href: lienMembre(m) }, "Voir ma fiche") : null);
      if (!rep.oubli) { champ.value = ""; lu = null; fill(apercu); bouton.disabled = true; }
    });
    const etape = (n, ...contenu) => h("li", {}, h("span", { class: "gd-code-n" }, n), h("div", {}, contenu));
    vue.append(h("div", { class: "stack" },
      cadre("En trois gestes",
        h("ol", { class: "gd-code-etapes" },
          etape("1", h("p", {}, "En jeu, tape ", h("code", {}, "/lbf code"), " (ou Ctrl + clic sur le bouton de l'addon, près de la mini-carte).")),
          etape("2", h("p", {}, "Le code est déjà sélectionné : copie-le avec ", h("kbd", {}, "Ctrl"), " + ", h("kbd", {}, "C"), ".")),
          etape("3", h("p", {}, "Colle-le ici, puis envoie."))),
        champ, apercu, h("div", { class: "gd-code-actions" }, bouton), retour),
      cadre("Ce qui part",
        h("p", { class: "gd-pourquoi" }, "Exactement ce que l'addon partage déjà avec la guilde : ton nom, ta classe, tes métiers et ta spécialisation, tes recettes et tes recharges. Rien d'autre."),
        h("p", { class: "muted small" }, "Le code porte aussi une petite clé tirée au hasard par ton addon et gardée seulement chez toi : elle prouve au site que c'est bien toi. Ton perso doit être dans la liste de la guilde (rubrique Membres). Addon en pause, le code efface ta fiche."),
        h("div", { class: "gd-docs" }, h("a", { class: "btn ghost", href: "service/worker.js", target: "_blank", rel: "noopener" }, "Lire le code du relais")))));
    if (SURVOL) setTimeout(() => { try { champ.focus({ preventScroll: true }); } catch (e) { champ.focus(); } }, 0);
  }

  function pageIntrouvable(filAriane) {
    setTitre("Page introuvable");
    ajouter(vue, [filAriane, cadre("Page introuvable", h("div", { class: "gd-vide" }, h("p", {}, "Cette adresse ne mène nulle part."), h("a", { class: "btn", href: "#/" }, "Retour à l'accueil")))]);
  }

  // ---------------------------------------------------------------- Les rubriques et les pages
  // Une rubrique de site.json n'apparaît (menu, tuiles de l'accueil) que si elle est ici. routes : la première est sa page principale ;
  // sous : l'élément de son panneau à allumer ; panneau : ses liens directs dans le menu ; compte : le chiffre de sa tuile.
  // Ses routes marchent même quand site.json ne la cite pas.
  const RUBRIQUES = {
    membres: {
      titre: "Membres", href: "#/membres",
      routes: { membres: (p, q) => pageMembres(q), membre: (p) => pageMembre(p) },
      compte: () => { const n = listeRoster().length; return n ? pl(n, "membre") : null; },
    },
    metiers: {
      titre: "Métiers", href: "#/metiers",
      routes: { metiers: (p, q) => (p[0] === "envoyer" ? pageEnvoyer() : p[0] === "emplacement" ? (D ? pageEmplacement(p[1]) : pageMetiers(""))
        : pageMetiers(q.get("q") || "", q.get("voir") === "nouveautes")), metier: (p) => (D ? pageMetier(p[0]) : pageMetiers("")), recette: (p) => (D ? pageRecette(p[0]) : pageMetiers("")) },
      compte: () => (D && IX.recherche.recettes.length ? pl(IX.recherche.recettes.length, "recette") : null),
      sous: (page, p) => (page === "metier" ? p[0] : page === "metiers" && p[0] === "envoyer" ? "envoyer" : null),
      panneau: (sous) => [...(D ? listeMetiers().map((cle) => {
        const n = (IX.parMetier.get(cle) || []).length;
        return lienPanneau(`#/metier/${encodeURIComponent(cle)}`, iconeMetier(cle), nomMetier(cle), h("span", { class: "gd-compte", title: pl(n, "membre") }, n), cle === sous);
      }) : [])].filter(Boolean),
    },
    addons: {
      titre: "Addons", href: "#/addons",
      routes: { addons: (p) => (p[0] ? pageUnAddon(p[0]) : pageAddons()) },
      compte: () => (CFG.addons.length ? pl(CFG.addons.length, "addon") : null),
      sous: (page, p) => p[0] || null,
      // Rempli par site.json > addons : un addon ajouté au fichier entre dans le menu de lui-même
      panneau: (sous) => CFG.addons.map((a) => {
        const A = infoAddon(a.id);
        return lienPanneau(lienAddon(a.id), A.icone, A.nom, A.version ? h("span", { class: "gd-panneau-note" }, A.version) : null, a.id === sous);
      }),
    },
  };
  // Les addons qui ont une page à eux ; les autres prennent la page générique (site.json : icône, nom, ligne, fichier)
  const PAGES_ADDONS = { [ADDON_METIERS]: pageAddonMetiers };
  const aSoi = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const defRubrique = (id) => (aSoi(RUBRIQUES, id) ? RUBRIQUES[id] : null);
  // Les rubriques de site.json dans leur ordre ; sans site.json lisible, toutes celles d'ici
  const rubriquesConnues = () => (CFG.rubriques.length ? CFG.rubriques : Object.keys(RUBRIQUES).map(rubrique)).filter((r) => defRubrique(r.id));

  // ---------------------------------------------------------------- Les données : site.json, membres.json, guilde.json
  const texte = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const nombre = (v) => (v === "" || v == null || typeof v === "boolean" || !Number.isFinite(Number(v)) ? null : Number(v));
  function lireSite(s) {
    const g = s && s.guilde && typeof s.guilde === "object" ? s.guilde : {};
    const vus = new Set();
    const bon = (x) => x && typeof x.id === "string" && /^[a-z0-9-]+$/.test(x.id) && !vus.has(x.id) && vus.add(x.id);
    CFG = {
      nom: texte(g.nom) || GUILDE_DEFAUT.nom, court: texte(g.court) || GUILDE_DEFAUT.court, accroche: texte(g.accroche),
      presentation: Array.isArray(g.presentation) ? g.presentation.map(texte).filter(Boolean) : texte(g.presentation) ? [texte(g.presentation)] : [],
      rubriques: (s && Array.isArray(s.rubriques) ? s.rubriques : []).filter((r) => texte(r && r.titre) && bon(r))
        .map((r) => ({ id: r.id, titre: texte(r.titre), icone: texte(r.icone), desc: texte(r.desc) })),
      addons: [],
      nouveautesMin: nombre(s && s.nouveautes && s.nouveautes.competenceMin) ?? 200,
      nouveautesForeverMin: nombre(s && s.nouveautes && s.nouveautes.foreverMin) ?? 100,
      // Le nom des rangs, écrit à la main dans site.json (l'armurerie de Blizzard ne le donne pas) : il passe devant tout le reste
      rangs: s && s.rangs && typeof s.rangs === "object" && !Array.isArray(s.rangs)
        ? Object.fromEntries(Object.entries(s.rangs).filter(([k, v]) => /^\d+$/.test(k) && texte(v)).map(([k, v]) => [k, texte(v)])) : {},
      service: typeof (s && s.service) === "string" && /^(https:\/\/[\w.-]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)(\/[\w.-]*)*$/.test(s.service.trim()) ? s.service.trim().replace(/\/+$/, "") : null,
    };
    vus.clear();
    CFG.addons = (s && Array.isArray(s.addons) ? s.addons : []).filter((a) => texte(a && a.nom) && bon(a))
      .map((a) => ({ ...a, nom: texte(a.nom), icone: texte(a.icone), desc: texte(a.desc) }))
      .sort((a, b) => (b.id === ADDON_METIERS) - (a.id === ADDON_METIERS));   // Métiers LBF d'abord
  }
  function lireMembres(d) {
    const M = (d && Array.isArray(d.membres) ? d.membres : []).filter((p) => p && texte(p.nom)).map((p) => ({
      nom: texte(p.nom), surnom: texte(p.surnom), niveau: nombre(p.niveau), classe: texte(p.classe), race: texte(p.race), rang: nombre(p.rang), ilvl: nombre(p.ilvl),
      armurerie: texte(p.armurerie) }));
    R = { membres: M, rangs: d && d.rangs && typeof d.rangs === "object" && !Array.isArray(d.rangs) ? d.rangs : {}, maj: d && d.maj };
  }
  // Une fiche au format de l'addon, telle que le relais la garde : « 1;nom;CLASSE;;maj;métiers;recharges;version » (nombres en base 36)
  const b36 = (s) => (/^[0-9a-z]{1,8}$/.test(s || "") ? parseInt(s, 36) : null);
  const isoDe = (t) => (t ? new Date(t * 1000).toISOString() : null);
  function ficheDuCode(f, recu) {
    const c = String(f || "").split(";");
    if (c.length < 8 || c[0] !== "1" || !texte(c[1])) return null;
    const metiers = [];
    for (const b of (c[5] || "").split("/")) {
      const x = /^([0-9a-z]+):(\d+):(\d+):([0-9a-z.]*)$/.exec(b);
      const cle = x && LIGNES[b36(x[1])];
      if (cle) metiers.push({ cle, rang: Number(x[2]) || null, max: Number(x[3]) || null, recettes: x[4].split(".").map(b36).filter(Boolean).map(String) });
    }
    const recharges = {};
    for (const v of (c[6] || "").split(",")) {
      const x = /^([0-9a-z]+):([0-9a-z]+)$/.exec(v);
      if (x && b36(x[1]) && b36(x[2]) * 1000 > Date.now()) recharges[String(b36(x[1]))] = isoDe(b36(x[2]));
    }
    const maj = isoDe(b36(c[4]));
    const spes = (c[3] || "").split(".").map(b36).filter(Boolean).map(String);
    return { nom: c[1], classe: (c[2] || "").toLowerCase() || null, spes, maj, vu: texte(recu) || maj, version: texte(c[7]), metiers, recharges };
  }
  // Les fiches du relais plus récentes que le carnet (guilde.json) passent devant ; une fiche effacée par son membre (code en pause) disparaît.
  // Une recette que guilde.json ne connaît pas encore vient du catalogue (toutes les recettes), lu seulement dans ce cas.
  async function fusionnerService(doc) {
    const brutes = doc && doc.fiches && typeof doc.fiches === "object" ? doc.fiches : {};
    const oublis = doc && doc.oublis && typeof doc.oublis === "object" ? doc.oublis : {};
    const roster = R && R.membres.length ? new Set(R.membres.map((p) => plat(p.nom))) : null;
    const base = D ? D.membres : [];
    const parNom = new Map(base.map((m) => [m.nom, m]));
    const neuves = [];
    for (const [nom, x] of Object.entries(brutes)) {
      const f = x && typeof x === "object" ? ficheDuCode(x.f, x.recu) : null;
      if (!f || f.nom !== nom || !f.metiers.length || (roster && !roster.has(plat(nom)))) continue;
      const a = parNom.get(nom);
      if (!a || (dateDe(f.maj) || 0) > (dateDe(a.maj) || 0)) neuves.push(f);
    }
    const oublies = new Set(Object.keys(oublis).filter((nom) => !neuves.some((f) => f.nom === nom) && parNom.has(nom)
      && (dateDe(parNom.get(nom).maj) || 0) <= (dateDe(oublis[nom]) || 0)));
    if (!neuves.length && !oublies.size) return false;
    // Une recette apprise ne s'oublie pas : la fiche du relais garde les recettes que le carnet connaissait dans les mêmes métiers
    for (const f of neuves) {
      const a = parNom.get(f.nom);
      for (const x of a ? f.metiers : []) {
        const avant = ((a.metiers || []).find((y) => y.cle === x.cle) || {}).recettes || [];
        const vues = new Set(x.recettes);
        x.recettes = [...x.recettes, ...avant.map(String).filter((id) => !vues.has(id))];
      }
    }
    const membres = base.filter((m) => !oublies.has(m.nom) && !neuves.some((f) => f.nom === m.nom)).concat(neuves);
    const recettes = { ...(D ? D.recettes : {}) }, composants = { ...(D ? D.composants : {}) }, metiers = { ...(D ? D.metiers : {}) };
    let cat = null;
    if (neuves.some((f) => f.metiers.some((x) => x.recettes.some((id) => !recettes[id])))) {
      try { cat = await lire(FICHIERS.catalogue); } catch (e) { /* sans catalogue, ces recettes attendent la prochaine publication */ }
      if (cat && cat.recettes && typeof cat.recettes === "object") {
        const sues = new Set(membres.flatMap((m) => (m.metiers || []).flatMap((x) => (x.recettes || []).map(String))));
        for (const id of sues) {
          if (recettes[id] || !cat.recettes[id]) continue;
          recettes[id] = cat.recettes[id];
          for (const [cid] of cat.recettes[id].co || []) if (!composants[cid] && cat.composants && cat.composants[cid]) composants[cid] = cat.composants[cid];
        }
        for (const [cle, mt] of Object.entries(cat.metiers || {})) {
          if (!mt || !membres.some((m) => (m.metiers || []).some((x) => x.cle === cle))) continue;
          const cats = (mt.categories || []).map((c) => ({ nom: c.nom, recettes: (c.recettes || []).filter((id) => sues.has(String(id))) })).filter((c) => c.recettes.length);
          if (cats.length) metiers[cle] = { ...mt, categories: cats };
        }
      }
    }
    for (const cle of Object.keys(metiers)) if (!membres.some((m) => (m.metiers || []).some((x) => x.cle === cle))) delete metiers[cle];
    const recu = neuves.map((f) => f.vu).filter(Boolean).sort().pop();
    const specialites = (D && Object.keys(D.specialites || {}).length ? D.specialites : null) || (cat && cat.specialites) || {};
    preparer({ ...(D || {}), maj: [D && D.maj, recu].filter(Boolean).sort().pop() || null, membres, recettes, composants, metiers, specialites, historique: D ? D.historique : [] });
    ERREUR = null;
    return true;
  }

  // Relie un membre de guilde.json à sa fiche de l'armurerie (même nom, même classe) et donne à chacun sa clé d'adresse :
  // le nom, ou nom-surnom quand plusieurs membres de l'armurerie portent le même nom
  function lier() {
    FICHES.clear();
    const prises = new Set();
    const unique = (base) => { let k = base, i = 2; while (prises.has(plat(k))) k = `${base}-${i++}`; prises.add(plat(k)); return k; };
    const roster = R ? R.membres : [];
    const parNom = new Map();
    for (const p of roster) pousser(parNom, plat(p.nom), p);
    for (const p of roster) {
      p.cle = unique(parNom.get(plat(p.nom)).length > 1 && p.surnom ? `${p.nom}-${p.surnom}` : p.nom);
      FICHES.set(p.cle, { p, m: null });
    }
    for (const m of D ? D.membres : []) {
      const L = (parNom.get(plat(m.nom)) || []).filter((p) => !p.partage && (!m.classe || !p.classe || p.classe === m.classe)
        && (!texte(m.surnom) || plat(p.surnom) === plat(m.surnom)));
      const p = L.length === 1 ? L[0] : null;
      if (p) { p.partage = m; m.perso = p; m.cle = p.cle; FICHES.get(p.cle).m = m; }
      else { m.cle = unique(m.nom); FICHES.set(m.cle, { p: null, m }); }
    }
  }

  // ---------------------------------------------------------------- Routeur
  const vue = document.getElementById("vue");
  function lireAdresse() {
    let brut = location.hash.replace(/^#\/?/, "");
    let q = new URLSearchParams();
    const i = brut.indexOf("?");
    if (i >= 0) { q = new URLSearchParams(brut.slice(i + 1)); brut = brut.slice(0, i); }
    const parts = brut.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch (e) { return s; } });
    return { parts, q };
  }
  // Une ancienne adresse : remplacée dans l'historique, sans laisser de pas en arrière
  function rediriger(hash) { history.replaceState(null, "", hash); router(); }
  function router() {
    const { parts, q } = lireAdresse();
    const [page = "", ...params] = parts;
    // Les anciennes adresses : la page de l'addon, et la recherche qui était sur l'accueil
    if (page === "addon") { rediriger(lienAddon(ADDON_METIERS)); return; }
    if (page === "" && (q.get("q") || "").trim()) { rediriger(`#/metiers?q=${encodeURIComponent(q.get("q").trim())}`); return; }
    fermerMenu();
    dessinerMenu(page, params);
    vue.textContent = "";
    const def = Object.values(RUBRIQUES).find((r) => aSoi(r.routes, page));
    if (page === "") pageAccueil();
    else if (def) def.routes[page](params, q);
    else pageIntrouvable();
    infobulles();
  }

  async function lire(url) {
    const rep = await fetch(url, { cache: "no-cache" });
    if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
    return rep.json();
  }
  async function demarrer() {
    vue.append(h("p", { class: "gd-chargement" }, "Ouverture des registres de la guilde…"));
    const panne = () => (location.protocol === "file:" ? "fichier" : "lecture");
    const pSite = lire(FICHIERS.site);
    // Le relais des codes, dès que site.json donne son adresse ; 4 s au plus, le site s'ouvre sans lui
    const pRelais = pSite.then((x) => { lireSite(x); return CFG.service ? Promise.race([lire(`${CFG.service}/fiches`), new Promise((ok) => setTimeout(() => ok(null), 4000))]) : null; });
    const [s, mb, mt, rl] = await Promise.allSettled([pSite, lire(FICHIERS.membres), lire(FICHIERS.metiers), pRelais]);
    lireSite(s.status === "fulfilled" ? s.value : null);
    try { if (mb.status === "fulfilled") lireMembres(mb.value); else ERREUR_R = panne(); } catch (e) { R = null; ERREUR_R = "lecture"; }
    // Les noms des rangs : site.json > rangs (l'armurerie de Blizzard ne les donne pas)
    if (R) R.rangs = { ...R.rangs, ...CFG.rangs };
    if (mt.status === "fulfilled") {
      const d = mt.value;
      ADDON = d && typeof d.addon === "object" ? d.addon : null;
      try {
        if (d && Array.isArray(d.membres) && d.membres.some((m) => m && m.nom)) preparer(d);
        else ERREUR = "vide";
      } catch (e) { D = null; ERREUR = "lecture"; }
    } else ERREUR = panne();
    // Sans site.json lisible, l'addon des métiers reste au menu (d'après data/guilde.json)
    if (s.status !== "fulfilled" && ADDON) CFG.addons = [{ id: ADDON_METIERS, nom: texte(ADDON.nom) || NOM_ADDON_METIERS }];
    if (rl.status === "fulfilled" && rl.value && ERREUR !== "lecture") { try { await fusionnerService(rl.value); } catch (e) { /* le carnet reste tel quel */ } }
    lier();
    router();
    window.addEventListener("hashchange", () => {
      router();
      window.scrollTo(0, 0);
      try { vue.focus({ preventScroll: true }); } catch (e) { /* ancien navigateur */ }
    });
  }

  // Le menu déroulant se ferme d'un clic ailleurs ou avec Échap (le focus revient sur sa flèche) ;
  // le lien d'évitement mène au contenu sans toucher à l'adresse
  document.addEventListener("click", (e) => { const d = document.querySelector(".gd-deroule.ouvert"); if (d && !d.contains(e.target)) fermerMenu(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const d = document.querySelector(".gd-deroule.ouvert");
    if (!d) return;
    const dedans = d.contains(document.activeElement);
    fermerMenu();
    if (dedans) { const b = d.querySelector(".gd-ouvrir"); if (b) b.focus(); }
  });
  const saut = document.querySelector(".gd-saut");
  if (saut) saut.addEventListener("click", (e) => { e.preventDefault(); vue.focus(); });

  demarrer();
})();
