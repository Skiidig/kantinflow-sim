# Frontend KantinFlow SIM

React 19 + Vite untuk dua layar:

1. **Masuk** — mengirim email/password ke `POST /api/v1/auth/login`.
2. **Stok Masuk** — mengirim formulir ke `POST /api/v1/stock/receipts` dengan
   Bearer token dari login dan `Idempotency-Key`.

## Konfigurasi

Salin `.env.example` menjadi `.env`:

```powershell
Copy-Item .env.example .env
```

| Variabel | Keterangan |
| --- | --- |
| `VITE_DEMO_ITEM_ID` | `itemId` Susu Kotak dari `npm.cmd run seed:reset` di backend. |
| `VITE_DEMO_ITEM_NAME` | Nama tampilan barang demo. |
| `VITE_DEMO_ITEM_UNIT` | Satuan barang demo. |
| `VITE_DEMO_EMAIL` | Email yang diprefill di layar Masuk. |
| `VITE_API_BASE_URL` | Opsional; kosongkan untuk memakai proxy Vite. Isi hanya untuk origin yang sama/proxy karena backend belum memasang CORS. |

`itemId` bisa berubah bila database demo dibuat ulang. Jalankan seed, lalu
perbarui `VITE_DEMO_ITEM_ID`.

## Menjalankan

Backend dan MongoDB harus aktif lebih dulu. Lihat panduan di
`../backend/README.md`.

```powershell
npm.cmd install
npm.cmd run dev
```

Buka `http://localhost:5173`.

Vite mem-proxy `/api` ke `http://127.0.0.1:3000`, jadi backend tidak perlu
konfigurasi CORS untuk pengembangan. Binding backend tetap `127.0.0.1`.

## Uji manual

Dari saldo 0:

1. Masuk dengan akun demo.
2. Isi kode batch `SUSU-WEB-01`, jumlah `5`, harga `4500`, dan tanggal valid.
3. Simpan. Kartu saldo harus menampilkan **5 kotak**.
4. Ubah jumlah menjadi `0`, simpan lagi.
5. Pesan `Jumlah harus lebih dari 0` muncul di bawah kolom Jumlah; isian lain
   tetap dan saldo tetap 5.

Jika ingin mengulang dari nol, jalankan `npm.cmd run seed:reset` di folder
`backend`, lalu muat ulang halaman.

## Perilaku pengiriman

- Tombol dinonaktifkan saat request berjalan. Sebuah ref juga mencegah dua
  request bila tombol terklik dua kali sebelum React sempat merender.
- `Idempotency-Key` berupa UUID yang terikat pada isi formulir. Bila request
  gagal karena jaringan atau server 5xx, tombol berubah menjadi **Coba lagi**
  dan kunci yang sama dipakai ulang untuk isi yang sama.
- Setelah sukses, mengirim isian yang persis sama tidak membuat request baru.
  Ubah isian untuk mencatat penerimaan berikutnya.
- Respons `400` dengan `fields.quantity` ditampilkan di bawah kolom Jumlah dan
  fokus kembali ke kolom itu.
- Token disimpan di `sessionStorage`; respons `401` saat menyimpan akan
  mengakhiri sesi dan kembali ke layar Masuk.

## Tes dan build

```powershell
npm.cmd test
npm.cmd run build
```

`npm.cmd test` memakai test runner Node untuk memeriksa bahwa kunci idempotensi
dipakai ulang hanya saat isi request sama.

## Struktur

| File | Isi |
| --- | --- |
| `src/App.jsx` | Perpindahan layar dan sesi `sessionStorage`. |
| `src/screens/LoginScreen.jsx` | Layar Masuk. |
| `src/screens/ReceiptScreen.jsx` | Formulir Stok Masuk, error, dan kartu saldo. |
| `src/api.js` | Pemanggilan login/penerimaan dan klasifikasi error. |
| `src/idempotency.js` | Pemilihan kunci idempotensi berdasarkan isi request. |
| `src/styles.css` | Tampilan responsif dua layar. |
| `vite.config.js` | Proxy `/api` ke backend lokal. |

## Batas tahap ini

- Satu barang demo; daftar barang dinamis belum ada.
- Belum ada layar riwayat atau pengambilan saldo awal.
- Belum ada refresh token; token berakhir sesuai `JWT_EXPIRES_IN` backend.
