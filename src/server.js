const express = require("express");
const crypto = require("crypto");
const path = require("path");
const db = require("./db");
const spec = require("./spec");

const PORT = Number(process.env.PORT) || 8090;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ONLINE_MS = (Number(process.env.ONLINE_SEC) || 35) * 1000;
const POLL_WAIT_MS = 25 * 1000;
const CMD_PENDING_TTL = 10 * 60 * 1000;  // perintah belum diambil booth (offline) -> kedaluwarsa
const CMD_IDLE_TTL = 30 * 60 * 1000;     // perintah 'setelah sesi selesai' boleh menunggu lebih lama
const CMD_SENT_TTL = 2 * 60 * 1000;      // sudah diambil tapi tak ada konfirmasi -> kedaluwarsa
const COMMANDS = ["lock", "unlock", "cancel_session", "reload_ui", "settings.patch", "ping", ...spec.TOOL_TYPES];

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use("/api/agent/ack", express.json({ limit: "2mb" })); // hasil alat (mis. log aplikasi) bisa besar
app.use(express.json({ limit: "512kb" }));

const now = () => Date.now();
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const j = (v) => (v == null ? null : JSON.stringify(v));
const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ---------- rahasia sesi (dibuat sekali, disimpan) ----------
function secret() {
  let r = db.prepare("SELECT v FROM meta WHERE k='secret'").get();
  if (!r) { const v = crypto.randomBytes(32).toString("hex"); db.prepare("INSERT INTO meta (k,v) VALUES ('secret',?)").run(v); r = { v }; }
  return r.v;
}
const SECRET = secret();
const sign = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function cookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function makeSession(user) { const exp = now() + 7 * 24 * 3600 * 1000; const body = `${user}.${exp}`; return `${body}.${sign(body)}`; }
function readSession(req) {
  const t = cookies(req).rb_session; if (!t) return null;
  const i = t.lastIndexOf("."); if (i < 0) return null;
  const body = t.slice(0, i), sig = t.slice(i + 1);
  if (!safeEq(sig, sign(body))) return null;
  const [user, exp] = [body.slice(0, body.lastIndexOf(".")), Number(body.slice(body.lastIndexOf(".") + 1))];
  return exp > now() ? { user } : null;
}

// ---------- batas percobaan login ----------
const fails = new Map();
function tooMany(ip) { const f = fails.get(ip); return f && f.n >= 8 && now() - f.t < 10 * 60 * 1000; }
function noteFail(ip) { const f = fails.get(ip); if (!f || now() - f.t > 10 * 60 * 1000) fails.set(ip, { n: 1, t: now() }); else { f.n += 1; f.t = now(); } }

function sameOrigin(req, res, next) {
  const o = req.headers.origin;
  if (o) { try { if (new URL(o).host !== req.headers.host) return res.status(403).json({ error: "Origin ditolak." }); } catch { return res.status(403).json({ error: "Origin ditolak." }); } }
  next();
}
function admin(req, res, next) {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: "Belum login." });
  req.admin = s; next();
}

app.get("/healthz", (req, res) => res.type("text").send("ok"));

app.post("/api/login", sameOrigin, (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "ADMIN_PASSWORD belum diisi di .env server." });
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi 10 menit." });
  const { user, password } = req.body || {};
  if (safeEq(sha(user ?? ""), sha(ADMIN_USER)) && safeEq(sha(password ?? ""), sha(ADMIN_PASSWORD))) {
    fails.delete(ip);
    const secure = (req.headers["x-forwarded-proto"] || req.protocol) === "https" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `rb_session=${encodeURIComponent(makeSession(ADMIN_USER))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}${secure}`);
    return res.json({ ok: true, user: ADMIN_USER });
  }
  noteFail(ip);
  res.status(401).json({ error: "Username atau password salah." });
});
app.post("/api/logout", sameOrigin, (req, res) => { res.setHeader("Set-Cookie", "rb_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"); res.json({ ok: true }); });
app.get("/api/me", (req, res) => { const s = readSession(req); res.json({ user: s?.user || null }); });

// ---------- SSE (live ke halaman admin) ----------
const sse = new Set();
function emit(boothId, what) {
  const msg = `event: change\ndata: ${JSON.stringify({ booth: boothId, what })}\n\n`;
  for (const r of sse) { try { r.write(msg); } catch { sse.delete(r); } }
}
app.get("/api/events", admin, (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");
  sse.add(res);
  req.on("close", () => sse.delete(res));
});
setInterval(() => { for (const r of sse) { try { r.write(": ping\n\n"); } catch { sse.delete(r); } } }, 20000).unref();

