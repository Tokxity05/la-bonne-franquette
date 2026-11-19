/* Métiers LBF · le relais des codes du site de La Bonne Franquette (un Worker Cloudflare, offre gratuite).
   Un membre tape /lbf code en jeu, copie le texte et le colle sur le site (Métiers › Envoyer mes métiers) : le site l'envoie ici.
     POST /envoyer   { "code": "LBF1!<fiche>!<clé>" }   vérifie le code et garde la fiche
     GET  /fiches    les fiches reçues : { maj, fiches: { nom: { f, recu } }, oublis: { nom: date } }
   Gardé : la fiche telle que l'addon la partage déjà sur le canal de la guilde (nom, classe, spécialisations, métiers, recettes, recharges, version)
   et l'empreinte de la clé du perso, jamais la clé. Ni adresse IP, ni cookie, ni rien d'autre.
   Réglages : un espace KV lié sous le nom FICHES ; la variable SITE si le site change d'adresse.
   Le robot des Membres (19/11) : GitHub saute la plupart des passages programmés de son robot (.github/workflows/membres.yml) ; un déclencheur
   horaire du Worker (Cron Trigger) le lance d'ici. Il faut le secret GH_JETON : un jeton GitHub limité au dépôt du site, permission Actions
   en lecture et écriture, rien d'autre ; GH_DEPOT si le dépôt change de nom. Sans secret, rien ne part. */

const SITE_DEFAUT = "https://tokxity05.github.io/la-bonne-franquette";
const DEPOT_DEFAUT = "Tokxity05/la-bonne-franquette";
const CLASSES = new Set(["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID"]);
const LIGNES = new Set([129, 164, 165, 171, 182, 185, 186, 197, 202, 333, 356, 393]);
const MAX_FICHE = 40000;
const ATTENTE = 60;

const plier = (s) => String(s || "").normalize("NFC").toLowerCase();
const nomValide = (n) => /^\p{L}{2,24}$/u.test(n);
const site = (env) => String(env.SITE || SITE_DEFAUT).replace(/\/+$/, "");

function cors(origine) {
  return { "Access-Control-Allow-Origin": origine, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400", Vary: "Origin" };
}
function origineDe(req, env) {
  const permise = new URL(site(env)).origin;
  const o = req.headers.get("Origin") || "";
  return o === permise || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : permise;
}
function json(corps, statut, origine, plus) {
  return new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origine), ...(plus || {}) } });
}

function lireCode(brut) {
  const code = String(brut || "").replace(/\s+/g, "");
  const m = /^LBF1!([^!]+)!([0-9a-f]{16})$/.exec(code);
  if (!m) return { erreur: "Ce n'est pas un code Métiers LBF. En jeu, tape /lbf code et copie tout le texte de la fenêtre." };
  const [, fiche, cle] = m;
  const abime = { erreur: "Ce code est abîmé, il manque peut-être un morceau : refais /lbf code et copie tout le texte." };
  if (fiche.length > MAX_FICHE) return { erreur: "Ce code est trop long." };
  if (fiche.startsWith("X;")) return nomValide(fiche.slice(2)) ? { oubli: true, nom: fiche.slice(2), cle } : abime;
  const c = fiche.split(";");
  if (c.length !== 8 || c[0] !== "1" || !nomValide(c[1]) || !CLASSES.has(c[2]) || !/^([0-9a-z]{1,6}(\.[0-9a-z]{1,6}){0,3})?$/.test(c[3]) || !/^[0-9a-z]{1,8}$/.test(c[4])) return abime;
  const metiers = c[5] ? c[5].split("/") : [];
  if (!metiers.length || metiers.length > 12) return abime;
  let recettes = 0;
  for (const b of metiers) {
    const x = /^([0-9a-z]{1,4}):(\d{1,3}):(\d{1,3}):((?:[0-9a-z]{1,6}(?:\.[0-9a-z]{1,6})*)?)$/.exec(b);
    if (!x || !LIGNES.has(parseInt(x[1], 36))) return abime;
    recettes += x[4] ? x[4].split(".").length : 0;
  }
  if (c[6] && !c[6].split(",").every((v) => /^[0-9a-z]{1,6}:[0-9a-z]{1,8}$/.test(v))) return abime;
  if (c[7] && !/^\d{1,3}(\.\d{1,3}){0,3}$/.test(c[7])) return abime;
  return { nom: c[1], cle, fiche, metiers: metiers.length, recettes };
}

