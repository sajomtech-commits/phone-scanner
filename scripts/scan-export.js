// Scan headless pour GitHub Actions : interroge les plateformes selon scanner.config.json
// et fusionne les résultats dans docs/data/listings.json (consommé par le dashboard Pages).
// Zéro dépendance npm — tourne avec Node ≥ 22.5.
import fs from "node:fs";
import { searchVinted } from "../lib/vinted.js";
import { searchLeboncoin } from "../lib/leboncoin.js";
import { modelLabel, isAccessory, conditionLabel } from "../lib/models.js";

const CONFIG_PATH = "scanner.config.json";
const OUT_PATH = "docs/data/listings.json";
const MAX_KEEP = 400;          // on garde les 400 annonces les plus récentes
const NEW_WINDOW_H = 24;       // une annonce est "nouvelle" pendant 24 h après 1re apparition

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base) => base + Math.random() * base * 0.5;

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
fs.mkdirSync("docs/data", { recursive: true });

const previous = fs.existsSync(OUT_PATH)
  ? JSON.parse(fs.readFileSync(OUT_PATH, "utf8"))
  : { listings: [] };
const prevById = new Map((previous.listings || []).map((l) => [`${l.platform}|${l.external_id}`, l]));

const now = new Date().toISOString();
const errors = [];
let found = 0;

function decorate(item) {
  const prev = prevById.get(`${item.platform}|${item.external_id}`);
  if (prev) {
    return {
      ...item,
      first_seen_at: prev.first_seen_at,
      last_seen_at: now,
      times_seen: (prev.times_seen || 1) + 1,
    };
  }
  return { ...item, first_seen_at: now, last_seen_at: now, times_seen: 1 };
}

function matches(item) {
  if (isAccessory(item.title)) return false;
  if (config.conditions?.length && !config.conditions.includes(item.condition)) return false;
  const entry = config.models?.find((m) => m.id === item.model_id);
  if (config.models?.length && !entry) return false;
  if (entry?.max_price && item.price != null && item.price > entry.max_price) return false;
  return true;
}

const platforms = config.platforms?.length ? config.platforms : ["vinted", "leboncoin"];
const results = [];

for (const m of config.models || []) {
  const query = modelLabel(m.id);
  if (platforms.includes("vinted")) {
    const r = await searchVinted({ query, priceMax: m.max_price, perPage: 30 });
    if (r.error) errors.push(r.error);
    for (const it of r.items) {
      if (it.model_id && it.model_id !== m.id) continue;
      if (!matches(it)) continue;
      found++;
      results.push(decorate(it));
    }
    await sleep(jitter(700));
  }
  if (platforms.includes("leboncoin")) {
    const r = await searchLeboncoin({ query, priceMax: m.max_price });
    if (r.error) errors.push(r.error);
    for (const it of r.items) {
      if (it.model_id && it.model_id !== m.id) continue;
      if (!matches(it)) continue;
      found++;
      results.push(decorate(it));
    }
    await sleep(jitter(900));
  }
}

// fusion : les annonces déjà connues non revues ce cycle restent dans le fichier
// (elles vieilliront naturellement et sortiront par la limite MAX_KEEP)
const seenNow = new Set(results.map((i) => `${i.platform}|${i.external_id}`));
const merged = new Map();
for (const item of results) merged.set(`${item.platform}|${item.external_id}`, item);
for (const old of previous.listings || []) {
  const key = `${old.platform}|${old.external_id}`;
  if (!seenNow.has(key)) merged.set(key, { ...old, last_seen_at: old.last_seen_at, times_seen: old.times_seen || 1 });
}

const listings = [...merged.values()]
  // on ré-applique les filtres courants aux anciennes annonces : une annonce qui ne
  // correspond plus (accessoire, catégorie) disparaît au lieu de rester pour toujours
  .filter((l) => matches(l))
  .map((l) => ({
    ...l,
    is_new: (Date.now() - new Date(l.first_seen_at).getTime()) < NEW_WINDOW_H * 3600 * 1000,
    model_label: l.model_id ? modelLabel(l.model_id) : null,
    condition_label: l.condition ? conditionLabel(l.condition) : l.condition_raw,
  }))
  .sort((a, b) => (b.published_at || b.first_seen_at).localeCompare(a.published_at || a.first_seen_at))
  .slice(0, MAX_KEEP);

const prices = listings.map((l) => l.price).filter((p) => p != null);
const out = {
  generated_at: now,
  last_scan_at: now,
  errors,
  stats: {
    total: listings.length,
    nouvelles: listings.filter((l) => l.is_new).length,
    prix_moyen: prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : null,
  },
  listings,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(out));
console.log(
  `scan: ${found} vues, ${out.stats.total} en base, ${out.stats.nouvelles} nouvelles, ` +
  `${errors.length} erreur(s) ${errors.length ? "→ " + errors.join(" | ") : ""}`
);
if (out.stats.total === 0 && errors.length) process.exitCode = 1; // échec total → visible dans Actions
