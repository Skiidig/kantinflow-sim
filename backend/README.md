# Backend KantinFlow SIM

Antarmuka web React untuk alur login dan stok masuk ada di `../frontend`.
Panduan menjalankan keduanya ada di `../README.md`.

Backend Express + MongoDB untuk dua alur pertama:

- `POST /api/v1/auth/login` memeriksa password lalu menerbitkan JWT HS256.
- `POST /api/v1/stock/receipts` memakai JWT tersebut untuk mencatat batch dan
  satu entri riwayat stok dalam satu transaksi MongoDB.

Dokumen ini juga menjelaskan cara menyiapkan MongoDB lokal yang mendukung
transaksi, data demo, dan dua request Postman.

## Prasyarat

- Node.js 22.9 atau lebih baru (dites dengan Node 26).
- PowerShell di Windows.
- Ruang disk sekitar 2 GB untuk MongoDB portabel dan data lokal.

Jalankan perintah dari folder `backend`. Jika PowerShell menolak menjalankan
`npm.ps1` karena execution policy, gunakan `npm.cmd` seperti contoh di bawah.

## 1. Konfigurasi lokal

```powershell
Copy-Item .env.example .env
```

Isi `.env`:

| Variabel | Keterangan |
| --- | --- |
| `MONGODB_URI` | URI MongoDB pengembangan, harus replica set. |
| `MONGODB_DB` | Nama database pengembangan. |
| `JWT_SECRET` | Rahasia acak minimal 32 byte. |
| `JWT_EXPIRES_IN` | Umur token, default `8h`. |
| `PORT` | Port HTTP, default `3000`. |
| `TEST_MONGODB_URI` | URI untuk tes integrasi. |
| `DEMO_STAFF_EMAIL` | Email akun petugas demo. |
| `DEMO_STAFF_PASSWORD` | Password demo; hanya dibaca oleh skrip seed. |
| `DEMO_STAFF_NAME` | Nama yang ditampilkan di profil. |

`.env` sudah masuk `.gitignore`. Jangan menaruh password atau rahasia JWT di
file yang ikut di-commit.

## 2. Menyalakan MongoDB lokal dengan transaksi

```powershell
npm.cmd run db:start
```

Perintah ini, sekali saja, mengunduh MongoDB Community portabel 7.0.14 ke
`backend/.tools/`, mengekstraknya, lalu menjalankan `mongod` dengan:

- data di `backend/.data/mongodb`
- log di `backend/.data/mongod.log`
- port `27017`, hanya `127.0.0.1`
- replica set `rs0`

Setelah port terbuka, skrip `scripts/init-replica.mjs` menjalankan
`replSetInitiate` dan menunggu node menjadi primary. Transaksi MongoDB hanya
tersedia pada replica set atau cluster sharded, bukan standalone.

Hentikan MongoDB lokal dengan:

```powershell
npm.cmd run db:stop
```

## 3. Menyiapkan data demo

```powershell
npm.cmd run seed:reset
```

Skrip `scripts/seed-demo.mjs`:

- membaca `MONGODB_URI`, `MONGODB_DB`, dan `DEMO_STAFF_PASSWORD` dari `.env`;
- membuat hash password dengan `scrypt` dari modul `node:crypto`, bukan
  menyimpan password mentah;
- membuat/memperbarui akun `staff` aktif dengan email demo;
- membuat/memperbarui barang **Susu Kotak** (`sku: SUSU-KOTAK`,
  `baseUnit: kotak`, `quantityScale: 0`);
- dengan `--reset`, menghapus batch dan riwayat khusus barang demo lalu
  mengembalikan `stockRevision` ke 0.

Keluarannya memuat `itemId`:

```text
Database      : kantinflow_dev (replica set rs0)
Akun petugas  : petugas@kantinflow.local
Password      : nilai DEMO_STAFF_PASSWORD di .env
Barang        : Susu Kotak (sku SUSU-KOTAK)
itemId        : 6741f0c2a1b2c3d4e5f60718
Saldo awal    : 0 kotak
```

Salin `itemId` tersebut ke variabel koleksi Postman `itemId`. Jalankan
`seed:reset` lagi kapan pun ingin mengulang demo dari saldo 0. Perintah
`npm.cmd run seed` membuat data tanpa menghapus stok yang sudah ada.

