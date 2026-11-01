// Moteur de scan : interroge les plateformes pour chaque liste active,
// dédoublonne en base, met à jour les compteurs et journalise les cycles.
import db, { getSetting, setSetting } from "./db.js";
import { searchVinted } from "./vinted.js";
import { searchLeboncoin } from "./leboncoin.js";
import { detectModel, modelLabel, isAccessory } from "./models.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base) => base + Math.random() * base * 0.5;

function nowISO() {
  return new Date().toISOString();
}

// Insère ou met à jour une annonce ; retourne true si elle est NOUVELLE.
function upsertListing(item) {
  const existing = db
    .prepare("SELECT id, price, price_fees, times_seen FROM listings WHERE platform = ? AND external_id = ?")
    .get(item.platform, item.external_id);
  if (existing) {
    db.prepare(
      `UPDATE listings SET last_seen_at = ?, times_seen = times_seen + 1,
         price = COALESCE(?, price), price_fees = COALESCE(?, price_fees),
         title = COALESCE(NULLIF(?, ''), title), image = COALESCE(?, image)
       WHERE id = ?`
    ).run(nowISO(), item.price, item.price_fees, item.title, item.image, existing.id);
    return false;
  }
  db.prepare(
    `INSERT INTO listings (platform, external_id, title, model_id, price, price_fees, currency,
       condition, condition_raw, url, image, seller, city, description, published_at, first_seen_at, last_seen_at, is_new)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    item.platform,
    item.external_id,
    item.title,
    item.model_id,
    item.price,
    item.price_fees,
    item.currency || "EUR",
    item.condition,
    item.condition_raw,
    item.url,
    item.image,
    item.seller,
    item.city,
    item.description,
    item.published_at,
    nowISO(),
    nowISO()
  );
  return true;
}

function matchesListFilters(item, list) {
  const conditions = JSON.parse(list.conditions || "[]");
  if (conditions.length && !conditions.includes(item.condition)) return false;
  const models = JSON.parse(list.models || "[]");
  if (models.length) {
    const entry = models.find((m) => m.id === item.model_id);
    if (!entry) return false;
    if (entry.max_price && item.price != null && item.price > entry.max_price) return false;
  }
  return true;
}

// Scanne une liste sur toutes ses plateformes. Retourne {found, new_count, errors[]}
export async function scanList(list) {
  const models = JSON.parse(list.models || "[]");
  const platforms = JSON.parse(list.platforms || '["vinted","leboncoin"]');
  let found = 0;
  let newCount = 0;
  const errors = [];

  for (const m of models.length ? models : [{ id: null, label: "iphone" }]) {
    const query = m.id ? modelLabel(m.id) : "iphone";
    if (platforms.includes("vinted")) {
      const r = await searchVinted({ query, priceMax: m.max_price });
      if (r.error) errors.push(r.error);
      for (const it of r.items) {
        if (isAccessory(it.title)) continue;
        if (it.model_id && m.id && it.model_id !== m.id) continue;
        if (!matchesListFilters(it, list)) continue;
        found++;
        if (upsertListing(it)) newCount++;
      }
      await sleep(jitter(700));
    }
    if (platforms.includes("leboncoin")) {
      const r = await searchLeboncoin({ query, priceMax: m.max_price });
      if (r.error) errors.push(r.error);
      for (const it of r.items) {
        if (isAccessory(it.title)) continue;
        if (!matchesListFilters(it, list)) continue;
        found++;
        if (upsertListing(it)) newCount++;
      }
      await sleep(jitter(900));
    }
  }
  return { found, new_count: newCount, errors };
}

export async function runScan({ listId = null } = {}) {
  const run = db
    .prepare("INSERT INTO scan_runs (started_at) VALUES (?)")
    .run(nowISO());
  const runId = run.lastInsertRowid;
  const lists = listId
    ? db.prepare("SELECT * FROM lists WHERE id = ? AND active = 1").all(listId)
    : db.prepare("SELECT * FROM lists WHERE active = 1").all();

  let queries = 0;
  let found = 0;
  let newTotal = 0;
  const errors = [];
  for (const list of lists) {
    try {
      const r = await scanList(list);
      queries += JSON.parse(list.models || "[]").length * 2;
      found += r.found;
      newTotal += r.new_count;
      errors.push(...r.errors);
    } catch (e) {
      errors.push(`Liste « ${list.name} » : ${e.message}`);
    }
  }
  db.prepare(
    "UPDATE scan_runs SET finished_at = ?, queries = ?, found = ?, new_count = ?, errors = ? WHERE id = ?"
  ).run(nowISO(), queries, found, newTotal, errors.length ? errors.join(" | ") : null, runId);
  setSetting("last_scan_at", nowISO());
  return { run_id: runId, found, new_count: newTotal, errors };
}

// Recherche live (sans liste) pour le panneau de recherche du dashboard.
export async function liveSearch({ query, platform, priceMin, priceMax, conditions, modelHint }) {
  const wanted = conditions && conditions.length ? new Set(conditions) : null;
  const items = [];
  const errors = [];

  const keep = (it) => {
    if (wanted && !(wanted.has(it.condition) || (!it.condition && wanted.has("unknown")))) return false;
    if (priceMin && it.price != null && it.price < priceMin) return false;
    if (priceMax && it.price != null && it.price > priceMax) return false;
    if (modelHint && it.model_id && it.model_id !== modelHint) return false;
    return true;
  };

  if (!platform || platform === "vinted") {
    const r = await searchVinted({ query, priceMax, perPage: 30 });
    if (r.error) errors.push(r.error);
    for (const it of r.items) if (keep(it)) items.push(it);
  }
  if (!platform || platform === "leboncoin") {
    const r = await searchLeboncoin({ query, priceMin, priceMax });
    if (r.error) errors.push(r.error);
    for (const it of r.items) if (keep(it)) items.push(it);
  }
  // tri : plus récentes d'abord (date de publication si dispo, sinon plateformes dans l'ordre)
  items.sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));
  return { items, errors };
}

// Boucle de fond
let timer = null;
export function startEngine() {
  const intervalSec = parseInt(getSetting("scan_interval_seconds", process.env.SCAN_INTERVAL_SECONDS || "120"), 10);
  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    try {
      await runScan();
    } catch (e) {
      console.error("[engine] scan error:", e.message);
    }
  }, Math.max(30, intervalSec) * 1000);
  // premier scan rapide au démarrage (asynchrone, ne bloque pas le serveur)
  setTimeout(() => runScan().catch((e) => console.error("[engine] initial scan:", e.message)), 2000);
  console.log(`[engine] scan toutes les ${intervalSec}s`);
  return timer;
}
