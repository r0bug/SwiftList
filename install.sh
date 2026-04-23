#!/usr/bin/env bash
# swiftlist installer — standalone, no listflow required.
#
# LOOP-UNTIL-DONE installer. Safe to Ctrl+C and re-run at any point:
#   - Each step is idempotent (guards on "is this already done?" first).
#   - On failure, a step retries up to 3 times with a short backoff before
#     giving up; re-running the script picks up where you left off.
#   - We deliberately DO NOT `set -e` — the driver loop manages errors per
#     step so one transient failure doesn't nuke the whole install.
#
# Nothing in your .env is ever overwritten: only blank/placeholder values
# are filled in with sensible defaults derived from $PWD.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# ── pretty printers ──────────────────────────────────────────────────
bold() { printf "\033[1m%s\033[0m\n" "$*"; }
red()  { printf "\033[31m%s\033[0m\n" "$*"; }
grn()  { printf "\033[32m%s\033[0m\n" "$*"; }
ylw()  { printf "\033[33m%s\033[0m\n" "$*"; }
dim()  { printf "\033[2m%s\033[0m\n" "$*"; }

# ── portable in-place sed ────────────────────────────────────────────
# Usage: sed_i "s|a|b|" file
sed_i() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    # BSD/macOS sed requires an explicit empty suffix for -i
    local expr="$1"; shift
    sed -i '' "$expr" "$@"
  fi
}

KEY_FILE="$SCRIPT_DIR/.swiftlist-extension-key"

# ════════════════════════════════════════════════════════════════════
# STEPS — each returns 0 on success, non-zero on failure.
# Each step starts with an idempotency guard and returns fast when
# the work is already done.
# ════════════════════════════════════════════════════════════════════

check_node() {
  # Guard: node present and >= 18.18
  if ! command -v node >/dev/null 2>&1; then
    red "Need Node.js 18.18+ (20 LTS recommended): https://nodejs.org/"
    return 1
  fi
  local ok
  ok=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.stdout.write(a>20||a===20||(a===18&&b>=18)||a===19?"ok":"no")' 2>/dev/null)
  if [ "$ok" != "ok" ]; then
    red "Node 18.18+ required (have $(node -v))."
    echo "  Recommended: nvm install 20 && nvm use 20"
    echo "  Or:          curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs"
    return 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    red "npm missing"
    return 1
  fi
  grn "✓ Node $(node -v)"
  return 0
}

check_postgres_tooling() {
  if command -v psql >/dev/null 2>&1 || command -v docker >/dev/null 2>&1; then
    grn "✓ Postgres tooling present"
    return 0
  fi
  red "Need either psql (PostgreSQL client) or docker."
  echo "  Install Postgres:    https://www.postgresql.org/download/"
  echo "  Or install Docker and use the bundled docker-compose.yml"
  return 1
}

