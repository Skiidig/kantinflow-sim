# KantinFlow SIM

Simulasi alur kantin bertahap. Tahap yang sudah tersedia:

- backend Express + MongoDB untuk login petugas dan penerimaan stok;
- frontend React + Vite dengan layar **Masuk** dan **Stok Masuk**;
- satu alur uji: login → isi formulir → simpan → lihat saldo dari server.

Panduan backend yang lengkap ada di [`backend/README.md`](backend/README.md).
Panduan frontend ada di [`frontend/README.md`](frontend/README.md).

## Menjalankan semuanya

Prasyarat: Node.js 22.12+ dan PowerShell di Windows. Gunakan `npm.cmd` jika
PowerShell menolak menjalankan `npm.ps1`.

### 1. MongoDB dan data demo

Dari folder `backend`:

```powershell
npm.cmd run db:start     # hanya jika MongoDB lokal belum berjalan
npm.cmd run seed:reset   # membuat akun demo + Susu Kotak, saldo 0
```

Catat `itemId` yang dicetak. `frontend/.env` saat ini sudah berisi `itemId`
untuk database demo yang sama.

### 2. Backend

Masih dari folder `backend`:

```powershell
npm.cmd start
```

Backend berjalan di `http://127.0.0.1:3000`.

### 3. Frontend

Di terminal lain, dari folder `frontend`:

```powershell
npm.cmd install
npm.cmd run dev
```

Buka `http://localhost:5173`.

Jika memakai clone baru, salin `frontend/.env.example` menjadi `frontend/.env`
lalu isi `VITE_DEMO_ITEM_ID` dari keluaran `seed:reset`.

## Akun demo

Nilai aktual ada di `backend/.env`:

- email: `petugas@kantinflow.local`
- password: nilai `DEMO_STAFF_PASSWORD`

`.env` tidak ikut di-commit.

## Uji penerimaan dari browser

Pastikan `seed:reset` baru saja dijalankan agar saldo awal 0.

1. Masuk dengan akun demo.
2. Di layar **Stok Masuk**, isi:
   - kode batch: `SUSU-WEB-01`
   - jumlah: `5`
   - harga beli per satuan: `4500`
   - tanggal masuk dan kedaluwarsa: tanggal valid, kedaluwarsa setelah masuk
3. Klik **Simpan penerimaan**.
4. Kartu kanan menampilkan **Saldo terkini 5 kotak** dan batch `SUSU-WEB-01`.
5. Ubah jumlah menjadi `0`, lalu klik **Simpan penerimaan** lagi.
6. Pesan **“Jumlah harus lebih dari 0”** muncul di bawah kolom Jumlah. Semua
   isian tetap ada dan saldo tetap 5.
7. Coba klik tombol simpan dua kali cepat: hanya satu request yang dikirim.

Untuk mengulang dari nol:

```powershell
cd backend
npm.cmd run seed:reset
```

Lalu muat ulang halaman frontend.

## Tes

Backend:

```powershell
cd backend
npm.cmd test
```

Frontend:

```powershell
cd frontend
npm.cmd test
npm.cmd run build
```

## Batas tahap ini

- Barang masih satu data demo **Susu Kotak**; daftar barang dinamis belum ada.
- Layar riwayat belum ada.
- Frontend memakai `sessionStorage`, jadi sesi hilang saat tab ditutup.
- `seed:reset` hanya untuk database pengembangan karena menghapus stok barang
  demo.
