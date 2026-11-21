#!/usr/bin/env bash
# Idempotent LeaseWeb VPS bootstrap script — run by hand as root once, never by CI.
set -euo pipefail

DEPLOY_USER="deploy"
APP_DIR="/srv/geo-coach"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg ufw unattended-upgrades

# Install Docker Engine + Compose plugin if missing
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# Create deploy user in docker group
if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G docker "${DEPLOY_USER}"
else
  usermod -aG docker "${DEPLOY_USER}"
fi

mkdir -p "/home/${DEPLOY_USER}/.ssh" "${APP_DIR}/certs" "${APP_DIR}/dumps"
chmod 700 "/home/${DEPLOY_USER}/.ssh"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh" "${APP_DIR}"

# Harden SSH: key-only, no root login, no password auth (01- prefix beats 50-cloud-init.conf)
cat >/etc/ssh/sshd_config.d/01-geocoach.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
sshd -t
systemctl reload ssh || systemctl reload sshd

# Firewall: SSH open for GitHub Actions runners; 80/443 only from Cloudflare IP ranges
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp

for cidr in $(curl -fsSL https://www.cloudflare.com/ips-v4); do
  ufw allow from "${cidr}" to any port 80 proto tcp
  ufw allow from "${cidr}" to any port 443 proto tcp
done
for cidr in $(curl -fsSL https://www.cloudflare.com/ips-v6); do
  ufw allow from "${cidr}" to any port 80 proto tcp
  ufw allow from "${cidr}" to any port 443 proto tcp
done
ufw --force enable

dpkg-reconfigure -f noninteractive unattended-upgrades

echo "Bootstrap complete. Add the GitHub deploy public key to /home/${DEPLOY_USER}/.ssh/authorized_keys."