ensure_env() {
  # Guard: copy .env from template if missing.
  if [ ! -f .env ]; then
    if [ ! -f .env.example ]; then
      red ".env.example missing — can't bootstrap .env"
      return 1
    fi
    cp .env.example .env
    ylw "→ Created .env from .env.example"
  fi

  # Fill defaults for blank/placeholder values. NEVER overwrites a real value.
  # Helper: is the value for KEY either missing, empty-string, or the known placeholder?
  _val() { grep -E "^$1=" .env | head -n1 | sed -E 's/^[^=]+=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'; }
  _set() {
    # _set KEY "value"
    local key="$1" val="$2"
    if grep -qE "^$key=" .env; then
      # escape pipe/ampersand/backslash for sed replacement
      local esc
      esc=$(printf '%s' "$val" | sed -e 's/[\\&|]/\\&/g')
      sed_i "s|^$key=.*|$key=\"$esc\"|" .env
    else
      printf '%s="%s"\n' "$key" "$val" >>.env
    fi
  }
  _blankish() {
    # True if value is empty or one of our known placeholders.
    case "$1" in
      ""|"CHANGE_ME_run_openssl_rand_-hex_32") return 0 ;;
      *) return 1 ;;
    esac
  }

  # JWT_SECRET
  if _blankish "$(_val JWT_SECRET)"; then
    local jwt
    if command -v openssl >/dev/null 2>&1; then
      jwt=$(openssl rand -hex 32)
    else
      jwt=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    fi
    _set JWT_SECRET "$jwt"
    ylw "→ Generated JWT_SECRET"
  fi

  # PUBLIC_IMAGES_DIR
  if _blankish "$(_val PUBLIC_IMAGES_DIR)"; then
    _set PUBLIC_IMAGES_DIR "$PWD/public-images"
    ylw "→ Set PUBLIC_IMAGES_DIR=$PWD/public-images"
  fi

  # UPLOADS_DIR
  if _blankish "$(_val UPLOADS_DIR)"; then
    _set UPLOADS_DIR "$PWD/uploads"
    ylw "→ Set UPLOADS_DIR=$PWD/uploads"
  fi

  # SWIFTLIST_WATCH_FOLDER (also mkdir -p)
  if _blankish "$(_val SWIFTLIST_WATCH_FOLDER)"; then
    _set SWIFTLIST_WATCH_FOLDER "$PWD/inbox"
    ylw "→ Set SWIFTLIST_WATCH_FOLDER=$PWD/inbox"
  fi
  local watch_folder
  watch_folder=$(_val SWIFTLIST_WATCH_FOLDER)
  [ -n "$watch_folder" ] && mkdir -p "$watch_folder"

  # PUBLIC_IMAGE_BASE_URL (depends on PORT)
  if _blankish "$(_val PUBLIC_IMAGE_BASE_URL)"; then
    local port
    port=$(_val PORT)
    [ -z "$port" ] && port=3004
    _set PUBLIC_IMAGE_BASE_URL "http://localhost:$port"
    ylw "→ Set PUBLIC_IMAGE_BASE_URL=http://localhost:$port"
  fi

  # Make sure the output dirs exist so subsequent steps don't trip.
  mkdir -p "$PWD/uploads" "$PWD/public-images/swiftlist" "$PWD/dist"

  grn "✓ .env populated"
  return 0
}

source_env() {
  if [ ! -f .env ]; then
    red ".env missing — ensure_env must run first"
    return 1
  fi
  set -o allexport
  # shellcheck disable=SC1091
  . ./.env
  set +o allexport
  if [ -z "${DATABASE_URL:-}" ]; then
    red "DATABASE_URL is empty in .env"
    return 1
  fi
  grn "✓ Sourced .env"
  return 0
}

_db_reachable() {
  command -v psql >/dev/null 2>&1 && psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1
}

