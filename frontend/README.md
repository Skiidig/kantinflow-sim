# KantinFlow SIM — Frontend SPA

Single-page web interface built with **React 19, Vite 8, and CSS Custom Properties** for all operational and administrative workflows in **KantinFlow SIM**.

## 1. Local Setup

From the `frontend/` directory:

```powershell
Copy-Item .env.example .env
npm.cmd ci
```

| Variable | Description |
| --- | --- |
| `VITE_API_BASE_URL` | Leave empty during local development so `/api` requests proxy through Vite to `http://127.0.0.1:3000`. Set to the deployed backend origin (without trailing slash) in production. |

## 2. Running Locally

Ensure MongoDB Replica Set and the backend API are running on port `3000` (or run `npm.cmd start` from the repository root to launch all services together):

```powershell
npm.cmd run dev
```

Open **`http://localhost:5173`**. The Vite dev server (`vite.config.js`) forwards `/api` requests to `http://127.0.0.1:3000`.

## 3. Screens & Navigation

Client-side routing is handled by a lightweight History API router in `src/App.jsx` paired with `src/components/AppShell.jsx`, dynamically adjusting navigation items by user role (`admin` vs `petugas`):

| Route | Screen | Access | Primary Function |
| --- | --- | --- | --- |
| — | `LoginScreen.jsx` | Public | JWT login (`POST /api/v1/auth/login`) and session notices. |
| `/dashboard` | `DashboardScreen.jsx` | `admin`, `petugas` | Inventory KPIs, low-stock table, near-expiry batches (`H-3`/`H-7`/`H-14`), and expired stock awaiting disposal. |
| `/items` | `ItemsScreen.jsx` | `admin`, `petugas` | Search, status & low-stock filters, sorting, pagination, FEFO batch detail modal, and admin item CRUD / safe archive. |
| `/receipts` | `ReceiptScreen.jsx` | `admin`, `petugas` | Idempotent stock-in form (`Idempotency-Key`) with default operational date in `Asia/Makassar` (WITA). |
| `/usages` | `UsageScreen.jsx` | `admin`, `petugas` | Cross-batch FEFO usage form with ordered batch preview and allocation confirmation card. |
| `/disposals` | `DisposalScreen.jsx` | `admin`, `petugas` | Per-batch disposal form (active items only, expired batch highlighting, reason presets, `ITEM_INACTIVE` guard). |
| `/transactions` | `TransactionsScreen.jsx` | `admin`, `petugas` | Chronological audit log with item, type, and date-range filters; cost columns visible only to `admin`. |
| `/users` | `UsersScreen.jsx` | `admin` | Account directory, role/status filtering, user creation, and active-status toggle (blocks self-deactivation). |
| `/reports/disposals` | `DisposalReportScreen.jsx` | `admin` | Waste-cost KPIs and breakdowns by item, by reason, and by disposal event. |

### Key Frontend Behaviors

- **Session & Auto-Logout:** Auth sessions are stored in `sessionStorage`; any `401` API response automatically clears the session and returns the user to the login screen.
- **Idempotency & Double-Submit Protection:** Receipt, FEFO usage, and disposal screens use `resolveIdempotencyKey()` (`src/idempotency.js`) and an in-flight ref guard so retrying after a network interruption never duplicates stock movements.
- **WITA Timezone Consistency (`Asia/Makassar`):** `src/format.js` formats transaction timestamps (`formatDateTimeId`) and computes operational date defaults (`getOperationalDateString`) explicitly in `Asia/Makassar`, while calendar dates (`YYYY-MM-DD`) render without timezone shifting.

## 4. Testing & Production Build

```powershell
npm.cmd test          # 8/8 unit tests (IDR currency, WITA date/time & cross-TZ checks, date ranges, labels, idempotency)
npm.cmd run build     # Production Vite build into frontend/dist/
npm.cmd run preview   # Preview the production build locally
```

## 5. Project Layout

| File / Directory | Responsibility |
| --- | --- |
| `src/App.jsx` | Client-side routing, role guards (`ADMIN_ONLY_PATHS`), `sessionStorage` session state, and toast queue. |
| `src/api.js` | `fetch` API client, Bearer token injection, `401` callback hook, `ApiError` & `NetworkError` classification. |
| `src/format.js` & `src/format.test.js` | IDR formatting, Indonesian calendar dates, WITA timestamps, operational date defaults, date-range validation, and unit tests. |
| `src/idempotency.js` & `src/idempotency.test.js` | Payload-fingerprinted `Idempotency-Key` resolver and unit tests. |
| `src/components/` | `AppShell.jsx`, `Icon.jsx` (custom inline SVGs), and `ToastContainer.jsx`. |
| `src/screens/` | 9 feature screens (`Login`, `Dashboard`, `Items`, `Receipt`, `Usage`, `Disposal`, `Transactions`, `Users`, `DisposalReport`). |
| `src/styles.css` | Responsive single stylesheet built on CSS Custom Properties (no external CSS framework). |
| `vite.config.js` & `vercel.json` | Dev proxy (`/api` → `http://127.0.0.1:3000`) and Vercel SPA fallback rewrite. |
