/* Métier LBF : le site de la guilde La Bonne Franquette (World of Warcraft: Forever). « Qui sait faire quoi » dans la guilde.
   Les données (data/guilde.json) viennent de l'addon Métier LBF des membres : métiers, rangs, recettes connues, recharges.
   Site statique (GitHub Pages) : chemins relatifs, routage par hash, JavaScript sans bibliothèque.
     #/                          Accueil (#/?q=… garde la recherche)
     #/recette/<id>              une recette et qui sait la faire
     #/membre/<nom>[/<métier>[/<recette>]]   la fenêtre de métier d'un membre, comme en jeu
     #/metier/<clé>              un métier : ses recettes dans la guilde, ses membres
     #/addon                     l'addon : téléchargement, installation, mise à jour, nouveautés
   Tout ce qui vient des données passe par textContent (jamais innerHTML) : les noms des membres viennent du jeu. */
(() => {
  "use strict";

  const DONNEES = "data/guilde.json";
  const ZIP_DEFAUT = "MetierLBF.zip";
  const SITE = "Métier LBF";
  const GUILDE_DEFAUT = "La Bonne Franquette";
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
  const RECOLTE = new Set(["herbalism", "mining", "skinning", "fishing"]);
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

  let D = null;            // les données de la guilde, une fois lues
  let ADDON = null;        // le champ « addon » (même quand le carnet est vide)
  let ERREUR = null;       // "vide", "lecture" ou "fichier"
  const IX = {};           // les index bâtis à la lecture

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
  const lienMembre = (m, ...suite) => `#/membre/${[m.nom, ...suite].map((x) => encodeURIComponent(String(x))).join("/")}`;
  // Le niveau du perso n'est pas relevé par l'addon : la classe seule
  const identite = (m) => CLASSES[m.classe] || "";
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
      return { pret: false, reste: Number.MAX_SAFE_INTEGER, texte: r.cd ? `Recharge de ${dureeRecharge(r.cd)}` : "Recharge inconnue", titre: "Pas encore relevée par l'addon Métier LBF" };
    }
    const d = dateDe((m.recharges || {})[id]);
    const reste = d ? d.getTime() - Date.now() : 0;
    return reste > 0 ? { pret: false, reste, texte: `Prête dans ${duree(reste)}`, titre: `Prête ${quand(d.toISOString())}` }
      : { pret: true, reste: 0, texte: "Prête", titre: "D'après son dernier relevé" };
  }

  // ---------------------------------------------------------------- Les données
  function preparer(d) {
    D = d;
    D.metiers = d.metiers && typeof d.metiers === "object" ? d.metiers : {};
    D.recettes = d.recettes && typeof d.recettes === "object" ? d.recettes : {};
    D.composants = d.composants && typeof d.composants === "object" ? d.composants : {};
    D.membres = (Array.isArray(d.membres) ? d.membres : []).filter((m) => m && typeof m.nom === "string" && m.nom);
    IX.quiSait = new Map();       // recette -> [{ m, x }]
    IX.parMetier = new Map();     // métier -> [{ m, x }], meilleur rang d'abord
    IX.categorie = new Map();     // recette -> { cle, nom }
    IX.dansRecettes = new Map();  // composant -> [recettes]
    for (const m of D.membres) {
      m.metiers = (Array.isArray(m.metiers) ? m.metiers : []).filter((x) => x && typeof x.cle === "string");
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
    // L'historique (le plus récent en tête) : les recettes apparues depuis moins de 7 jours portent « nouveau »
    D.historique = (Array.isArray(d.historique) ? d.historique : []).filter((e) => e && typeof e.qui === "string" && (e.type === "arrivee" || e.type === "recette"));
    IX.nouvelles = new Set();      // recettes apparues dans la guilde depuis moins de 7 jours
    IX.nouvellesDe = new Set();    // « membre\nrecette » : ce qu'un membre a appris depuis moins de 7 jours
    for (const e of D.historique) {
      const d7 = dateDe(e.date);
      if (e.type !== "recette" || e.r == null || !d7 || Date.now() - d7.getTime() > 7 * 864e5) continue;
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
  const idsDuMetier = (cle) => [...new Set(((D.metiers[cle] || {}).categories || []).flatMap((c) => (c.recettes || []).map(String)))].filter((id) => D.recettes[id] && IX.quiSait.has(id));
  const avecRecettes = (x) => x.recettes.some((id) => D.recettes[id]);

  // ---------------------------------------------------------------- Morceaux communs
  function cadre(titre, ...contenu) {
    return h("section", { class: `frame${titre ? " titre" : ""}` }, titre ? h("h2", { class: "frame-title" }, titre) : null, contenu);
  }
  function setTitre(t) { document.title = t ? `${t} · ${SITE}` : `${SITE} — ${(D && D.guilde) || GUILDE_DEFAUT}`; }
  function fil(...etapes) {
    const L = [h("a", { href: "#/" }, "Accueil")];
    for (const e of etapes.filter(Boolean)) L.push(" › ", e);
    return h("nav", { class: "gd-fil", "aria-label": "Fil d'Ariane" }, L);
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
  // « nouveau » : une recette apparue dans l'historique depuis moins de 7 jours (sur la page d'un membre : apprise par lui)
  function pastille(id, membre) {
    const neuve = membre ? IX.nouvellesDe.has(`${membre.nom}\n${id}`) : IX.nouvelles.has(String(id));
    return neuve ? h("span", { class: "gd-neuf", title: membre ? "Apprise depuis moins de 7 jours" : "Apparue dans le carnet depuis moins de 7 jours" }, "nouveau") : null;
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
  function infoAddon() {
    const fichier = typeof (ADDON || {}).fichier === "string" && /^[\w.-]+(\/[\w.-]+)*\.zip$/i.test(ADDON.fichier) && !ADDON.fichier.includes("..") ? ADDON.fichier : ZIP_DEFAUT;
    return { nom: (ADDON && typeof ADDON.nom === "string" && ADDON.nom) || SITE, version: ADDON && ADDON.version ? String(ADDON.version) : null, fichier,
      maj: ADDON && ADDON.maj, nouveautes: ADDON && Array.isArray(ADDON.nouveautes) ? ADDON.nouveautes.filter((n) => n && (n.texte || n.version)) : [] };
  }

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
      stats.length ? h("ul", { class: "lv-stats" }, stats.map(([txt, cls]) => h("li", { class: cls }, txt))) : null,
      co.length ? [h("div", { class: "lv-or" }, "Composants :"), h("div", { class: "lv-comps" }, co.map(([cid, q]) => {
        const c = D.composants[String(cid)] || {};
        return h("div", { class: "lv-comp" }, h("span", { class: "lv-comp-ic" }, lienWh("item", cid, icone(c.i, "md")), q > 1 ? h("b", {}, q) : null),
          h("span", { class: "lv-comp-nom" }, lienWh("item", cid, c.n || `Objet ${cid}`)));
      }))] : null,
      h("div", { class: "lv-bas" }, paliers(r), r.cd ? h("span", { class: "lv-cd" }, `Recharge : ${dureeRecharge(r.cd)}`) : null,
        st ? h("span", { class: `gd-recharge${st.pret ? " pret" : ""}`, title: st.titre }, st.texte) : null),
      quiLigne);
  }

  // ---------------------------------------------------------------- Le menu du haut
  function dessinerMenu(page, cleMetier) {
    const metiers = D ? listeMetiers() : [];
    const lien = (href, texte, actif) => h("a", { class: `gd-lien${actif ? " actif" : ""}`, href, "aria-current": actif ? "page" : null }, texte);
    fill(document.getElementById("menu"), h("div", { class: "gd-menu-in" },
      h("a", { class: "gd-marque", href: "#/" }, h("img", { class: "gd-marque-logo", src: "img/wow-forever-logo.png", alt: "", width: 36, height: 29 }), h("span", { class: "gd-marque-txt" }, h("span", { class: "gd-marque-nom" }, SITE), h("span", { class: "gd-marque-sous" }, (D && D.guilde) || GUILDE_DEFAUT))),
      h("nav", { class: "gd-nav", "aria-label": "Menu" },
        lien("#/", "Accueil", page === ""),
        metiers.length ? h("details", { class: `gd-deroule${page === "metier" ? " actif" : ""}` },
          h("summary", { class: "gd-lien" }, "Métiers", h("span", { class: "gd-fleche", "aria-hidden": "true" }, "▾")),
          h("div", { class: "gd-panneau" }, metiers.map((cle) => h("a", { class: `gd-panneau-lien${cle === cleMetier ? " actif" : ""}`, href: `#/metier/${encodeURIComponent(cle)}`,
            onclick: fermerMenu }, icone(iconeMetier(cle), "sm"), h("span", {}, nomMetier(cle)), h("span", { class: "gd-compte", title: pl((IX.parMetier.get(cle) || []).length, "membre") },
            (IX.parMetier.get(cle) || []).length))))) : null,
        lien("#/addon", "L'addon", page === "addon"))));
  }
  function fermerMenu() { for (const d of document.querySelectorAll(".gd-deroule[open]")) d.removeAttribute("open"); }

  // ---------------------------------------------------------------- Accueil
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
      history.replaceState(null, "", q ? `#/?q=${encodeURIComponent(q)}` : "#/");
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
      champ, resultats);
  }
  function pageAccueil(q) {
    setTitre(null);
    const nRec = IX.recherche.recettes.length;
    const A = infoAddon();
    const resume = [pl(D.membres.length, "membre"), `${nRec} recette${nRec > 1 ? "s" : ""} connue${nRec > 1 ? "s" : ""}`, D.maj && quand(D.maj) ? `mis à jour ${quand(D.maj)}` : null].filter(Boolean).join(", ");
    const metiers = listeMetiers();
    const tries = [...D.membres].sort((a, b) => ((dateDe(b.vu || b.maj) || 0) - (dateDe(a.vu || a.maj) || 0)) || a.nom.localeCompare(b.nom, "fr"));
    const liste = h("div", { class: "gd-membres" });
    const montrer = (n) => fill(liste, tries.slice(0, n).map(ligneMembre),
      tries.length > n ? h("button", { type: "button", class: "gd-plus", onclick: () => montrer(tries.length) }, `Voir les ${tries.length} membres`) : null);
    montrer(8);
    vue.append(
      h("div", { class: "gd-hero" }, h("img", { class: "gd-logo", src: "img/wow-forever-logo.png", alt: "World of Warcraft: Forever", width: 360, height: 293 }), h("h1", {}, SITE), h("p", { class: "gd-hero-guilde" }, D.guilde || GUILDE_DEFAUT), h("div", { class: "rune-divider" }),
        h("p", { class: "gd-hero-resume" }, majuscule(resume)),
        h("a", { class: "gd-encart", href: "#/addon" }, icone("inv_misc_book_11", "sm"), h("b", {}, A.version ? `${A.nom} ${A.version}` : A.nom), h("span", {}, "· Télécharger"))),
      h("div", { class: "stack" },
        blocRecherche(q),
        metiers.length ? cadre("Les métiers de la guilde", h("div", { class: "gd-tuiles" }, metiers.map((cle) => {
          const L = IX.parMetier.get(cle) || [];
          const meilleur = L.find((e) => e.x.rang != null);
          const nR = idsDuMetier(cle).length;
          return h("a", { class: "gd-tuile", href: `#/metier/${encodeURIComponent(cle)}`, title: meilleur ? `Meilleur rang : ${meilleur.m.nom}` : null },
            icone(iconeMetier(cle), "lg"), h("span", { class: "gd-tuile-nom" }, nomMetier(cle)),
            h("span", { class: "gd-tuile-info" }, [pl(L.length, "membre"), nR ? pl(nR, "recette") : null].filter(Boolean).join(" · ")),
            meilleur ? h("span", { class: "gd-tuile-info" }, `meilleur rang ${meilleur.x.rang}${meilleur.x.max ? `/${meilleur.x.max}` : ""}`) : null);
        }))) : null,
        blocNouveautes(),
        cadre("Derniers membres vus", liste)));
  }
  // Les dernières nouveautés du carnet (historique, le plus récent en tête) : arrivées et recettes apprises ; caché s'il est vide
  function blocNouveautes() {
    const L = D.historique.slice(0, 10);
    if (!L.length) return null;
    const membre = (nom) => D.membres.find((m) => m.nom === nom);
    return cadre("Les dernières nouveautés", h("ul", { class: "gd-histo" }, L.map((e) => {
      const m = membre(e.qui);
      const qui = m ? h("a", { class: `gd-membre-nom ${classeCss(m)}`, href: lienMembre(m) }, e.qui) : h("b", {}, e.qui);
      const r = e.r != null ? D.recettes[String(e.r)] : null;
      const texte = e.type === "arrivee" ? [qui, " a rejoint le carnet"]
        : [qui, " sait faire ", r ? lienRecette(String(e.r), r.n, `q-${couleurNom(r)}`) : "une nouvelle recette", !r && e.m ? ` (${nomMetier(e.m)})` : null];
      return h("li", {}, h("span", { class: "gd-histo-date" }, majuscule((quandJour(e.date) || "").replace(/^le /, ""))), h("span", { class: "gd-histo-txt" }, texte),
        e.type === "recette" && e.neuf ? h("span", { class: "gd-badge-neuf" }, "Nouveau pour la guilde") : null);
    })));
  }

  // ---------------------------------------------------------------- Une recette
  function pageRecette(id) {
    id = String(id || "");
    const r = D.recettes[id];
    if (!r) {
      setTitre("Recette inconnue");
      vue.append(fil(), cadre("Recette inconnue", h("div", { class: "gd-vide" }, h("p", {}, "Personne dans la guilde ne connaît cette recette, ou elle n'est pas encore dans le carnet."),
        h("a", { class: "btn", href: "#/" }, "Chercher une recette"))));
      return;
    }
    setTitre(r.n);
    const cat = IX.categorie.get(id);
    const qui = [...(IX.quiSait.get(id) || [])];
    if (r.cd) qui.sort((a, b) => etatRecharge(a.m, id).reste - etatRecharge(b.m, id).reste || parRang(a, b));
    vue.append(
      fil(h("a", { href: `#/metier/${encodeURIComponent(r.m)}` }, nomMetier(r.m)), cat ? h("span", {}, cat.nom) : null),
      h("div", { class: "lv-fenetre lv-seule" },
        h("div", { class: "lv-titre" }, h("span", { class: "lv-portrait" }, icone(iconeMetier(r.m), "lg")),
          h("a", { class: "lv-titre-nom", href: `#/metier/${encodeURIComponent(r.m)}` }, cat ? `${nomMetier(r.m)} · ${cat.nom}` : nomMetier(r.m))),
        h("div", { class: "lv-corps" }, h("div", { class: "lv-droite" }, detailRecette(id, { titre: "h1" })))),
      h("div", { class: "stack", style: { marginTop: "34px" } }, cadre(qui.length ? `Qui sait la faire (${qui.length})` : "Qui sait la faire",
        qui.length ? h("div", { class: "gd-membres" }, qui.map(({ m, x }) => {
          const st = r.cd ? etatRecharge(m, id) : null;
          return h("a", { class: "gd-qui", href: lienMembre(m, x.cle, id) },
            h("span", { class: "gd-qui-id" }, h("span", { class: `gd-membre-nom ${classeCss(m)}` }, m.nom), h("span", { class: "gd-membre-sous" }, identite(m))),
            barreRang(x, `${nomMetier(x.cle)} : ${x.rang == null ? "?" : x.rang}/${x.max || "?"}`),
            st ? h("span", { class: `gd-recharge${st.pret ? " pret" : ""}`, title: st.titre }, st.texte) : null,
            h("span", { class: "gd-membre-vu" }, vu(m)));
        })) : h("p", { class: "muted center" }, "Plus personne ne la connaît dans le carnet."))));
  }

  // ---------------------------------------------------------------- Un membre : sa fenêtre de métier, comme en jeu
  function pageMembre(params) {
    const nom = params[0] || "";
    const m = D.membres.find((x) => x.nom === nom) || D.membres.find((x) => plat(x.nom) === plat(nom));
    if (!m) {
      setTitre("Membre introuvable");
      vue.append(fil(), cadre("Membre introuvable", h("div", { class: "gd-vide" }, h("p", {}, `Personne du nom de « ${nom} » dans le carnet de la guilde.`),
        h("a", { class: "btn", href: "#/" }, "Retour à l'accueil"))));
      return;
    }
    setTitre(m.nom);
    const artisanat = m.metiers.filter(avecRecettes);
    const autres = m.metiers.filter((x) => !artisanat.includes(x));
    vue.append(fil(h("span", {}, m.nom)),
      h("section", { class: "frame" },
        h("div", { class: "gd-tete-membre" }, h("h1", { class: classeCss(m) }, m.nom), h("span", { class: "gd-membre-sous" }, [identite(m), vu(m)].filter(Boolean).join(" · "))),
        autres.length ? h("div", { class: "gd-autres" }, h("span", {}, artisanat.length ? "Ses autres métiers :" : "Ses métiers :"), autres.map((x) => h("a", { class: "gd-autre", href: `#/metier/${encodeURIComponent(x.cle)}` },
          icone(iconeMetier(x.cle), "sm"), nomMetier(x.cle), h("i", {}, x.rang != null ? `${x.rang}/${x.max || "?"}` : "rang inconnu"),
          RECOLTE.has(x.cle) ? null : h("i", {}, "· recettes pas encore relevées")))) : null));
    if (!artisanat.length) {
      vue.append(h("p", { class: "muted center", style: { marginTop: "24px" } }, m.metiers.length
        ? "Aucune recette relevée pour l'instant : il suffit d'ouvrir une fois chaque fenêtre de métier en jeu, avec l'addon Métier LBF."
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
          h("span", { class: "lv-cat-nom" }, g.nom), h("span", { class: "lv-plie", "aria-hidden": "true" }, fermee ? "+" : "−")));
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
        h("div", { class: "lv-titre" }, h("span", { class: "lv-portrait" }, icone(iconeMetier(x.cle), "lg")), h("h2", { class: "lv-titre-nom" }, nomMetier(x.cle))),
        x.rang != null ? h("div", { class: "lv-barre" }, h("span", { class: "lv-barre-plein", style: { width: `${Math.max(0, Math.min(100, (x.rang / (x.max || 300)) * 100))}%` } }),
          h("span", { class: "lv-barre-txt" }, `${nomMetier(x.cle)} : ${x.rang}/${x.max || "?"}`)) : h("div", { class: "lv-sans-barre" }),
        h("div", { class: "lv-corps" }, h("div", { class: "lv-gauche" }, h("div", { class: "lv-outils" }, champ, bouton), liste), droite),
        pied,
        // Un onglet par métier, sur le bord droit, comme en jeu
        h("nav", { class: "lv-onglets", "aria-label": `Métiers de ${m.nom}` }, artisanat.map((a) => h("button", { type: "button", class: `lv-onglet${a === x ? " actif" : ""}`,
          "aria-pressed": String(a === x), "aria-label": nomMetier(a.cle), title: nomMetier(a.cle),
          onclick: () => { if (a === x) return; x = a; choisie = null; cherche = ""; champ.value = ""; replies.clear(); liste.scrollTop = 0; adresse(); dessiner(); } },
          icone(iconeMetier(a.cle), "lg")))));
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
      vue.append(fil(), cadre("Métier introuvable", h("div", { class: "gd-vide" }, h("p", {}, "Personne dans la guilde n'a ce métier pour l'instant."), h("a", { class: "btn", href: "#/" }, "Retour à l'accueil"))));
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
          h("span", { class: "lv-cat-nom" }, c.nom), h("span", { class: "lv-cat-droite" }, h("span", { class: "gd-compte" }, garde.length), h("span", { class: "lv-plie", "aria-hidden": "true" }, fermee ? "+" : "−"))));
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
        barreRang(x), n ? h("span", { class: "gd-nbrec" }, pl(n, "recette")) : null);
    })));
    blocMembres.classList.add("gd-metier-membres");
    vue.append(fil(h("span", {}, nomMetier(cle))),
      h("section", { class: "frame" }, h("div", { class: "gd-tete-metier" }, icone(iconeMetier(cle), "xl"),
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
  function pageAddon() {
    setTitre("L'addon");
    const A = infoAddon();
    const date = A.version && A.maj ? dateLongue(A.maj) : null;
    const nouveautes = [...A.nouveautes].sort((a, b) => (dateDe(b.date) || 0) - (dateDe(a.date) || 0) || compareVersions(b.version, a.version));
    const point = (titre, ...contenu) => h("div", { class: "gd-point" }, h("h3", {}, titre), contenu);
    const doc = (href, texte) => h("a", { class: "btn ghost", href, target: "_blank", rel: "noopener" }, texte);
    vue.append(
      h("div", { class: "gd-hero gd-hero-petit" }, h("h1", {}, `L'addon ${A.nom}`), h("div", { class: "rune-divider" }),
        h("p", { class: "gd-hero-resume" }, "Il partage tes métiers avec la guilde : c'est lui qui remplit ce site.")),
      h("div", { class: "stack" },
        // D'abord ce qu'il fait, et seulement ça (le fond de addon/LISEZMOI.txt)
        cadre("En toute transparence",
          h("p", { class: "gd-pourquoi" }, h("b", {}, "Pourquoi ? "), "Pour savoir qui, dans la guilde, sait fabriquer quoi. Tu cherches un enchantement ou une pièce de couture : ce site te dit qui connaît la recette."),
          h("div", { class: "gd-transp" },
            h("div", { class: "gd-oui" }, h("h3", {}, "Ce qu'il partage, et seulement ça"),
              h("ul", {}, h("li", {}, "le nom de ton personnage ;"), h("li", {}, "sa classe ;"), h("li", {}, "tes métiers et leur niveau (« Enchantement 279/300 ») ;"),
                h("li", {}, "les recettes que tu connais dans ces métiers ;"), h("li", {}, "les recharges de tes recettes (« prête dans 2 j »).")),
              h("p", { class: "muted small" }, "Ce que tes compagnons voient déjà quand tu leur montres ta fenêtre de métier : l'addon le rassemble au même endroit.")),
            h("div", { class: "gd-non" }, h("h3", {}, "Ce qu'il ne fait jamais"),
              h("ul", {}, h("li", {}, "Il ne lit ni tes sacs, ni ta banque, ni ton or."), h("li", {}, "Ni ta position, ni tes quêtes, ni tes discussions."),
                h("li", {}, "Ni le niveau de ton personnage, ni ton équipement."),
                h("li", {}, "Il n'envoie rien sur internet : il parle seulement aux addons des membres, par le canal caché de la guilde, comme le font DBM ou Details."),
                h("li", {}, "Il ne touche à rien dans le jeu : il lit ta fenêtre de métier quand tu l'ouvres, sans rien y changer, et jamais en combat.")))),
          h("div", { class: "gd-points" },
            point("Comment le site est mis à jour", h("p", {}, "Chaque exemplaire garde ce que les autres membres lui envoient. Celui d'un officier fait le relais : à sa déconnexion, il publie le carnet ici. Tu apparais donc sur le site après avoir été connecté en même temps que lui."),
              h("p", {}, "L'addon lit aussi la liste des membres de la guilde, sur place, sans l'envoyer : ceux qui partent disparaissent du site.")),
            point("Il ne ralentit pas le jeu", h("p", {}, "Rien en continu : une lecture quand tu ouvres une fenêtre de métier, et l'envoi de ta fiche à la connexion ou quand tu apprends une recette, en quelques petits messages espacés.")),
            point("Tu restes maître", h("p", {}, h("code", {}, "/lbf pause"), " : plus rien ne part, et ta fiche s'efface chez les autres. ", h("code", {}, "/lbf reprendre"), " relance le partage."),
              h("p", {}, "Pour disparaître aussi du site, mets l'addon en pause et préviens un officier. Personne n'est obligé de l'installer.")),
            point("Vérifier par toi-même", h("p", {}, "Le code est en clair : tu peux le lire ici, ou dans le zip avec le Bloc-notes."),
              h("div", { class: "gd-docs" }, doc("addon/LISEZMOI.txt", "Lire le LISEZMOI"), doc("addon/MetierLBF.lua.txt", "Lire le code de l'addon"))))),
        cadre("Télécharger", h("div", { class: "gd-telecharger" },
          h("a", { class: "btn gd-gros-bouton", href: A.fichier, download: "" }, icone("inv_misc_book_11", "md"), "Télécharger l'addon"),
          A.version ? h("p", { class: "gd-version" }, "Version ", h("b", {}, A.version), date ? ` · ${date}` : null) : null,
          // Melvin (18/11) : « les gens savent installer un addon » ; reste la seule chose propre à celui-ci
          h("p", { class: "gd-texte muted" }, "Une fois installé, ouvre une fois chacune de tes fenêtres de métier : c'est tout."))),
        nouveautes.length ? cadre("Nouveautés", h("ul", { class: "gd-nouveautes" }, nouveautes.map((n) => h("li", {},
          h("div", { class: "gd-nv-tete" }, n.version ? h("b", {}, `Version ${n.version}`) : null, dateLongue(n.date) ? h("span", { class: "gd-nv-date" }, dateLongue(n.date)) : null),
          n.texte ? h("p", {}, Array.isArray(n.texte) ? n.texte.join(" ") : String(n.texte)) : null)))) : null,
        cadre("Les commandes", h("dl", { class: "gd-commandes" },
          h("dt", {}, h("code", {}, "/lbf")), h("dd", {}, "Ce que l'addon partage, et combien de membres sont dans ton carnet."),
          h("dt", {}, h("code", {}, "/lbf qui <recette>")), h("dd", {}, "Qui sait faire cette recette, en jeu (par exemple : /lbf qui révélation)."),
          h("dt", {}, h("code", {}, "/lbf envoyer")), h("dd", {}, "Renvoyer tes métiers maintenant."),
          h("dt", {}, h("code", {}, "/lbf pause")), h("dd", {}, "Ne plus rien partager ; les addons des membres connectés effacent ta fiche."),
          h("dt", {}, h("code", {}, "/lbf reprendre")), h("dd", {}, "Relancer le partage.")))));
  }

  // ---------------------------------------------------------------- Pages sans données
  function pageVide() {
    setTitre(null);
    const texte = ERREUR === "fichier"
      ? "Le navigateur refuse de lire les données depuis un fichier de ton disque : ouvre le site par son adresse web."
      : ERREUR === "lecture"
        ? "Les données de la guilde n'ont pas pu être lues. Réessaie dans un instant."
        : "Aucun membre n'a encore partagé ses métiers. Installe l'addon Métier LBF et ouvre une fois chacune de tes fenêtres de métier en jeu : le carnet se remplira au prochain relais.";
    vue.append(h("div", { class: "gd-hero" }, h("img", { class: "gd-logo", src: "img/wow-forever-logo.png", alt: "World of Warcraft: Forever", width: 360, height: 293 }), h("h1", {}, SITE), h("p", { class: "gd-hero-guilde" }, GUILDE_DEFAUT), h("div", { class: "rune-divider" })),
      cadre("Le carnet est encore vide", h("div", { class: "gd-vide" }, h("p", {}, texte), h("a", { class: "btn", href: "#/addon" }, "Télécharger l'addon"))));
  }
  function pageIntrouvable() {
    setTitre("Page introuvable");
    vue.append(cadre("Page introuvable", h("div", { class: "gd-vide" }, h("p", {}, "Cette adresse ne mène nulle part."), h("a", { class: "btn", href: "#/" }, "Retour à l'accueil"))));
  }

  // ---------------------------------------------------------------- Routeur
  const vue = document.getElementById("vue");
  function lireAdresse() {
    let brut = location.hash.replace(/^#\/?/, "");
    let q = "";
    const i = brut.indexOf("?");
    if (i >= 0) { q = new URLSearchParams(brut.slice(i + 1)).get("q") || ""; brut = brut.slice(0, i); }
    const parts = brut.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch (e) { return s; } });
    return { parts, q };
  }
  function router() {
    const { parts, q } = lireAdresse();
    const [page = "", ...params] = parts;
    fermerMenu();
    dessinerMenu(page, page === "metier" ? params[0] : null);
    vue.textContent = "";
    if (page === "addon") pageAddon();
    else if (!D) pageVide();
    else if (page === "") pageAccueil(q);
    else if (page === "recette") pageRecette(params[0]);
    else if (page === "membre") pageMembre(params);
    else if (page === "metier") pageMetier(params[0]);
    else pageIntrouvable();
    infobulles();
  }

  async function demarrer() {
    vue.append(h("p", { class: "gd-chargement" }, "Lecture du carnet de la guilde…"));
    try {
      const rep = await fetch(DONNEES, { cache: "no-cache" });
      if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
      const d = await rep.json();
      ADDON = d && typeof d.addon === "object" ? d.addon : null;
      if (d && Array.isArray(d.membres) && d.membres.some((m) => m && m.nom)) preparer(d);
      else ERREUR = "vide";
    } catch (e) {
      ERREUR = location.protocol === "file:" ? "fichier" : "lecture";
    }
    router();
    window.addEventListener("hashchange", () => {
      router();
      window.scrollTo(0, 0);
      try { vue.focus({ preventScroll: true }); } catch (e) { /* ancien navigateur */ }
    });
  }

  // Le menu déroulant se ferme d'un clic ailleurs ou avec Échap ; le lien d'évitement mène au contenu sans toucher à l'adresse
  document.addEventListener("click", (e) => { const d = document.querySelector(".gd-deroule[open]"); if (d && !d.contains(e.target)) d.removeAttribute("open"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fermerMenu(); });
  const saut = document.querySelector(".gd-saut");
  if (saut) saut.addEventListener("click", (e) => { e.preventDefault(); vue.focus(); });

  demarrer();
})();
