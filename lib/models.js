// Catalogue des modèles iPhone suivis + détection depuis un titre d'annonce.
// Stratégie : tester les variantes les plus longues d'abord (pro max > pro > plus > mini > base).

const V = (num, variant) =>
  variant
    ? {
        id: `iphone-${num}-${variant}`,
        label: `iPhone ${num} ${variant.charAt(0).toUpperCase()}${variant.slice(1)}`,
        re: new RegExp(`iphone\\s*${num}\\s*${variant}\\b`, "i"),
      }
    : {
        id: `iphone-${num}`,
        label: `iPhone ${num}`,
        // base : pas suivi d'une variante
        re: new RegExp(`iphone\\s*${num}(?!\\s*(pro|plus|mini|air|e)\\b)`, "i"),
      };

function family(num) {
  return [
    V(num, "pro max"),
    V(num, "pro"),
    V(num, "plus"),
    V(num, "mini"),
    V(num, null),
  ];
}

export const MODELS = [
  ...family(11),
  ...family(12),
  ...family(13),
  ...family(14),
  ...family(15),
  ...family(16),
  { id: "iphone-16e", label: "iPhone 16e", re: /iphone\s*16e\b/i },
  ...family(17),
  { id: "iphone-air", label: "iPhone Air", re: /iphone\s*air\b/i },
];

// États normalisés (union des taxonomies Vinted / Leboncoin)
export const CONDITIONS = [
  { id: "new_with_tag", label: "Neuf", match: [/neuf avec étiquette/i, /état neuf/i, /^neuf$/i] },
  { id: "new_no_tag", label: "Neuf sans étiquette", match: [/neuf sans étiquette/i] },
  { id: "very_good", label: "Très bon état", match: [/très bon état/i] },
  { id: "good", label: "Bon état", match: [/bon état/i] },
  { id: "satisfactory", label: "Satisfaisant", match: [/satisfaisant/i] },
  { id: "for_parts", label: "Pour pièces / HS", match: [/pour pièces/i, /\bhs\b/i, /hors service/i, /défectueux/i] },
];

export function detectCondition(raw) {
  if (!raw) return null;
  for (const c of CONDITIONS) {
    if (c.match.some((re) => re.test(raw))) return c.id;
  }
  return null;
}

export function conditionLabel(id) {
  const c = CONDITIONS.find((x) => x.id === id);
  return c ? c.label : id || "";
}

// Détecte le modèle d'après un titre (et éventuellement la description).
export function detectModel(title, body = "") {
  const text = `${title} ${body}`;
  for (const m of MODELS) {
    if (m.re.test(text)) return m;
  }
  return null;
}

export function modelLabel(id) {
  const m = MODELS.find((x) => x.id === id);
  return m ? m.label : id;
}

// Accessoires : coques, chargeurs, films… qui mentionnent un modèle iPhone
// mais ne sont pas le téléphone.
const ACCESSORY_RE =
  /\b(coques?|capas?|housses?|étuis?|etuis?|cases?|covers?|fundas?|(?:handy)?h[üu]llen?|husa|protection|verres?(?:\s+tremp[ée]s?)?|films?(?:\s+de\s+protection)?|chargeurs?|c[âa]bles?|adaptateurs?|supports?|socles?|docks?|bumpers?|dragonnes?|lanyards?|stickers?|autocollants?|vitres?|dalles?|nappes?|outils?|coffrets?)\b/i;
// Accessoire en tête de titre : c'est le produit vendu
const ACCESSORY_HEAD_RE =
  /^\s*(lot\s+(de\s+)?\d*\s*)?(coques?|capas?|housses?|étuis?|etuis?|batteries?|écrans?|ecrans?|chargeurs?|c[âa]bles?|cables?|verres?|films?|protections?|carte\s+m[èe]re|nappe)\b/i;
// Téléphone vendu avec son accessoire : "iPhone 13 avec coque" = un téléphone
const WITH_ACCESSORY_RE =
  /\b(avec|with)\s+(?:une?\s+|a\s+|sa\s+|son\s+|its\s+)?(coque|case|étui|etui|housse|chargeur|c[âa]ble|cable|film|verre|protection|adaptateur)/i;

export function isAccessory(title) {
  if (!title) return false;
  if (WITH_ACCESSORY_RE.test(title)) return false;
  if (ACCESSORY_HEAD_RE.test(title)) return true;
  return ACCESSORY_RE.test(title);
}