## 4. Menjalankan server

```powershell
npm.cmd start
```

Server mendengarkan di `http://127.0.0.1:3000` dan membuat indeks idempotensi
untuk riwayat stok saat mulai.

## 5. Mencoba login

Request:

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "petugas@kantinflow.local",
  "password": "<DEMO_STAFF_PASSWORD>"
}
```

Respons sukses `200`:

```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "6741f0c2a1b2c3d4e5f60719",
      "name": "Petugas Demo",
      "email": "petugas@kantinflow.local",
      "role": "staff"
    }
  }
}
```

Email tidak dikenal, password salah, dan akun nonaktif semuanya menghasilkan
respons `401` yang sama:

```json
{ "error": { "code": "INVALID_CREDENTIALS" } }
```

Email dinormalisasi dengan `trim().toLowerCase()`. Password dibandingkan dengan
hash `scrypt` memakai `timingSafeEqual`. Respons tidak pernah memuat
`passwordHash`, dan header `Cache-Control: no-store` dipasang.

Token ditandatangani dengan HS256, `sub` berisi ID MongoDB pengguna, klaim
`role` hanya informasi tambahan, dan `exp` dibatasi `JWT_EXPIRES_IN`.

## 6. Menerima stok dengan token login

```http
POST /api/v1/stock/receipts
Authorization: Bearer <token dari login>
Idempotency-Key: demo-receipt-5-kotak
Content-Type: application/json

{
  "itemId": "<itemId dari seed>",
  "batchCode": "SUSU-DEMO-01",
  "quantity": "5",
  "unitCost": "4500.00",
  "receivedOn": "2026-11-17",
  "expiresOn": "2026-11-24"
}
```

Respons pertama `201`:

```json
{
  "data": {
    "batchId": "6741f0c2a1b2c3d4e5f6071a",
    "transactionId": "6741f0c2a1b2c3d4e5f6071b",
    "itemId": "6741f0c2a1b2c3d4e5f60718",
    "stockBalance": "5",
    "unit": "kotak"
  }
}
```

Mengirim ulang request yang sama dengan `Idempotency-Key` sama menghasilkan
`200` dan data yang sama, tanpa batch/riwayat baru. Key sama dengan isi berbeda
menghasilkan `409 IDEMPOTENCY_CONFLICT`.

Jumlah `0` ditolak sebelum transaksi dimulai:

```http
POST /api/v1/stock/receipts
Authorization: Bearer <token>
Idempotency-Key: demo-receipt-zero

{ "...": "...", "quantity": "0" }
```

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "fields": { "quantity": "Jumlah harus lebih dari 0" }
  }
}
```

Karena validasi selesai sebelum `saveReceipt`, tidak ada batch atau riwayat baru
dan saldo tidak berubah.

## 7. Urutan request di Postman

Impor:

```text
postman/KantinFlow-SIM.postman_collection.json
```

Koleksi sengaja mengosongkan `password`, `token`, dan `itemId`. Langkahnya:

1. Isi variabel koleksi `password` dengan `DEMO_STAFF_PASSWORD` dari `.env`.
2. Isi variabel koleksi `itemId` dari keluaran `npm.cmd run seed:reset`.
3. Jalankan **1. Login petugas**. Script tes menyimpan `data.token` ke variabel
   `token`.
4. Jalankan **2. Terima 5 kotak Susu Kotak**. Header memakai
   `Bearer {{token}}` dan `Idempotency-Key: demo-receipt-5-kotak`. Status
   `201`, `stockBalance` `"5"`, `unit` `"kotak"`.
5. Jalankan **3. Tolak jumlah 0**. Status `400`,
   `fields.quantity` = `"Jumlah harus lebih dari 0"`, saldo tetap 5 dan riwayat
   tetap satu.

Jika request nomor 2 dijalankan lagi, statusnya `200` karena replay idempoten,
bukan `201`, dan saldo tetap 5.

## 8. Tes

```powershell
npm.cmd test
```

Dengan `TEST_MONGODB_URI` di `.env`, seluruh tes berjalan:

