# Panduan Demonstrasi End-to-End — KantinFlow SIM

Panduan ringkas ini disiapkan untuk demonstrasi aplikasi web **KantinFlow — Sistem Informasi Pengelolaan Stok dan Pemantauan Kedaluwarsa Kantin** mencakup seluruh kebutuhan fungsional (**FR-001 s.d. FR-007**), kontrol keamanan (**RBAC `401`/`403` & Bcrypt**), serta pengujian otomatis (**Node test runner + Supertest**) dan benchmark performa (`< 500 ms`).

---

## 1. Persiapan & Menjalankan Aplikasi

> **Catatan Windows PowerShell:** Gunakan `npm.cmd` apabila PowerShell memblokir eksekusi `npm.ps1`.

### Langkah 1 — Jalankan MongoDB Replica Set & Reset Data Demo
Buka terminal pertama di folder `backend/`:

```powershell
cd backend
npm.cmd run db:start
npm.cmd run seed:reset
```

Akun demo yang otomatis dibuat (password mengikuti nilai di `backend/.env`):

| Peran | Email | Hak Akses |
| --- | --- | --- |
| **Admin** | `admin@kantinflow.local` | Akses penuh (kelola barang, akun petugas, lihat biaya & laporan pembuangan, operasional stok) |
| **Petugas** | `petugas@kantinflow.local` | Operasional harian (dashboard, lihat barang & batch tanpa harga beli, stok masuk, FEFO, pembuangan, riwayat tanpa biaya) |

### Langkah 2 — Jalankan Backend Express
Di terminal `backend/` yang sama:

```powershell
npm.cmd start
```

Server API berjalan pada port sesuai `PORT` di `backend/.env` (default `http://127.0.0.1:3000`; bila menjalankan di port `3001` agar cocok dengan default variabel `{{baseUrl}}` pada koleksi Postman, cukup ubah `PORT=3001` di `backend/.env` dan target proxy di `frontend/vite.config.js`, atau sesuaikan `{{baseUrl}}` di Postman menjadi `http://127.0.0.1:3000`).

### Langkah 3 — Jalankan Frontend React
Buka terminal kedua di folder `frontend/`:

```powershell
cd frontend
npm.cmd run dev
```

Buka browser di **`http://localhost:5173`**.

---

## 2. Skenario Demo Live (FR-001 s.d. FR-007)

### Tahap A — Login Admin & Manajemen Akun Petugas (FR-001)
1. Buka `http://localhost:5173`, masuk menggunakan akun **`admin@kantinflow.local`**.
2. Amati navigasi sidebar: seluruh menu tampil termasuk bagian **Administrasi** (**Akun Petugas** & **Laporan Biaya**).
3. Buka menu **Akun Petugas**, buat akun petugas baru (mis. `Siti Rahayu`, `siti@kantinflow.local`, password minimal 6 karakter).
4. Tunjukkan bahwa akun baru langsung muncul di daftar dengan status **Aktif** (password tersimpan sebagai hash **Bcrypt** di MongoDB dan tidak pernah dikembalikan API).

### Tahap B — Manajemen Barang, Pencarian & Filter (FR-002 & FR-003)
1. Buka menu **Barang & Batch**, klik **+ Tambah Barang** dan tambahkan contoh barang baru (mis. kode `ROTI-01`, nama `Roti Tawar`, satuan `bungkus`, stok minimum `3`).
2. Coba fitur **Pencarian** (`SUSU` / `ROTI`), **Filter Status** (`Aktif`/`Diarsipkan`), **Filter Stok Menipis**, dan **Pengurutan**.
3. Demonstrasikan penghapusan barang **tanpa riwayat** (`ROTI-01` → klik **Hapus / Arsip** → terhapus permanen `204`).

### Tahap C — Login sebagai Petugas & Uji RBAC (FR-001 + NFR Keamanan)
1. Klik **Keluar**, lalu masuk menggunakan akun **`petugas@kantinflow.local`** (atau akun baru `siti@kantinflow.local`).
2. Tunjukkan bahwa menu **Akun Petugas** dan **Laporan Biaya** otomatis **disembunyikan**, tombol Tambah/Ubah/Hapus barang tidak tampil, dan kolom **Harga Beli / Total Biaya** tidak terlihat di Detail Batch maupun Riwayat Transaksi.

