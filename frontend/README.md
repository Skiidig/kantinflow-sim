# Frontend KantinFlow SIM

Antarmuka web SPA berbasis **React 19 + Vite 8 + plain CSS Custom Properties** untuk seluruh alur operasional dan administrasi **KantinFlow SIM** (`FR-001` s.d. `FR-007`).

## 1. Konfigurasi Lokal

Dari folder `frontend/`:

```powershell
Copy-Item .env.example .env
npm.cmd ci
```

| Variabel | Keterangan |
| --- | --- |
| `VITE_API_BASE_URL` | Kosongkan saat pengembangan lokal agar request `/api` otomatis diteruskan melalui proxy Vite ke `http://127.0.0.1:3000`. Isi dengan URL origin backend (tanpa slash akhir) saat deployment produksi. |

## 2. Menjalankan Aplikasi

Pastikan MongoDB Replica Set dan backend berjalan di port `3000` (atau gunakan `npm.cmd start` dari folder root untuk menyalakan semuanya sekaligus):

```powershell
npm.cmd run dev
```

Aplikasi tersedia di **`http://localhost:5173`**. Proxy pengembangan pada `vite.config.js` meneruskan `/api` ke `http://127.0.0.1:3000`.

## 3. Cakupan Layar & Perilaku Utama

Navigasi dikelola oleh custom History API router di `src/App.jsx` bersama `src/components/AppShell.jsx` yang menyesuaikan menu berdasarkan peran (`admin` vs `petugas`):

| Rute | Layar | Akses | Fungsi Utama |
| --- | --- | --- | --- |
| — | `LoginScreen.jsx` | Publik | Login JWT ke `POST /api/v1/auth/login` dan manajemen pesan sesi. |
| `/dashboard` | `DashboardScreen.jsx` | `admin`, `petugas` | KPI persediaan, tabel stok menipis, batch mendekati kedaluwarsa (`H-3`/`H-7`/`H-14`), dan batch kedaluwarsa bersisa. |
| `/items` | `ItemsScreen.jsx` | `admin`, `petugas` | Pencarian, filter status & stok menipis, pengurutan, pagination, modal detail batch FEFO, serta CRUD & hapus/arsip barang khusus `admin`. |
| `/receipts` | `ReceiptScreen.jsx` | `admin`, `petugas` | Formulir penerimaan stok masuk idempoten (`Idempotency-Key`) dengan default tanggal operasional WITA (`Asia/Makassar`). |
| `/usages` | `UsageScreen.jsx` | `admin`, `petugas` | Formulir pemakaian stok FEFO lintas batch dengan pratinjau urutan batch layak dan rincian alokasi. |
| `/disposals` | `DisposalScreen.jsx` | `admin`, `petugas` | Pencatatan pembuangan stok per batch (hanya menampilkan barang aktif dan menangani penolakan `ITEM_INACTIVE`). |
| `/transactions` | `TransactionsScreen.jsx` | `admin`, `petugas` | Riwayat mutasi stok kronologis dengan filter barang, jenis, dan rentang tanggal; kolom biaya hanya tampil untuk `admin`. |
| `/users` | `UsersScreen.jsx` | `admin` | Daftar/filter akun, tambah akun baru, dan aktif/nonaktifkan akun (mencegah nonaktifkan akun sendiri). |
| `/reports/disposals` | `DisposalReportScreen.jsx` | `admin` | Ringkasan biaya barang terbuang per barang, per alasan, dan rincian per transaksi. |

Perilaku teknis penting:
- **Sesi & Auto-Logout:** Token disimpan di `sessionStorage`; respons `401` otomatis membersihkan sesi dan mengembalikan pengguna ke layar Masuk.
- **Idempotensi & Anti Double-Submit:** Layar Stok Masuk, Pemakaian FEFO, dan Pembuangan menggunakan `resolveIdempotencyKey()` (`src/idempotency.js`) dan ref in-flight sehingga pengiriman ulang akibat gangguan jaringan tidak menggandakan data.
- **Konsistensi Zona Waktu (`Asia/Makassar` / WITA):** `src/format.js` memformat seluruh timestamp transaksi (`formatDateTimeId`) dan nilai default tanggal operasional (`getOperationalDateString`) secara eksplisit pada zona waktu `Asia/Makassar`, sementara tanggal kalender `YYYY-MM-DD` (`formatDateId`) diproses tanpa pergeseran zona waktu.

## 4. Pengujian & Build Produksi

```powershell
npm.cmd test          # 7/7 unit test lulus (format Rupiah, tanggal & waktu WITA, lintas TZ, & idempotensi)
npm.cmd run build     # Build produksi Vite ke frontend/dist/
npm.cmd run preview   # Pratinjau hasil build produksi secara lokal
```

## 5. Struktur File Utama

| File / Folder | Isi |
| --- | --- |
| `src/App.jsx` | Routing client-side, penjagaan peran (`ADMIN_ONLY_PATHS`), sesi `sessionStorage`, dan state toast. |
| `src/api.js` | HTTP client `fetch`, manajemen Bearer token, handler `401`, serta klasifikasi `ApiError` & `NetworkError`. |
| `src/format.js` & `src/format.test.js` | Formatter Rupiah, tanggal Indonesia, timestamp WITA, default tanggal operasional, dan unit test. |
| `src/idempotency.js` & `src/idempotency.test.js` | Resolver `Idempotency-Key` berbasis fingerprint payload dan unit test. |
| `src/components/` | `AppShell.jsx`, `Icon.jsx`, dan `ToastContainer.jsx`. |
| `src/screens/` | 9 layar fitur (`Login`, `Dashboard`, `Items`, `Receipt`, `Usage`, `Disposal`, `Transactions`, `Users`, `DisposalReport`). |
| `src/styles.css` | Stylesheet tunggal responsif berbasis CSS Custom Properties (tanpa Tailwind). |
| `vite.config.js` & `vercel.json` | Proxy dev `/api` → `http://127.0.0.1:3000` dan SPA rewrite untuk Vercel. |
