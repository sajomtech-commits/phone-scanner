// Scraper Leboncoin — la recherche passe par la page SSR /recherche et le JSON
// embarqué dans <script id="__NEXT_DATA__">. L'API directe api.leboncoin.fr est
// protégée par DataDome : on usurpe l'empreinte TLS de Chrome avec curl-impersonate.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectModel, detectCondition } from "./models.js";

const run = promisify(execFile);

// Chemin du binaire curl_chrome131 (curl-impersonate). Configurable via env.
const CURL = process.env.LBC_CURL || "curl_chrome131";

let cookieFile = null;
let cookieAt = 0;
const COOKIE_TTL_MS = 45 * 60 * 1000;

function tmpCookieFile() {
  if (!cookieFile || Date.now() - cookieAt > COOKIE_TTL_MS) {
    cookieFile = `/tmp/lbc-session-${process.pid}.txt`;
    cookieAt = Date.now();
  }
  return cookieFile;
}

async function curl(url, { saveCookies = false, useCookies = true } = {}) {
  const cf = tmpCookieFile();
  const args = [
    "-s",
    "-L",
    "--max-time", "30",
    "-o", "-",
    "-w", "\n__HTTP_CODE__%{http_code}",
  ];
  if (saveCookies) args.push("-c", cf);
  if (useCookies) args.push("-b", cf);
  args.push(url);
  const { stdout } = await run(CURL, args, { maxBuffer: 20 * 1024 * 1024 });
  const MARK = "__HTTP_CODE__";
  const marker = stdout.lastIndexOf(MARK);
  const body = marker >= 0 ? stdout.slice(0, marker) : stdout;
  let code = marker >= 0 ? parseInt(stdout.slice(marker + MARK.length), 10) : 0;
  if (Number.isNaN(code)) {
    console.error("[leboncoin] code NaN — tail:", JSON.stringify(stdout.slice(-80)));
    code = 0;
  }
  return { body, code };
}

async function ensureSession() {
  try {
    await curl("https://www.leboncoin.fr/", { saveCookies: true, useCookies: false });
  } catch {
    /* la homepage seule n'est pas bloquante pour la recherche */
  }
}

function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function mapAd(ad) {
  const attrs = {};
  for (const a of ad.attributes || []) attrs[a.key] = a.value_label || a.value;
  const price = Array.isArray(ad.price) ? ad.price[0] : ad.price ?? null;
  const conditionRaw = attrs.condition || null;
  const title = ad.subject || "";
  return {
    platform: "leboncoin",
    external_id: String(ad.list_id),
    title,
    model_id: detectModel(title, attrs.phone_model || "")?.id ?? null,
    price,
    price_fees: null,
    currency: "EUR",
    condition: detectCondition(conditionRaw),
    condition_raw: conditionRaw,
    url: ad.url || `https://www.leboncoin.fr/ad/${ad.list_id}`,
    image: ad.images?.thumb_url || ad.images?.small_url || null,
    seller: ad.owner?.name || null,
    city: ad.location?.city_label || null,
    description: ad.body ? String(ad.body).slice(0, 500) : null,
    published_at: ad.first_publication_date || null, // "YYYY-MM-DD HH:MM:SS" (heure locale FR)
  };
}

// Retourne { items: [...], error?: string }
export async function searchLeboncoin({ query, priceMax, priceMin, page = 1 }) {
  const params = new URLSearchParams();
  params.set("text", query);
  if (page > 1) params.set("page", String(page));
  if (priceMin && priceMin > 0) params.set("price_min", String(priceMin));
  if (priceMax && priceMax > 0) params.set("price_max", String(priceMax));

  const url = `https://www.leboncoin.fr/recherche?${params.toString()}`;
  let { body, code } = await curl(url, { saveCookies: page === 1 });

  if (code === 403 || !extractNextData(body)) {
    // session froide ou challenge → on ré-établit la session et on retente
    await ensureSession();
    ({ body, code } = await curl(url, { saveCookies: true }));
  }
  if (code !== 200) return { items: [], error: `Leboncoin HTTP ${code}` };

  const data = extractNextData(body);
  if (!data) return { items: [], error: "Leboncoin: __NEXT_DATA__ introuvable (challenge DataDome ?)" };
  const ads = data?.props?.pageProps?.searchData?.ads;
  if (!Array.isArray(ads)) return { items: [], error: "Leboncoin: structure inattendue (coquille SSR)" };

  // Filtre catégorie : la recherche texte ramène aussi voitures, apparts…
  // On ne garde que les annonces de la catégorie téléphones.
  const PHONE_CATEGORY = /t[ée]l[ée]phones?|smartphones?|objets connect[ée]s/i;
  const keep = ads.filter((ad) => PHONE_CATEGORY.test(ad.category_name || ""));
  console.log(`[leboncoin] "${query}" → ${ads.length} brutes, ${keep.length} téléphones`);
  return { items: keep.map(mapAd) };
}
