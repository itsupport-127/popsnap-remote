#!/usr/bin/env bash
# Setup POPSNAP Remote Booth di VPS (Ubuntu/Debian):
# Docker build + nginx reverse proxy + SSL gratis Let's Encrypt + firewall.
#
# Pakai (sebagai root, di VPS):
#   export DUCK_SH="/path/ke/duckdns/duck.sh"  # opsional, dijalankan sekali
#   export EMAIL="email-anda@contoh.com"       # untuk Let's Encrypt
#   export PUBLIC_PORT=8643                    # port di belakang domain (ganti sesuai selera)
#   bash deploy-popsnap-remote.sh
set -euo pipefail

DOMAIN="${DOMAIN:-remote-popsnap.duckdns.org}"
SUBDOMAIN="${DOMAIN%.duckdns.org}"
EMAIL="${EMAIL:-}"
REPO="${REPO:-https://github.com/itsupport-127/popsnap-remote.git}"
APP_DIR="${APP_DIR:-/opt/popsnap-remote}"
PUBLIC_PORT="${PUBLIC_PORT:-8643}"   # port HTTPS di belakang domain
HOST_PORT="${HOST_PORT:-8090}"   # port di 127.0.0.1 VPS untuk container (ganti jika bentrok)
APP_PORT=8090   # hanya 127.0.0.1, tidak dibuka ke internet

[ "$(id -u)" -eq 0 ] || { echo "Jalankan sebagai root (sudo -i)."; exit 1; }
[ -n "$EMAIL" ] || { echo "Isi dulu: export EMAIL=email-anda@contoh.com"; exit 1; }

echo "==> [1/7] Paket dasar"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates nginx certbot python3-certbot-nginx dnsutils ufw

echo "==> [2/7] Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version >/dev/null

echo "==> [3/7] Cek DuckDNS (pakai duck.sh yang sudah Anda siapkan, tidak diubah)"
PUBIP="$(curl -fsS https://api.ipify.org)"
echo "IP publik VPS: $PUBIP"
# Opsional: jalankan duck.sh Anda sekali, mis. DUCK_SH=/root/duckdns/duck.sh
if [ -n "${DUCK_SH:-}" ] && [ -x "$DUCK_SH" ]; then "$DUCK_SH" || true; sleep 3; fi

echo "==> Menunggu DNS ${DOMAIN} mengarah ke ${PUBIP} ..."
for i in $(seq 1 30); do
  RESOLVED="$(dig +short "$DOMAIN" @1.1.1.1 | tail -n1 || true)"
  [ "$RESOLVED" = "$PUBIP" ] && break
  sleep 5
done
if [ "${RESOLVED:-}" != "$PUBIP" ]; then
  echo "DNS ${DOMAIN} (=${RESOLVED:-kosong}) belum sama dengan IP VPS (${PUBIP}). Perbaiki di duckdns.org lalu jalankan ulang."
  exit 1
fi

echo "==> [4/7] Ambil kode & build container"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
if [ ! -f .env ]; then
  ADMIN_PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  cat > .env <<EOF
PORT=${APP_PORT}
ADMIN_USER=admin
ADMIN_PASSWORD=${ADMIN_PASS}
ONLINE_SEC=35
EOF
  chmod 600 .env
  echo ">>> LOGIN: admin / ${ADMIN_PASS}   (juga tersimpan di ${APP_DIR}/.env)"
fi
# pastikan port host untuk container belum dipakai program/container lain
if ss -ltnH "sport = :${HOST_PORT}" | grep -q . && ! docker ps --filter "name=^popsnap-remote$" --format '{{.Ports}}' | grep -q ":${HOST_PORT}->"; then
  echo "Port ${HOST_PORT} di VPS sudah dipakai program/container lain:"
  ss -ltnp "sport = :${HOST_PORT}" | sed 's/^/   /'
  echo "Pakai port lain, mis.: sudo HOST_PORT=8091 EMAIL=... bash $0"
  exit 1
fi
sed -i -E "s|\"127\.0\.0\.1:[0-9]+:8090\"|\"127.0.0.1:${HOST_PORT}:8090\"|" docker-compose.yml
# folder data harus bisa ditulis user "node" (uid 1000) di dalam container
mkdir -p data && chown -R 1000:1000 data
docker compose up -d --build

echo "==> Cek health container"
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz"; echo

echo "==> [5/7] nginx: hanya port ${PUBLIC_PORT} (port 80 dibiarkan kosong untuk certbot app lain)"
if ss -ltnH "sport = :${PUBLIC_PORT}" | grep -q . && ! ss -ltnpH "sport = :${PUBLIC_PORT}" | grep -q nginx; then
  echo "Port ${PUBLIC_PORT} sudah dipakai program/container lain:"
  ss -ltnp "sport = :${PUBLIC_PORT}" | sed 's/^/   /'
  echo "Pilih port lain: sudo PUBLIC_PORT=xxxx ..."; exit 1
fi
# situs default bawaan nginx memakai port 80 -> dinonaktifkan agar port 80 bebas
if [ -L /etc/nginx/sites-enabled/default ]; then rm -f /etc/nginx/sites-enabled/default; fi
nginx -t
systemctl enable --now nginx
systemctl reload nginx
sleep 1

echo "==> [6/7] SSL gratis Let's Encrypt (standalone: butuh port 80 kosong sebentar)"
if ss -ltnH "sport = :80" | grep -q .; then
  echo "Port 80 masih dipakai program lain, Let's Encrypt butuh port 80 kosong:"
  ss -ltnp "sport = :80" | sed 's/^/   /'
  exit 1
fi
certbot certonly --standalone -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email -n

cat > /etc/nginx/sites-available/popsnap-remote <<NGINX_HTTPS
server {
  listen ${PUBLIC_PORT} ssl http2;
  listen [::]:${PUBLIC_PORT} ssl http2;
  server_name ${DOMAIN};

  ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;

  location / {
    proxy_pass http://127.0.0.1:${HOST_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$http_host;   # bawa port, supaya cek Origin aplikasi cocok
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_buffering off;        # SSE (live)
    proxy_read_timeout 120s;    # > 25 dtk long-poll booth
  }
}
NGINX_HTTPS
ln -sf /etc/nginx/sites-available/popsnap-remote /etc/nginx/sites-enabled/popsnap-remote

# reload nginx otomatis setelah sertifikat diperpanjang
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
nginx -t
systemctl reload nginx
certbot renew --cert-name "$DOMAIN" --dry-run || echo "PERINGATAN: tes perpanjangan otomatis gagal untuk ${DOMAIN}. Cek: systemctl status certbot.timer"

echo "==> [7/7] Firewall"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "^Status: active"; then
  ufw allow OpenSSH              >/dev/null
  ufw allow 80/tcp               >/dev/null
  ufw allow "${PUBLIC_PORT}/tcp" >/dev/null
  ufw status | sed 's/^/   /'
else
  echo "ufw tidak aktif di VPS ini, jadi TIDAK diaktifkan (agar container lain tidak terganggu)."
  echo "Kalau penyedia VPS punya firewall di panelnya, pastikan port 80 dan ${PUBLIC_PORT} terbuka."
fi

echo
echo "SELESAI."
echo "  Web   : https://${DOMAIN}:${PUBLIC_PORT}/"
echo "  Cek   : curl -I https://${DOMAIN}:${PUBLIC_PORT}/healthz"
echo "  Isi 'alamat server' di app photobox: https://${DOMAIN}:${PUBLIC_PORT}"
echo "  Update: cd ${APP_DIR} && git pull && docker compose up -d --build"
