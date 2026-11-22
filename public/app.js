(() => {
"use strict";
const $app = document.getElementById("app");
const S = { me: null, spec: null, booths: [], total: { count: 0, revenue: 0 }, online: 0, booth: null, tab: "kontrol", fields: {}, sec: null, q: "", waiting: new Set(), tx: null, txQ: null, cmds: [], dirty: {}, es: null };

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
  document.getElementById("bar")?.classList.remove("show");
  $app.innerHTML = `<form class="card login" id="lf"><img src="/logo.png" alt="POPSNAP"><h1 style="margin:6px 0 14px">Remote Booth</h1>
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
  return `<div class="top"><div class="in"><img src="/logo.png" alt="POPSNAP"><div class="brand">Remote Booth</div><div class="sp"></div>
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
  document.getElementById("bar")?.classList.remove("show");
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
  return `<div class="tabs">${[["kontrol", "Kontrol"], ["setelan", "Pengaturan"], ["alat", "Alat"], ["transaksi", "Transaksi"], ["log", "Riwayat perintah"]].map(([k, l]) => `<button class="tab ${tab === k ? "on" : ""}" data-act="tab" data-tab="${k}">${l}</button>`).join("")}</div>`;
}
function detailShell() {
  const { id, tab } = route(); S.tab = tab;
  $app.innerHTML = shell(`<div id="hdr">${hdrHtml(S.booth)}</div>${tabsHtml(tab)}<div id="tabc"></div>`);
  renderTab(); updateBar();
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
  else if (S.tab === "alat") t.innerHTML = toolsHtml(b);
  else if (S.tab === "log") { await loadCmds(); const t2 = document.getElementById("tabc"); if (t2 && S.tab === "log") t2.innerHTML = logHtml(); }
  else if (S.tab === "transaksi") await renderTx(true);
}

// ----- pengaturan -----
const dirtyCount = () => Object.keys(S.dirty).length;
const curVal = (p) => (S.dirty[p] !== undefined ? S.dirty[p] : S.booth.settings[p]);
const gateOk = (f) => { if (!f.when) return true; const v = curVal(f.when); return f.whenValue !== undefined ? String(v) === String(f.whenValue) : !!v; };
const gateText = (f) => { const g = S.fields[f.when]; if (!g) return ""; return f.whenValue !== undefined ? `aktif jika “${g.label}” = ${(g.options?.find(([o]) => String(o) === String(f.whenValue)) || [0, f.whenValue])[1]}` : `aktif jika “${g.label}” dinyalakan`; };
const sameVal = (f, a, b) => f.type === "profile" || f.type === "periods" ? JSON.stringify(f.type === "profile" ? normProf(a) : normPer(a)) === JSON.stringify(f.type === "profile" ? normProf(b) : normPer(b)) : f.type === "steps" ? JSON.stringify(a) === JSON.stringify(b) : f.type === "color" ? String(a).toLowerCase() === String(b).toLowerCase() : f.type === "int" || f.type === "num" ? Number(a) === Number(b) : f.type === "enum" ? String(a) === String(b) : a === b;
const secDirty = (sec) => sec.groups.reduce((n, g) => n + g.fields.filter((f) => S.dirty[f.path] !== undefined).length, 0);

function fieldInput(f) {
  const v = curVal(f.path), id = `f_${f.path}`, d = `id="${id}" data-path="${f.path}"`;
  if (f.type === "bool") return `<span class="sw"><input type="checkbox" ${d} ${v ? "checked" : ""}><span></span></span>`;
  if (f.type === "int") return `<input type="number" ${d} value="${esc(v ?? "")}" min="${f.min}" max="${f.max}" step="1" inputmode="numeric">${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ""}`;
  if (f.type === "num") return `<input type="number" ${d} value="${esc(v ?? "")}" min="${f.min}" max="${f.max}" step="${f.step || 0.1}" inputmode="decimal">${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ""}`;
  if (f.type === "text") return `<input type="text" ${d} value="${esc(v ?? "")}" maxlength="${f.max}">`;
  if (f.type === "textarea") return `<textarea ${d} maxlength="${f.max}">${esc(v ?? "")}</textarea>`;
  if (f.type === "color") return `<input type="color" ${d} value="${esc(v || "#000000")}"><span class="unit mono">${esc(String(v || "").toUpperCase())}</span>`;
  if (f.type === "enum") return `<select ${d}>${f.options.map(([o, l]) => `<option value="${esc(o)}" ${String(o) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  return "";
}
function stepsHtml(f) {
  const order = Array.isArray(curVal(f.path)) ? curVal(f.path) : f.options.map((o) => o[0]);
  return `<div class="steps" data-steps="${f.path}">${order.map((id, i) => {
    const o = f.options.find((x) => x[0] === id); if (!o) return "";
    const on = !o[3] || !!curVal(o[3]);
    return `<div class="step ${on ? "" : "off"}"><span class="no">${i + 1}</span><div class="tx"><b>${esc(o[1])}</b><small>${esc(o[2] || "")}</small>${on ? "" : `<small style="display:block;color:var(--red-d)">Sedang mati — dilewati. ${esc(o[4] || "")}</small>`}</div>
      <div class="mv"><button class="btn sm" data-act="mv" data-path="${f.path}" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} title="Naikkan">↑</button><button class="btn sm" data-act="mv" data-path="${f.path}" data-i="${i}" data-d="1" ${i === order.length - 1 ? "disabled" : ""} title="Turunkan">↓</button></div></div>`;
  }).join("")}</div>`;
}
function fieldHtml(f) {
  const on = gateOk(f), chg = S.dirty[f.path] !== undefined;
  const wide = ["textarea", "steps", "profile", "periods"].includes(f.type);
  return `<div class="fld ${chg ? "chg" : ""} ${on ? "" : "off"} ${f.danger ? "danger" : ""} ${wide ? "wide" : ""}" data-fld="${f.path}"><div class="lb"><b>${esc(f.label)}</b>${f.hint ? `<small>${esc(f.hint)}</small>` : ""}<small class="gate">${on ? "" : esc(gateText(f))}</small></div>
    ${wide && f.type !== "textarea" ? "" : `<div class="ct">${fieldInput(f)}</div>`}${f.type === "steps" ? stepsHtml(f) : f.type === "profile" ? profileHtml(f) : f.type === "periods" ? periodsHtml(f) : ""}</div>`;
}
function groupHtml(g, filter) {
  const fs = g.fields.filter((f) => S.booth.settings[f.path] !== undefined && (!filter || (f.label + " " + (f.hint || "") + " " + g.title).toLowerCase().includes(filter)));
  if (!fs.length) return "";
  return `<section class="card mb"><div class="ch"><h2>${esc(g.title)}</h2>${g.hint ? `<p>${esc(g.hint)}</p>` : ""}</div><div class="cb">${fs.map(fieldHtml).join("")}</div></section>`;
}
function settingsBody() {
  const q = S.q.trim().toLowerCase();
  if (q) {
    const out = S.spec.sections.map((s) => { const h = s.groups.map((g) => groupHtml(g, q)).join(""); return h ? `<h3 class="sec-title" style="font-size:1rem;margin:10px 0 6px">${esc(s.title)}</h3>${h}` : ""; }).join("");
    return out || `<div class="card empty">Tidak ada pengaturan yang cocok dengan “${esc(S.q)}”.</div>`;
  }
  const sec = S.spec.sections.find((s) => s.id === S.sec) || S.spec.sections[0];
  const body = sec.groups.map((g) => groupHtml(g)).join("");
  return `<h2 class="sec-title">${esc(sec.title)}</h2><p class="sec-desc">${esc(sec.desc || "")}</p>${body || `<div class="banner warn">Booth belum mengirim pengaturan untuk bagian ini. Kemungkinan app photobox di booth masih versi lama: perbarui file photobox (<b>backend/remoteSpec.js</b>, <b>remoteAgent.js</b>, <b>server.js</b>, <b>cameraBridge.js</b>) lalu restart app, dan bagian ini akan terisi.</div>`}`;
}
function settingsHtml(b) {
  if (!Object.keys(b.settings || {}).length) return `<div class="card empty">Belum ada data pengaturan dari booth. ${b.online ? "Tunggu beberapa detik." : "Booth sedang offline."}</div>`;
  if (!S.sec) S.sec = S.spec.sections[0].id;
  const missing = Object.keys(S.fields).filter((p) => b.settings[p] === undefined).length;
  const nav = S.spec.sections.map((s) => { const n = secDirty(s); return `<button class="${s.id === S.sec && !S.q ? "on" : ""}" data-act="sec" data-sec="${s.id}">${esc(s.title)}${n ? ` <span class="cnt">${n}</span>` : ""}<small>${esc(s.desc || "")}</small></button>`; }).join("");
  return `<div class="banner" id="waitbn" style="${S.waiting.size ? "" : "display:none"}">Ada perubahan yang masih menunggu booth (offline atau menunggu sesi selesai). Hasilnya muncul sebagai pesan.</div>${!b.online ? `<div class="banner warn">Booth offline: perubahan akan dikirim saat booth online lagi (maks. 10 menit).</div>` : ""}
    ${missing ? `<div class="banner warn"><b>${missing} pengaturan belum dikirim booth.</b> App photobox di booth kemungkinan belum diperbarui — pasang versi terbaru lalu restart, setelah itu semuanya muncul.</div>` : ""}
    <div class="banner">Semua pengaturan photobox bisa diubah di sini. Yang <b>tidak</b> bisa dari jarak jauh: kunci/rahasia, sinkron kasir &amp; galeri, folder, nama perangkat, dan unggah file — ubah itu langsung di app photobox.</div>
    <div class="set"><div><input class="search" type="search" id="sq" placeholder="Cari pengaturan… (mis. harga, printer, countdown)" value="${esc(S.q)}"><nav class="snav" id="snav">${nav}</nav></div><div id="sbody">${settingsBody()}</div></div>`;
}
function refreshSettings() { // render ulang isi (tanpa mengganggu kolom cari)
  const sb = document.getElementById("sbody"), nv = document.getElementById("snav"); if (!sb) return;
  const y = window.scrollY; sb.innerHTML = settingsBody();
  nv.innerHTML = S.spec.sections.map((s) => { const n = secDirty(s); return `<button class="${s.id === S.sec && !S.q ? "on" : ""}" data-act="sec" data-sec="${s.id}">${esc(s.title)}${n ? ` <span class="cnt">${n}</span>` : ""}<small>${esc(s.desc || "")}</small></button>`; }).join("");
  window.scrollTo(0, y);
}
function updateBar() {
  let bar = document.getElementById("bar");
  if (!bar) { bar = document.createElement("div"); bar.id = "bar"; bar.className = "bar"; document.body.appendChild(bar); }
  const n = dirtyCount();
  bar.className = "bar" + (n && S.tab === "setelan" ? " show" : "");
  bar.innerHTML = `<div class="in"><b>${n} perubahan belum dikirim</b><span class="sp"></span><button class="btn" data-act="discard">Batalkan</button><button class="btn pri" data-act="save">Kirim ke booth</button></div>`;
}
function onSettingInput(el) {
  const f = S.fields[el.dataset.path]; if (!f) return;
  const orig = S.booth.settings[f.path];
  let v = f.type === "bool" ? el.checked : f.type === "int" || f.type === "num" ? (el.value === "" ? NaN : Number(el.value)) : f.type === "enum" && f.numeric ? Number(el.value) : el.value;
  const same = sameVal(f, v, orig);
  if (same) delete S.dirty[f.path]; else S.dirty[f.path] = v;
  el.closest(".fld")?.classList.toggle("chg", !same);
  if (f.type === "color") { const u = el.parentElement.querySelector(".unit"); if (u) u.textContent = String(v).toUpperCase(); }
  document.querySelectorAll("[data-fld]").forEach((row) => { // kolom bersyarat: redupkan bila syaratnya belum terpenuhi
    const g = S.fields[row.dataset.fld]; if (!g?.when) return; const on = gateOk(g);
    row.classList.toggle("off", !on); const gt = row.querySelector(".gate"); if (gt) gt.textContent = on ? "" : gateText(g);
  });
  if (f.type === "bool") document.querySelectorAll("[data-steps]").forEach((box) => { const sf = S.fields[box.dataset.steps]; box.outerHTML = stepsHtml(sf); });
  updateBar();
  const cnt = S.spec.sections.length; if (cnt) document.querySelectorAll("#snav button").forEach((bt, i) => { const s = S.spec.sections[i], n = secDirty(s); let c = bt.querySelector(".cnt"); if (n && !c) { c = document.createElement("span"); c.className = "cnt"; bt.insertBefore(c, bt.querySelector("small")); bt.insertBefore(document.createTextNode(" "), c); } if (c) { if (n) c.textContent = n; else c.remove(); } });
}
function moveStep(path, i, d) {
  const f = S.fields[path], arr = (curVal(path) || f.options.map((o) => o[0])).slice(), j = i + d; if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  if (sameVal(f, arr, S.booth.settings[path])) delete S.dirty[path]; else S.dirty[path] = arr;
  const box = document.querySelector(`[data-steps="${path}"]`); if (box) box.outerHTML = stepsHtml(f);
  document.querySelector(`[data-fld="${path}"]`)?.classList.toggle("chg", S.dirty[path] !== undefined);
  updateBar();
}
function fmtVal(f, v) {
  if (v === undefined || v === null) return "-";
  if (f.type === "bool") return v ? "Ya" : "Tidak";
  if (f.type === "enum") return f.options.find(([o]) => String(o) === String(v))?.[1] || String(v);
  if (f.type === "profile") return profSummary(v);
  if (f.type === "periods") return normPer(v).length ? normPer(v).map((p) => `${p.label} ${p.from}–${p.to}`).join(", ") : "(tanpa periode)";
  if (f.type === "steps") return v.map((id) => f.options.find((o) => o[0] === id)?.[1] || id).join(" → ");
  if (f.type === "textarea" || f.type === "text") { const s = String(v); return s.length > 60 ? s.slice(0, 60) + "…" : s || "(kosong)"; }
  if (f.unit === "Rp") return rp(v);
  return String(v) + (f.unit ? " " + f.unit : "");
}
function saveSettings() {
  const lines = Object.entries(S.dirty).map(([p, v]) => ({ f: S.fields[p], p, v }));
  const bad = lines.find((l) => (l.f.type === "int" || l.f.type === "num") && !(Number.isFinite(l.v) && ((l.v >= l.f.min && l.v <= l.f.max) || (l.f.allowZero && l.v === 0))));
  if (bad) return toast(`${bad.f.label}: isi angka ${bad.f.allowZero ? "0 atau " : ""}${bad.f.min}–${bad.f.max}.`, "bad");
  const risky = lines.filter((l) => l.f.danger);
  modal(`<h2>Kirim ${lines.length} perubahan ke ${esc(S.booth.name)}?</h2>
    <div class="card pad" style="margin:10px 0">${lines.map((l) => `<div class="kv"><span>${esc(l.f.label)}</span><span style="text-align:right"><span class="mut">${esc(fmtVal(l.f, S.booth.settings[l.p]))}</span> → <b>${esc(fmtVal(l.f, l.v))}</b></span></div>`).join("")}</div>
    ${risky.length ? `<div class="banner warn">Ada pengaturan sensitif (${risky.map((l) => esc(l.f.label)).join(", ")}). Berlaku untuk tamu berikutnya — pastikan sudah benar.</div>` : ""}
    <div class="card pad" style="margin:10px 0"><label class="row" style="cursor:pointer;align-items:flex-start;gap:8px"><input type="radio" name="when" value="now" checked style="margin-top:3px"><span><b>Terapkan sekarang</b><br><span class="small mut">Langsung berlaku. Kalau ada tamu sedang sesi, layarnya bisa berubah di tengah jalan.</span></span></label>
      <label class="row" style="cursor:pointer;align-items:flex-start;gap:8px;margin-top:8px"><input type="radio" name="when" value="idle" style="margin-top:3px"><span><b>Setelah sesi selesai</b><br><span class="small mut">Menunggu sampai booth kembali ke layar awal (maks. 30 menit). Aman untuk harga, mode bayar, dan alur.</span></span></label></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">Batal</button><button class="btn pri" data-act="save-go">Kirim</button></div>`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sendSettings() {
  const idle = document.querySelector('input[name="when"]:checked')?.value === "idle";
  const sent = { ...S.dirty }, prev = {}; for (const p of Object.keys(sent)) prev[p] = S.booth.settings[p];
  const boothId = S.booth.id;
  try {
    const r = await sendCmd("settings.patch", sent, true, idle);
    Object.assign(S.booth.settings, sent); S.dirty = {}; closeModal();
    toast(idle ? "Dikirim. Diterapkan setelah sesi selesai." : (r.online ? "Dikirim, menunggu jawaban booth…" : "Booth offline — menunggu booth online."), idle ? "ok" : "");
    updateBar(); if (S.tab === "setelan") renderTab();
    watchSettings(r.id, sent, prev, idle, boothId); // tidak ditunggu: hasil muncul sebagai pesan
  } catch (e) { toast(e.message, "bad"); }
}
async function watchSettings(id, sent, prev, idle, boothId) {
  S.waiting.add(id);
  const end = Date.now() + (idle ? 31 : 3) * 60000;
  try {
    while (Date.now() < end) {
      await sleep(idle ? 4000 : 1200);
      if (!S.booth || S.booth.id !== boothId) return; // pindah halaman: hasilnya tetap ada di Riwayat perintah
      let c; try { c = (await api(`/api/booths/${boothId}/commands`)).commands.find((x) => x.id === id); } catch { continue; }
      if (!c) return;
      if (c.status === "pending" || c.status === "sent") continue;
      if (c.status === "done") { toast(`Booth menerapkan perubahan${c.result?.message ? ": " + c.result.message : ""}.`, "ok"); return; }
      for (const p of Object.keys(sent)) if (S.booth.settings[p] === sent[p] && !(p in S.dirty)) S.booth.settings[p] = prev[p]; // gagal: kembalikan tampilan ke nilai lama
      toast(`Perubahan TIDAK diterapkan: ${c.result?.error || STATUS[c.status]?.[0] || c.status}`, "bad");
      if (S.tab === "setelan") renderTab();
      return;
    }
  } finally { S.waiting.delete(id); if (S.tab === "setelan" && S.booth?.id === boothId) { const b = document.getElementById("waitbn"); if (b) b.style.display = S.waiting.size ? "" : "none"; } }
}

// ----- profil kamera & jadwal (ISO / shutter / aperture / WB) -----
const PKEYS = ["tv", "av", "iso", "wb"], PNAMES = { tv: "Shutter", av: "Aperture", iso: "ISO", wb: "White balance" };
const normProf = (v) => Object.fromEntries(PKEYS.map((k) => [k, v && v[k] != null && v[k] !== "" ? String(v[k]) : ""]));
const normPer = (arr) => (Array.isArray(arr) ? arr : []).map((q, i) => ({ id: q.id || "p" + (i + 1), label: q.label || "", from: q.from || "06:00", to: q.to || "18:00", live: normProf(q.live), photo: normProf(q.photo) }));
function expKey() { return "popsnap.expinfo." + (S.booth?.id ?? 0); }
function expInfo() {
  if (S.expInfo === undefined) { try { S.expInfo = JSON.parse(localStorage.getItem(expKey()) || "null"); } catch { S.expInfo = null; } }
  return S.expInfo;
}
const optLabel = (key, val) => { const o = expInfo()?.[key]?.opts?.find(([v]) => String(v) === String(val)); return o ? o[1] : null; };
function profSummary(pr) { const x = normProf(pr); return PKEYS.filter((k) => x[k]).map((k) => `${k === "tv" ? "S" : k === "av" ? "f" : k === "iso" ? "ISO" : "WB"} ${optLabel(k, x[k]) || "kode " + x[k]}`).join(" · ") || "belum diisi"; }
function camSel(attrs, key, val) {
  const opts = (expInfo()?.[key]?.opts || []).slice();
  if (val && !opts.some(([v]) => String(v) === String(val))) opts.unshift([val, `kode ${val} (tersimpan)`]);
  return `<select ${attrs} data-key="${key}" aria-label="${PNAMES[key]}"><option value="">(tidak diatur)</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
}
function readBar() {
  const i = expInfo();
  return `<div class="row" style="margin-bottom:8px"><button class="btn sm dark" data-act="exp-read">Baca opsi dari kamera</button><span class="small mut">${i ? "Pilihan sudah dimuat dari kamera." : "Pilihan kosong sampai dibaca dari kamera (Canon / Nikon langsung, booth di layar awal)."}</span></div>`;
}
function profileHtml(f) {
  const v = normProf(curVal(f.path));
  return `<div class="pbox" data-pbox="${f.path}">${readBar()}<div class="pgrid">${PKEYS.map((k) => `<label class="small"><span class="mut">${PNAMES[k]}</span>${camSel(`data-prof="${f.path}"`, k, v[k])}</label>`).join("")}</div></div>`;
}
function periodCard(f, p, i) {
  const pr = (w, val) => `<div class="pgrid">${PKEYS.map((k) => `<label class="small"><span class="mut">${PNAMES[k]}</span>${camSel(`data-per="${f.path}" data-i="${i}" data-w="${w}"`, k, val[k])}</label>`).join("")}</div>`;
  return `<div class="pcard"><div class="row"><input type="text" data-per="${f.path}" data-i="${i}" data-w="label" value="${esc(p.label)}" maxlength="24" style="width:150px" aria-label="Nama periode"><span class="small">dari</span><input type="time" data-per="${f.path}" data-i="${i}" data-w="from" value="${esc(p.from)}"><span class="small">sampai</span><input type="time" data-per="${f.path}" data-i="${i}" data-w="to" value="${esc(p.to)}">
    <span class="sp"></span><button class="btn sm" data-act="per-fill" data-path="${f.path}" data-i="${i}">Isi dari kamera sekarang</button><button class="btn sm bad" data-act="per-del" data-path="${f.path}" data-i="${i}">Hapus</button></div>
    <div class="small" style="margin:8px 0 2px"><b>Live View</b></div>${pr("live", p.live)}<div class="small" style="margin:8px 0 2px"><b>Foto</b></div>${pr("photo", p.photo)}</div>`;
}
function periodsHtml(f) {
  const list = normPer(curVal(f.path));
  return `<div class="pbox" data-pbox="${f.path}">${readBar()}${list.map((p, i) => periodCard(f, p, i)).join("") || `<div class="small mut" style="margin-bottom:8px">Belum ada periode. Tambah periode lalu isi jam dan setelan kameranya.</div>`}
    <button class="btn pri sm" data-act="per-add" data-path="${f.path}" ${list.length >= 6 ? "disabled" : ""}>+ Tambah periode</button><span class="small mut"> maks. 6 · jam tidak boleh bertumpuk</span></div>`;
}
function setDirtyObj(f, val) { // simpan ke S.dirty bila beda dari nilai booth
  const orig = S.booth.settings[f.path];
  const norm = (x) => JSON.stringify(f.type === "profile" ? normProf(x) : normPer(x));
  if (norm(val) === norm(orig)) delete S.dirty[f.path]; else S.dirty[f.path] = val;
  document.querySelector(`[data-fld="${f.path}"]`)?.classList.toggle("chg", S.dirty[f.path] !== undefined);
  updateBar();
  const bt = document.querySelectorAll("#snav button"); S.spec.sections.forEach((s, i) => { const n = secDirty(s); let c = bt[i]?.querySelector(".cnt"); if (n && !c && bt[i]) { c = document.createElement("span"); c.className = "cnt"; bt[i].insertBefore(c, bt[i].querySelector("small")); } if (c) { if (n) c.textContent = n; else c.remove(); } });
}
function onProfInput(el) {
  const f = S.fields[el.dataset.prof]; const v = normProf(curVal(f.path)); v[el.dataset.key] = el.value; setDirtyObj(f, v);
}
function onPerInput(el) {
  const f = S.fields[el.dataset.per], list = normPer(curVal(f.path)), p = list[Number(el.dataset.i)]; if (!p) return;
  const w = el.dataset.w;
  if (w === "live" || w === "photo") p[w][el.dataset.key] = el.value; else if (el.value || w === "label") p[w] = el.value;
  setDirtyObj(f, list);
}
function rerenderPbox(path) { const box = document.querySelector(`[data-pbox="${path}"]`), f = S.fields[path]; if (box) box.outerHTML = f.type === "profile" ? profileHtml(f) : periodsHtml(f); }
async function readCam() { // baca opsi + nilai sekarang dari kamera lewat booth
  const c = await runTool("camera.exposure.get", undefined, "Baca setelan kamera");
  if (c?.status === "done" && c.result?.data) { S.expInfo = c.result.data; try { localStorage.setItem(expKey(), JSON.stringify(S.expInfo)); } catch { /* abaikan */ } }
  return c?.status === "done" ? S.expInfo : null;
}
function refreshPboxes() { document.querySelectorAll("[data-pbox]").forEach((b) => rerenderPbox(b.dataset.pbox)); }
async function perAction(act, el) {
  const f = S.fields[el.dataset.path], list = normPer(curVal(f.path)), i = Number(el.dataset.i);
  if (act === "per-add") {
    if (list.length >= 6) return;
    const last = list[list.length - 1];
    list.push({ id: "p" + Math.random().toString(36).slice(2, 7), label: "Periode " + (list.length + 1), from: last ? last.to : "06:00", to: last ? (last.to === "18:00" ? "21:00" : "18:00") : "18:00", live: normProf({}), photo: normProf({}) });
  } else if (act === "per-del") { if (!confirm(`Hapus periode “${list[i]?.label}”?`)) return; list.splice(i, 1); }
  else if (act === "per-fill") {
    el.disabled = true; const info = await readCam(); if (!info) { el.disabled = false; return; }
    const cur = Object.fromEntries(PKEYS.map((k) => [k, info[k]?.cur != null ? String(info[k].cur) : ""]));
    list[i].live = normProf(curVal("camera.exposure.split") ? curVal("camera.exposure.live") : cur);
    list[i].photo = normProf(curVal("camera.exposure.split") ? curVal("camera.exposure.photo") : cur);
    toast("Setelan kamera disimpan ke periode itu (belum dikirim).", "ok");
  }
  setDirtyObj(f, list); rerenderPbox(f.path);
}

// ----- perintah -----
async function sendCmd(type, payload, quiet, whenIdle) {
  const r = await api(`/api/booths/${S.booth.id}/commands`, { method: "POST", body: { type, payload, ...(whenIdle ? { whenIdle: true } : {}) } });
  if (!quiet) toast(r.online ? "Perintah dikirim." : "Booth offline — perintah menunggu booth online.", r.online ? "ok" : "");
  return r;
}
async function loadCmds() { S.cmds = (await api(`/api/booths/${S.booth.id}/commands`)).commands; }
const CMD = { lock: "Kunci booth", unlock: "Buka kunci", cancel_session: "Batalkan sesi", reload_ui: "Muat ulang tampilan", "settings.patch": "Ubah pengaturan", ping: "Tes koneksi", "tools.storage": "Cek penyimpanan", "tools.archive_cleanup": "Bersihkan arsip lama", "tools.cleanup_orphans": "Bersihkan file tidak terpakai", "camera.status": "Status kamera", "camera.exposure.get": "Baca setelan kamera", "camera.exposure.set": "Ubah setelan kamera", "logs.read": "Ambil log aplikasi" };
const STATUS = { pending: ["Menunggu booth", "warn"], sent: ["Diproses", "warn"], done: ["Berhasil", "ok"], error: ["Gagal", "bad"], expired: ["Kedaluwarsa", "bad"] };
function logHtml() {
  if (!S.cmds.length) return `<div class="card empty">Belum ada perintah.</div>`;
  return `<div class="card scroll"><table><thead><tr><th>Waktu</th><th>Perintah</th><th>Oleh</th><th>Status</th></tr></thead><tbody>${S.cmds.map((c) => {
    const st = c.status === "pending" && c.payload?.whenIdle ? ["Menunggu sesi selesai", "warn"] : (STATUS[c.status] || [c.status, ""]);
    const detail = c.type === "tools.archive_cleanup" && c.payload?.days ? "lebih tua dari " + c.payload.days + " hari" : c.type === "camera.exposure.set" && c.payload ? c.payload.prop + " = " + c.payload.value : c.type === "settings.patch" && c.payload?.patch ? Object.keys(c.payload.patch).length + " pengaturan" : c.type === "lock" && c.payload?.message ? "“" + c.payload.message + "”" : "";
    const note = c.result?.error || c.result?.message || "";
    return `<tr><td class="small">${fmtDT(c.created_at)}</td><td>${esc(CMD[c.type] || c.type)}${detail ? `<div class="small mut">${esc(detail)}</div>` : ""}</td><td class="small">${esc(c.by || "")}</td>
      <td><span class="chip ${st[1]}">${st[0]}</span>${note ? `<div class="small mut">${esc(note)}</div>` : ""}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

// ----- alat (Tools photobox) -----
const LG = { date: "", level: "all", from: "", to: "", q: "", tail: 400, activity: true }; // pilihan filter log (bertahan selama halaman terbuka)
const TOOL_LAST = {}; // hasil terakhir per jenis alat (di sesi halaman ini)
const fmtBytes = (n) => { n = Number(n) || 0; return n >= 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B"; };
async function runTool(type, payload, label) { // kirim perintah lalu tunggu hasil dari booth (maks 60 dtk)
  const id = `${S.booth.id}`;
  const r = await api(`/api/booths/${id}/commands`, { method: "POST", body: { type, payload } });
  if (!r.online) toast("Booth offline — perintah menunggu booth online.", "");
  for (let i = 0; i < 90; i++) {
    await new Promise((x) => setTimeout(x, 700));
    if (!S.booth || String(S.booth.id) !== id) return null;
    let c = (await api(`/api/booths/${id}/commands`)).commands.find((x) => x.id === r.id);
    if (c && !["pending", "sent"].includes(c.status)) {
      if (c.result?.data?._big) { try { c = (await api(`/api/booths/${id}/commands/${c.id}`)).command; } catch { /* pakai ringkasan */ } } // hasil besar (log) diambil terpisah
      TOOL_LAST[type] = c;
      toast(`${label || CMD[type] || type}: ${c.result?.error || c.result?.message || STATUS[c.status]?.[0] || c.status}`, c.status === "done" ? "ok" : "bad");
      return c;
    }
  }
  toast("Booth belum menjawab. Cek tab Riwayat.", "bad"); return null;
}
function storageHtml(d) {
  if (!d) return `<p class="mut small">Belum dicek. Klik tombol di atas.</p>`;
  const disk = d.disk || {}, o = d.output || {};
  const lvl = disk.level === "bad" ? "bad" : disk.level === "warn" ? "warn" : "";
  const row = (k, v) => `<div class="kv"><span class="mut">${k}</span><span>${v}</span></div>`;
  return `${disk.freeBytes != null || disk.free != null ? "" : ""}
    ${row("Disk bebas", disk.freeGB != null ? disk.freeGB + " GB" : disk.free != null ? fmtBytes(disk.free) : disk.freeBytes != null ? fmtBytes(disk.freeBytes) : "-")}${disk.level ? `<div class="meter ${lvl}"><i style="width:${disk.level === "bad" ? 95 : disk.level === "warn" ? 80 : 40}%"></i></div>` : ""}
    ${row("Sementara (uploads)", `${fmtBytes(d.uploads?.bytes)} · ${d.uploads?.files ?? 0} file`)}
    ${row("Arsip foto permanen", `${fmtBytes(o.bytes)} · ${o.sessions ?? 0} sesi · ${o.dayCount ?? 0} hari`)}
    ${o.oldest ? row("Arsip tertua", esc(o.oldest)) : ""}
    ${row("Cadangan database", fmtBytes(d.backups?.bytes))}${row("Pustaka", fmtBytes(d.library?.bytes))}
    ${d.retentionDays ? row("Retensi file sementara", d.retentionDays + " hari") : ""}`;
}
function expHtml(info) {
  if (!info) return `<p class="mut small">Klik “Baca setelan kamera” untuk memuat nilai dari kamera.</p>`;
  const names = { tv: "Shutter", av: "Aperture", iso: "ISO", wb: "White balance" };
  const rows = ["tv", "av", "iso", "wb"].filter((k) => info[k]).map((k) => { const p = info[k], opts = p.opts || [];
    return `<div class="fld"><div class="lb"><b>${names[k]}</b></div><div class="ct"><select id="exp_${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(p.cur) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select><button class="btn sm" data-act="exp-set" data-prop="${k}">Terapkan</button></div></div>`; }).join("");
  return rows || `<pre class="mono" style="white-space:pre-wrap">${esc(JSON.stringify(info, null, 1).slice(0, 1500))}</pre>`;
}
const lgColor = (ln) => (/^\S+ \S+ \[E\]/.test(ln) ? "color:#B81E36" : /^\S+ \S+ \[W\]/.test(ln) ? "color:#8a6d00" : "");
function logText(d, name) {
  const head = `Log aplikasi — ${name} — ${d.date}`;
  const act = (d.activity || []).map((a) => `${a.t} ${a.user || "-"} ${a.action} ${a.target || ""} ${a.detail || ""}`.trim());
  return [head, "", ...d.lines, ...(act.length ? ["", "--- Catatan aktivitas ---", ...act] : [])].join("\n");
}
function logHtml(c) {
  const d = c?.result?.data;
  if (c && c.status !== "done") return `<div class="banner bad">${esc(c.result?.error || "Gagal mengambil log.")}</div>`;
  if (c && !d) return `<div class="banner warn">Booth menjawab tapi isi log tidak sampai (terlalu besar?). Persempit jam, naikkan filter ke “Error saja”, atau kurangi jumlah baris.</div>`;
  if (!d) return `<p class="mut small">Pilih tanggal lalu klik “Ambil log”. Kosongkan tanggal untuk hari ini.</p>`;
  const chips = (d.dates || []).map((x) => `<button class="chip ${x === d.date ? "ok" : ""}" style="cursor:pointer;border:0" data-act="lg-date" data-d="${x}">${x}${x === d.today ? " (hari ini)" : ""}</button>`).join(" ");
  const act = d.activity || [];
  return `<div class="small mut" style="margin:6px 0">Tanggal <b>${esc(d.date)}</b> · ${d.shown} dari ${d.total} baris cocok${d.truncated ? " (dipotong: tampil yang terbaru, persempit jam atau cari kata)" : ""} · ukuran file ${fmtBytes(d.bytes)}</div>
    <div class="row" style="margin:6px 0">${chips || '<span class="mut small">Belum ada file log.</span>'}</div>
    ${d.lines.length ? `<div class="row" style="margin:8px 0"><button class="btn sm" data-act="lg-copy">Salin</button><button class="btn sm" data-act="lg-dl">Unduh .txt</button></div>
    <pre class="mono" style="white-space:pre-wrap;word-break:break-word;max-height:480px;overflow:auto;background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:10px;margin:0">${d.lines.map((ln) => `<span style="${lgColor(ln)}">${esc(ln)}</span>`).join("\n")}</pre>` : `<div class="empty">Tidak ada baris log yang cocok.</div>`}
    ${act.length ? `<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">Catatan aktivitas (${act.length})</summary><div class="scroll"><table><tr><th>Jam</th><th>Siapa</th><th>Aksi</th><th>Detail</th></tr>${act.map((a) => `<tr><td class="mono">${esc(a.t)}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td><td class="small">${esc((a.target + " " + a.detail).trim())}</td></tr>`).join("")}</table></div></details>` : ""}`;
}
function toolsHtml(b) {
  const st = TOOL_LAST["tools.storage"]?.result?.data, cam = TOOL_LAST["camera.status"]?.result?.data, ex = TOOL_LAST["camera.exposure.get"]?.result?.data;
  const info = b.info || {};
  return `${!b.online ? `<div class="banner warn">Booth sedang offline — alat baru jalan saat booth online.</div>` : ""}
    <div class="tools">
    <section class="card"><div class="ch"><h2>Penyimpanan</h2><p>Sisa disk dan ukuran folder di komputer booth.</p></div><div class="pad" id="t-storage">${storageHtml(st)}${!st && info.disk ? `<p class="small mut">Disk bebas (laporan terakhir): ${info.disk.freeGB} dari ${info.disk.totalGB} GB</p>` : ""}
      <div class="ctl" style="margin-top:10px"><button class="btn dark" data-act="tool" data-t="tools.storage">Cek penyimpanan</button></div></div></section>
    <section class="card"><div class="ch"><h2>Bersihkan arsip foto lama</h2><p>Menghapus folder tanggal (YYYY-MM-DD) di arsip yang lebih tua dari batas. Folder lain tidak disentuh.</p></div><div class="pad">
      <div class="ctl"><span>Lebih tua dari</span><input type="number" id="arcdays" value="90" min="7" max="3650" style="width:90px"><span>hari</span><button class="btn bad" data-act="archive">Hapus arsip lama</button></div>
      <p class="small mut" style="margin:8px 0 0">Tidak bisa dibatalkan. Isi 7–3650 hari.</p></div></section>
    <section class="card"><div class="ch"><h2>Bersihkan file tidak terpakai</h2><p>Menghapus sisa file di folder uploads yang tidak dipakai template, sesi, stiker, atau tampilan mana pun. File baru (&lt;15 menit) aman.</p></div><div class="pad">
      <button class="btn dark" data-act="tool" data-t="tools.cleanup_orphans">Bersihkan sekarang</button></div></section>
    <section class="card"><div class="ch"><h2>Kamera</h2><p>Status kamera dan setelan ISO / shutter / aperture / WB (hanya mode Canon / Nikon langsung).</p></div><div class="pad">
      ${cam ? `<div class="kv"><span class="mut">Penghubung</span><span>${esc(cam.driver || "-")}${cam.model ? " · " + esc(cam.model) : ""}</span></div><div class="kv"><span class="mut">Live view</span><span>${cam.live ? "menyala" : "mati"}</span></div>` : ""}
      <div class="ctl" style="margin:8px 0"><button class="btn dark" data-act="tool" data-t="camera.status">Status kamera</button><button class="btn dark" data-act="tool" data-t="camera.exposure.get">Baca setelan kamera</button></div>
      <div id="t-exp">${expHtml(ex)}</div></div></section>
    <section class="card" style="grid-column:1/-1"><div class="ch"><h2>Log aplikasi</h2><p>Apa yang dikerjakan aplikasi dan error-nya, per tanggal (disimpan 14 hari di komputer booth). Token dan kata sandi disensor.</p></div><div class="pad">
      <div class="ctl"><label class="small">Tanggal <input type="date" id="lg_date" value="${esc(LG.date)}"></label>
        <label class="small">Jam <input type="time" id="lg_from" value="${esc(LG.from)}"> – <input type="time" id="lg_to" value="${esc(LG.to)}"></label>
        <label class="small">Tampilkan <select id="lg_level"><option value="all" ${LG.level === "all" ? "selected" : ""}>Semua</option><option value="warn" ${LG.level === "warn" ? "selected" : ""}>Peringatan + error</option><option value="error" ${LG.level === "error" ? "selected" : ""}>Error saja</option></select></label>
        <label class="small">Baris <select id="lg_tail">${[200, 400, 1000, 2000].map((n) => `<option ${LG.tail === n ? "selected" : ""}>${n}</option>`).join("")}</select></label></div>
      <div class="ctl" style="margin-top:8px"><input type="text" id="lg_q" placeholder="Cari kata (mis. dslr, printer, error)" value="${esc(LG.q)}" maxlength="60">
        <label class="small" style="white-space:nowrap"><input type="checkbox" id="lg_act" ${LG.activity ? "checked" : ""}> sertakan catatan aktivitas</label>
        <button class="btn dark" data-act="lg-get">Ambil log</button><button class="btn" data-act="lg-today">Hari ini</button></div>
      <div id="t-log" style="margin-top:6px">${logHtml(TOOL_LAST["logs.read"])}</div></div></section>
    </div>`;
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
    else if (act === "discard") { S.dirty = {}; renderTab(); updateBar(); }
    else if (act === "sec") { S.sec = el.dataset.sec; S.q = ""; const q = document.getElementById("sq"); if (q) q.value = ""; refreshSettings(); window.scrollTo(0, 0); }
    else if (act === "exp-read") { el.disabled = true; try { await readCam(); } finally { refreshPboxes(); } }
    else if (act === "per-add" || act === "per-del" || act === "per-fill") await perAction(act, el);
    else if (act === "mv") moveStep(el.dataset.path, Number(el.dataset.i), Number(el.dataset.d));
    else if (act === "lg-get" || act === "lg-today" || act === "lg-date") {
      if (act === "lg-today") { const e = document.getElementById("lg_date"); if (e) e.value = ""; }
      if (act === "lg-date") { const e = document.getElementById("lg_date"); if (e) e.value = el.dataset.d; }
      const v = (i) => document.getElementById(i)?.value || "";
      Object.assign(LG, { date: v("lg_date"), from: v("lg_from"), to: v("lg_to"), level: v("lg_level") || "all", tail: Number(v("lg_tail")) || 400, q: v("lg_q").trim(), activity: !!document.getElementById("lg_act")?.checked });
      el.disabled = true;
      try { await runTool("logs.read", { date: LG.date || undefined, level: LG.level, tail: LG.tail, from: LG.from || undefined, to: LG.to || undefined, q: LG.q, activity: LG.activity }, "Ambil log aplikasi"); } finally { if (S.tab === "alat") renderTab(); }
    }
    else if (act === "lg-copy" || act === "lg-dl") {
      const d = TOOL_LAST["logs.read"]?.result?.data; if (!d) return; const txt = logText(d, S.booth.name);
      if (act === "lg-copy") { try { await navigator.clipboard.writeText(txt); toast("Log disalin.", "ok"); } catch { toast("Tidak bisa menyalin; pakai Unduh.", "bad"); } }
      else { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain;charset=utf-8" })); a.download = `log-${S.booth.name.replace(/[^\w-]+/g, "_")}-${d.date}.txt`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
    }
    else if (act === "tool") { el.disabled = true; try { await runTool(el.dataset.t); } finally { if (S.tab === "alat") renderTab(); } }
    else if (act === "archive") { const d = Number(document.getElementById("arcdays")?.value); if (!Number.isInteger(d) || d < 7 || d > 3650) return toast("Isi batas hari antara 7 dan 3650.", "bad"); if (confirm(`Hapus SEMUA arsip foto yang lebih tua dari ${d} hari di booth ini? Tidak bisa dibatalkan.`)) { el.disabled = true; try { await runTool("tools.archive_cleanup", { days: d }); await runTool("tools.storage", { fresh: true }, "Cek penyimpanan"); } finally { if (S.tab === "alat") renderTab(); } } }
    else if (act === "exp-set") { const p = el.dataset.prop, v = document.getElementById("exp_" + p)?.value; el.disabled = true; try { const c = await runTool("camera.exposure.set", { prop: p, value: String(v) }); if (c?.status === "done") await runTool("camera.exposure.get", undefined, "Baca setelan kamera"); } finally { if (S.tab === "alat") renderTab(); } }
    else if (act === "preset") { S.txQ.preset = el.dataset.p; renderTx(true); }
    else if (act === "more") { S.txQ.limit += 50; renderTx(false); }
    else if (act === "csv") csv();
  } catch (er) { toast(er.message, "bad"); }
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset?.per && el.tagName === "INPUT" && el.type === "text") onPerInput(el);
  else if (el.dataset?.path && el.type !== "checkbox" && el.tagName !== "SELECT") onSettingInput(el);
  else if (el.id === "sq") { S.q = el.value; refreshSettings(); }
  else if (el.id === "txq") { S.txQ.q = el.value; debTx(); }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset?.prof) onProfInput(el);
  else if (el.dataset?.per) onPerInput(el);
  else if (el.dataset?.path && (el.type === "checkbox" || el.tagName === "SELECT")) onSettingInput(el);
  else if (el.id === "txs") { S.txQ.status = el.value; renderTx(true); }
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
    if (S.tab === "setelan" && !dirtyCount() && ev?.what === "hello") { const t = document.getElementById("tabc"); if (t && !t.contains(document.activeElement)) t.innerHTML = settingsHtml(S.booth); updateBar(); }
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
    if (!S.booth || S.booth.id !== id) { S.dirty = {}; S.tx = null; S.txQ = null; S.q = ""; S.expInfo = undefined; for (const k in TOOL_LAST) delete TOOL_LAST[k]; }
    await loadBooth(id); detailShell();
  } catch (e) { if (S.me) { toast(e.message, "bad"); location.hash = "#/"; } }
}
async function start() {
  try { S.spec = await api("/api/spec"); S.fields = {}; S.spec.sections.forEach((sc) => sc.groups.forEach((g) => g.fields.forEach((f) => { S.fields[f.path] = f; }))); openES(); await show(); } catch (e) { if (S.me) toast(e.message, "bad"); }
}
(async () => {
  try { const m = await api("/api/me"); if (m.user) { S.me = m; start(); } else renderLogin(); } catch { renderLogin(); }
})();
})();