// ---------- tampilan data booth ----------
function boothView(b) {
  const online = !!b.last_seen_at && now() - b.last_seen_at < ONLINE_MS;
  return {
    id: b.id, name: b.name, online, lastSeenAt: b.last_seen_at, createdAt: b.created_at, version: b.version,
    ui: parse(b.ui, {}), today: parse(b.today, { count: 0, revenue: 0 }), info: parse(b.info, {}),
    pending: db.prepare("SELECT COUNT(*) n FROM commands WHERE booth_id=? AND status IN ('pending','sent')").get(b.id).n,
  };
}
const getBooth = (id) => db.prepare("SELECT * FROM booths WHERE id=?").get(Number(id));

app.get("/api/spec", admin, (req, res) => res.json({ sections: spec.SECTIONS }));
app.get("/api/booths", admin, (req, res) => {
  const list = db.prepare("SELECT * FROM booths ORDER BY name COLLATE NOCASE").all().map(boothView);
  const total = list.reduce((a, b) => ({ count: a.count + (b.today.count || 0), revenue: a.revenue + (b.today.revenue || 0) }), { count: 0, revenue: 0 });
  res.json({ booths: list, total, online: list.filter((b) => b.online).length });
});
app.get("/api/booths/:id", admin, (req, res) => {
  const b = getBooth(req.params.id); if (!b) return res.status(404).json({ error: "Booth tidak ditemukan." });
  res.json({ ...boothView(b), settings: parse(b.settings, {}) });
});

function newToken() { return "rb_" + crypto.randomBytes(24).toString("hex"); }
app.post("/api/booths", admin, sameOrigin, (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "Nama booth wajib diisi." });
  const token = newToken();
  const r = db.prepare("INSERT INTO booths (name, token_hash, created_at) VALUES (?,?,?)").run(name, sha(token), now());
  emit(Number(r.lastInsertRowid), "booth");
  res.json({ id: Number(r.lastInsertRowid), name, token }); // token hanya ditampilkan SEKALI
});
app.patch("/api/booths/:id", admin, sameOrigin, (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "Nama booth wajib diisi." });
  const r = db.prepare("UPDATE booths SET name=? WHERE id=?").run(name, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: "Booth tidak ditemukan." });
  emit(Number(req.params.id), "booth"); res.json({ ok: true });
});
app.post("/api/booths/:id/token", admin, sameOrigin, (req, res) => {
  const token = newToken();
  const r = db.prepare("UPDATE booths SET token_hash=? WHERE id=?").run(sha(token), Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: "Booth tidak ditemukan." });
  wake(Number(req.params.id)); res.json({ token }); // token lama langsung tidak berlaku
});
app.delete("/api/booths/:id", admin, sameOrigin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM tx WHERE booth_id=?").run(id);
  db.prepare("DELETE FROM commands WHERE booth_id=?").run(id);
  const r = db.prepare("DELETE FROM booths WHERE id=?").run(id);
  if (!r.changes) return res.status(404).json({ error: "Booth tidak ditemukan." });
  emit(id, "booth"); res.json({ ok: true });
});

// ---------- transaksi ----------
app.get("/api/booths/:id/tx", admin, (req, res) => {
  const id = Number(req.params.id);
  const where = ["booth_id = ?"], args = [id];
  if (req.query.from) { where.push("COALESCE(paid_at, created_at) >= ?"); args.push(String(req.query.from)); }
  if (req.query.to) { where.push("COALESCE(paid_at, created_at) < ?"); args.push(String(req.query.to)); }
  if (req.query.status) { where.push("status = ?"); args.push(String(req.query.status)); }
  if (req.query.test === "hide") where.push("is_test = 0");
  if (req.query.q) { where.push("(order_no LIKE ? OR template_name LIKE ? OR voucher_code LIKE ?)"); const q = `%${String(req.query.q).slice(0, 40)}%`; args.push(q, q, q); }
  const w = where.join(" AND ");
  const limit = Math.min(200, Number(req.query.limit) || 50), offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = db.prepare(`SELECT * FROM tx WHERE ${w} ORDER BY COALESCE(paid_at, created_at) DESC, order_no DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
    .map((r) => ({ ...r, is_test: !!r.is_test }));
  const sum = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status='paid' AND is_test=0 THEN amount END),0) revenue,
    COALESCE(SUM(CASE WHEN status='paid' AND is_test=0 THEN 1 END),0) paid FROM tx WHERE ${w}`).get(...args);
  res.json({ rows, total: sum.n, paid: sum.paid, revenue: sum.revenue });
});

