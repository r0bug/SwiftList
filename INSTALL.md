# Installing swiftlist locally

Standalone — no listflow or comptool required. Sets up its own Postgres database.

## Prereqs

- **Node.js 20+** — `node -v`
- **PostgreSQL 14+** running locally — OR Docker, in which case use the bundled `docker-compose.yml`
- **(optional) Anthropic API key** — without it, vision analysis returns mocks but the rest of the app works

## Quick install (5 minutes)

```bash
tar -xzf swiftlist.tar.gz
cd swiftlist
./install.sh
```

The script:
1. Verifies Node 20+ and Postgres tooling
2. Generates `.env` from `.env.example` (random JWT_SECRET)
3. Pauses so you can edit `.env` (most importantly: `ANTHROPIC_API_KEY`)
4. Creates the `swiftlist` Postgres role + database (asks for sudo if needed to talk to the local `postgres` superuser)
5. `npm install`
6. Runs Prisma generate + migrate
7. Briefly boots the server, mints an extension API key, and prints it

If you don't have Postgres locally:

```bash
docker compose up -d postgres
./install.sh
```

## Manual install

```bash
cp .env.example .env
# Edit .env: ANTHROPIC_API_KEY, JWT_SECRET (openssl rand -hex 32)

# Create DB role + database (skip if you've changed DATABASE_URL):
sudo -u postgres psql <<SQL
CREATE ROLE swiftlist LOGIN PASSWORD 'swiftlist' CREATEDB;
CREATE DATABASE swiftlist OWNER swiftlist;
SQL

npm install
npx prisma migrate deploy   # or `migrate dev --name init` first time

# Mint an API key:
npm run dev:server &
sleep 4
curl -X POST -H "Content-Type: application/json" \
  -d '{"name":"local"}' \
  http://localhost:3004/api/v1/extension/register
kill %1
```

## Run it

In three terminals (or use a process manager):

```bash
npm run dev:server    # API on :3004
npm run dev:client    # web UI on :5173 (proxies API calls to :3004)
npm run dev:watcher   # folder watcher daemon
```

Web UI: <http://localhost:5173>

## Load the Chrome extension

1. `chrome://extensions` → toggle **Developer mode** (top right)
2. Click **Load unpacked**, pick `swiftlist/packages/extension`
3. Click the swiftlist icon → **Open options** (cog)
4. **Base URL**: `http://localhost:3004`
5. **API key**: paste what `install.sh` printed
6. **Save & test** → should turn green.

## Use it

- Drop photos into your watch folder (default: `$PWD/inbox`, populated by `install.sh`; set `SWIFTLIST_WATCH_FOLDER` in `.env` to override).
- Log in to the web UI as `john@robug.com` / `ListFast` (seeded by `install.sh`). Change the password under Settings → Account.
- Plug in a phone or camera with a `DCIM/` folder — the watcher auto-imports.
- Watch Items appear in the web UI (`http://localhost:5173`).
- Open the extension popup → **Find sold like this →** for an Item that needs a sold-comp match. Land on the eBay sold search; click **Associate** on a result, or open it and click **Pull into swiftlist**.
- On any eBay listing/draft page (`/sl/sell`, `/lstng`), the swiftlist banner offers **Fill missing** / **Force overwrite**. Reopen the same draft any time and **Fill missing** picks up where you left off without overwriting your edits.

---

## Push to GitHub

The bundle has no `.git/` directory — initialize fresh:

```bash
cd swiftlist
git init -b main
git add -A
git commit -m "Initial commit (from swiftlist v0.1.0 bundle)"

# Create the GitHub repo + push (uses your `gh` auth):
gh repo create r0bug/swiftlist --public --source=. --push --description "Local-first eBay listing assistant"

# OR if you've already created the repo on github.com:
git remote add origin git@github.com:r0bug/swiftlist.git
git push -u origin main
```

`gh` reads its token from `~/.config/gh/hosts.yml`. If `gh auth status` complains, run `gh auth login` first.

If you'd rather use the SSH form, make sure `ssh -T git@github.com` works.

After the first push, the normal cycle is:

```bash
git add -A
git commit -m "your message"
git push
```

---

## Troubleshooting

**`Error: P3014` from prisma migrate** — your DB user can't create the shadow database. Fix:
```sql
ALTER USER swiftlist CREATEDB;
```

**`pino-pretty` errors on startup** — only used in dev; install with `npm i -D pino-pretty -w @swiftlist/server` if missing.

**Extension shows "No swiftlist API key set"** — open the extension's options page and paste it. Use **Save & test** to verify the server is reachable.

**Image URLs broken in the extension** — your DB has `http://localhost:3004/...` paths. If the extension runs on a different machine than the server, set `PUBLIC_IMAGE_BASE_URL` to a publicly reachable URL (a Tailscale/Cloudflare tunnel works). Existing rows won't auto-update — reprocess or update via SQL.

**Port 3004 conflict** — change `PORT` in `.env` and update the extension's base URL to match.

**Watcher doesn't see new files** — confirm `SWIFTLIST_WATCH_FOLDER` matches where you're dropping photos, and that the watcher process is actually running (`ps aux | grep watcher`).
