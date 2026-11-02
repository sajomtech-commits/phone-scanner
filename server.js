// Phone Scanner — serveur HTTP (zéro dépendance : node:http + node:sqlite).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db, { getSetting, setSetting } from "./lib/db.js";
import { startEngine, runScan, liveSearch } from "./lib/engine.js";
import { MODELS, CONDITIONS, modelLabel, conditionLabel, isAccessory } from "./lib/models.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = parseInt(process.env.PORT || "3210", 10);

// ---------- seed liste par défaut (au premier lancement) ----------
if (db.prepare("SELECT COUNT(*) AS n FROM lists").get().n === 0) {
  db.prepare("INSERT INTO lists (name, models, conditions, platforms) VALUES (?, ?, ?, ?)").run(
    "premiers",
    JSON.stringify([
      { id: "iphone-11", max_price: 60 },
      { id: "iphone-11-pro", max_price: 70 },
      { id: "iphone-11-pro-max", max_price: 70 },
      { id: "iphone-12", max_price: null },
      { id: "iphone-13", max_price: null },
      { id: "iphone-14", max_price: null },
    ]),
    JSON.stringify(["very_good", "good", "satisfactory"]),
    JSON.stringify(["vinted", "leboncoin"])
  );
}

// ---------- helpers ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("JSON invalide"));
      }
    });
    req.on("error", reject);
  });
}

// ---------- API ----------
let scanning = false;

