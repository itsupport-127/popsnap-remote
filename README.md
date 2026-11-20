# POPSNAP Remote Booth

Web ringan (Node + SQLite + HTML biasa, **tanpa build**, ±1 container kecil) untuk memantau dan mengendalikan semua booth photobox dari satu halaman.

**Cara kerja:** tiap booth menyambung KELUAR ke server ini (jadi tidak perlu port masuk / IP publik di booth). Perintah dari web didorong ke booth lewat long-poll, tampilan web diperbarui live lewat SSE (tanpa refresh).

## Yang bisa dilakukan
- Daftar booth: online/offline, layar yang sedang tampil, transaksi & omzet hari ini (live).
- Kontrol: kunci/buka booth (dengan pesan di layar), batalkan sesi, muat ulang tampilan, tes koneksi.
- Pengaturan aman: harga mode, jumlah foto, timer, cetak/Add Print, mode bayar, warna, jadwal kamera, nama event.
- Transaksi lengkap per booth (filter tanggal/status/cari, sembunyikan TEST, Add Print ditandai, unduh CSV).
- Riwayat perintah (siapa, kapan, berhasil/gagal).

**Tidak bisa diubah dari jarak jauh (sengaja):** kunci pembayaran (Midtrans/DOKU), PIN, token kasir, folder penyimpanan, template. Daftar yang diizinkan ada di `src/spec.js` dan diperiksa ULANG di booth (`backend/remoteSpec.js`).

## Deploy (Docker)
```bash
git clone <repo> popsnap-remote && cd popsnap-remote
cp .env.example .env        # isi ADMIN_USER & ADMIN_PASSWORD (panjang!)
docker compose up -d --build
curl http://127.0.0.1:8090/healthz   # -> ok
```
Container hanya membuka `127.0.0.1:8090`. Pasang HTTPS di depannya (WAJIB, karena ada login):

**nginx** (SSE butuh buffering mati):
```nginx
server {
  server_name remote.domainanda.com;
  # listen 443 ssl; + sertifikat (certbot / Cloudflare origin cert)
  location / {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # untuk live (SSE)
    proxy_read_timeout 120s;      # > 25 dtk long-poll
  }
}
```
Alternatif tanpa buka port: Cloudflare Tunnel ke `http://localhost:8090`.

## Menyambungkan booth
1. Buka web → **+ Tambah booth** → beri nama → salin **token** (hanya tampil sekali).
2. Di app photobox: **Admin → Remote** → isi alamat server + token → centang aktifkan → **Tes koneksi** → **Simpan**.
3. Dalam ±10 detik booth tampil online.

Ganti token (mis. token bocor): hapus & buat booth lagi, atau panggil `POST /api/booths/:id/token` (token lama langsung mati).

## Keamanan
- Login admin dengan batas percobaan (8 gagal / 10 menit / IP), cookie HttpOnly + SameSite, cek Origin untuk aksi tulis.
- Token booth disimpan **hash**-nya saja (SHA-256) di server.
- Perintah ke booth hanya dari daftar tetap (kunci, buka, batal sesi, muat ulang, ubah setelan aman, ping).
- Satu akun admin (dari `.env`). Butuh banyak akun / peran? Belum ada di v1.

## Data & backup
Semua di `./data/remote.db` (SQLite). Backup = salin file itu. Riwayat transaksi menumpuk selama booth tersambung (booth mengirim 60 transaksi terbaru tiap perubahan).

## Uji
```bash
npm install && npm test
```
