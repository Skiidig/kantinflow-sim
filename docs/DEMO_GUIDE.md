# End-to-End Demo Guide — KantinFlow SIM

This walkthrough demonstrates the complete operational and administrative workflow of **KantinFlow SIM**, covering authentication, role-based access control (`admin` vs `petugas`), batch inventory tracking, H-3 expiry monitoring, atomic cross-batch FEFO allocation, stock disposal, admin waste-cost reporting, and automated verification.

> **UI Language Note:** Because the application UI is written in Indonesian, menu labels and buttons below include the exact Indonesian labels displayed on screen.

---

## 1. Local Setup & Startup

> **Windows PowerShell Note:** Use `npm.cmd` if PowerShell blocks execution of `npm.ps1`.

### Option A — One-Command Startup (Recommended)

After configuring `backend/.env` and `frontend/.env` and installing dependencies (see [`../README.md`](../README.md)):

```powershell
# Reset local demo database (kantinflow_dev) from a clean state
npm.cmd run db:start
npm.cmd run seed
npm.cmd run db:stop

# Start MongoDB Replica Set (rs0), Backend (:3000), and Frontend (:5173) together
npm.cmd start
```

### Option B — Separate Terminals

```powershell
# Terminal 1 — MongoDB + Seed + Backend API (http://127.0.0.1:3000)
cd backend
npm.cmd run db:start
npm.cmd run seed:reset
npm.cmd start

# Terminal 2 — Frontend SPA (http://localhost:5173)
cd frontend
npm.cmd run dev
```

Demo accounts seeded into `kantinflow_dev` (passwords read from `backend/.env`):

| Role | Email | Permissions |
| --- | --- | --- |
| **Admin** | `admin@kantinflow.local` | Full access: item CRUD/archive, staff account management, purchase/waste cost visibility, and all stock operations |
| **Petugas (Staff)** | `petugas@kantinflow.local` | Daily operations: dashboard, item & batch viewing (without unit cost), stock-in, FEFO usage, disposals, and cost-redacted transaction history |

Open **`http://localhost:5173`** in your browser.

---

## 2. Live Walkthrough Scenarios

### Step A — Admin Login & Staff Account Management

1. Sign in at `http://localhost:5173` as **`admin@kantinflow.local`**.
2. Observe the sidebar navigation: both **Operasional** and **Administrasi** (**Akun Petugas** and **Laporan Biaya**) sections are visible.
3. Open **Akun Petugas** and create a new staff account (e.g., `Siti Rahayu`, `siti@kantinflow.local`, password ≥ 6 characters).
4. Confirm the new account appears immediately as **Aktif** (passwords are stored as `bcryptjs` hashes and never returned by the API).

### Step B — Item Catalog, Search, Filters & Safe Deletion

1. Open **Barang & Batch**, click **+ Tambah Barang**, and add a sample item (e.g., code `ROTI-01`, name `Roti Tawar`, unit `bungkus`, minimum stock `3`).
2. Test search (`SUSU` / `ROTI`), status filtering (**Aktif** / **Diarsipkan**), low-stock filtering, and sorting.
3. Test permanent deletion on an item with no stock history: click **Hapus / Arsip** on `ROTI-01` → permanently removed (`204 No Content`).

### Step C — Staff Login & RBAC Enforcement

1. Click **Keluar**, then sign in as **`petugas@kantinflow.local`** (or the newly created staff account).
2. Confirm that **Akun Petugas** and **Laporan Biaya** are hidden from navigation, item create/edit/delete controls are not shown, and **Harga Beli** / **Total Biaya** columns are absent in batch details and transaction history.

### Step D — Idempotent Stock Receipts & Validation

1. Open **Stok Masuk** and select **Susu Kotak (`SUSU-KOTAK`)**:
   - **Batch A:** code `SUSU-A`, quantity `5`, unit cost `4500`, received today, expires **H+2** → click **Simpan penerimaan** → balance becomes **5 kotak**.
   - **Zero-quantity check:** enter quantity `0` and submit → inline validation error (*"Jumlah harus lebih dari 0"*), balance remains **5 kotak**.
   - **Batch B:** code `SUSU-B`, quantity `7`, unit cost `5000`, received today, expires **H+10** → submit → physical stock becomes **12 kotak**.

### Step E — H-3 Expiry Monitoring Dashboard

1. Open **Dashboard**:
   - Verify `SUSU-A` (expires H+2) appears automatically under **Batch Mendekati Kedaluwarsa (H-3)** with an `H-2` warning badge.
   - Click **Cek Batch** on any low-stock item to inspect batches sorted in FEFO order.

### Step F — Cross-Batch Atomic FEFO Usage & Insufficient Stock Guard

1. Open **Pemakaian FEFO** and select **Susu Kotak**:
   - Review **Pratinjau Urutan Batch FEFO**: `#1 SUSU-A (5 kotak)` followed by `#2 SUSU-B (7 kotak)`.
   - Enter quantity **`8`**, note `Sajian pagi`, and click **Catat Pemakaian FEFO**.
   - Confirm the right-side summary shows automatic cross-batch allocation: **`SUSU-A: -5 kotak (sisa 0)`** and **`SUSU-B: -3 kotak (sisa 4)`**, leaving **4 kotak** of usable stock.
2. **Insufficient stock check:** request **`5`** kotak (exceeding the 4 usable kotak) → rejected (`409 INSUFFICIENT_USABLE_STOCK`) with all batch balances unchanged.

### Step G — Batch Disposal & Admin Waste-Cost Report

1. Open **Pembuangan**, select **Susu Kotak** → choose batch `SUSU-B` (4 remaining) → enter quantity **`1`**, select **`Kemasan rusak / bocor`**, and submit → batch remainder updates to **3 kotak**.
2. Open **Riwayat Stok** to verify chronological `RECEIPT`, `USAGE`, and `DISPOSAL` entries without cost columns for `petugas`.
3. Sign out (**Keluar**), sign back in as **`admin@kantinflow.local`**, and open **Laporan Biaya**:
   - Verify **Total Biaya Terbuang** automatically computes `1 kotak × Rp 5.000 = Rp 5.000`, along with breakdowns by item, by reason, and by transaction event.

---

## 3. Automated Tests, Benchmark & Postman Verification

### Automated Test Suites & API Benchmark

```powershell
# Backend (21/21 unit & Supertest integration tests + API benchmark)
npm.cmd run db:start
npm.cmd run test:backend
npm.cmd run benchmark
npm.cmd run db:stop

# Frontend (8/8 unit tests + production build)
npm.cmd run test:frontend
npm.cmd run build:frontend
```

### Postman Collection (`docs/kantinflow.postman_collection.json`)

1. Import `docs/kantinflow.postman_collection.json` (19 requests across 4 folders) into Postman.
2. In the collection **Variables** tab, confirm `baseUrl` is `http://localhost:3000` and populate `password` with your local demo password from `backend/.env`.
3. Run **Login Admin** first — its test script stores the returned JWT in `{{token}}` and `{{adminToken}}` for subsequent requests.
