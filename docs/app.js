/* Phone Scanner — dashboard GitHub Pages (données = data/listings.json, listes = localStorage) */
const $ = (id) => document.getElementById(id);

const LS_LISTS = "ps_lists_v1";
const LS_SOUND = "ps_sound";

const state = {
  data: { stats: {}, listings: [], errors: [], last_scan_at: null },
  listId: null,
  q: "", platform: "all", condition: "all", sort: "recent",
  min: "", max: "", newOnly: false,
  sound: localStorage.getItem(LS_SOUND) === "1",
  lists: [],
  lastNewCount: null,
  editingListId: null,
};

const PLATFORMS = [
  { id: "vinted", label: "Vinted" },
  { id: "leboncoin", label: "Leboncoin" },
];

/* ---------- utilitaires ---------- */
const fmtEuro = (n) =>
  n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;

function agoLabel(min) {
  if (min == null || Number.isNaN(min)) return "";
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

function ageMinutes(item) {
  const d = item.published_at
    ? new Date(item.published_at.replace(" ", "T") + ":00")
    : new Date(item.first_seen_at);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((Date.now() - d.getTime()) / 60000);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.08;
    o.start();
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.stop(ctx.currentTime + 0.4);
  } catch { /* audio indisponible */ }
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- données ---------- */
async function loadData() {
  const r = await fetch(`data/listings.json?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`listings.json → HTTP ${r.status}`);
  state.data = await r.json();
  if (state.lastNewCount != null &&
      state.data.stats.nouvelles > state.lastNewCount && state.sound) beep();
  state.lastNewCount = state.data.stats.nouvelles;
}

function renderStats() {
  const s = state.data.stats || {};
  $("stat-total").textContent = (s.total ?? 0).toLocaleString("fr-FR");
  $("stat-new").textContent = (s.nouvelles ?? 0).toLocaleString("fr-FR");
  $("stat-avg").textContent = s.prix_moyen != null ? fmtEuro(s.prix_moyen) : "—";
  if (state.data.last_scan_at) {
    const d = new Date(state.data.last_scan_at);
    $("last-scan").textContent =
      `Dernier scan : ${d.toLocaleString("fr-FR")}` +
      (state.data.errors?.length ? ` · ⚠ ${state.data.errors.length} erreur(s)` : "");
  }
  $("feed-errors").textContent = state.data.errors?.length ? state.data.errors.join(" · ") : "";
}

/* ---------- listes (localStorage) ---------- */
function loadLists() {
  try { state.lists = JSON.parse(localStorage.getItem(LS_LISTS)) || []; }
  catch { state.lists = []; }
  if (!state.lists.length) {
    // première visite : liste de départ (même contenu que scanner.config.json)
    state.lists = [{
      id: 1,
      name: "premiers",
      models: [
        { id: "iphone-11", max_price: 60 },
        { id: "iphone-11-pro", max_price: 70 },
        { id: "iphone-11-pro-max", max_price: 70 },
        { id: "iphone-12", max_price: null },
        { id: "iphone-13", max_price: null },
        { id: "iphone-14", max_price: null },
      ],
      conditions: ["very_good", "good", "satisfactory"],
      platforms: ["vinted", "leboncoin"],
    }];
    saveLists();
  }
}

function saveLists() {
  localStorage.setItem(LS_LISTS, JSON.stringify(state.lists));
}

function currentList() {
  return state.lists.find((l) => l.id === state.listId) || null;
}

function renderChips() {
  const box = $("list-chips");
  box.innerHTML = "";
  const mk = (label, id) => {
    const el = document.createElement("button");
    el.className = "chip" + (state.listId === id ? " active" : "");
    el.textContent = label;
    el.onclick = () => { state.listId = id; renderChips(); renderFeed(); };
    return el;
  };
  box.appendChild(mk("Toutes les annonces", null));
  for (const l of state.lists) box.appendChild(mk(l.name, l.id));
}

function openListEditor(list) {
  state.editingListId = list ? list.id : null;
  $("list-editor").hidden = false;
  $("le-delete").hidden = !list;
  $("le-name").value = list ? list.name : "";

  const sel = new Map((list?.models || []).map((m) => [m.id, m.max_price]));
  const box = $("le-models");
  box.innerHTML = "";
  // modèles déduits des données disponibles (annonces réellement vues)
  const modelSet = new Map();
  for (const it of state.data.listings || []) {
    if (it.model_id && !modelSet.has(it.model_id)) modelSet.set(it.model_id, it.model_label);
  }
  const models = [...modelSet.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr", { numeric: true }));
  for (const [id, label] of models) {
    const row = document.createElement("label");
    row.className = "le-model-row";
    row.innerHTML = `<input type="checkbox" data-id="${id}" ${sel.has(id) ? "checked" : ""}>
      <span>${escapeHTML(label)}</span>
      <input type="number" min="0" placeholder="max €" value="${sel.get(id) ?? ""}" data-price="${id}">`;
    box.appendChild(row);
  }

  const conds = new Set(list?.conditions || []);
  const cbox = $("le-conditions");
  cbox.innerHTML = "";
  const condSet = new Map();
  for (const it of state.data.listings || []) {
    if (it.condition && !condSet.has(it.condition)) condSet.set(it.condition, it.condition_label);
  }
  for (const [id, label] of condSet) {
    const lab = document.createElement("label");
    lab.innerHTML = `<input type="checkbox" value="${id}" ${conds.has(id) ? "checked" : ""}> ${escapeHTML(label)}`;
    cbox.appendChild(lab);
  }

  const plats = new Set(list?.platforms || ["vinted", "leboncoin"]);
  const pbox = $("le-platforms");
  pbox.innerHTML = "";
  for (const p of PLATFORMS) {
    const lab = document.createElement("label");
    lab.innerHTML = `<input type="checkbox" value="${p.id}" ${plats.has(p.id) ? "checked" : ""}> ${p.label}`;
    pbox.appendChild(lab);
  }
}

function saveList() {
  const name = $("le-name").value.trim();
  if (!name) return alert("Donne un nom à la liste.");
  const models = [...$("le-models").querySelectorAll("input[type=checkbox]:checked")].map((cb) => {
    const priceInput = $("le-models").querySelector(`input[data-price="${cb.dataset.id}"]`);
    const max = parseFloat(priceInput.value);
    return { id: cb.dataset.id, max_price: Number.isNaN(max) ? null : max };
  });
  if (!models.length) return alert("Sélectionne au moins un modèle.");
  const conditions = [...$("le-conditions").querySelectorAll("input:checked")].map((i) => i.value);
  const platforms = [...$("le-platforms").querySelectorAll("input:checked")].map((i) => i.value);
  const body = { name, models, conditions, platforms: platforms.length ? platforms : PLATFORMS.map((p) => p.id) };
  if (state.editingListId) {
    const l = state.lists.find((x) => x.id === state.editingListId);
    Object.assign(l, body);
  } else {
    const id = state.lists.reduce((m, l) => Math.max(m, l.id), 0) + 1;
    state.lists.push({ id, ...body });
    state.listId = id;
  }
  saveLists();
  $("list-editor").hidden = true;
  renderChips();
  renderFeed();
}

function deleteList() {
  if (!state.editingListId) return;
  if (!confirm("Supprimer cette liste ?")) return;
  state.lists = state.lists.filter((l) => l.id !== state.editingListId);
  state.listId = null;
  saveLists();
  $("list-editor").hidden = true;
  renderChips();
  renderFeed();
}

/* ---------- feed ---------- */
function filteredItems() {
  const list = currentList();
  let items = state.data.listings || [];
  if (list) {
    const modelMap = new Map(list.models.map((m) => [m.id, m.max_price]));
    const condSet = new Set(list.conditions || []);
    const platSet = new Set(list.platforms || []);
    items = items.filter((it) => {
      if (!platSet.has(it.platform)) return false;
      if (it.model_id && modelMap.has(it.model_id)) {
        const cap = modelMap.get(it.model_id);
        if (cap != null && it.price != null && it.price > cap) return false;
      } else if (modelMap.size) {
        return false;
      }
      if (condSet.size && !condSet.has(it.condition)) return false;
      return true;
    });
  }
  if (state.q) {
    const q = state.q.toLowerCase();
    items = items.filter((it) => (it.title || "").toLowerCase().includes(q));
  }
  if (state.platform !== "all") items = items.filter((it) => it.platform === state.platform);
  if (state.condition !== "all") items = items.filter((it) => it.condition === state.condition);
  if (state.min) items = items.filter((it) => it.price != null && it.price >= parseFloat(state.min));
  if (state.max) items = items.filter((it) => it.price != null && it.price <= parseFloat(state.max));
  if (state.newOnly) items = items.filter((it) => it.is_new);
  if (state.sort === "price_asc") items.sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12));
  else if (state.sort === "price_desc") items.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  else items.sort((a, b) => (b.published_at || b.first_seen_at).localeCompare(a.published_at || a.first_seen_at));
  return items.slice(0, 120);
}

function cardHTML(it) {
  const plat = it.platform === "vinted" ? "Vinted" : "Leboncoin";
  const price = fmtEuro(it.price);
  const fees = it.price_fees != null ? ` <small>(${fmtEuro(it.price_fees)} frais inclus)</small>` : "";
  const cond = it.condition_label ? `<span class="cond-badge">${escapeHTML(it.condition_label)}</span>` : "";
  const img = it.image
    ? `<img src="${escapeHTML(it.image)}" loading="lazy" alt="" onerror="this.style.display='none'">`
    : "";
  return `<article class="card ${it.is_new ? "fresh" : ""}">
    <div class="card-thumb">${img}
      ${it.is_new ? '<span class="badge-new">NOUVEAU</span>' : ""}
      <span class="platform-tag ${it.platform}">${plat}</span>
    </div>
    <div class="card-body">
      <h3 class="card-title">${escapeHTML(it.title)}</h3>
      <div class="card-price">${price}${fees}</div>
      ${cond}
      ${it.description ? `<p class="card-desc">${escapeHTML(it.description)}</p>` : ""}
      <div class="card-meta">
        <span>${escapeHTML(it.seller || "")}</span>
        <span>${agoLabel(ageMinutes(it))}${it.city ? " · " + escapeHTML(it.city) : ""}</span>
      </div>
    </div>
    <div class="card-actions"><a href="${escapeHTML(it.url)}" target="_blank" rel="noopener">Voir sur ${plat}</a></div>
  </article>`;
}

function renderFeed() {
  const items = filteredItems();
  $("feed").innerHTML = items.map(cardHTML).join("");
  $("feed-count").textContent = `${items.length} annonce${items.length > 1 ? "s" : ""}`;
  $("empty").hidden = items.length > 0;
}

async function refresh() {
  const btn = $("btn-refresh");
  btn.disabled = true;
  btn.textContent = "Chargement…";
  try {
    await loadData();
    renderStats();
    renderFeed();
  } catch (e) {
    $("feed-errors").textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Rafraîchir";
  }
}

/* ---------- init ---------- */
function bindFilters() {
  let t = null;
  const reload = () => renderFeed();
  $("f-q").addEventListener("input", (e) => { state.q = e.target.value.trim(); clearTimeout(t); t = setTimeout(reload, 300); });
  $("f-platform").onchange = (e) => { state.platform = e.target.value; reload(); };
  $("f-condition").onchange = (e) => { state.condition = e.target.value; reload(); };
  $("f-sort").onchange = (e) => { state.sort = e.target.value; reload(); };
  $("f-min").oninput = (e) => { state.min = e.target.value; clearTimeout(t); t = setTimeout(reload, 350); };
  $("f-max").oninput = (e) => { state.max = e.target.value; clearTimeout(t); t = setTimeout(reload, 350); };
  $("f-new-only").onchange = (e) => { state.newOnly = e.target.checked; reload(); };
  $("btn-reset").onclick = () => {
    state.q = ""; state.platform = "all"; state.condition = "all"; state.sort = "recent";
    state.min = ""; state.max = ""; state.newOnly = false;
    $("f-q").value = ""; $("f-platform").value = "all"; $("f-condition").value = "all";
    $("f-sort").value = "recent"; $("f-min").value = ""; $("f-max").value = ""; $("f-new-only").checked = false;
    reload();
  };
  $("btn-refresh").onclick = refresh;
  $("btn-new-list").onclick = () => openListEditor(null);
  $("le-save").onclick = saveList;
  $("le-cancel").onclick = () => ($("list-editor").hidden = true);
  $("le-delete").onclick = deleteList;
  const sb = $("btn-sound");
  sb.textContent = state.sound ? "🔔" : "🔇";
  sb.classList.toggle("on", state.sound);
  sb.onclick = () => {
    state.sound = !state.sound;
    localStorage.setItem(LS_SOUND, state.sound ? "1" : "0");
    sb.textContent = state.sound ? "🔔" : "🔇";
    sb.classList.toggle("on", state.sound);
    if (state.sound) beep();
  };
}

async function init() {
  loadLists();
  bindFilters();
  // remplir le sélecteur d'états à partir des données
  await loadData();
  const condSel = $("f-condition");
  const condSet = new Map();
  for (const it of state.data.listings || []) {
    if (it.condition && !condSet.has(it.condition)) condSet.set(it.condition, it.condition_label);
  }
  for (const [id, label] of condSet) {
    const o = document.createElement("option");
    o.value = id; o.textContent = label;
    condSel.appendChild(o);
  }
  renderChips();
  renderStats();
  renderFeed();
  // rafraîchissement auto toutes les 60 s (nouveau JSON poussé par le scan)
  setInterval(() => { loadData().then(() => { renderStats(); renderFeed(); }).catch(() => {}); }, 60000);
}

init().catch((e) => {
  document.body.innerHTML = `<p style="padding:40px">Erreur : ${e.message}</p>`;
});
