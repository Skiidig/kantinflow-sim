# KantinFlow SIM — Backend API

REST API built with **Node.js, Express 5, and MongoDB 7 (Replica Set `rs0`)** powering **KantinFlow SIM**. For full-stack one-command startup instructions, see [`../README.md`](../README.md).

## Prerequisites

- **Node.js 22.12+** (verified on Node.js v26.13.1).
- **MongoDB 7+ Replica Set** (required for multi-document ACID transactions).
  - On Windows PowerShell, `npm.cmd run db:start` downloads (once) and runs a portable MongoDB 7.0.14 single-node replica set (`rs0`) under git-ignored `backend/.tools/` and `backend/.data/` (~1–2 GB disk space).
  - On macOS/Linux, start a local MongoDB replica set or point `MONGODB_URI` to a development MongoDB Atlas cluster.

## 1. Local Setup

From the `backend/` directory:

```powershell
Copy-Item .env.example .env
npm.cmd ci
```

Key environment variables in `backend/.env`:

| Variable | Description |
| --- | --- |
| `PORT` | Local HTTP server port, default `3000` (aligned with the Vite dev proxy and Postman collection). |
| `MONGODB_URI` | MongoDB replica set URI (e.g., `mongodb://127.0.0.1:27017/kantinflow_dev?replicaSet=rs0` or Atlas `mongodb+srv://...`). |
| `MONGODB_DB` | Target MongoDB database name (default `kantinflow_dev`). |
| `JWT_SECRET` | Random signing secret of at least 32 bytes for HS256 JWT tokens. |
| `JWT_EXPIRES_IN` | Token lifetime, default `8h`. |
| `CORS_ORIGIN` | Comma-separated list of allowed frontend origins (default `http://localhost:5173`). |
| `TEST_MONGODB_URI` | Replica set URI used by `npm test`; each test creates and drops an isolated `kantinflow_test_<hex>` database. |
| `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` / `DEMO_ADMIN_NAME` | Admin demo account created by the seed script. |
| `DEMO_PETUGAS_EMAIL` / `DEMO_PETUGAS_PASSWORD` / `DEMO_PETUGAS_NAME` | Staff (*petugas*) demo account created by the seed script. |

`.env` is git-ignored; never commit JWT secrets, database credentials, or real passwords.

## 2. Starting MongoDB, Seeding & Running the Server

```powershell
npm.cmd run db:start      # Windows helper: downloads (once) & starts MongoDB 7.0.14 replica set rs0 on 127.0.0.1:27017
npm.cmd run seed:reset    # Creates admin & petugas demo accounts + sample item SUSU-KOTAK from 0 balance
npm.cmd start             # Starts the Express API on port 3000 (default)
```

Stop the local portable MongoDB process when finished:

```powershell
npm.cmd run db:stop
```

## 3. REST API Endpoints (`/api/v1`)

| Method & Path | Access | Description |
| --- | --- | --- |
| `GET /api/v1/health` | Public | Health check (`{ "status": "ok" }`). |
| `POST /api/v1/auth/login` | Public | Verifies password via `bcryptjs` (10 rounds) and issues an HS256 JWT. Returns uniform `401 INVALID_CREDENTIALS` on unknown email, wrong password, or inactive account. |
| `GET / POST /api/v1/users`, `PATCH /api/v1/users/:id` | `admin` | Lists/filters accounts, creates `admin`/`petugas` users (`409 EMAIL_EXISTS` on duplicate email), and updates name or active status (`409 CANNOT_DEACTIVATE_SELF` on self-deactivation). |
| `GET /api/v1/items`, `GET /api/v1/items/:id`, `GET /api/v1/items/:id/batches` | `admin`, `petugas` | Item catalog with search, status/low-stock filters, sorting, pagination, and FEFO-ordered batch details (`unitCost` included only for `admin`). |
| `POST /api/v1/items`, `PATCH /api/v1/items/:id`, `DELETE /api/v1/items/:id` | `admin` | Item CRUD and safe delete/archive rules (`204` permanent delete without history; `200 ARCHIVED` with history and 0 physical stock; `409 ITEM_HAS_STOCK` when physical stock > 0). |
| `POST /api/v1/stock/receipts` | `admin`, `petugas` | Atomic stock-in (creates 1 batch + 1 `RECEIPT` transaction). Requires `Idempotency-Key` header; rejects archived items (`409 ITEM_INACTIVE`). |
| `POST /api/v1/stock/usages` | `admin`, `petugas` | Atomic cross-batch FEFO stock consumption across usable batches (`expiresOn >= today`), skipping expired batches; rejects insufficient usable stock (`409 INSUFFICIENT_USABLE_STOCK`) and archived items (`409 ITEM_INACTIVE`). |
| `POST /api/v1/stock/disposals` | `admin`, `petugas` | Atomic per-batch disposal with required reason; rejects quantity above batch remainder (`409 INSUFFICIENT_BATCH_STOCK`) and archived items (`409 ITEM_INACTIVE`). |
| `GET /api/v1/dashboard` | `admin`, `petugas` | KPI summary, low-stock items, near-expiry batches (`days`, default `3`, range `1–30`), and expired batches with remaining stock (`unitCost` admin-only). |
| `GET /api/v1/transactions` | `admin`, `petugas` | Chronological stock mutation log with item, type, WITA date-range (`from`/`to`), and pagination filters (cost fields omitted for `petugas`). |
| `GET /api/v1/reports/disposals` | `admin` | Waste quantity and cost summary grouped by item, by reason, and by disposal event (`403 FORBIDDEN` for `petugas`). |

