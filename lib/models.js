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
// mais ne sont pas le téléphone. On garde les téléphones vendus "avec" un accessoire.
const ACCESSORY_RE =
  /\b(coques?\b|housse|étuis?\b|etuis?\b|cases?\b|cover\b|fundas?\b|handyhülle|hülle|husa\b|protection\b|verre\s+trempé|film\s+de\s+protection|chargeur\b|câble\b|cable\b|adaptateur\b|support\b|batterie\s+externe|power\s?bank|cordon\b|lanyard\b|strap\b|stickers?\b)\b/i;
const WITH_ACCESSORY_RE = /\b(avec|with|inclus|sous)\b/i;

export function isAccessory(title) {
  if (!title) return false;
  return ACCESSORY_RE.test(title) && !WITH_ACCESSORY_RE.test(title);
}