ensure_database() {
  # Guard: already reachable?
  if _db_reachable; then
    grn "✓ Database reachable"
    return 0
  fi

  local db_name db_user
  db_name=$(printf '%s' "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')
  db_user=$(printf '%s' "$DATABASE_URL" | sed -E 's|^[a-z]+://([^:]+):.*|\1|')

  # Try docker compose's bundled postgres if we have docker + compose file.
  if [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1; then
    ylw "→ Trying docker compose up -d postgres..."
    if docker compose up -d postgres >/dev/null 2>&1 || docker-compose up -d postgres >/dev/null 2>&1; then
      local i
      for i in $(seq 1 30); do
        if _db_reachable; then
          grn "✓ Database reachable via docker (after ${i}s)"
          return 0
        fi
        sleep 1
      done
      ylw "  docker postgres didn't become reachable in 30s"
    else
      ylw "  docker compose unavailable, continuing..."
    fi
  fi

  # Fall back to local postgres superuser via sudo.
  if command -v sudo >/dev/null 2>&1 && id -u postgres >/dev/null 2>&1; then
    ylw "→ Creating role '$db_user' + db '$db_name' via local postgres superuser..."
    sudo -u postgres psql <<SQL 2>/dev/null || true
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='$db_user') THEN
    CREATE ROLE "$db_user" LOGIN PASSWORD 'swiftlist' CREATEDB;
  ELSE
    ALTER ROLE "$db_user" CREATEDB;
  END IF;
END \$\$;
SQL
    sudo -u postgres createdb -O "$db_user" "$db_name" 2>/dev/null || true
  fi

  if _db_reachable; then
    grn "✓ Database now reachable"
    return 0
  fi

  red "Can't reach the database at DATABASE_URL."
  echo "  Edit .env or run: docker compose up -d postgres"
  return 1
}

ensure_node_modules() {
  # Guard: node_modules fresh relative to package-lock.json mtime?
  if [ -d node_modules ] && [ -f node_modules/.package-lock.json ] && [ -f package-lock.json ]; then
    # If lockfile-marker inside node_modules is newer than (or equal to) package-lock.json, we're fresh.
    if [ ! package-lock.json -nt node_modules/.package-lock.json ]; then
      grn "✓ node_modules fresh"
      return 0
    fi
    ylw "→ package-lock.json newer than installed modules — reinstalling"
  elif [ -d node_modules ]; then
    ylw "→ node_modules exists but no lockfile marker — reinstalling"
  fi
  bold "Installing npm dependencies (this can take a few minutes)..."
  npm install --no-audit --no-fund
  return $?
}

prisma_migrate() {
  # migrate deploy is idempotent; it's a no-op if nothing new to apply.
  # If there are no migration files yet (fresh checkout), deploy fails —
  # fall back to migrate dev --name init, which creates + applies.
  bold "Applying Prisma migrations..."
  if npx prisma migrate deploy; then
    grn "✓ prisma migrate deploy ok"
    return 0
  fi
  ylw "→ migrate deploy failed, trying migrate dev --name init..."
  if npx prisma migrate dev --name init; then
    grn "✓ prisma migrate dev ok"
    return 0
  fi
  return 1
}

prisma_generate() {
  # `prisma generate` is cheap and idempotent — skip the guard, just run it.
  bold "Generating Prisma client..."
  npx prisma generate
  return $?
}

prisma_seed() {
  # seed.ts uses upsert — idempotent by design.
  bold "Seeding default user..."
  npx prisma db seed
  return $?
}

mint_extension_key() {
  # Guard: do we already have a non-revoked "local-extension" key in the DB?
  local exists=""
  if command -v psql >/dev/null 2>&1; then
    exists=$(psql "$DATABASE_URL" -tAc \
      "SELECT EXISTS(SELECT 1 FROM swiftlist.\"ApiKey\" WHERE name='local-extension' AND \"revokedAt\" IS NULL);" 2>/dev/null || echo "")
  fi
  if [ "$exists" = "t" ]; then
    grn "✓ Extension API key already minted (already minted)"
    if [ -f "$KEY_FILE" ]; then
      dim "  Plaintext copy: $KEY_FILE"
    else
      ylw "  Note: DB has a key but $KEY_FILE is missing."
      ylw "  Extension key plaintext cannot be recovered. To rotate:"
      ylw "    psql \"\$DATABASE_URL\" -c \"UPDATE swiftlist.\\\"ApiKey\\\" SET \\\"revokedAt\\\"=NOW() WHERE name='local-extension';\""
      ylw "  then re-run ./install.sh"
    fi
    return 0
  fi

  # Boot the server briefly and POST to register endpoint.
  bold "Minting an extension API key..."
  local log resp key
  log=$(mktemp)
  ( npm run dev:server >"$log" 2>&1 ) &
  local server_pid=$!
  _cleanup() { kill "$server_pid" 2>/dev/null || true; }
  trap _cleanup RETURN

  local i ready=""
  for i in $(seq 1 40); do
    sleep 0.5
    if curl -fs "http://localhost:${PORT:-3004}/api/v1/health" >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
      break
    fi
  done
  if [ -z "$ready" ]; then
    red "Server didn't come up in time. Last 20 log lines:"
    tail -20 "$log"
    _cleanup
    trap - RETURN
    return 1
  fi

  resp=$(curl -fs -X POST -H "Content-Type: application/json" \
    -d '{"name":"local-extension"}' \
    "http://localhost:${PORT:-3004}/api/v1/extension/register" 2>/dev/null || echo "")
  key=$(printf '%s' "$resp" | grep -o '"apiKey":"[^"]*"' | cut -d'"' -f4)

  _cleanup
  trap - RETURN

  if [ -z "$key" ]; then
    red "Couldn't mint an API key. Server log tail:"
    tail -20 "$log"
    return 1
  fi

  # Persist plaintext locally (chmod 600) so re-runs can show it again.
  printf '%s\n' "$key" >"$KEY_FILE"
  chmod 600 "$KEY_FILE" 2>/dev/null || true
  grn "✓ Minted extension API key (stored in .swiftlist-extension-key)"
  return 0
}

write_extension_defaults() {
  # Bundle the minted key + local URLs into packages/extension/defaults.js
  # so the Chrome extension is pre-configured on Load unpacked. Idempotent —
  # re-runs overwrite with current values. Git-ignored by design.
  local key=""
  if [ -f "$KEY_FILE" ]; then
    key=$(head -n 1 "$KEY_FILE" | tr -d '\r\n')
  fi
  local web_port="${VITE_PORT:-5173}"
  local api_port="${PORT:-3004}"
  local base_url="http://localhost:${api_port}"
  local web_url="http://localhost:${web_port}"
  local path="packages/extension/defaults.js"
  cat >"$path" <<EOF
// Auto-generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Git-ignored.
// Regenerate by re-running ./install.sh. Safe to delete; lib/api.js falls
// back to localhost defaults.
window.__swiftlist_defaults = {
  baseUrl: '${base_url}',
  apiKey: '${key}',
  webUrl: '${web_url}',
};
EOF
  grn "✓ Wrote $path"
  return 0
}

# ════════════════════════════════════════════════════════════════════
# DRIVER LOOP
# ════════════════════════════════════════════════════════════════════

bold "swiftlist installer"
echo

STEPS=(
  check_node
  check_postgres_tooling
  ensure_env
  source_env
  ensure_database
  ensure_node_modules
  prisma_migrate
  prisma_generate
  prisma_seed
  mint_extension_key
  write_extension_defaults
)

declare -A DONE=()
MAX_RETRIES=3

for step in "${STEPS[@]}"; do
  if [ "${DONE[$step]:-}" = "1" ]; then
    continue
  fi
  attempt=1
  while : ; do
    dim "── step: $step (attempt $attempt/$MAX_RETRIES)"
    if "$step"; then
      DONE[$step]=1
      break
    fi
    if [ "$attempt" -ge "$MAX_RETRIES" ]; then
      red "Step '$step' failed after $MAX_RETRIES attempts."
      case "$step" in
        check_node)            echo "  Install Node 18.18+ (20 LTS recommended) and re-run ./install.sh";;
        check_postgres_tooling) echo "  Install psql or docker and re-run ./install.sh";;
        ensure_env)            echo "  Check that .env.example exists and .env is writable";;
        source_env)            echo "  Check DATABASE_URL is set in .env";;
        ensure_database)       echo "  Fix DATABASE_URL or start Postgres (docker compose up -d postgres) and re-run";;
        ensure_node_modules)   echo "  Check network / npm registry access, then re-run";;
        prisma_migrate)        echo "  Check DB permissions (ALTER USER <user> CREATEDB;) and re-run";;
        prisma_generate)       echo "  Inspect the error above and re-run ./install.sh";;
        prisma_seed)           echo "  Check the seed script in prisma/seed.ts, then re-run";;
        mint_extension_key)    echo "  See log above. You can re-run ./install.sh to retry.";;
        write_extension_defaults) echo "  Check packages/extension is writable";;
      esac
      exit 1
    fi
    ylw "  retrying in 2s..."
    sleep 2
    attempt=$((attempt + 1))
  done
