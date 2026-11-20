(() => {
"use strict";
const $app = document.getElementById("app");
const S = { me: null, spec: null, booths: [], total: { count: 0, revenue: 0 }, online: 0, booth: null, tab: "kontrol", tx: null, txQ: null, cmds: [], dirty: {}, es: null };

// ---------- util ----------
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rp = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
const TZ = "Asia/Jakarta";
const fmtDT = (v) => { if (!v) return "-"; const d = new Date(v); return isNaN(d) ? "-" : d.toLocaleString("id-ID", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };
const ago = (ts) => { if (!ts) return "belum pernah"; const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); if (s < 5) return "baru saja"; if (s < 60) return s + " dtk lalu"; if (s < 3600) return Math.floor(s / 60) + " mnt lalu"; if (s < 86400) return Math.floor(s / 3600) + " jam lalu"; return Math.floor(s / 86400) + " hari lalu"; };
const SCREEN = { WELCOME: "Standby (layar awal)", DISCLAIMER: "Ketentuan", TEMPLATE_CATEGORY: "Memilih template", TEMPLATE_SELECT: "Memilih template", PAYMENT: "Pembayaran", CONSENT: "Izin sosmed", REMINDER: "Pengingat", PHOTO_SESSION: "Sesi foto", MEDIA_CAPTURE: "Sesi GIF/Video", EDITOR: "Editor", RESULT: "Hasil" };
const MODE = { photo: "Foto", gif: "GIF", boomerang: "Boomerang", video: "Video", addprint: "Add Print" };
const toast = (msg, kind = "") => { const el = document.createElement("div"); el.className = "toast " + kind; el.textContent = msg; document.getElementById("toasts").appendChild(el); setTimeout(() => el.remove(), 4200); };

async function api(path, opt = {}) {
  const o = { method: opt.method || "GET", headers: {}, credentials: "same-origin" };
  if (opt.body !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(opt.body); }
  const res = await fetch(path, o);
  let data = null; try { data = await res.json(); } catch { /* kosong */ }
  if (res.status === 401 && S.me) { S.me = null; closeES(); renderLogin(); throw new Error("Sesi habis. Silakan login lagi."); }
  if (!res.ok) throw new Error(data?.error || "Gagal (" + res.status + ")");
  return data;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- login ----------
function renderLogin(err) {
  $app.innerHTML = `<form class="card login" id="lf"><h1 style="margin-top:0">POPSNAP Remote</h1>
    <label class="small mut">Username</label><input type="text" name="user" autocomplete="username" required>
    <label class="small mut">Password</label><input type="password" name="password" autocomplete="current-password" required>
    ${err ? `<div class="banner bad">${esc(err)}</div>` : ""}
    <button class="btn pri" style="width:100%;justify-content:center">Masuk</button></form>`;
  document.getElementById("lf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/api/login", { method: "POST", body: { user: f.get("user"), password: f.get("password") } }); S.me = { user: f.get("user") }; start(); }
    catch (er) { renderLogin(er.message); }
  };
}

// ---------- kerangka ----------
function shell(inner) {
  return `<div class="top"><div class="in"><div class="logo"><i></i></div><div class="brand">POPSNAP Remote</div><div class="sp"></div>
    <span class="small mut hide-s">${esc(S.me?.user || "")}</span><button class="btn sm" data-act="logout">Keluar</button></div></div><div class="wrap">${inner}</div>`;
}
function route() { const m = /^#\/booth\/(\d+)(?:\/(\w+))?/.exec(location.hash); return m ? { id: Number(m[1]), tab: m[2] || "kontrol" } : { id: null }; }
window.addEventListener("hashchange", () => { if (S.me) show(); });

// ---------- daftar booth ----------
function screenLabel(b) { return b.online ? (SCREEN[b.ui?.screen] || "Menunggu data…") : "Offline"; }
function lockChip(b) { const l = b.ui?.locked; return l === "on" ? `<span class="chip bad">Terkunci</span>` : l === "pending" ? `<span class="chip warn">Mengunci…</span>` : ""; }

async function loadList() {
  const d = await api("/api/booths"); S.booths = d.booths; S.total = d.total; S.online = d.online;
}
function renderList() {
  const cards = S.booths.map((b) => `<a class="card booth" href="#/booth/${b.id}">
      <div class="nm"><span class="dot ${b.online ? "on" : ""}"></span>${esc(b.name)} ${lockChip(b)}</div>
      <div class="kv"><span class="mut">Status</span><b>${esc(screenLabel(b))}</b></div>
      <div class="kv"><span class="mut">Hari ini</span><span>${b.today.count || 0} transaksi · <b>${rp(b.today.revenue)}</b></span></div>
      <div class="kv"><span class="mut">Terakhir aktif</span><span data-ts="${b.lastSeenAt || ""}">${ago(b.lastSeenAt)}</span></div></a>`).join("");
  $app.innerHTML = shell(`
    <div class="row" style="margin-top:18px"><h1 style="margin:0">Semua booth</h1><div class="sp"></div><button class="btn pri" data-act="add">+ Tambah booth</button></div>
    <div class="stats">
      <div class="card stat"><span class="mut small">Booth online</span><b>${S.online} / ${S.booths.length}</b></div>
      <div class="card stat"><span class="mut small">Transaksi hari ini</span><b>${S.total.count}</b></div>
      <div class="card stat"><span class="mut small">Pendapatan hari ini</span><b>${rp(S.total.revenue)}</b></div></div>
    ${S.booths.length ? `<div class="grid">${cards}</div>` : `<div class="card empty">Belum ada booth. Klik <b>+ Tambah booth</b>, lalu tempel alamat dan token-nya di app photobox (Pengaturan → Remote).</div>`}`);
}

// ---------- detail booth ----------
async function loadBooth(id) { S.booth = await api("/api/booths/" + id); }
function hdrHtml(b) {
  const l = b.ui?.locked;
  return `<div class="row" style="margin-top:18px"><a href="#/" class="btn sm" style="color:inherit">← Semua</a><h1 style="margin:0 0 0 4px"><span class="dot ${b.online ? "on" : ""}" style="display:inline-block;margin-right:8px"></span>${esc(b.name)}</h1>
    ${lockChip(b)}<div class="sp"></div><button class="btn sm" data-act="rename">Ganti nama</button></div>
    <div class="row mut small" style="margin-top:6px"><span>${b.online ? "Online" : "Offline"} · ${esc(screenLabel(b))}</span><span>·</span><span>aktif <span data-ts="${b.lastSeenAt || ""}">${ago(b.lastSeenAt)}</span></span>${b.version ? `<span>· app v${esc(b.version)}</span>` : ""}
    ${b.ui?.shots != null && b.online && b.ui.screen === "PHOTO_SESSION" ? `<span>· ${esc(b.ui.shots)} foto terambil</span>` : ""}${l === "on" && b.ui?.lockMessage ? `<span>· pesan: “${esc(b.ui.lockMessage)}”</span>` : ""}</div>`;
}
function infoHtml(b) {
  const i = b.info || {}, items = [];
  if (i.camera) items.push(["Kamera", i.camera]);
  if (i.printer) items.push(["Printer", i.printer]);
  if (i.paymentMode) items.push(["Mode bayar", i.paymentMode]);
  if (i.pendingSync != null) items.push(["Antrean sinkron kasir", i.pendingSync ? `${i.pendingSync} menunggu` : "kosong"]);
  if (i.uptimeMin != null) items.push(["App hidup", i.uptimeMin >= 60 ? Math.floor(i.uptimeMin / 60) + " jam " + (i.uptimeMin % 60) + " mnt" : i.uptimeMin + " mnt"]);
  return items.length ? `<div class="card pad" style="margin-bottom:12px">${items.map(([k, v]) => `<div class="kv"><span class="mut">${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}</div>` : "";
}
function controlHtml(b) {
  const locked = b.ui?.locked === "on" || b.ui?.locked === "pending";
  const inSession = b.online && b.ui?.screen && b.ui.screen !== "WELCOME";
  return `${!b.online ? `<div class="banner warn">Booth sedang offline. Perintah akan menunggu sampai booth online (maksimal 10 menit), lalu kedaluwarsa.</div>` : ""}
    <div class="card pad" style="margin-bottom:12px"><h2>Kunci booth</h2>
      <p class="mut small" style="margin:0 0 10px">Booth menampilkan layar “tidak tersedia” di tampilan awal. Tamu yang sedang berfoto diselesaikan dulu, baru layar terkunci.</p>
      <div class="ctl">${locked ? `<button class="btn pri" data-act="unlock">Buka kunci</button>` : `<input type="text" id="lockmsg" placeholder="Pesan di layar (opsional), mis. Sedang istirahat" maxlength="120"><button class="btn pri" data-act="lock">Kunci booth</button>`}</div></div>
    <div class="card pad" style="margin-bottom:12px"><h2>Kontrol sesi</h2>
      <div class="ctl"><button class="btn bad" data-act="cancel" ${inSession ? "" : "disabled"}>Batalkan sesi berjalan</button>
      <button class="btn" data-act="reload">Muat ulang tampilan</button><button class="btn" data-act="ping">Tes koneksi</button></div>
      <p class="mut small" style="margin:10px 0 0">“Batalkan sesi” mengembalikan booth ke layar awal. Uang yang sudah dibayar tidak otomatis dikembalikan.</p></div>
    ${infoHtml(b)}`;
}
function tabsHtml(tab) {
  return `<div class="tabs">${[["kontrol", "Kontrol"], ["setelan", "Pengaturan"], ["transaksi", "Transaksi"], ["log", "Riwayat perintah"]].map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" data-act="tab" data-tab="${k}">${l}</button>`).join("")}</div>`;
}
function detailShell() {
  const { id, tab } = route(); S.tab = tab;
  $app.innerHTML = shell(`<div id="hdr">${hdrHtml(S.booth)}</div>${tabsHtml(tab)}<div id="tabc"></div>`);
  renderTab();
}
function refreshHdr() {
  const h = document.getElementById("hdr"); if (h) h.innerHTML = hdrHtml(S.booth);
  if (S.tab === "kontrol") { const t = document.getElementById("tabc"); if (t && !t.contains(document.activeElement)) t.innerHTML = controlHtml(S.booth); }
}
async function renderTab() {
  const t = document.getElementById("tabc"); if (!t) return;
  const b = S.booth;
  if (S.tab === "kontrol") t.innerHTML = controlHtml(b);
  else if (S.tab === "setelan") t.innerHTML = settingsHtml(b);
  else if (S.tab === "log") { await loadCmds(); const t2 = document.getElementById("tabc"); if (t2 && S.tab === "log") t2.innerHTML = logHtml(); }
  else if (S.tab === "transaksi") await renderTx(true);
}

// ----- pengaturan -----
const dirtyCount = () => Object.keys(S.dirty).length;
function fieldInput(f, val) {
  const v = S.dirty[f.path] !== undefined ? S.dirty[f.path] : val;
  const id = `f_${f.path}`;
  if (f.type === "bool") return `<span class="sw"><input type="checkbox" id="${id}" data-path="${f.path}" ${v ? "checked" : ""}><span></span></span>`;
  if (f.type === "int") return `<input type="number" id="${id}" data-path="${f.path}" value="${esc(v ?? "")}" min="${f.min}" max="${f.max}" step="1" inputmode="numeric">`;
  if (f.type === "text") return `<input type="text" id="${id}" data-path="${f.path}" value="${esc(v ?? "")}" maxlength="${f.max}">`;
  if (f.type === "color") return `<input type="color" id="${id}" data-path="${f.path}" value="${esc(v || "#000000")}">`;
  if (f.type === "enum") return `<select id="${id}" data-path="${f.path}">${f.options.map(([o, l]) => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  return "";
}
function settingsHtml(b) {
  const cur = b.settings || {};
  if (!Object.keys(cur).length) return `<div class="card empty">Belum ada data pengaturan dari booth. ${b.online ? "Tunggu beberapa detik." : "Booth sedang offline."}</div>`;
  const groups = S.spec.groups.map((g) => `<div class="fg"><h2>${esc(g.title)}</h2>${g.hint ? `<p class="mut small" style="margin:-4px 0 6px">${esc(g.hint)}</p>` : ""}
    ${g.fields.filter((f) => cur[f.path] !== undefined).map((f) => `<div class="fld ${S.dirty[f.path] !== undefined ? "chg" : ""}"><label for="f_${f.path}">${esc(f.label)}</label>${fieldInput(f, cur[f.path])}</div>`).join("")}</div>`).join("");
  return `${!b.online ? `<div class="banner warn">Booth offline: perubahan akan dikirim saat booth online lagi (maks. 10 menit).</div>` : ""}
    <div class="card pad">${groups}<div class="save"><button class="btn pri" data-act="save" ${dirtyCount() ? "" : "disabled"}>Simpan perubahan${dirtyCount() ? " (" + dirtyCount() + ")" : ""}</button>
    <button class="btn" data-act="discard" ${dirtyCount() ? "" : "disabled"}>Batalkan</button><span class="small mut">Berlaku untuk tamu berikutnya, tanpa restart.</span></div></div>`;
}
function onSettingInput(el) {
  const f = S.spec.groups.flatMap((g) => g.fields).find((x) => x.path === el.dataset.path); if (!f) return;
  const orig = S.booth.settings[f.path];
  let v = f.type === "bool" ? el.checked : f.type === "int" ? (el.value === "" ? NaN : Number(el.value)) : el.value;
  const same = f.type === "int" ? v === Number(orig) : v === orig;
  if (same) delete S.dirty[f.path]; else S.dirty[f.path] = v;
  el.closest(".fld")?.classList.toggle("chg", !same);
  const save = document.querySelector('[data-act="save"]'), disc = document.querySelector('[data-act="discard"]');
  if (save) { save.disabled = !dirtyCount(); save.textContent = "Simpan perubahan" + (dirtyCount() ? " (" + dirtyCount() + ")" : ""); }
  if (disc) disc.disabled = !dirtyCount();
}
function fmtVal(f, v) { return f.type === "bool" ? (v ? "Ya" : "Tidak") : f.type === "enum" ? (f.options.find(([o]) => o === v)?.[1] || v) : f.type === "int" && /price|Harga/i.test(f.path + f.label) && /Rp/.test(f.label) ? rp(v) : String(v); }
function saveSettings() {
  const fields = S.spec.groups.flatMap((g) => g.fields);
  const lines = Object.entries(S.dirty).map(([p, v]) => { const f = fields.find((x) => x.path === p); return { f, p, v }; });
  const bad = lines.find((l) => l.f.type === "int" && (!Number.isInteger(l.v) || l.v < l.f.min || l.v > l.f.max));
  if (bad) return toast(`${bad.f.label}: isi angka ${bad.f.min}–${bad.f.max}.`, "bad");
  const risky = lines.some((l) => l.p === "payment.mode");
  modal(`<h2>Kirim perubahan ke ${esc(S.booth.name)}?</h2>
    <div class="card pad" style="margin:10px 0">${lines.map((l) => `<div class="kv"><span>${esc(l.f.label)}</span><span><span class="mut">${esc(fmtVal(l.f, S.booth.settings[l.p]))}</span> → <b>${esc(fmtVal(l.f, l.v))}</b></span></div>`).join("")}</div>
    ${risky ? `<div class="banner warn">Mode bayar berubah: berlaku untuk tamu berikutnya. Pastikan sudah benar.</div>` : ""}
    <div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">Batal</button><button class="btn pri" data-act="save-go">Kirim</button></div>`);
}
async function sendSettings() {
  try {
    await sendCmd("settings.patch", { ...S.dirty }, true);
    S.dirty = {}; closeModal(); toast("Perubahan dikirim ke booth.", "ok");
    if (S.tab === "setelan") renderTab();
  } catch (e) { toast(e.message, "bad"); }
}

// ----- perintah -----
async function sendCmd(type, payload, quiet) {
  const r = await api(`/api/booths/${S.booth.id}/commands`, { method: "POST", body: { type, payload } });
  if (!quiet) toast(r.online ? "Perintah dikirim." : "Booth offline — perintah menunggu booth online.", r.online ? "ok" : "");
  return r;
}
async function loadCmds() { S.cmds = (await api(`/api/booths/${S.booth.id}/commands`)).commands; }
const CMD = { lock: "Kunci booth", unlock: "Buka kunci", cancel_session: "Batalkan sesi", reload_ui: "Muat ulang tampilan", "settings.patch": "Ubah pengaturan", ping: "Tes koneksi" };
const STATUS = { pending: ["Menunggu booth", "warn"], sent: ["Diproses", "warn"], done: ["Berhasil", "ok"], error: ["Gagal", "bad"], expired: ["Kedaluwarsa", "bad"] };
function logHtml() {
  if (!S.cmds.length) return `<div class="card empty">Belum ada perintah.</div>`;
  return `<div class="card scroll"><table><thead><tr><th>Waktu</th><th>Perintah</th><th>Oleh</th><th>Status</th></tr></thead><tbody>${S.cmds.map((c) => {
    const st = STATUS[c.status] || [c.status, ""];
    const detail = c.type === "settings.patch" && c.payload?.patch ? Object.keys(c.payload.patch).length + " pengaturan" : c.type === "lock" && c.payload?.message ? "“" + c.payload.message + "”" : "";
    const note = c.result?.error || c.result?.message || "";
    return `<tr><td class="small">${fmtDT(c.created_at)}</td><td>${esc(CMD[c.type] || c.type)}${detail ? `<div class="small mut">${esc(detail)}</div>` : ""}</td><td class="small">${esc(c.by || "")}</td>
      <td><span class="chip ${st[1]}">${st[0]}</span>${note ? `<div class="small mut">${esc(note)}</div>` : ""}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

// ----- transaksi -----
const dayStart = (offset = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };
const PRESETS = { today: "Hari ini", yesterday: "Kemarin", week: "7 hari", all: "Semua" };
function txRange(p) {
  if (p === "today") return [dayStart(0), dayStart(1)];
  if (p === "yesterday") return [dayStart(-1), dayStart(0)];
  if (p === "week") return [dayStart(-6), dayStart(1)];
  return [null, null];
}
async function renderTx(reset) {
  const t = document.getElementById("tabc"); if (!t) return;
  if (!S.txQ) S.txQ = { preset: "today", status: "", q: "", hideTest: true, limit: 50 };
  const Q = S.txQ;
  if (reset) Q.limit = 50;
  const [from, to] = txRange(Q.preset);
  const qs = new URLSearchParams({ limit: String(Q.limit) });
  if (from) qs.set("from", from.toISOString()); if (to) qs.set("to", to.toISOString());
  if (Q.status) qs.set("status", Q.status); if (Q.q) qs.set("q", Q.q); if (Q.hideTest) qs.set("test", "hide");
  let d; try { d = await api(`/api/booths/${S.booth.id}/tx?${qs}`); } catch (e) { return toast(e.message, "bad"); }
  S.tx = d;
  const keep = document.activeElement?.id === "txq" ? { s: document.activeElement.selectionStart } : null;
  t.innerHTML = `<div class="filters">${Object.entries(PRESETS).map(([k, l]) => `<button class="btn sm ${Q.preset === k ? "pri" : ""}" data-act="preset" data-p="${k}">${l}</button>`).join("")}
    <select id="txs"><option value="">Semua status</option>${["paid", "pending", "failed", "expired"].map((s) => `<option value="${s}" ${Q.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <input type="search" id="txq" placeholder="Cari no. transaksi / template / voucher" value="${esc(Q.q)}" style="flex:1;min-width:180px">
    <label class="small"><input type="checkbox" id="txt" ${Q.hideTest ? "checked" : ""}> sembunyikan TEST</label><button class="btn sm" data-act="csv">Unduh CSV</button></div>
    <div class="stats" style="margin-top:0"><div class="card stat"><span class="mut small">Transaksi lunas</span><b>${d.paid}</b></div><div class="card stat"><span class="mut small">Pendapatan (lunas, non-TEST)</span><b>${rp(d.revenue)}</b></div><div class="card stat"><span class="mut small">Semua baris</span><b>${d.total}</b></div></div>
    <div class="card scroll">${d.rows.length ? `<table><thead><tr><th>Waktu</th><th>No. transaksi</th><th>Mode</th><th>Template / paket</th><th>Metode</th><th class="r">Nominal</th><th>Status</th></tr></thead><tbody>${d.rows.map((r) => `<tr>
      <td class="small">${fmtDT(r.paid_at || r.created_at)}</td><td class="mono">${esc(r.order_no)}${r.is_test ? ` <span class="chip warn">TEST</span>` : ""}</td>
      <td>${r.mode === "addprint" ? `<span class="chip warn">Add Print</span>` : esc(MODE[r.mode] || r.mode || "Foto")}</td><td>${esc(r.template_name || "-")}${r.category ? `<div class="small mut">${esc(r.category)}</div>` : ""}</td>
      <td>${esc(r.method || "-")}${r.voucher_code ? `<div class="small mut mono">${esc(r.voucher_code)}</div>` : ""}</td><td class="r">${r.amount ? rp(r.amount) : "-"}</td>
      <td><span class="chip ${r.status === "paid" ? "ok" : r.status === "pending" ? "warn" : "bad"}">${esc(r.status)}</span></td></tr>`).join("")}</tbody></table>` : `<div class="empty">Tidak ada transaksi pada filter ini.</div>`}</div>
    ${d.rows.length < d.total ? `<div style="text-align:center;margin-top:12px"><button class="btn" data-act="more">Muat lebih banyak</button></div>` : ""}
    <p class="small mut">Data dikirim booth setiap beberapa detik. Riwayat yang tampil adalah yang sudah diterima server ini sejak booth tersambung.</p>`;
  if (keep) { const q = document.getElementById("txq"); q.focus(); q.setSelectionRange(keep.s, keep.s); }
}
function csv() {
  const rows = S.tx?.rows || []; const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["waktu", "no_transaksi", "mode", "template", "metode", "voucher", "nominal", "status", "test"];
  const body = rows.map((r) => [r.paid_at || r.created_at, r.order_no, r.mode, r.template_name, r.method, r.voucher_code, r.amount, r.status, r.is_test ? "ya" : ""].map(q).join(","));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + [head.join(","), ...body].join("\n")], { type: "text/csv" }));
  a.download = `transaksi-${S.booth.name.replace(/\W+/g, "_")}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- modal ----------
function modal(html) { closeModal(); const d = document.createElement("div"); d.className = "modal"; d.id = "modal"; d.innerHTML = `<div class="box">${html}</div>`; d.addEventListener("mousedown", (e) => { if (e.target === d) closeModal(); }); document.body.appendChild(d); d.querySelector("input")?.focus(); }
function closeModal() { document.getElementById("modal")?.remove(); }
function addBoothModal() {
  modal(`<h2>Tambah booth</h2><label class="small mut">Nama booth (mis. nama studio)</label><input type="text" id="nb" maxlength="60" style="width:100%;margin:6px 0 14px" placeholder="Studio 1990">
    <div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">Batal</button><button class="btn pri" data-act="add-go">Buat</button></div>`);
}
async function createBooth() {
  const name = document.getElementById("nb")?.value.trim(); if (!name) return toast("Isi nama booth dulu.", "bad");
  try {
    const r = await api("/api/booths", { method: "POST", body: { name } });
    modal(`<h2>Booth “${esc(r.name)}” dibuat</h2><div class="banner warn">Token hanya tampil sekali. Salin sekarang.</div>
      <div class="small mut">Alamat server</div><code class="tok">${esc(location.origin)}</code>
      <div class="small mut">Token booth</div><code class="tok">${esc(r.token)}</code>
      <p class="small mut">Di app photobox: <b>Admin → Pengaturan → Remote</b>, isi alamat dan token ini, aktifkan, simpan.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-act="copytok" data-v="${esc(r.token)}">Salin token</button><button class="btn pri" data-act="close">Selesai</button></div>`);
    await loadList(); if (!route().id) renderList();
  } catch (e) { toast(e.message, "bad"); }
}

// ---------- aksi ----------
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, b = S.booth;
  try {
    if (act === "logout") { await api("/api/logout", { method: "POST", body: {} }); S.me = null; closeES(); renderLogin(); }
    else if (act === "add") addBoothModal();
    else if (act === "add-go") await createBooth();
    else if (act === "close") closeModal();
    else if (act === "copytok") { await navigator.clipboard.writeText(el.dataset.v); toast("Token disalin.", "ok"); }
    else if (act === "tab") { location.hash = `#/booth/${b.id}/${el.dataset.tab}`; }
    else if (act === "lock") { const m = document.getElementById("lockmsg")?.value || ""; if (confirm("Kunci booth ini?")) await sendCmd("lock", { message: m }); }
    else if (act === "unlock") await sendCmd("unlock");
    else if (act === "cancel") { if (confirm("Batalkan sesi yang sedang berjalan di booth ini? Booth kembali ke layar awal.")) await sendCmd("cancel_session"); }
    else if (act === "reload") { if (confirm("Muat ulang tampilan booth? Sesi yang berjalan akan terputus.")) await sendCmd("reload_ui"); }
    else if (act === "ping") await sendCmd("ping");
    else if (act === "rename") { const n = prompt("Nama baru booth:", b.name); if (n && n.trim()) { await api("/api/booths/" + b.id, { method: "PATCH", body: { name: n.trim() } }); await loadBooth(b.id); refreshHdr(); toast("Nama diganti.", "ok"); } }
    else if (act === "save") saveSettings();
    else if (act === "save-go") await sendSettings();
    else if (act === "discard") { S.dirty = {}; renderTab(); }
    else if (act === "preset") { S.txQ.preset = el.dataset.p; renderTx(true); }
    else if (act === "more") { S.txQ.limit += 50; renderTx(false); }
    else if (act === "csv") csv();
  } catch (er) { toast(er.message, "bad"); }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset?.path) onSettingInput(el);
  else if (el.id === "txq") { S.txQ.q = el.value; debTx(); }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "txs") { S.txQ.status = el.value; renderTx(true); }
  else if (el.id === "txt") { S.txQ.hideTest = el.checked; renderTx(true); }
});
const debTx = debounce(() => renderTx(true), 350);

// ---------- live (SSE) + siklus ----------
function closeES() { if (S.es) { S.es.close(); S.es = null; } }
const onChange = debounce(async (ev) => {
  try {
    const { id } = route();
    if (!id) { await loadList(); if (!route().id) renderList(); return; }
    await loadBooth(id); refreshHdr();
    if (S.tab === "log" && (!ev || ev.what === "cmd" || true)) { await loadCmds(); const t = document.getElementById("tabc"); if (t && S.tab === "log") t.innerHTML = logHtml(); }
    if (S.tab === "transaksi" && ev?.what === "hello" && !document.getElementById("modal")) renderTx(false);
    if (S.tab === "setelan" && !dirtyCount() && ev?.what === "hello") { const t = document.getElementById("tabc"); if (t && !t.contains(document.activeElement)) t.innerHTML = settingsHtml(S.booth); }
  } catch { /* abaikan, coba lagi di siklus berikut */ }
}, 300);
function openES() {
  closeES();
  const es = new EventSource("/api/events"); S.es = es;
  es.addEventListener("change", (m) => { let d = {}; try { d = JSON.parse(m.data); } catch { /* */ } const { id } = route(); if (!id || d.booth === id) onChange(d); });
  es.onerror = () => { /* EventSource menyambung ulang sendiri */ };
}
setInterval(() => { // status offline tidak datang lewat SSE -> segarkan berkala + jam relatif
  if (!S.me) return;
  document.querySelectorAll("[data-ts]").forEach((el) => { const t = Number(el.dataset.ts); if (t) el.textContent = ago(t); });
}, 1000);
setInterval(() => { if (S.me && !document.hidden && !document.getElementById("modal")) onChange({ what: "tick" }); }, 15000);

async function show() {
  const { id } = route();
  try {
    if (!id) { await loadList(); renderList(); return; }
    if (!S.booth || S.booth.id !== id) { S.dirty = {}; S.tx = null; S.txQ = null; }
    await loadBooth(id); detailShell();
  } catch (e) { if (S.me) { toast(e.message, "bad"); location.hash = "#/"; } }
}
async function start() {
  try { S.spec = await api("/api/spec"); openES(); await show(); } catch (e) { if (S.me) toast(e.message, "bad"); }
}
(async () => {
  try { const m = await api("/api/me"); if (m.user) { S.me = m; start(); } else renderLogin(); } catch { renderLogin(); }
})();
})();
