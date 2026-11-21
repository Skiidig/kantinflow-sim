# KantinFlow SIM

**KantinFlow — Sistem Informasi Pengelolaan Stok dan Pemantauan Kedaluwarsa Kantin** adalah aplikasi web *decoupled* untuk mencatat persediaan kantin per batch, menerapkan pemakaian stok **FEFO (First Expired, First Out)**, memantau barang menipis dan batch mendekati kedaluwarsa (**H-3**), serta menghitung biaya barang terbuang bagi admin.

Proyek ini dibangun untuk mata kuliah **Sistem Informasi Manajemen (SIM)** — Program Studi Sistem Informasi, Universitas Primakara.

---

## Arsitektur & Tech Stack

```text
Browser / React (Vite)  <--- REST API /api/v1 (JSON + JWT Bearer) --->  Node.js + Express 5
                                                                                  |
                                                                       MongoDB 7 (Replica Set rs0)
```

| Lapisan | Teknologi | Peran Utama |
| --- | --- | --- |
| **Frontend** | React 19, Vite 8, CSS Responsif | Antarmuka mobile, tablet, dan desktop dengan navigasi berbasis peran (RBAC) dan notifikasi toast. |
| **Backend** | Node.js, Express 5 | REST API `/api/v1`, validasi bisnis, transaksi atomik, dan proteksi RBAC (`401`/`403`). |
| **Database** | MongoDB 7 (Replica Set `rs0`) | Penyimpanan koleksi `users`, `items`, `batches`, dan `stockTransactions` dengan transaksi atomik & `Decimal128`. |
| **Keamanan** | JWT (HS256) + `bcryptjs` | Hash password Bcrypt, autentikasi Bearer Token, dan pemisahan hak akses `admin` vs `petugas`. |
| **Pengujian** | Node Test Runner (`node:test`) + Supertest | Pengujian unit, integrasi API, rollback transaksi, *security matrix*, dan benchmark performa. |

---

## Cakupan Fitur (FR-001 s.d. FR-007)

Seluruh kebutuhan fungsional pada dokumen SRS/SDS telah selesai diimplementasikan dan terverifikasi:

1. **FR-001 — Autentikasi & Manajemen Akun (`admin` / `petugas`):**
   - Login JWT (`POST /api/v1/auth/login`), logout, dan auto-logout saat sesi `401`.
   - Manajemen akun petugas khusus `admin` (`POST/GET/PATCH /api/v1/users`) dengan hash Bcrypt dan tolak email duplikat (`409`).
2. **FR-002 & FR-003 — Manajemen Barang, Pencarian, Filter & Detail Batch:**
   - CRUD barang (`GET/POST /api/v1/items`, `GET/PATCH/DELETE /api/v1/items/:id`), pencarian nama/kode, filter status & stok menipis, pengurutan, dan pagination.
   - Aturan penghapusan aman: hapus permanen (`204`) bila belum memiliki riwayat; arsip (`isActive: false`, `200`) bila berriwayat dengan stok fisik `0`; tolak (`409`) bila masih ada stok fisik.
   - Detail batch per barang (`GET /api/v1/items/:id/batches`) terurut FEFO beserta status `LAYAK`, `MENDEKATI_KEDALUWARSA`, `KEDALUWARSA`, dan `HABIS` (harga beli hanya tampil bagi `admin`).
3. **FR-004 — Dashboard Pemantauan H-3:**
   - Ringkasan stok menipis (`usableStock <= minimumStock`), batch mendekati kedaluwarsa (`H-3`), dan batch kedaluwarsa yang masih bersisa (`GET /api/v1/dashboard`).
4. **FR-005 — Penerimaan Stok Idempoten & Riwayat Transaksi:**
   - Pencatatan penerimaan atomik (`POST /api/v1/stock/receipts`) dengan header `Idempotency-Key` (replay identik `200`, konflik payload `409`, jumlah `0` ditolak `400 VALIDATION_ERROR`).
   - Riwayat mutasi kronologis (`GET /api/v1/transactions`) dengan filter barang, jenis (`RECEIPT`/`USAGE`/`DISPOSAL`), rentang tanggal, dan pagination (kolom biaya disembunyikan dari `petugas`).
5. **FR-006 — Pemakaian Stok FEFO Atomik:**
   - Pemotongan otomatis batch layak dengan tanggal kedaluwarsa terdekat lintas batch (`POST /api/v1/stock/usages`), melewati batch kedaluwarsa, dan menolak (`409 INSUFFICIENT_USABLE_STOCK`) tanpa mengubah saldo jika stok layak tidak mencukupi.