- 3 tes validasi penerimaan;
- 2 tes hash/verifikasi password;
- 1 tes integrasi penerimaan stok yang sudah ada;
- 1 tes integrasi login sampai penerimaan stok.

Tes integrasi membuat database acak `kantinflow_test_<acak>`, memakai replica
set, lalu menghapus database itu setelah selesai. Tanpa `TEST_MONGODB_URI`, dua
tes integrasi dilewati dan hanya tes unit yang berjalan.

Tes login memeriksa: email dinormalisasi, token HS256 berisi `sub`, profil tanpa
hash, tiga kegagalan login menghasilkan `401` yang identik, jumlah kosong
menghasilkan `400`, token login dapat mencatat satu batch dan satu riwayat,
pengiriman ulang bersifat idempoten, dan jumlah `0` tidak menulis apa pun.

## 9. Alur data: login sampai tersimpan

1. Postman mengirim email dan password ke `/api/v1/auth/login`.
2. Express menormalkan email lalu mencari dokumen `users` berdasarkan email.
3. `verifyPassword` membaca format hash `scrypt$N$r$p$salt$hash`, menurunkan
   ulang kunci dengan salt tersimpan, dan membandingkannya secara konstan.
4. Bila akun tidak ada, password salah, atau `isActive !== true`, API berhenti
   dengan `401 INVALID_CREDENTIALS`. Tidak ada perbedaan respons di antara
   ketiganya.
5. Bila valid, `jwt.sign` membuat token HS256 dengan `sub` = `_id` pengguna dan
   masa berlaku terbatas. Token dan profil minimal dikirim ke Postman.
6. Script tes Postman menyimpan token ke variabel koleksi `token`.
7. Request penerimaan mengirim `Authorization: Bearer <token>` beserta body dan
   `Idempotency-Key`.
8. Endpoint penerimaan menjalankan `jwt.verify` dengan algoritma yang dibatasi
   HS256. Token rusak/kedaluwarsa atau `sub` yang bukan 24 karakter hex menjadi
   `401 UNAUTHENTICATED`.
9. `sub` diubah menjadi `ObjectId`, lalu pengguna dicari dengan
   `{ _id, isActive: true }`. Pengguna tidak aktif menjadi `401`; peran di luar
   `admin`/`staff` menjadi `403`.
10. Body divalidasi dan `Idempotency-Key` diwajibkan sebelum menyentuh stok.
11. `saveReceipt` membuka transaksi. Di dalamnya: cek kunci idempotensi,
    menaikkan `stockRevision` barang sebagai pengunci, memeriksa skala jumlah,
    menyisipkan dokumen `batches`, menghitung saldo dari seluruh batch, lalu
    menyisipkan satu dokumen `stockTransactions` yang memuat hasil respons.
12. Transaksi di-commit. API mengembalikan `201` beserta `batchId`,
    `transactionId`, `stockBalance`, dan `unit`. Batch dan riwayat tersimpan
    bersama; bila salah satu gagal, keduanya dibatalkan.

## 10. File utama

| File | Isi |
| --- | --- |
| `app.mjs` | Route login, route penerimaan, autentikasi JWT, error handler. |
| `password.mjs` | Hash dan verifikasi password `scrypt`. |
| `api-error.mjs` | Error HTTP yang aman dikembalikan ke klien. |
| `receipt-store.mjs` | Transaksi batch + riwayat dan idempotensi. |
| `validate-receipt.mjs` | Validasi body penerimaan. |
| `server.mjs` | Konfigurasi environment dan startup. |
| `scripts/start-mongodb.ps1` | MongoDB portabel + replica set `rs0`. |
| `scripts/init-replica.mjs` | Inisialisasi dan pengecekan primary. |
| `scripts/seed-demo.mjs` | Akun petugas dan barang Susu Kotak. |
| `postman/KantinFlow-SIM.postman_collection.json` | Dua request demo. |

## Catatan produksi

- Login belum memiliki rate limit, refresh token, atau pencabutan token.
- Ganti `JWT_SECRET`, password demo, dan gunakan TLS saat tidak lagi lokal.
- `seed:reset` hanya untuk database pengembangan karena menghapus stok barang
  demo.
