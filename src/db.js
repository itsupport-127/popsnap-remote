const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "remote.db"));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS booths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  version TEXT,
  ui TEXT,        -- JSON: layar yang sedang tampil, status kunci, dst
  today TEXT,     -- JSON: { count, revenue } hari ini (dihitung booth)
  settings TEXT,  -- JSON datar: nilai pengaturan saat ini (hanya yang boleh diubah dari remote)
  info TEXT       -- JSON: kamera, printer, antrean sinkron, dst
);
CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booth_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | done | error | expired
  result TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  done_at INTEGER,
  by TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmd_booth ON commands(booth_id, id DESC);
CREATE TABLE IF NOT EXISTS tx (
  booth_id INTEGER NOT NULL,
  order_no TEXT NOT NULL,
  mode TEXT, method TEXT, template_name TEXT, category TEXT, voucher_code TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, paid_at TEXT, updated_at TEXT,
  PRIMARY KEY (booth_id, order_no)
);
CREATE INDEX IF NOT EXISTS idx_tx_time ON tx(booth_id, created_at DESC);
`);

module.exports = db;
