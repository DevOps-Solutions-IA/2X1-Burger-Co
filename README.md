# Inventory Fastfood System

Production-oriented monorepo for fast-food inventory, purchases, POS sales, cash control, expenses, daily closing and operational reporting.

## Current state

Implemented in this iteration:
- Runnable pnpm workspace
- NestJS API with Prisma integration
- JWT auth with refresh flow and RBAC
- Refresh token rotation, login throttling and stricter session handling
- Core modules for users, roles, settings, categories, products, ingredients, suppliers, recipes, inventory, purchases, sales, cash sessions, expenses, reports and health
- Dining tables and open order tickets for multi-table service and deferred checkout
- Formal daily closure snapshot on cash close, with historical report storage
- Daily summary, historical closures, printable PDF in Spanish and supply alert endpoints
- Operational summary endpoint that resets the dashboard after closing and requires a new opening
- Manual WhatsApp-ready supplier notification flow with notification log for future automation
- Deterministic seed with admin, cashier, inventory and waiter users, plus dedicated waiter access name + code, business settings, categories, suppliers, products, ingredients and burger recipe
- Product brand is now modeled in the domain (`HOUSE`, `COCA_COLA`, `POSTOBON`, `HIT`, `OTHER`) instead of inferred only in the UI
- Critical backend integration tests covering auth, purchases, sales, stock, cash, daily closure history, supplier notifications, expenses and reports
- Playwright E2E coverage for login, protected dashboard, sidebar navigation, permission-restricted access, cash open/close, POS sale, stock guard, expense registration, report access, historical closure visibility and purchase flow
- Next.js frontend with premium admin shell and a separate waiter order-taking panel, plus connected views for dashboard, categories, products, ingredients, suppliers, purchases, inventory, POS, cash, expenses, recipes, reports, users and settings
- Waiter operational updates in real time through an authenticated operational event stream shared with tables and POS
- Waiter surface prepared as installable PWA with manifest, icons and service worker
- Cash operation hardened with controlled reopen, denomination-based cash counts, classified manual movements and an operational timeline
- Inventory upgraded with guided physical counts, fast waste/damage adjustments and reorder suggestions based on recent consumption
- Executive reporting expanded with hourly sales, product margins, ingredient rotation and day/week/month comparisons
- Production scripts upgraded with rendered nginx configs, HTTPS provisioning helpers, custom-format backups and restore validation
- Docker, docker-compose, nginx, smoke checks and CI

Still pending for a later iteration:
- Production CD to VPS via secrets
- Additional UI depth for recipes/inventory adjustments and broader responsive QA

## Stack

- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS, TanStack Query, React Hook Form, Zod
- Backend: NestJS 11, TypeScript, Prisma
- Database: PostgreSQL
- Auth: JWT access + refresh tokens, RBAC
- Infra: Docker, Docker Compose, Nginx

## Local setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy env file:

```bash
cp .env.example .env
```

3. Start PostgreSQL:

```bash
docker compose up -d postgres
```

4. Generate Prisma client:

```bash
pnpm db:generate
```

5. Run migrations:

```bash
pnpm db:migrate
```

6. Seed the database:

```bash
pnpm db:seed
```

7. Start API and web:

```bash
pnpm dev
```

API default URL:
- `http://localhost:3000`

Web default URL:
- `http://localhost:3001`

If those ports are already taken on your machine, override them:

```bash
PORT=4300 pnpm --filter @inventory-fastfood/api start:dev
PORT=3301 NEXT_PUBLIC_API_URL=http://localhost:4300 pnpm --filter @inventory-fastfood/web dev
```

## Seed credentials

- Email: `admin@2x1burgerco.local`
- Password: `Admin12345*`
- Cashier: `cashier@2x1burgerco.local` / `Cashier12345*`
- Inventory: `inventory@2x1burgerco.local` / `Inventory12345*`
- Waiter panel: `Mesero Principal` / `M124578`
- Waiter technical account: `waiter@2x1burgerco.local`

Override them with `ADMIN_EMAIL`, `CASHIER_EMAIL`, `INVENTORY_EMAIL`, `WAITER_EMAIL`, `WAITER_ACCESS_NAME`, `WAITER_ACCESS_CODE` and matching passwords in `.env`.

