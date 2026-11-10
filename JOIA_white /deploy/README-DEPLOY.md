# CLUB JOIA 300 (white edition): test server deployment

This folder is a ready-built release. Nothing needs to be installed or compiled on the server
apart from **Node.js** and **PostgreSQL**.

## What the server needs

| | |
|---|---|
| Server | A Linux server or VPS where you can run programs, e.g. Ubuntu 22.04/24.04 (x64 or ARM). Plain PHP/"shared" web hosting **cannot** run this app. |
| Node.js | 20.19 or newer (22 LTS recommended) |
| Database | PostgreSQL 14 or newer, an empty database |
| HTTPS | Required. Sign-in cookies are marked *Secure*, so sign-in does not work over plain `http://`. The phone camera scanner also needs HTTPS. The Caddy setup below gets a free certificate automatically. |
| Domain | A (sub)domain pointing at the server, e.g. `test.your-domain.example` |

There are two ways to install: **A. Docker** (everything in one command) or **B. directly on the server**.

---

## A. With Docker (simplest)

```bash
unzip club-joia-300-white-*.zip && cd club-joia-300-white
cp .env.example .env
nano .env            # fill in NEXT_PUBLIC_APP_URL, AUTH_SECRET, QR_SIGNING_SECRET, POSTGRES_PASSWORD
nano Caddyfile.docker  # put your domain on the first line
docker compose up -d --build
```

Then continue with **First sign-in** below. Run the tools inside the container:
`docker compose exec app node tools/create-admin.mjs you@example.com "Your Name"`.

## B. Directly on the server

```bash
# 1. Unpack (example location /opt/club-joia)
sudo mkdir -p /opt/club-joia && sudo unzip club-joia-300-white-*.zip -d /tmp/joia
sudo cp -a /tmp/joia/club-joia-300-white/. /opt/club-joia/ && cd /opt/club-joia

# 2. Database (if PostgreSQL is not set up yet)
sudo -u postgres psql -c "CREATE USER joia WITH PASSWORD 'choose-a-password';"
sudo -u postgres psql -c "CREATE DATABASE joia OWNER joia;"

# 3. Settings
cp .env.example .env && nano .env      # DATABASE_URL, NEXT_PUBLIC_APP_URL, the two secrets

# 4. Create the tables
node tools/migrate.mjs

# 5. Start (test it in the foreground first, Ctrl+C to stop)
./start.sh
```

Keep it running with systemd: edit `User` / `WorkingDirectory` in `club-joia.service`, then
`sudo cp club-joia.service /etc/systemd/system/ && sudo systemctl enable --now club-joia`.

HTTPS with Caddy: install Caddy (https://caddyserver.com/docs/install), put your domain in
`Caddyfile`, then `sudo cp Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy`.
Using nginx instead? Proxy to `http://127.0.0.1:3000`, pass the `Host` and `X-Forwarded-For`
headers, and set `client_max_body_size 12m`.

---

## First sign-in

Pick **one** of these:

- **Your own super admin (recommended):**
  `node tools/create-admin.mjs you@example.com "Your Name"` prints a one-time password.
  Sign in at `https://<your-domain>/admin/login`, then create events, tiers, members and staff in the admin.
- **Demo data (testing only):** `node tools/seed-demo.mjs` loads the sample Abu Dhabi event,
  tiers, programme, tickets and demo accounts (`alex.carter@joia.test`, `admin@joia.test`, …)
  with the **publicly known development passwords** from the project README. Anyone who knows
  them can sign in, so only use it on a private test server and disable those accounts before
  sharing the address.

## Updating to a new release

1. Stop the app (`sudo systemctl stop club-joia`).
2. Copy the new release over the old folder. **Keep `.env` and the `data/` folder** (uploaded images).
3. `node tools/migrate.mjs`, then start it again.

With Docker: replace the files, then `docker compose up -d --build`. The data stays in Docker volumes.

## Good to know

- **Emails and WhatsApp** are only written to the server log until `EMAIL_DRIVER` /
  `WHATSAPP_DRIVER` are configured in `.env`. Until then, the admin shows one-time activation
  links to copy by hand.
- **Logs:** `journalctl -u club-joia -f` (systemd) or `docker compose logs -f app`.
- **Backups:** back up the PostgreSQL database and the `data/uploads` folder.
- **Port:** the app listens on `127.0.0.1:3000` (set `PORT` / `BIND_ADDRESS` in `.env`).
