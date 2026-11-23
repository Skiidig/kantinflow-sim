# Backend KantinFlow SIM

REST API berbasis **Node.js + Express 5 + MongoDB 7 (Replica Set `rs0`)** untuk aplikasi **KantinFlow SIM** (`FR-001` s.d. `FR-007`). Panduan menjalankan keseluruhan stack (MongoDB, Backend, dan Frontend) dalam satu perintah tersedia di [`../README.md`](../README.md).

## Prasyarat

- Node.js 22.12+ (terverifikasi pada Node.js v26.13.1).
- PowerShell di Windows (gunakan `npm.cmd` bila execution policy memblokir `npm.ps1`).
- Ruang disk sekitar 1–2 GB untuk MongoDB Community portabel (`7.0.14`) dan data lokal.

## 1. Konfigurasi Lokal

Dari folder `backend/`:

```powershell
Copy-Item .env.example .env
npm.cmd ci
```

Variabel utama pada `backend/.env`:

| Variabel | Keterangan |
| --- | --- |
| `PORT` | Port server HTTP lokal, default `3000` (selaras dengan proxy Vite & koleksi Postman). |
| `MONGODB_URI` | URI MongoDB pengembangan (wajib replica set untuk transaksi atomik, mis. `mongodb://127.0.0.1:27017/kantinflow_dev?replicaSet=rs0`). |
| `MONGODB_DB` | Nama database pengembangan (default `kantinflow_dev`). |
| `JWT_SECRET` | Rahasia acak minimal 32 byte untuk menandatangani token JWT HS256. |
| `JWT_EXPIRES_IN` | Masa berlaku token JWT, default `8h`. |
| `CORS_ORIGIN` | Daftar origin frontend yang diizinkan CORS, dipisahkan koma (default `http://localhost:5173`). |
| `TEST_MONGODB_URI` | URI MongoDB untuk tes integrasi (`npm.cmd test`); setiap tes membuat dan menghapus database acak `kantinflow_test_<hex>`. |
| `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` / `DEMO_ADMIN_NAME` | Akun demo peran `admin` yang dibuat oleh skrip seed. |
| `DEMO_PETUGAS_EMAIL` / `DEMO_PETUGAS_PASSWORD` / `DEMO_PETUGAS_NAME` | Akun demo peran `petugas` yang dibuat oleh skrip seed. |

`.env` diabaikan oleh `.gitignore`; jangan pernah memasukkan rahasia JWT atau password ke file yang di-commit.

## 2. Menjalankan MongoDB, Seed Demo & Server

```powershell
npm.cmd run db:start      # Mengunduh (sekali saja) & menyalakan MongoDB 7.0.14 replica set rs0 di 127.0.0.1:27017
npm.cmd run seed:reset    # Membuat akun demo admin & petugas + barang SUSU-KOTAK dari saldo 0
npm.cmd start             # Menjalankan Express API di port 3000 (default)
```

Hentikan MongoDB lokal setelah selesai:

```powershell
npm.cmd run db:stop
```

## 3. Daftar Endpoint `/api/v1`

| Method & Path | Akses | Deskripsi |
| --- | --- | --- |
| `GET /api/v1/health` | Publik | Pengecekan kesehatan layanan (`{ "status": "ok" }`). |
| `POST /api/v1/auth/login` | Publik | Verifikasi Bcrypt (`bcryptjs`, 10 rounds) & penerbitan JWT HS256. Respons gagal seragam `401 INVALID_CREDENTIALS`. |
| `GET / POST /api/v1/users`, `PATCH /api/v1/users/:id` | `admin` | Daftar/filter akun, tambah akun petugas/admin (tolak email duplikat `409`), ubah nama/status aktif (cegah nonaktifkan diri sendiri `409`). |
| `GET /api/v1/items`, `GET /api/v1/items/:id`, `GET /api/v1/items/:id/batches` | `admin`, `petugas` | Katalog barang dengan pencarian, filter status/stok menipis, pengurutan, pagination, serta detail batch terurut FEFO (`unitCost` hanya untuk `admin`). |
| `POST /api/v1/items`, `PATCH /api/v1/items/:id`, `DELETE /api/v1/items/:id` | `admin` | CRUD master barang dan aturan hapus/arsip aman (`204` hapus permanen tanpa riwayat; `200 ARCHIVED` jika berriwayat dengan stok fisik `0`; `409 ITEM_HAS_STOCK` jika stok fisik `> 0`). |
| `POST /api/v1/stock/receipts` | `admin`, `petugas` | Penerimaan stok atomik (1 batch + 1 transaksi `RECEIPT`), wajib `Idempotency-Key`, tolak barang arsip (`409 ITEM_INACTIVE`). |
| `POST /api/v1/stock/usages` | `admin`, `petugas` | Pemakaian stok FEFO atomik lintas batch layak (`expiresOn >= today`), melewati batch kedaluwarsa, tolak stok kurang (`409 INSUFFICIENT_USABLE_STOCK`) & barang arsip (`409 ITEM_INACTIVE`). |
| `POST /api/v1/stock/disposals` | `admin`, `petugas` | Pembuangan stok per batch secara atomik beserta alasan wajib, tolak melebihi sisa batch (`409 INSUFFICIENT_BATCH_STOCK`) & barang arsip (`409 ITEM_INACTIVE`). |
| `GET /api/v1/dashboard` | `admin`, `petugas` | Ringkasan KPI, stok menipis, batch mendekati kedaluwarsa (`days`, default H-3), dan batch kedaluwarsa bersisa (`unitCost` hanya untuk `admin`). |
| `GET /api/v1/transactions` | `admin`, `petugas` | Riwayat mutasi stok kronologis dengan filter barang, jenis, rentang tanggal WITA (`from`/`to`), dan pagination (kolom biaya disembunyikan dari `petugas`). |
| `GET /api/v1/reports/disposals` | `admin` | Laporan ringkasan kuantitas dan total biaya barang terbuang per barang, per alasan, dan rincian peristiwa. |