## 4. Integrity Rules & Operational Timezone

- **Atomic Transactions & Concurrency:** Stock mutations and item status/archive changes run inside MongoDB multi-document transactions (`session.withTransaction`), incrementing `items.stockRevision` to serialize concurrent mutations per item and using `Decimal128` + `BigInt` decimal helpers (`lib/decimal.mjs`) to prevent floating-point drift.
- **Operational Timezone (`Asia/Makassar` / WITA, UTC+08:00):** Operational dates (`toOperationalDateString`) and inclusive date-range bounds (`startOfOperationalDay`, `endOfOperationalDay`) in `lib/format.mjs` are explicitly locked to `Asia/Makassar`, independent of server host timezone.
- **Postman Collection:** Import the 19-request v2.1 collection at [`../docs/kantinflow.postman_collection.json`](../docs/kantinflow.postman_collection.json) (default `baseUrl`: `http://localhost:3000`).

## 5. Automated Tests & Benchmark

```powershell
npm.cmd run db:start
npm.cmd test          # 21/21 unit & Supertest integration tests (isolated kantinflow_test_<hex> DBs)
npm.cmd run benchmark # 100 req/endpoint (concurrency 10) on 100 items & 300 batches (target < 500 ms)
npm.cmd run db:stop
```

## 6. Project Layout

| File / Directory | Responsibility |
| --- | --- |
| `app.mjs` | Express 5 app factory, CORS middleware, JSON parser (`16kb`), `/api/v1` router registration, error handler. |
| `server.mjs` | Standard Node.js HTTP server entry point (default `PORT=3000`). |
| `api/index.mjs` & `vercel.json` | Vercel Serverless entry point and rewrite configuration. |
| `db-indexes.mjs` | Unique indexes (`users.email`, `items.code`, `stockTransactions.{actorId,idempotencyKey}`) and composite query indexes. |
| `password.mjs` | Password hashing and verification using `bcryptjs`. |
| `receipt-store.mjs` & `validate-receipt.mjs` | Validation, atomic persistence, and idempotent replay for stock receipts. |
| `middleware/` | HS256 JWT auth + active-account lookup (`auth.mjs`), multi-origin CORS (`cors.mjs`), and global error handler (`error-handler.mjs`). |
| `routes/` | Express routers for `auth`, `users`, `items`, `stock`, `dashboard`, `transactions`, and `reports`. |
| `services/` | Domain logic for `items`, `dashboard`, `usage` (FEFO), `disposal` & waste-cost reporting, and `transactions`. |
| `lib/` | Arbitrary-precision decimal helpers (`decimal.mjs`), WITA timezone & formatting utilities (`format.mjs`), and isolated Supertest test harness (`http-context.mjs`). |
| `scripts/` | Portable MongoDB Windows helpers (`start-mongodb.ps1`, `stop-mongodb.ps1`, `init-replica.mjs`), `seed-demo.mjs`, and `benchmark.mjs`. |