6. **FR-007 — Pembuangan Stok & Laporan Biaya Admin:**
   - Pencatatan pembuangan jumlah & alasan per batch secara atomik (`POST /api/v1/stock/disposals`).
   - Laporan ringkasan total kuantitas dan total biaya barang terbuang khusus `admin` (`GET /api/v1/reports/disposals`; peran `petugas` ditolak `403`).

---

## Panduan Instalasi & Menjalankan Aplikasi

> **Prasyarat:** Node.js 22.12+ dan PowerShell di Windows. Gunakan `npm.cmd` apabila PowerShell memblokir eksekusi `npm.ps1`.

### 1. Konfigurasi Environment (Sekali Saja)
```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```
Lengkapi `JWT_SECRET` (minimal 32 byte) dan password demo pada `backend/.env`.

### 2. Jalankan MongoDB Replica Set & Seed Data Demo
```powershell
cd backend
npm.cmd install
npm.cmd run db:start
npm.cmd run seed:reset
```

Akun demo yang dibuat otomatis (password sesuai nilai di `backend/.env`):
- **Admin:** `admin@kantinflow.local`
- **Petugas:** `petugas@kantinflow.local`

### 3. Jalankan Backend API
Masih di folder `backend/`:
```powershell
npm.cmd start
```
Server API berjalan sesuai `PORT` pada `backend/.env` (default `http://127.0.0.1:3000`).

### 4. Jalankan Frontend React
Buka terminal terpisah di folder `frontend/`:
```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```
Akses aplikasi di **`http://localhost:5173`**.

### 5. Menghentikan MongoDB Lokal Setelah Selesai
```powershell
cd backend
npm.cmd run db:stop
```

---

## Ringkasan Pengujian Otomatis & Benchmark Performa

### Menjalankan Tes & Benchmark
```powershell
# Backend (pastikan MongoDB replica set aktif)
cd backend
npm.cmd run db:start
npm.cmd test
npm.cmd run benchmark
npm.cmd run db:stop

# Frontend
cd frontend
npm.cmd test
npm.cmd run build
```

### Hasil Verifikasi Terakhir
- **Backend Automated Tests (`node:test` + Supertest):** **15/15 tes lulus** (0 gagal, 0 dilewati) mencakup seluruh FR-001 s.d. FR-007, idempotensi, rollback transaksi atomik, *Security Matrix* (`401` pada 15 endpoint terproteksi & `403` pada 7 endpoint khusus admin), dan skenario *end-to-end* HTTP.
- **Frontend Unit Tests & Build:** **5/5 unit test lulus** dan `vite build` produksi berhasil tanpa error.
- **API Performance Benchmark (`100` barang, `300` batch, `200` transaksi; `100` request/endpoint, konkurensi `10`; target `< 500 ms`):**

| Endpoint | Min | Avg | P95 | Max | Target (`< 500 ms`) |
| --- | :---: | :---: | :---: | :---: | :---: |
| `GET /api/v1/items?page=1&limit=20&sortBy=name&sortOrder=asc` | 20,48 ms | 34,43 ms | **49,98 ms** | 56,19 ms | Lulus |
| `GET /api/v1/items?q=BRG-05&lowStock=true` | 9,61 ms | 14,11 ms | **17,37 ms** | 18,89 ms | Lulus |
| `GET /api/v1/dashboard` | 27,49 ms | 47,92 ms | **67,46 ms** | 76,26 ms | Lulus |

---

## Dokumentasi & Tautan Proyek

- **Dokumen SRS & SDS Final:** [`docs/KantinFlow_SRS_SDS_Web.docx`](docs/KantinFlow_SRS_SDS_Web.docx)
- **Panduan Demo End-to-End (Hari Senin):** [`docs/DEMO_GUIDE.md`](docs/DEMO_GUIDE.md)
- **Koleksi Postman v2.1 (19 Request):** [`docs/kantinflow.postman_collection.json`](docs/kantinflow.postman_collection.json)
- **Published Postman Documentation:** `[Tempel URL Published Postman Documentation di sini]`
- **GitHub Projects Board:** [KantinFlow SIM — Project #1](https://github.com/users/Skiidig/projects/1)
- **Panduan Teknis Tambahan:** [`backend/README.md`](backend/README.md) · [`frontend/README.md`](frontend/README.md)