## 4. Aturan Integritas & Zona Waktu Operasional

- **Transaksi Atomik & Konkurensi:** Seluruh operasi mutasi stok dan perubahan status barang menggunakan transaksi multi-dokumen MongoDB (`session.withTransaction`) dengan penguncian `stockRevision` per barang dan tipe data `Decimal128` (aritmetika presisi berbasis `BigInt` di `lib/decimal.mjs`).
- **Zona Waktu Operasional (`Asia/Makassar` / WITA, UTC+08:00):** Seluruh penentuan tanggal operasional (`toOperationalDateString`) dan batas awal/akhir hari untuk filter rentang tanggal (`startOfOperationalDay`, `endOfOperationalDay`) di `lib/format.mjs` dievaluasi secara eksplisit dalam zona waktu `Asia/Makassar`, independen dari zona waktu server.
- **Koleksi Postman:** Gunakan koleksi lengkap 19 request di [`../docs/kantinflow.postman_collection.json`](../docs/kantinflow.postman_collection.json) (default `baseUrl`: `http://localhost:3000`).

## 5. Pengujian & Benchmark

```powershell
npm.cmd run db:start
npm.cmd test          # 21/21 unit & Supertest integration test lulus (database terisolasi kantinflow_test_<hex>)
npm.cmd run benchmark # Benchmark 100 request/endpoint pada 100 barang & 300 batch (target < 500 ms)
npm.cmd run db:stop
```

## 6. Struktur File Utama

| File / Folder | Peran |
| --- | --- |
| `app.mjs` | Factory Express 5, CORS, JSON parser (`16kb`), registrasi router `/api/v1`, dan error handler. |
| `server.mjs` | Entry point server HTTP Node.js standar (default `PORT=3000`). |
| `api/index.mjs` & `vercel.json` | Entry point dan konfigurasi rewrite untuk deployment Serverless Vercel. |
| `db-indexes.mjs` | Inisialisasi indeks unik (`users.email`, `items.code`, `stockTransactions.{actorId,idempotencyKey}`) dan indeks komposit. |
| `password.mjs` | Hash dan verifikasi password berbasis `bcryptjs`. |
| `receipt-store.mjs` & `validate-receipt.mjs` | Validasi dan penyimpanan atomik + replay idempoten untuk penerimaan stok. |
| `middleware/` | Autentikasi JWT HS256 + verifikasi akun aktif (`auth.mjs`), CORS multi-origin (`cors.mjs`), dan global error handler (`error-handler.mjs`). |
| `routes/` | Definisi router Express untuk `auth`, `users`, `items`, `stock`, `dashboard`, `transactions`, dan `reports`. |
| `services/` | Logika bisnis untuk `items`, `dashboard`, `usage` (FEFO), `disposal` & laporan biaya, serta `transactions`. |
| `lib/` | Utilitas aritmetika desimal (`decimal.mjs`), format & zona waktu WITA (`format.mjs`), dan context tes terisolasi (`http-context.mjs`). |
| `scripts/` | Skrip MongoDB portabel (`start-mongodb.ps1`, `stop-mongodb.ps1`, `init-replica.mjs`), `seed-demo.mjs`, dan `benchmark.mjs`. |
