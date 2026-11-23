# Production Infrastructure Setup

Hosting runs on the existing LeaseWeb VPS behind Cloudflare (no OpenTofu).

## 1. Cloudflare (one-time, manual)
1. Create a proxied `A` (and/or `AAAA`) DNS record pointing your subdomain (e.g. `geo-coach.example.com`) at the VPS IP.
2. Set SSL/TLS encryption mode to **Full (strict)**.
3. Generate a **Cloudflare Origin CA** certificate + private key for the subdomain.

## 2. VPS Bootstrap (one-time, manual)
1. SSH into the VPS as root and run `infra/bootstrap.sh`.
2. Add the GitHub Actions SSH deploy public key to `/home/deploy/.ssh/authorized_keys`.
3. Capture the host key (`ssh-keyscan <vps-ip>`) for the `SSH_KNOWN_HOSTS` secret.

## 3. GitHub `production` Environment & GHCR
1. Create a GitHub environment named `production` restricted to the `main` branch.
2. Add secrets to `production`:
   - `VPS_HOST`, `SSH_DEPLOY_KEY`, `SSH_KNOWN_HOSTS`
   - `DOMAIN`
   - `POSTGRES_PASSWORD`
   - `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
   - `CF_ORIGIN_CERT`, `CF_ORIGIN_KEY`
3. After the first push to `main`, mark the GHCR packages (`geo-coach-web`, `geo-coach-companion`, `geo-coach-transcriber`) as **public** once by hand.

## 4. Rollback & Migrations
- Every migration follows the **expand/contract** rule (compatible with the previous release).
- To roll back, trigger `Deploy` via `workflow_dispatch` with an earlier SHA tag.
- Pre-migration dumps live in `/srv/geo-coach/dumps/` (last 5 kept).
- House rule: **don't deploy mid-Session**.

## 5. Data to back up
- **Postgres** (`pgdata` volume): everything except Source images. The pre-migration dumps above are not a backup.
- **Source images** (`source-images` volume, mounted at `/data/source-images` in `web`): images of knowledge bank Sources, which the database only references. A database backup without this volume restores Claims whose images are missing, so back up both together (#22).
