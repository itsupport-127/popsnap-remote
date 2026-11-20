// Uji: node --disable-warning=ExperimentalWarning test/run.js
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rb-"));
process.env.ADMIN_USER = "boss"; process.env.ADMIN_PASSWORD = "rahasia-panjang"; process.env.ONLINE_SEC = "35";
const { app } = require("../src/server");
const spec = require("../src/spec");

let n = 0;
const ok = (name) => console.log("  ✓ " + name) || n++;
(async () => {
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = "";
  const call = async (p, o = {}) => {
    const r = await fetch(base + p, { method: o.method || "GET", headers: { ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(o.headers || {}) }, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc && sc.includes("rb_session=") && !sc.includes("Max-Age=0")) cookie = sc.split(";")[0];
    let d = null; try { d = await r.json(); } catch { /* */ }
    return { s: r.status, d };
  };
  const agent = (token) => (p, o = {}) => call(p, { ...o, headers: { Authorization: "Bearer " + token } });

  // --- spec ---
  assert.ok(spec.validatePatch({ "printing.price": 5000, "general.modes.gif.enabled": true, "display.colors.primary": "#aabbcc", "payment.mode": "none" }).ok); ok("spec: patch valid");
  assert.ok(!spec.validatePatch({ "payment.qris.midtrans.serverKey": "x" }).ok); ok("spec: kunci pembayaran DITOLAK");
  assert.ok(!spec.validatePatch({ "general.security.pinHash": "x" }).ok); ok("spec: PIN DITOLAK");
  assert.ok(!spec.validatePatch({ "printing.copies": 99 }).ok); ok("spec: di luar batas ditolak");
  assert.ok(!spec.validatePatch({ "printing.auto": "ya" }).ok); ok("spec: tipe salah ditolak");
  assert.deepStrictEqual(spec.unflatten({ "a.b.c": 1, "a.d": 2 }), { a: { b: { c: 1 }, d: 2 } }); ok("spec: unflatten");

  // --- auth ---
  assert.strictEqual((await call("/healthz")).s, 200);
  assert.strictEqual((await call("/api/booths")).s, 401); ok("admin API butuh login");
  assert.strictEqual((await call("/api/login", { method: "POST", body: { user: "boss", password: "salah" } })).s, 401); ok("login salah ditolak");
  assert.strictEqual((await call("/api/login", { method: "POST", body: { user: "boss", password: "rahasia-panjang" } })).s, 200); ok("login benar");
  assert.strictEqual((await call("/api/me")).d.user, "boss");
  assert.strictEqual((await call("/api/booths", { method: "POST", body: { name: "X" }, headers: { Origin: "https://jahat.example" } })).s, 403); ok("Origin asing ditolak");

  // --- booth + agent ---
  assert.strictEqual((await call("/api/booths", { method: "POST", body: { name: " " } })).s, 400);
  const created = (await call("/api/booths", { method: "POST", body: { name: "Studio 1990" } })).d;
  assert.ok(created.token.startsWith("rb_")); ok("buat booth + token");
  assert.strictEqual((await agent("rb_salah")("/api/agent/hello", { method: "POST", body: {} })).s, 401); ok("token booth salah ditolak");
  const A = agent(created.token);

  let list = (await call("/api/booths")).d;
  assert.strictEqual(list.booths[0].online, false); ok("booth baru: offline");

  const t0 = new Date().toISOString();
  const hello = await A("/api/agent/hello", { method: "POST", body: {
    version: "1.2.3", ui: { screen: "WELCOME", locked: "off" }, today: { count: 3, revenue: 105000 },
    settings: { "printing.price": 5000, "general.modes.gif.enabled": false }, info: { camera: "Canon EOS", pendingSync: 0 },
    tx: [
      { order_no: "PB-A-0001", mode: "photo", method: "qris", template_name: "Wisuda 3", amount: 35000, status: "paid", is_test: false, created_at: t0, paid_at: t0, updated_at: t0 },
      { order_no: "PB-A-0002", mode: "addprint", method: "qris", amount: 10000, status: "paid", is_test: false, created_at: t0, paid_at: t0, updated_at: t0 },
      { order_no: "PB-A-0003", mode: "photo", method: "voucher", amount: 0, status: "paid", is_test: false, created_at: t0, paid_at: t0, updated_at: t0 },
      { order_no: "PB-A-0004", mode: "photo", method: "qris", amount: 35000, status: "paid", is_test: true, created_at: t0, paid_at: t0, updated_at: t0 },
      { order_no: "PB-A-0005", mode: "photo", method: "qris", amount: 35000, status: "pending", is_test: false, created_at: t0, updated_at: t0 },
    ] } });
  assert.strictEqual(hello.s, 200);
  list = (await call("/api/booths")).d;
  assert.strictEqual(list.booths[0].online, true); assert.strictEqual(list.total.revenue, 105000); assert.strictEqual(list.booths[0].version, "1.2.3"); ok("hello -> online + ringkasan");
  const id = created.id;
  const det = (await call("/api/booths/" + id)).d;
  assert.strictEqual(det.settings["printing.price"], 5000); ok("detail memuat nilai pengaturan");

  let tx = (await call(`/api/booths/${id}/tx?test=hide`)).d;
  assert.strictEqual(tx.total, 4); assert.strictEqual(tx.revenue, 45000); assert.strictEqual(tx.paid, 3); ok("transaksi: TEST tidak dihitung, nominal benar");
  tx = (await call(`/api/booths/${id}/tx?status=pending`)).d; assert.strictEqual(tx.total, 1);
  tx = (await call(`/api/booths/${id}/tx?q=Wisuda`)).d; assert.strictEqual(tx.total, 1); ok("transaksi: filter status & cari");
  await A("/api/agent/hello", { method: "POST", body: { ui: {}, tx: [{ order_no: "PB-A-0005", amount: 35000, status: "paid", created_at: t0, paid_at: t0, updated_at: t0 }] } });
  tx = (await call(`/api/booths/${id}/tx?status=paid&test=hide`)).d; assert.strictEqual(tx.total, 4); ok("transaksi: upsert memperbarui status");
  assert.strictEqual((await call(`/api/booths/${id}/tx?from=${encodeURIComponent("2999-01-01T00:00:00Z")}`)).d.total, 0); ok("transaksi: filter tanggal");

  // --- perintah ---
  assert.strictEqual((await call(`/api/booths/${id}/commands`, { method: "POST", body: { type: "rm_rf" } })).s, 400); ok("perintah asing ditolak");
  assert.strictEqual((await call(`/api/booths/${id}/commands`, { method: "POST", body: { type: "settings.patch", payload: { "payment.qris.midtrans.serverKey": "x" } } })).s, 400); ok("patch kunci pembayaran ditolak server");
  assert.strictEqual((await call(`/api/booths/${id}/commands`, { method: "POST", body: { type: "settings.patch", payload: { "printing.copies": 50 } } })).s, 400);

  // long-poll: tidak ada perintah -> menunggu; perintah masuk -> langsung terkirim
  const t1 = Date.now();
  const pollP = A("/api/agent/poll");
  await new Promise((r) => setTimeout(r, 300));
  await call(`/api/booths/${id}/commands`, { method: "POST", body: { type: "settings.patch", payload: { "printing.price": 7500, "general.modes.gif.enabled": true } } });
  const polled = await pollP;
  assert.ok(Date.now() - t1 < 3000); assert.strictEqual(polled.d.commands.length, 1); assert.strictEqual(polled.d.commands[0].type, "settings.patch");
  assert.deepStrictEqual(polled.d.commands[0].payload.patch, { "printing.price": 7500, "general.modes.gif.enabled": true }); ok("long-poll: perintah langsung sampai");
  let cm = (await call(`/api/booths/${id}/commands`)).d.commands; assert.strictEqual(cm[0].status, "sent");
  assert.strictEqual((await A("/api/agent/ack", { method: "POST", body: { id: polled.d.commands[0].id, ok: true, message: "2 pengaturan diterapkan" } })).d.ok, true);
  cm = (await call(`/api/booths/${id}/commands`)).d.commands; assert.strictEqual(cm[0].status, "done"); assert.strictEqual(cm[0].result.message, "2 pengaturan diterapkan"); ok("ack -> status selesai");

  // antrean saat tidak ada poll aktif
  await call(`/api/booths/${id}/commands`, { method: "POST", body: { type: "lock", payload: { message: "Istirahat" } } });
  await call(`/api/booths/${id}/commands`, { method: "POST", body: { type: "cancel_session" } });
  const p2 = (await A("/api/agent/poll")).d.commands; assert.strictEqual(p2.length, 2); assert.strictEqual(p2[0].payload.message, "Istirahat"); assert.strictEqual(p2[1].payload, null); ok("antrean: urut & lengkap");
  assert.strictEqual((await A("/api/agent/poll")).d.commands.length, 0, "tidak boleh terkirim dua kali") ;
  ok("perintah tidak terkirim dua kali");

  // --- SSE ---
  const ctrl = new AbortController();
  const sse = await fetch(base + "/api/events", { headers: { Cookie: cookie }, signal: ctrl.signal });
  assert.strictEqual(sse.status, 200);
  const reader = sse.body.getReader();
  await A("/api/agent/hello", { method: "POST", body: { ui: { screen: "PAYMENT" } } });
  let got = ""; const dl = Date.now() + 2000;
  while (Date.now() < dl && !got.includes("hello")) { const { value } = await reader.read(); got += Buffer.from(value || []).toString(); }
  assert.ok(got.includes('"what":"hello"')); ctrl.abort(); ok("SSE: perubahan booth didorong langsung");

  // --- token baru mematikan token lama ---
  const rt = (await call(`/api/booths/${id}/token`, { method: "POST", body: {} })).d;
  assert.strictEqual((await A("/api/agent/hello", { method: "POST", body: {} })).s, 401);
  assert.strictEqual((await agent(rt.token)("/api/agent/hello", { method: "POST", body: {} })).s, 200); ok("ganti token: token lama mati");

  // --- hapus ---
  assert.strictEqual((await call("/api/booths/" + id, { method: "DELETE" })).s, 200);
  assert.strictEqual((await call("/api/booths/" + id)).s, 404); ok("hapus booth");
  cookie = ""; assert.strictEqual((await call("/api/booths")).s, 401);
  srv.close(); console.log(`\n${n} pemeriksaan lulus.`); process.exit(0);
})().catch((e) => { console.error("GAGAL:", e); process.exit(1); });