## Environment notes

- `.env.example` is a template only.
- `docker-compose` now expects a real `.env` file for the API container.
- `TEST_DATABASE_URL` should point to a dedicated test database. The default template uses `inventory_fastfood_system_test`.
- `WHATSAPP_INTERNAL_ENABLED`, `WHATSAPP_AUTH_DIR` and `WHATSAPP_SEND_TIMEOUT_MS` control the internal WhatsApp receipt delivery flow.
- `SEED_ALLOW_LIVE_DATABASE=false` keeps `seed` blocked on the live database by default.
- `CATALOG_SYNC_ALLOW_WRITE=false` keeps catalog sync scripts blocked unless explicitly enabled.
- `ALLOW_UNSAFE_DEPLOY=false` keeps deploys backing up the live database before changes.
- `SKIP_BACKUP_BEFORE_RESTORE=false` keeps restore creating a safety backup before destructive restore.
- `DOMAIN`, `SSL_EMAIL` and `ENABLE_HTTPS` drive the nginx render/provision scripts for VPS deployments.
- `CLOUDFLARE_TUNNEL_ENABLED`, `CLOUDFLARE_TUNNEL_HOSTNAME` and `CLOUDFLARE_TUNNEL_TOKEN` enable a persistent Cloudflare Tunnel with a fixed hostname.
- `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_KEEP_COUNT` and `BACKUP_CRON_SCHEDULE` control backup automation.
- `pnpm test` and `pnpm e2e` automatically:
  - start PostgreSQL if needed
  - create the test database if it does not exist
  - run migrations on that test database
  - reseed it before execution

## Data safety rules

- `pnpm db:seed` is now blocked on the live database unless `SEED_ALLOW_LIVE_DATABASE=true`.
- `infra/scripts/sync-beverage-catalog.mjs` is now blocked unless `CATALOG_SYNC_ALLOW_WRITE=true`.
- `infra/scripts/deploy.sh` creates a backup before deployment by default.
- `infra/scripts/deploy.sh` now also syncs base roles/permissions after `migrate deploy`, so new operational modules stay aligned with the real production database.
- `infra/scripts/restore.sh` validates the dump first and now also creates a safety backup before destructive restore by default.
- Test automation keeps using `TEST_DATABASE_URL`; it does not seed the live database.

## Internal WhatsApp receipts

The POS can now send receipt PDFs from an internal WhatsApp session without the official Meta API.

- Open `POS`
- Complete a sale
- Click `WhatsApp`
- Scan the QR once with the business WhatsApp account
- Enter the customer number
- Click `Enviar factura`

The QR session is persisted in Docker through the `whatsapp_auth` volume.

## Persistent Cloudflare Tunnel

`trycloudflare.com` links are temporary. For a fixed production-like hostname you need a named tunnel in your Cloudflare account.

1. Create the tunnel and hostname in Cloudflare.
2. Put these values in `.env`:

```bash
CLOUDFLARE_TUNNEL_ENABLED=true
CLOUDFLARE_TUNNEL_HOSTNAME=panel.tudominio.com
CLOUDFLARE_TUNNEL_TOKEN=<token-del-tunel>
```

3. Start it:

```bash
./infra/scripts/cloudflare-tunnel.sh start
```

Useful commands:

```bash
./infra/scripts/cloudflare-tunnel.sh validate
./infra/scripts/cloudflare-tunnel.sh status
./infra/scripts/cloudflare-tunnel.sh logs
./infra/scripts/cloudflare-tunnel.sh restart
./infra/scripts/cloudflare-tunnel.sh stop
```

The service runs through Docker Compose with the `cloudflare` profile and proxies the same `nginx` entrypoint already used by the admin panel and waiter panel.

## Useful scripts

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm e2e
pnpm validate
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## Core endpoints