// ---------- perintah ----------
// Daftar perintah: data hasil yang besar (mis. log) tidak ikut, cukup penanda; isinya diambil lewat /commands/:cid
app.get("/api/booths/:id/commands", admin, (req, res) => {
  const rows = db.prepare("SELECT * FROM commands WHERE booth_id=? ORDER BY id DESC LIMIT 30").all(Number(req.params.id))
    .map((c) => {
      const result = parse(c.result);
      if (result?.data != null) { const n = JSON.stringify(result.data).length; if (n > 4000) result.data = { _big: true, bytes: n }; }
      return { ...c, payload: parse(c.payload), result };
    });
  res.json({ commands: rows });
});
app.get("/api/booths/:id/commands/:cid", admin, (req, res) => {
  const c = db.prepare("SELECT * FROM commands WHERE id=? AND booth_id=?").get(Number(req.params.cid), Number(req.params.id));
  if (!c) return res.status(404).json({ error: "Perintah tidak ditemukan." });
  res.json({ command: { ...c, payload: parse(c.payload), result: parse(c.result) } });
});
app.post("/api/booths/:id/commands", admin, sameOrigin, (req, res) => {
  const b = getBooth(req.params.id); if (!b) return res.status(404).json({ error: "Booth tidak ditemukan." });
  const type = String(req.body?.type || "");
  if (!COMMANDS.includes(type)) return res.status(400).json({ error: "Perintah tidak dikenal." });
  let payload = req.body?.payload ?? null;
  if (type === "settings.patch") {
    const v = spec.validatePatch(payload);
    if (!v.ok) return res.status(400).json({ error: v.errors[0] || "Tidak ada perubahan.", errors: v.errors });
    payload = { patch: v.clean };
    if (req.body?.whenIdle === true) payload.whenIdle = true; // ditahan server sampai booth di layar awal (tidak ada sesi tamu)
  } else if (type === "lock") {
    payload = { message: String(payload?.message ?? "").trim().slice(0, 120) };
  } else if (spec.TOOL_TYPES.includes(type)) {
    const v = spec.validateTool(type, payload);
    if (!v.ok) return res.status(400).json({ error: v.error });
    payload = v.payload;
  } else payload = null;
  const r = db.prepare("INSERT INTO commands (booth_id, type, payload, created_at, by) VALUES (?,?,?,?,?)").run(b.id, type, j(payload), now(), req.admin.user);
  wake(b.id); emit(b.id, "cmd");
  res.json({ id: Number(r.lastInsertRowid), online: boothView(b).online });
});

// ---------- API untuk agent di booth ----------
function agent(req, res, next) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || "");
  const b = m && db.prepare("SELECT * FROM booths WHERE token_hash=?").get(sha(m[1]));
  if (!b) return res.status(401).json({ error: "Token booth tidak valid." });
  req.booth = b; next();
}

const waiting = new Map(); // boothId -> { res, timer }
function wake(boothId) {
  const w = waiting.get(boothId);
  if (w) { clearTimeout(w.timer); waiting.delete(boothId); deliver(boothId, w.res); }
}
// booth dianggap kosong bila tidak ada layar sesi (kiosk mati / belum melapor) atau di layar awal
function boothIdle(boothId) {
  const r = db.prepare("SELECT ui FROM booths WHERE id=?").get(boothId); const ui = parse(r?.ui) || {};
  return !ui.screen || ui.screen === "WELCOME";
}
function hasIdleWaiting(boothId) {
  return !!db.prepare("SELECT 1 FROM commands WHERE booth_id=? AND status='pending' AND payload LIKE '%\"whenIdle\":true%' LIMIT 1").get(boothId);
}
// perintah menunggu yang boleh dikirim SEKARANG (yang 'setelah sesi selesai' ditahan selama ada sesi)
function deliverable(boothId) {
  const idle = boothIdle(boothId);
  return db.prepare("SELECT id, type, payload FROM commands WHERE booth_id=? AND status='pending' ORDER BY id LIMIT 30").all(boothId)
    .filter((r) => idle || !parse(r.payload)?.whenIdle).slice(0, 10);
}
function deliver(boothId, res) {
  expireOld();
  const rows = deliverable(boothId);
  if (rows.length) db.prepare(`UPDATE commands SET status='sent', sent_at=? WHERE id IN (${rows.map(() => "?").join(",")})`).run(now(), ...rows.map((r) => r.id));
  if (!res.writableEnded) res.json({ commands: rows.map((r) => ({ id: r.id, type: r.type, payload: parse(r.payload) })) });
  if (rows.length) emit(boothId, "cmd");
}
function expireOld() {
  const t = now();
  db.prepare("UPDATE commands SET status='expired', done_at=? WHERE status='pending' AND created_at < ? AND payload NOT LIKE '%\"whenIdle\":true%'").run(t, t - CMD_PENDING_TTL);
  db.prepare("UPDATE commands SET status='expired', done_at=? WHERE status='pending' AND created_at < ?").run(t, t - CMD_IDLE_TTL);
  db.prepare("UPDATE commands SET status='expired', done_at=? WHERE status='sent' AND sent_at < ?").run(t, t - CMD_SENT_TTL);
  db.prepare("DELETE FROM commands WHERE created_at < ? AND status NOT IN ('pending','sent')").run(t - 14 * 86400000); // riwayat >14 hari dibuang (hasil alat seperti log bisa besar)
}
setInterval(expireOld, 30000).unref();

