/* Phone Scanner — dashboard front */
const $ = (id) => document.getElementById(id);

const state = {
  listId: null,          // liste sélectionnée (ou null = tout)
  q: "", platform: "all", condition: "all", sort: "recent",
  min: "", max: "", newOnly: false,
  sound: localStorage.getItem("ps_sound") === "1",
  meta: { models: [], conditions: [] },
  lists: [],
  lastNewCount: null,
  editingListId: null,
};

/* ---------- utilitaires ---------- */
const fmtEuro = (n) =>
  n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

function agoLabel(min) {
  if (min == null || Number.isNaN(min)) return "";
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
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

/* ---------- API ---------- */
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

/* ---------- stats ---------- */
async function loadStats() {
  const s = await api("/api/stats");
  $("stat-total").textContent = s.total.toLocaleString("fr-FR");
  $("stat-new").textContent = s.nouvelles.toLocaleString("fr-FR");
  $("stat-avg").textContent = s.prix_moyen != null ? fmtEuro(s.prix_moyen) : "—";
  $("live-badge").style.opacity = s.scanning ? 1 : 0.75;
  if (s.last_scan_at) {
    const d = new Date(s.last_scan_at);
    $("last-scan").textContent = `Dernier scan : ${d.toLocaleTimeString("fr-FR")}`;
  }
  if (state.lastNewCount != null && s.nouvelles > state.lastNewCount && state.sound) beep();
  state.lastNewCount = s.nouvelles;
}

/* ---------- listes ---------- */
async function loadLists() {
  const r = await api("/api/lists");
  state.lists = r.items;
  renderChips();
}

function renderChips() {
  const box = $("list-chips");
  box.innerHTML = "";
  const mk = (label, id) => {
    const el = document.createElement("button");
    el.className = "chip" + (state.listId === id ? " active" : "");
    el.textContent = label;
    el.onclick = () => {
      state.listId = id;
      renderChips();
      loadFeed();
    };
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

  // modèles avec prix max
  const sel = new Map((list?.models || []).map((m) => [m.id, m.max_price]));
  const box = $("le-models");
  box.innerHTML = "";
  for (const m of state.meta.models) {
    const row = document.createElement("label");
    row.className = "le-model-row";
    const checked = sel.has(m.id);
    row.innerHTML = `<input type="checkbox" data-id="${m.id}" ${checked ? "checked" : ""}>
      <span>${m.label}</span>
      <input type="number" min="0" placeholder="max €" value="${sel.get(m.id) ?? ""}" data-price="${m.id}">`;
    const cb = row.querySelector("input[type=checkbox]");
    const price = row.querySelector("input[type=number]");
    cb.onchange = () => { if (cb.checked && !price.value) price.focus(); };
    box.appendChild(row);
  }

  // états
  const conds = new Set(list?.conditions || []);
  const cbox = $("le-conditions");
  cbox.innerHTML = "";
  for (const c of state.meta.conditions) {
    const lab = document.createElement("label");
    lab.innerHTML = `<input type="checkbox" value="${c.id}" ${conds.has(c.id) ? "checked" : ""}> ${c.label}`;
    cbox.appendChild(lab);
  }

  // plateformes
  const plats = new Set(list?.platforms || ["vinted", "leboncoin"]);
  const pbox = $("le-platforms");
  pbox.innerHTML = "";
  for (const [id, label] of [["vinted", "Vinted"], ["leboncoin", "Leboncoin"]]) {
    const lab = document.createElement("label");
    lab.innerHTML = `<input type="checkbox" value="${id}" ${plats.has(id) ? "checked" : ""}> ${label}`;
    pbox.appendChild(lab);
  }
}

async function saveList() {
  const name = $("le-name").value.trim();
  if (!name) return alert("Donne un nom à la liste.");
  const models = [...$("le-models").querySelectorAll("input[type=checkbox]:checked")].map((cb) => {
    const priceInput = $(`le-models`).querySelector(`input[data-price="${cb.dataset.id}"]`);
    const max = parseFloat(priceInput.value);
    return { id: cb.dataset.id, max_price: Number.isNaN(max) ? null : max };
  });
  const conditions = [...$("le-conditions").querySelectorAll("input:checked")].map((i) => i.value);
  const platforms = [...$("le-platforms").querySelectorAll("input:checked")].map((i) => i.value);
  if (!models.length) return alert("Sélectionne au moins un modèle.");
  const body = { name, models, conditions, platforms: platforms.length ? platforms : ["vinted", "leboncoin"] };
  if (state.editingListId) {
    await api(`/api/lists/${state.editingListId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } else {
    const r = await api("/api/lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    state.listId = r.id;
  }
  $("list-editor").hidden = true;
  await loadLists();
  loadFeed();
}

async function deleteList() {
  if (!state.editingListId) return;
  if (!confirm("Supprimer cette liste ?")) return;
  await api(`/api/lists/${state.editingListId}`, { method: "DELETE" });
  state.listId = null;
  $("list-editor").hidden = true;
  await loadLists();
  loadFeed();
}

/* ---------- feed ---------- */
function feedQuery() {
  const p = new URLSearchParams();
  if (state.listId) p.set("list_id", state.listId);
  if (state.q) p.set("q", state.q);
  if (state.platform !== "all") p.set("platform", state.platform);
  if (state.condition !== "all") p.set("condition", state.condition);
  p.set("sort", state.sort);
  if (state.min) p.set("min", state.min);
  if (state.max) p.set("max", state.max);
  if (state.newOnly) p.set("new_only", "1");
  p.set("limit", "60");
  return p.toString();
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
        <span>${agoLabel(it.age_minutes)}${it.city ? " · " + escapeHTML(it.city) : ""}</span>
      </div>
    </div>
    <div class="card-actions"><a href="${escapeHTML(it.url)}" target="_blank" rel="noopener">Voir sur ${plat}</a></div>
  </article>`;
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadFeed() {
  try {
    const r = await api(`/api/listings?${feedQuery()}`);
    $("feed").innerHTML = r.items.map(cardHTML).join("");
    $("feed-count").textContent = `${r.items.length} annonce${r.items.length > 1 ? "s" : ""}`;
    $("empty").hidden = r.items.length > 0;
  } catch (e) {
    $("feed-errors").textContent = e.message;
  }
}

/* ---------- recherche live (Rafraîchir) ---------- */
async function liveRefresh() {
  const btn = $("btn-refresh");
  btn.disabled = true;
  btn.textContent = "Scan en cours…";
  try {
    // 1) on lance un scan des listes en arrière-plan + 2) recherche live pour les filtres courants
    const p = new URLSearchParams();
    p.set("q", state.q || "iphone");
    if (state.platform !== "all") p.set("platform", state.platform);
    if (state.min) p.set("min", state.min);
    if (state.max) p.set("max", state.max);
    if (state.condition !== "all") p.set("conditions", state.condition);
    const r = await api(`/api/search?${p.toString()}`);
    $("feed-errors").textContent = r.errors && r.errors.length ? r.errors.join(" · ") : "";
    // on affiche le résultat live si pertinent, sinon le feed DB
    if (r.items.length) {
      $("feed").innerHTML = r.items.map(cardHTML).join("");
      $("feed-count").textContent = `${r.items.length} annonce${r.items.length > 1 ? "s" : ""} (live)`;
      $("empty").hidden = r.items.length > 0;
    } else {
      await loadFeed();
    }
    await loadStats();
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
  const reload = () => loadFeed();
  $("f-q").addEventListener("input", (e) => { state.q = e.target.value.trim(); clearTimeout(t); t = setTimeout(reload, 350); });
  $("f-platform").onchange = (e) => { state.platform = e.target.value; reload(); };
  $("f-condition").onchange = (e) => { state.condition = e.target.value; reload(); };
  $("f-sort").onchange = (e) => { state.sort = e.target.value; reload(); };
  $("f-min").oninput = (e) => { state.min = e.target.value; clearTimeout(t); t = setTimeout(reload, 400); };
  $("f-max").oninput = (e) => { state.max = e.target.value; clearTimeout(t); t = setTimeout(reload, 400); };
  $("f-new-only").onchange = (e) => { state.newOnly = e.target.checked; reload(); };
  $("btn-reset").onclick = () => {
    state.q = ""; state.platform = "all"; state.condition = "all"; state.sort = "recent";
    state.min = ""; state.max = ""; state.newOnly = false;
    $("f-q").value = ""; $("f-platform").value = "all"; $("f-condition").value = "all";
    $("f-sort").value = "recent"; $("f-min").value = ""; $("f-max").value = ""; $("f-new-only").checked = false;
    reload();
  };
  $("btn-refresh").onclick = liveRefresh;
  $("btn-new-list").onclick = () => openListEditor(null);
  $("le-save").onclick = saveList;
  $("le-cancel").onclick = () => ($("list-editor").hidden = true);
  $("le-delete").onclick = deleteList;
  const sb = $("btn-sound");
  sb.textContent = state.sound ? "🔔" : "🔇";
  sb.classList.toggle("on", state.sound);
  sb.onclick = () => {
    state.sound = !state.sound;
    localStorage.setItem("ps_sound", state.sound ? "1" : "0");
    sb.textContent = state.sound ? "🔔" : "🔇";
    sb.classList.toggle("on", state.sound);
    if (state.sound) beep();
  };
}

async function init() {
  state.meta = await api("/api/meta");
  const condSel = $("f-condition");
  for (const c of state.meta.conditions) {
    const o = document.createElement("option");
    o.value = c.id; o.textContent = c.label;
    condSel.appendChild(o);
  }
  bindFilters();
  await loadLists();
  await loadFeed();
  await loadStats();
  // polling temps réel
  setInterval(async () => {
    await loadStats().catch(() => {});
    await loadFeed().catch(() => {});
  }, 15000);
}

init().catch((e) => {
  document.body.innerHTML = `<p style="padding:40px">Erreur d'initialisation : ${e.message}</p>`;
});