- `POST /auth/login`
- `POST /auth/waiter-login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /products`
- `GET /ingredients`
- `GET /suppliers`
- `POST /purchases`
- `POST /sales`
- `GET /tables`
- `POST /tables`
- `GET /orders`
- `POST /orders`
- `POST /orders/:id/checkout`
- `POST /expenses`
- `POST /cash-register/open`
- `POST /cash-register/close`
- `POST /cash-register/reopen`
- `POST /cash-register/movements/manual`
- `GET /cash-register/operational-log`
- `GET /inventory/stock-counts`
- `GET /inventory/stock-counts/preview`
- `POST /inventory/stock-counts`
- `GET /inventory/reorder-suggestions`
- `GET /reports/daily`
- `GET /reports/operational`
- `GET /reports/sales-by-hour`
- `GET /reports/product-margins`
- `GET /reports/ingredient-rotation`
- `GET /reports/comparisons`
- `GET /reports/daily/:date/pdf`

## Critical test coverage

The backend suite currently validates these flows against a real PostgreSQL database:
- auth login success
- auth protected route
- refresh token invalidation after logout
- create purchase updates stock
- create purchase fails on incomplete line item
- create sale reduces direct stock product
- create sale reduces recipe ingredients
- create sale fails on insufficient stock
- open cash session
- close cash session with daily summary
- close cash session stores a historical daily closure snapshot
- create expense affects daily close
- create expense fails with invalid amount
- recipe rejects incomplete payload
- cashier cannot create purchases without permission
- daily report generation basic validation
- supplier notification can be generated from reorder suggestions
- create dining table
- open order ticket and checkout frees table
- multiple open orders simultaneously
- waiter can open and update dining-room orders but cannot checkout
- operational dashboard reset after daily close
- controlled cash reopen and classified manual cash movements
- guided stock count applies inventory differences and stores a count session
- executive report datasets for hourly sales, margins, rotation and comparisons

The browser E2E suite currently validates:
- admin login
- protected dashboard access
- sidebar navigation
- restricted user access
- cash opening
- cash closing
- POS sale registration
- open dine-in order from tables and checkout later
- waiter login with access name + code and dedicated order-taking flow
- waiter real-time active-order sync across sessions
- waiter manifest exposure and service-worker registration
- direct-stock guard on insufficient quantity
- expense registration
- report screen access and PDF open action
- purchase creation from the frontend
- session invalidation redirect
- dashboard pending-opening state after cash close
- historical daily closure visibility after cash close

Run it with:

```bash
pnpm e2e
```

The Playwright setup automatically:
- starts PostgreSQL if needed
- creates the isolated test database if missing
- runs migrations
- reseeds the database
- boots API on `4301`
- boots web on `3302`

## Docker workflow

Render nginx config and run the full stack locally:

```bash
./infra/scripts/render-nginx-conf.sh
docker compose up --build
```

Nginx exposes:
- web on `/`
- api on `/api`
- waiter login on `/waiter/login`
- HTTPS on `:443` when `ENABLE_HTTPS=true` and certificates exist under `infra/nginx/certs`

The compose stack includes health checks for:
- PostgreSQL
- API `/health`
- web `/login`
- nginx `/api/health`

## VPS deployment

1. Create `.env` from `.env.example` and replace every secret and production URL.
2. Ensure Docker and Docker Compose are available on the Ubuntu VPS.
3. Run:

```bash
./infra/scripts/deploy.sh
```

The deploy script:
- validates `.env`
- renders the nginx config
- rebuilds the stack
- runs Prisma migrations inside the API container
- executes smoke checks

Provision HTTPS on a real VPS/domain:

```bash
DOMAIN=app.example.com SSL_EMAIL=ops@example.com ENABLE_HTTPS=true ./infra/scripts/provision-https.sh
```

Backups:

```bash
./infra/scripts/backup.sh
./infra/scripts/restore.sh backups/backup-<db>-<timestamp>.dump --validate-only
FORCE_RESTORE=true ./infra/scripts/restore.sh backups/backup-<db>-<timestamp>.dump
./infra/scripts/install-backup-cron.sh
```

Manual smoke check:

```bash
./infra/scripts/smoke.sh
```

Optional environment overrides for smoke checks:

```bash
APP_BASE_URL=https://your-domain.com \
API_BASE_URL=https://your-domain.com/api \
WEB_BASE_URL=https://your-domain.com \
./infra/scripts/smoke.sh
```

## Backup and restore

Create backup:

```bash
./infra/scripts/backup.sh
```

Restore backup:

```bash
./infra/scripts/restore.sh backups/backup-YYYYMMDD-HHMMSS.sql
```