done

# ════════════════════════════════════════════════════════════════════
# SUMMARY
# ════════════════════════════════════════════════════════════════════

# Best-effort pull of the plaintext key for the summary block.
KEY_DISPLAY=""
if [ -f "$KEY_FILE" ]; then
  KEY_DISPLAY=$(cat "$KEY_FILE" 2>/dev/null || echo "")
fi
if [ -z "$KEY_DISPLAY" ]; then
  KEY_DISPLAY="(already minted; plaintext not available — see troubleshooting)"
fi

cat <<EOF

$(grn "════════════════════════════════════════════════════════════")
$(grn "  swiftlist installed.")
$(grn "════════════════════════════════════════════════════════════")

  API key (paste into the Chrome extension):
      $KEY_DISPLAY

  Default login (change it in Settings):
      Email:    john@robug.com
      Password: ListFast

  Run:
      npm run dev:server     # API on :${PORT:-3004}
      npm run dev:client     # web UI on :5173
      npm run dev:watcher    # folder watcher daemon

  Web UI:           http://localhost:5173
  Extension URL:    http://localhost:${PORT:-3004}
  Watch folder:     ${SWIFTLIST_WATCH_FOLDER:-(unset)}

  Load the Chrome extension:
      1. chrome://extensions → toggle "Developer mode"
      2. Click "Load unpacked", pick:
         $SCRIPT_DIR/packages/extension
      3. Click the extension icon → Open options
      4. Base URL: http://localhost:${PORT:-3004}
      5. Paste the API key above, Save & test.

  See INSTALL.md for git push instructions.
EOF