### Tahap D — Penerimaan Stok, Validasi & Idempotensi (FR-005)
1. Buka menu **Stok Masuk**, pilih **Susu Kotak (`SUSU-KOTAK`)** dari dropdown dinamis:
   - **Batch A:** kode `SUSU-A`, jumlah `5`, harga beli `4500`, tanggal masuk hari ini, kedaluwarsa **H+2** → klik **Simpan penerimaan** → saldo menjadi **5 kotak**.
   - **Uji validasi jumlah 0:** ubah jumlah menjadi `0` lalu klik simpan → muncul pesan inline *"Jumlah harus lebih dari 0"*, saldo tetap **5 kotak**.
   - **Batch B:** kode `SUSU-B`, jumlah `7`, harga beli `5000`, tanggal masuk hari ini, kedaluwarsa **H+10** → klik simpan → saldo fisik menjadi **12 kotak**.

### Tahap E — Pemantauan Dashboard H-3 (FR-004)
1. Buka menu **Dashboard**:
   - Tunjukkan bahwa `SUSU-A` (kedaluwarsa H+2) otomatis masuk ke tabel **Batch Mendekati Kedaluwarsa (H-3)** dengan badge peringatan `H-2`.
   - Klik **Cek Batch** pada barang untuk melihat urutan batch berdasarkan kedaluwarsa terdekat.

### Tahap F — Pemakaian FEFO Lintas Batch & Tolak Stok Kurang (FR-006)
1. Buka menu **Pemakaian FEFO**, pilih **Susu Kotak**:
   - Amati **Pratinjau Urutan Batch FEFO**: `#1 SUSU-A (5 kotak)` lalu `#2 SUSU-B (7 kotak)`.
   - Masukkan jumlah **`8`** kotak, isi catatan `Sajian pagi`, lalu klik **Catat Pemakaian FEFO**.
   - Panel kanan menampilkan pemotongan lintas batch otomatis: **`SUSU-A: -5 kotak (sisa 0)`** dan **`SUSU-B: -3 kotak (sisa 4)`**, dengan sisa stok layak **4 kotak**.
2. **Uji stok kurang:** masukkan jumlah **`5`** kotak (melebihi sisa layak 4 kotak) → sistem menolak (`409 INSUFFICIENT_USABLE_STOCK`) dan saldo tetap utuh **4 kotak**.

### Tahap G — Pembuangan Stok & Laporan Biaya Admin (FR-007)
1. Buka menu **Pembuangan**, pilih **Susu Kotak** → pilih batch `SUSU-B` (sisa 4 kotak) → masukkan jumlah **`1`**, pilih alasan **`Kemasan rusak / bocor`**, lalu klik **Catat Pembuangan Stok** → sisa batch menjadi **3 kotak**.
2. Buka menu **Riwayat Stok**: lihat seluruh mutasi (`RECEIPT`, `USAGE`, `DISPOSAL`) tampil kronologis **tanpa kolom biaya** untuk petugas.
3. **Keluar** dan masuk kembali sebagai **`admin@kantinflow.local`**, lalu buka **Laporan Biaya**:
   - Tunjukkan **Total Biaya Terbuang** otomatis terhitung akurat (`1 kotak × Rp 5.000 = Rp 5.000`), lengkap dengan ringkasan per barang, per alasan, dan rincian transaksi.

---

## 3. Verifikasi Automated Test, Benchmark & Postman

### Menjalankan Seluruh Automated Test (Node Test Runner + Supertest)
```powershell
cd backend
npm.cmd run db:start
npm.cmd test          # 15/15 unit & Supertest integration test (FR-001 s.d. FR-007 + RBAC 401/403)
npm.cmd run benchmark # Benchmark 100 request/endpoint (target < 500 ms)
npm.cmd run db:stop
```

### Menguji Koleksi Postman
1. Impor file `docs/kantinflow.postman_collection.json` ke Postman.
2. Pada tab **Variables** koleksi, atur `baseUrl` (default `http://localhost:3001`, sesuaikan dengan port backend Anda) dan isi `password` dari `backend/.env`.
3. Jalankan request **Login Admin** terlebih dahulu — script test otomatis menyimpan JWT ke variabel `{{token}}` untuk seluruh request berikutnya.
