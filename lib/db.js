// Base de données SQLite (node:sqlite, zéro dépendance).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "phone-scanner.db"));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform      TEXT NOT NULL,             -- 'vinted' | 'leboncoin'
  external_id   TEXT NOT NULL,
  title         TEXT NOT NULL,
  model_id      TEXT,
  price         REAL,
  price_fees    REAL,                      -- prix frais inclus (Vinted)
  currency      TEXT DEFAULT 'EUR',
  condition     TEXT,                      -- id normalisé
  condition_raw TEXT,
  url           TEXT NOT NULL,
  image         TEXT,
  seller        TEXT,
  city          TEXT,
  description   TEXT,
  published_at  TEXT,                      -- date de publication annonce (si connue)
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  times_seen    INTEGER DEFAULT 1,
  is_new        INTEGER DEFAULT 1,         -- 1 tant que pas marqué vu
  UNIQUE(platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_listings_seen   ON listings(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_model  ON listings(model_id);
CREATE INDEX IF NOT EXISTS idx_listings_plat   ON listings(platform);

CREATE TABLE IF NOT EXISTS lists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  models     TEXT NOT NULL DEFAULT '[]',        -- JSON [{id, max_price}]
  conditions TEXT NOT NULL DEFAULT '[]',        -- JSON [condition_id]
  platforms  TEXT NOT NULL DEFAULT '["vinted","leboncoin"]',
  active     INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  queries    INTEGER DEFAULT 0,
  found      INTEGER DEFAULT 0,
  new_count  INTEGER DEFAULT 0,
  errors     TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

export default db;

// ---- helpers settings ----
export function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}
