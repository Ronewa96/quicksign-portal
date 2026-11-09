#!/usr/bin/env bash
# One-time setup (and later updates) of QuickSign on an Oracle Cloud Ubuntu server.
# Run from the unpacked project folder:  bash deploy/setup-oracle.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing Docker (skipped if already installed)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "==> Opening ports 80 and 443 in the server's own firewall"
# Oracle's Ubuntu images block everything except SSH with iptables, on top of the cloud security list
for port in 80 443; do
  sudo iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 1 -p tcp -m state --state NEW --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save
fi

echo "==> Preparing settings (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
fi
if ! grep -q '^SITE_ADDRESS=' .env; then
  PUBLIC_IP="$(curl -fsS https://api.ipify.org)"
  # sslip.io turns the IP into a free web address that can get an HTTPS certificate
  HOST="${PUBLIC_IP//./-}.sslip.io"
  sed -i "s#^APP_URL=.*#APP_URL=\"https://${HOST}\"#" .env
  printf '\n# Web address served by Caddy (HTTPS is set up automatically)\nSITE_ADDRESS=%s\n' "$HOST" >> .env
fi
mkdir -p data

echo "==> Building and starting QuickSign (the first build takes 5-15 minutes)"
sudo docker compose up -d --build

SITE="$(grep '^SITE_ADDRESS=' .env | cut -d= -f2)"
echo
echo "QuickSign is starting at:  https://${SITE}"
echo "If the page doesn't load within a minute or two, check: sudo docker compose logs -f"
