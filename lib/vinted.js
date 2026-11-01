// Scraper Vinted — API catalogue officielle du front web (api.vinted.fr).
// Nécessite une session anonyme : on visite la homepage pour obtenir les cookies
// (anon_id + access_token_web) puis on interroge l'API avec ces cookies.
import { detectModel, detectCondition } from "./models.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HOME = "https://www.vinted.fr/";
const API = "https://api.vinted.fr/svc-catalogue/items";

let cookieHeader = null;
let cookieFetchedAt = 0;
const COOKIE_TTL_MS = 30 * 60 * 1000; // on rafraîchit la session toutes les 30 min

function parseSetCookies(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const jar = new Map();
  // conserver aussi les cookies déjà connus
  if (cookieHeader) {
    for (const kv of cookieHeader.split("; ")) {
      const [k, ...rest] = kv.split("=");
      if (k && rest.length) jar.set(k, rest.join("="));
    }
  }
  for (const c of raw) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function ensureSession(force = false) {
  if (cookieHeader && !force && Date.now() - cookieFetchedAt < COOKIE_TTL_MS) return;
  const res = await fetch(HOME, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "fr-FR,fr;q=0.9" },
    redirect: "follow",
  });
  parseSetCookies(res);
  cookieFetchedAt = Date.now();
  if (!cookieHeader) throw new Error("Vinted: impossible d'obtenir une session anonyme");
}

function buildParams({ query, priceMax, page = 1, perPage = 20 }) {
  const p = new URLSearchParams();
  p.set("search_text", query);
  p.set("order", "newest_first");
  p.set("page", String(page));
  p.set("per_page", String(perPage));
  if (priceMax && priceMax > 0) p.set("price_to", String(priceMax));
  return p.toString();
}

function mapItem(it) {
  const url = it.url?.startsWith("http") ? it.url : `https://www.vinted.fr${it.url || ""}`;
  const price = it.price?.amount != null ? parseFloat(it.price.amount) : null;
  const fees = it.total_item_price?.amount != null ? parseFloat(it.total_item_price.amount) : null;
  const conditionRaw = it.item_box?.second_line || null;
  const title = it.title || it.item_box?.first_line || "";
  return {
    platform: "vinted",
    external_id: String(it.id),
    title,
    model_id: detectModel(title)?.id ?? null,
    price,
    price_fees: fees,
    currency: it.price?.currency_code || "EUR",
    condition: detectCondition(conditionRaw),
    condition_raw: conditionRaw,
    url,
    image: it.photo?.full_size_url || it.photo?.url || null,
    seller: it.user?.login || null,
    city: it.user?.city || null,
    description: null, // non exposé par l'API de recherche
    published_at: null, // non exposé par l'API de recherche ; first_seen_at fait foi
  };
}

// Retourne { items: [...], error?: string }
export async function searchVinted({ query, priceMax, page = 1, perPage = 20 }) {
  await ensureSession();
  const qs = buildParams({ query, priceMax, page, perPage });
  const res = await fetch(`${API}?${qs}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "fr-FR,fr;q=0.9",
      Platform: "web",
      Referer: "https://www.vinted.fr/catalog",
      Cookie: cookieHeader,
    },
  });
  if (res.status === 403 || res.status === 404) {
    // session expirée → on la reconstruit et on retente une fois
    await ensureSession(true);
    const retry = await fetch(`${API}?${buildParams({ query, priceMax, page, perPage })}`, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "fr-FR,fr;q=0.9",
        Platform: "web",
        Referer: "https://www.vinted.fr/catalog",
        Cookie: cookieHeader,
      },
    });
    if (!retry.ok) return { items: [], error: `Vinted HTTP ${retry.status}` };
    const data = await retry.json();
    return { items: (data.items || []).map(mapItem) };
  }
  if (!res.ok) return { items: [], error: `Vinted HTTP ${res.status}` };
  const data = await res.json();
  return { items: (data.items || []).map(mapItem) };
}