async function empreinte(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// La liste de la guilde publiée par le site (relue sur l'armurerie officielle toutes les 6 heures)
async function membres(env) {
  const r = await fetch(`${site(env)}/data/membres.json`, { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!r.ok) throw new Error(`membres ${r.status}`);
  const d = await r.json();
  return new Set((d.membres || []).map((m) => plier(m.nom)));
}

const lireDoc = async (env) => {
  const d = (await env.FICHES.get("fiches", "json")) || {};
  return { maj: d.maj || null, fiches: d.fiches || {}, oublis: d.oublis || {} };
};

async function envoyer(req, env, origine) {
  const non = (message, statut) => json({ ok: false, message }, statut || 400, origine);
  const brut = await req.text();
  if (brut.length > MAX_FICHE + 2000) return non("Ce code est trop long.", 413);
  let corps;
  try { corps = JSON.parse(brut); } catch (e) { return non("Requête illisible."); }
  const c = lireCode(corps && corps.code);
  if (c.erreur) return non(c.erreur);
  const k = plier(c.nom);
  const e = await empreinte(c.cle);
  const connue = await env.FICHES.get(`cle:${k}`);
  if (connue && connue !== e) {
    return non(`Ce code ne vient pas du même jeu que le premier envoi de ${c.nom}. Si tu as réinstallé l'addon ou changé d'ordinateur, demande à un officier de remettre ta fiche à zéro.`, 403);
  }
  const doc = await lireDoc(env);
  const deja = Object.keys(doc.fiches).find((n) => plier(n) === k);
  const maintenant = new Date().toISOString();
  if (c.oubli) {
    if (!connue) return non("Rien à effacer : ce perso n'a jamais envoyé de code.", 404);
    if (deja) delete doc.fiches[deja];
    doc.oublis[c.nom] = maintenant;
    doc.maj = maintenant;
    await env.FICHES.put("fiches", JSON.stringify(doc));
    return json({ ok: true, oubli: true, nom: c.nom, message: `C'est fait : la fiche est effacée. ${c.nom} disparaîtra aussi du carnet des métiers à la prochaine publication.` }, 200, origine);
  }
  let guilde;
  try { guilde = await membres(env); } catch (err) {
    return non("La liste des membres de la guilde ne répond pas pour l'instant : réessaie dans quelques minutes.", 503);
  }
  if (!guilde.has(k)) return non(`${c.nom} n'est pas (encore) dans la liste de la guilde. Elle est relue sur l'armurerie officielle toutes les 6 heures : réessaie plus tard.`, 403);
  const ancien = deja ? doc.fiches[deja] : null;
  if (ancien && ancien.f === c.fiche) {
    return json({ ok: true, nom: c.nom, fiche: c.fiche, recu: ancien.recu, message: "Rien de neuf : le site a déjà cette fiche." }, 200, origine);
  }
  if (ancien && Date.now() - Date.parse(ancien.recu) < ATTENTE * 1000) return non("Un envoi vient d'arriver pour ce perso : attends une minute.", 429);
  if (!connue) await env.FICHES.put(`cle:${k}`, e);
  if (deja && deja !== c.nom) delete doc.fiches[deja];
  for (const n of Object.keys(doc.oublis)) if (plier(n) === k) delete doc.oublis[n];
  doc.fiches[c.nom] = { f: c.fiche, recu: maintenant };
  doc.maj = maintenant;
  await env.FICHES.put("fiches", JSON.stringify(doc));
  const pl = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
  return json({ ok: true, nom: c.nom, fiche: c.fiche, recu: maintenant, message: `Reçu : ${pl(c.metiers, "métier")}, ${pl(c.recettes, "recette")}.` }, 200, origine);
}

export default {
  async fetch(req, env) {
    const origine = origineDe(req, env);
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origine) });
    if (!env.FICHES) return json({ ok: false, message: "Relais mal réglé : l'espace KV FICHES n'est pas lié au Worker." }, 500, origine);
    if (pathname === "/fiches" && req.method === "GET") return json(await lireDoc(env), 200, origine, { "Cache-Control": "public, max-age=60" });
    if (pathname === "/envoyer" && req.method === "POST") {
      try { return await envoyer(req, env, origine); } catch (err) { return json({ ok: false, message: "Le relais a eu un souci : réessaie dans un instant." }, 500, origine); }
    }
    if (pathname === "/") {
      return new Response("Métiers LBF : le relais des codes du site de La Bonne Franquette.\n", { headers: { "Content-Type": "text/plain; charset=utf-8", ...cors(origine) } });
    }
    return json({ ok: false, message: "Adresse inconnue." }, 404, origine);
  },
  // Chaque heure (Cron Trigger du Worker) : lance le robot des Membres sur GitHub (relecture de l'armurerie), que GitHub oublie de lancer seul
  async scheduled(evenement, env, ctx) {
    if (!env.GH_JETON) return;
    const depot = String(env.GH_DEPOT || DEPOT_DEFAUT);
    ctx.waitUntil(fetch(`https://api.github.com/repos/${depot}/actions/workflows/membres.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GH_JETON}`, Accept: "application/vnd.github+json", "User-Agent": "lbf-relais",
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
    }));
  },
};