async function handleApi(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === "/api/stats" && req.method === "GET") {
    const total = db.prepare("SELECT COUNT(*) AS n FROM listings").get().n;
    const nouvelles = db.prepare("SELECT COUNT(*) AS n FROM listings WHERE is_new = 1").get().n;
    const prixMoyen =
      db
        .prepare(
          "SELECT AVG(price) AS m FROM listings WHERE price IS NOT NULL AND first_seen_at > datetime('now', '-7 days')"
        )
        .get().m ?? null;
    sendJSON(res, 200, {
      total,
      nouvelles,
      prix_moyen: prixMoyen != null ? Math.round(prixMoyen * 100) / 100 : null,
      last_scan_at: getSetting("last_scan_at"),
      scanning,
    });
    return true;
  }

  if (p === "/api/listings" && req.method === "GET") {
    const where = [];
    const args = [];
    const listId = parseInt(q.get("list_id"), 10);
    if (listId) {
      const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(listId);
      if (list) {
        const models = JSON.parse(list.models || "[]");
        const conditions = JSON.parse(list.conditions || "[]");
        const platforms = JSON.parse(list.platforms || '["vinted","leboncoin"]');
        if (models.length) {
          where.push(`model_id IN (${models.map(() => "?").join(",")})`);
          args.push(...models.map((m) => m.id));
        }
        if (conditions.length) {
          where.push(`condition IN (${conditions.map(() => "?").join(",")})`);
          args.push(...conditions);
        }
        where.push(`platform IN (${platforms.map(() => "?").join(",")})`);
        args.push(...platforms);
        // plafonds de prix par modèle (appliqués en SQL par CASE)
        const caps = models.filter((m) => m.max_price);
        if (caps.length) {
          where.push(
            `NOT (${caps.map(() => "(model_id = ? AND price > ?)").join(" OR ")})`
          );
          for (const m of caps) args.push(m.id, m.max_price);
        }
      }
    }
    const model = q.get("model");
    if (model) {
      where.push("model_id = ?");
      args.push(model);
    }
    const platform = q.get("platform");
    if (platform && platform !== "all") {
      where.push("platform = ?");
      args.push(platform);
    }
    const condition = q.get("condition");
    if (condition && condition !== "all") {
      where.push("condition = ?");
      args.push(condition);
    }
    const min = parseFloat(q.get("min"));
    if (!Number.isNaN(min) && min > 0) {
      where.push("price >= ?");
      args.push(min);
    }
    const max = parseFloat(q.get("max"));
    if (!Number.isNaN(max) && max > 0) {
      where.push("price <= ?");
      args.push(max);
    }
    const search = q.get("q");
    if (search) {
      where.push("(title LIKE ? OR condition_raw LIKE ?)");
      args.push(`%${search}%`, `%${search}%`);
    }
    if (q.get("new_only") === "1") where.push("is_new = 1");
    const sort = q.get("sort") || "recent";
    const orderBy =
      sort === "price_asc"
        ? "price ASC"
        : sort === "price_desc"
          ? "price DESC"
          : "COALESCE(published_at, first_seen_at) DESC";
    const limit = Math.min(parseInt(q.get("limit") || "60", 10) || 60, 200);
    const sql = `SELECT * FROM listings ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${orderBy} LIMIT ?`;
    const rows = db.prepare(sql).all(...args, limit);
    sendJSON(res, 200, { items: rows.filter((r) => !isAccessory(r.title)).map(prettyListing) });
    return true;
  }

  if (p === "/api/scan" && req.method === "POST") {
    if (scanning) {
      sendJSON(res, 409, { error: "Un scan est déjà en cours" });
      return true;
    }
    const body = await readBody(req).catch(() => ({}));
    scanning = true;
    try {
      const result = await runScan({ listId: body.list_id ?? null });
      sendJSON(res, 200, result);
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    } finally {
      scanning = false;
    }
    return true;
  }

  if (p === "/api/search" && req.method === "GET") {
    const items = await liveSearch({
      query: q.get("q") || "iphone",
      platform: q.get("platform") || null,
      priceMin: parseFloat(q.get("min")) || null,
      priceMax: parseFloat(q.get("max")) || null,
      conditions: (q.get("conditions") || "").split(",").filter(Boolean),
      modelHint: q.get("model") || null,
    });
    sendJSON(res, 200, { items: items.items.map(prettyListing), errors: items.errors });
    return true;
  }

  if (p === "/api/lists" && req.method === "GET") {
    const rows = db.prepare("SELECT * FROM lists ORDER BY created_at ASC").all();
    sendJSON(res, 200, { items: rows.map(prettyList) });
    return true;
  }

  if (p === "/api/lists" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.name) return sendJSON(res, 400, { error: "name requis" });
    const r = db
      .prepare("INSERT INTO lists (name, models, conditions, platforms) VALUES (?, ?, ?, ?)")
      .run(
        body.name,
        JSON.stringify(body.models || []),
        JSON.stringify(body.conditions || []),
        JSON.stringify(body.platforms || ["vinted", "leboncoin"])
      );
    sendJSON(res, 201, { id: r.lastInsertRowid });
    return true;
  }

  const listMatch = p.match(/^\/api\/lists\/(\d+)$/);
  if (listMatch) {
    const id = parseInt(listMatch[1], 10);
    if (req.method === "PUT") {
      const body = await readBody(req);
      const cur = db.prepare("SELECT * FROM lists WHERE id = ?").get(id);
      if (!cur) return sendJSON(res, 404, { error: "liste inconnue" });
      db.prepare("UPDATE lists SET name = ?, models = ?, conditions = ?, platforms = ?, active = ? WHERE id = ?").run(
        body.name ?? cur.name,
        JSON.stringify(body.models ?? JSON.parse(cur.models)),
        JSON.stringify(body.conditions ?? JSON.parse(cur.conditions)),
        JSON.stringify(body.platforms ?? JSON.parse(cur.platforms)),
        body.active ?? cur.active,
        id
      );
      sendJSON(res, 200, { ok: true });
      return true;
    }
    if (req.method === "DELETE") {
      db.prepare("DELETE FROM lists WHERE id = ?").run(id);
      sendJSON(res, 200, { ok: true });
      return true;
    }
  }

  if (p === "/api/listings/mark-seen" && req.method === "POST") {
    db.prepare("UPDATE listings SET is_new = 0 WHERE is_new = 1").run();
    sendJSON(res, 200, { ok: true });
    return true;
  }

  if (p === "/api/meta" && req.method === "GET") {
    sendJSON(res, 200, {
      models: MODELS.map((m) => ({ id: m.id, label: m.label })),
      conditions: CONDITIONS.map((c) => ({ id: c.id, label: c.label })),
      scan_interval_seconds: parseInt(getSetting("scan_interval_seconds", "120"), 10),
    });
    return true;
  }

  if (p === "/api/settings" && req.method === "PUT") {
    const body = await readBody(req);
    if (body.scan_interval_seconds) setSetting("scan_interval_seconds", body.scan_interval_seconds);
    sendJSON(res, 200, { ok: true });
    return true;
  }

  sendJSON(res, 404, { error: "route inconnue" });
  return true;
}

function prettyListing(r) {
  return {
    ...r,
    is_new: !!r.is_new,
    model_label: r.model_id ? modelLabel(r.model_id) : null,
    condition_label: r.condition ? conditionLabel(r.condition) : r.condition_raw,
    age_minutes: r.published_at
      ? Math.round((Date.now() - new Date(r.published_at.replace(" ", "T") + ":00").getTime()) / 60000)
      : Math.round((Date.now() - new Date(r.first_seen_at).getTime()) / 60000),
  };
}

function prettyList(row) {
  return {
    ...row,
    models: JSON.parse(row.models || "[]"),
    conditions: JSON.parse(row.conditions || "[]"),
    platforms: JSON.parse(row.platforms || '["vinted","leboncoin"]'),
    active: !!row.active,
  };
}

// ---------- static ----------
function serveStatic(req, res, url) {
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      // fallback SPA
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, html) => {
        if (e2) {
          res.writeHead(404);
          return res.end("Not found");
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (e) {
    console.error("[server]", e);
    if (!res.headersSent) sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Phone Scanner sur http://localhost:${PORT}`);
  startEngine();
});