const upsertTx = db.prepare(`INSERT INTO tx (booth_id, order_no, mode, method, template_name, category, voucher_code, amount, status, is_test, created_at, paid_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(booth_id, order_no) DO UPDATE SET mode=excluded.mode, method=excluded.method, template_name=excluded.template_name, category=excluded.category,
    voucher_code=excluded.voucher_code, amount=excluded.amount, status=excluded.status, is_test=excluded.is_test, created_at=excluded.created_at, paid_at=excluded.paid_at, updated_at=excluded.updated_at`);
const s = (v, n = 80) => (v == null ? null : String(v).slice(0, n));

app.post("/api/agent/hello", agent, (req, res) => {
  const b = req.booth, d = req.body || {};
  db.prepare("UPDATE booths SET last_seen_at=?, version=?, ui=?, today=?, settings=?, info=? WHERE id=?")
    .run(now(), s(d.version, 20), j(d.ui ?? {}), j(d.today ?? { count: 0, revenue: 0 }), j(d.settings ?? {}), j(d.info ?? {}), b.id);
  if (Array.isArray(d.tx)) {
    db.exec("BEGIN");
    try {
      for (const t of d.tx.slice(0, 200)) {
        if (!t || !t.order_no) continue;
        upsertTx.run(b.id, s(t.order_no, 40), s(t.mode, 20), s(t.method, 20), s(t.template_name, 80), s(t.category, 40), s(t.voucher_code, 40),
          Math.max(0, Math.round(Number(t.amount) || 0)), s(t.status, 20), t.is_test ? 1 : 0, s(t.created_at, 40), s(t.paid_at, 40), s(t.updated_at, 40));
      }
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); console.error("[tx]", e.message); }
  }
  emit(b.id, "hello");
  if (hasIdleWaiting(b.id) && boothIdle(b.id)) wake(b.id); // sesi selesai -> kirim perubahan yang menunggu
  res.json({ ok: true, serverTime: now(), name: b.name });
});

app.get("/api/agent/poll", agent, (req, res) => {
  const b = req.booth;
  db.prepare("UPDATE booths SET last_seen_at=? WHERE id=?").run(now(), b.id);
  const old = waiting.get(b.id); if (old) { clearTimeout(old.timer); waiting.delete(b.id); if (!old.res.writableEnded) old.res.json({ commands: [] }); }
  if (deliverable(b.id).length) return deliver(b.id, res);
  const timer = setTimeout(() => { waiting.delete(b.id); if (!res.writableEnded) res.json({ commands: [] }); }, POLL_WAIT_MS);
  waiting.set(b.id, { res, timer });
  req.on("close", () => { const w = waiting.get(b.id); if (w && w.res === res) { clearTimeout(w.timer); waiting.delete(b.id); } });
});

app.post("/api/agent/ack", agent, (req, res) => {
  const id = Number(req.body?.id);
  const ok = !!req.body?.ok;
  // data = hasil alat (mis. ukuran penyimpanan, daftar setelan kamera); dibatasi supaya tabel perintah tidak membengkak
  let data = req.body?.data ?? null;
  if (data != null) { const raw = JSON.stringify(data); data = raw.length <= 400000 ? data : null; }
  const result = { message: s(req.body?.message, 300), applied: req.body?.applied ?? null, error: s(req.body?.error, 300), data };
  const r = db.prepare("UPDATE commands SET status=?, result=?, done_at=? WHERE id=? AND booth_id=?").run(ok ? "done" : "error", j(result), now(), id, req.booth.id);
  emit(req.booth.id, "cmd");
  res.json({ ok: !!r.changes });
});

app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: 0, etag: true }));
app.use((req, res) => res.status(404).json({ error: "Tidak ditemukan." }));
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: "Kesalahan server." }); });

if (require.main === module) {
  if (!ADMIN_PASSWORD) console.warn("PERINGATAN: ADMIN_PASSWORD belum diisi — login dinonaktifkan.");
  app.listen(PORT, () => console.log(`POPSNAP Remote Booth berjalan di port ${PORT}`));
}
module.exports = { app, db };
