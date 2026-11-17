import { useRef, useState } from 'react';
import { ApiError, NetworkError, saveReceipt } from '../api.js';
import { resolveIdempotencyKey } from '../idempotency.js';

const demoItem = {
  id: (import.meta.env.VITE_DEMO_ITEM_ID ?? '').trim(),
  name: import.meta.env.VITE_DEMO_ITEM_NAME || 'Susu Kotak',
  unit: import.meta.env.VITE_DEMO_ITEM_UNIT || 'kotak',
};

const formFieldNames = ['batchCode', 'quantity', 'unitCost', 'receivedOn', 'expiresOn'];

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialForm() {
  const today = new Date();
  const expires = new Date(today);
  expires.setDate(expires.getDate() + 7);
  return {
    batchCode: '',
    quantity: '',
    unitCost: '',
    receivedOn: toDateInputValue(today),
    expiresOn: toDateInputValue(expires),
  };
}

function shortId(value) {
  return value ? `${value.slice(0, 8)}…` : '—';
}

export default function ReceiptScreen({ session, onLogout }) {
  const [form, setForm] = useState(initialForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [formNotice, setFormNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const pendingKeyRef = useRef(null);
  const inFlightRef = useRef(false);
  const quantityRef = useRef(null);

  const itemConfigured = /^[a-f0-9]{24}$/iu.test(demoItem.id);
  const initials = (session.user.name ?? 'Petugas')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'P';
  const roleLabel = session.user.role === 'staff'
    ? 'Petugas'
    : session.user.role === 'admin' ? 'Admin' : session.user.role;

  function updateField(name, value) {
    setForm((previous) => ({ ...previous, [name]: value }));
    setFieldErrors((previous) => {
      if (!previous[name]) return previous;
      const next = { ...previous };
      delete next[name];
      return next;
    });
    setFormError('');
    setFormNotice('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || inFlightRef.current) return;
    if (!itemConfigured) {
      setFormError('itemId barang demo belum diisi dengan benar di frontend/.env.');
      return;
    }

    const payload = {
      itemId: demoItem.id,
      batchCode: form.batchCode.trim(),
      quantity: form.quantity.trim(),
      unitCost: form.unitCost.trim(),
      receivedOn: form.receivedOn,
      expiresOn: form.expiresOn,
    };
    const fingerprint = JSON.stringify(payload);

    if (receipt?.fingerprint === fingerprint) {
      setFieldErrors({});
      setFormError('');
      setFormNotice('Penerimaan dengan isian ini sudah tersimpan. Ubah isian untuk mencatat penerimaan lain.');
      return;
    }

    const resolvedKey = resolveIdempotencyKey(pendingKeyRef.current, fingerprint);
    pendingKeyRef.current = resolvedKey;
    inFlightRef.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setFormError('');
    setFormNotice('');

    try {
      const data = await saveReceipt({
        token: session.token,
        receipt: payload,
        idempotencyKey: resolvedKey.key,
      });
      pendingKeyRef.current = null;
      setReceipt({
        ...data,
        batchCode: payload.batchCode,
        quantity: payload.quantity,
        fingerprint,
      });
    } catch (error) {
      if (error instanceof NetworkError) {
        setFormError(
          'Koneksi ke server terputus. Isian tetap aman. Tekan Coba lagi untuk mengirim ulang dengan Idempotency-Key yang sama.',
        );
      } else if (error instanceof ApiError) {
        if (error.status === 401) {
          onLogout('Sesi Anda berakhir. Silakan masuk kembali.');
          return;
        }

        if (error.status >= 500) {
          setFormError(
            'Server gagal memproses penerimaan. Isian dipertahankan; coba lagi dengan kunci idempotensi yang sama.',
          );
        } else {
          pendingKeyRef.current = null;
        }

        if (error.status === 400 && error.fields) {
          setFieldErrors(error.fields);
          const unmapped = Object.keys(error.fields).filter((name) => !formFieldNames.includes(name));
          if (unmapped.length) setFormError('Periksa kembali isian penerimaan.');
          if (error.fields.quantity) quantityRef.current?.focus();
        } else if (error.status === 404) {
          setFormError('Barang demo tidak ditemukan. Jalankan npm.cmd run seed:reset di folder backend.');
        } else if (error.status === 409) {
          setFormError(
            error.code === 'IDEMPOTENCY_CONFLICT'
              ? 'Isian berubah saat pengiriman diulang. Muat ulang halaman lalu coba lagi.'
              : 'Barang demo sedang tidak aktif. Periksa data demo.',
          );
        } else if (error.status === 403) {
          setFormError('Akun ini tidak berwenang mencatat penerimaan stok.');
        } else if (error.status < 500) {
          setFormError('Penerimaan belum dapat disimpan. Periksa isian lalu coba lagi.');
        }
      } else {
        setFormError('Terjadi kesalahan tak terduga. Coba lagi.');
      }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">KF</span>
          <span className="brand-name">KantinFlow <em>SIM</em></span>
        </div>

        <div className="header-actions">
          <div className="user-chip">
            <span className="user-avatar" aria-hidden="true">{initials}</span>
            <div className="user-meta">
              <strong>{session.user.name ?? 'Petugas'}</strong>
              <span>{roleLabel}</span>
            </div>
          </div>
          <button
            className="btn-ghost"
            type="button"
            onClick={() => onLogout('Anda sudah keluar.')}
          >
            Keluar
          </button>
        </div>
      </header>

      <main className="receipt-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Penerimaan barang</p>
            <h1>Stok Masuk</h1>
            <p className="lede">Catat barang yang datang, lalu periksa saldo terbaru dari server.</p>
          </div>
          <div className="stage-chip">Tahap 1 · Satu barang demo</div>
        </div>

        <div className="receipt-grid">
          <section className="card form-card" aria-labelledby="receipt-form-title">
            <div className="card-heading">
              <div>
                <h2 id="receipt-form-title">Detail penerimaan</h2>
                <p>Isi sesuai surat jalan atau nota dari pemasok.</p>
              </div>
              <span className="card-step" aria-hidden="true">01</span>
            </div>

            {!itemConfigured && (
              <div className="form-alert" role="alert">
                `itemId` barang demo belum diisi dengan benar. Salin dari keluaran
                <code> npm.cmd run seed:reset </code> ke <code>frontend/.env</code>.
              </div>
            )}
            {formError && (
              <div className="form-alert" role="alert">{formError}</div>
            )}
            {formNotice && (
              <div className="notice notice--info" role="status">{formNotice}</div>
            )}

            <form className="receipt-form" onSubmit={handleSubmit} noValidate>
              <div className="field field--full">
                <label htmlFor="item">Barang</label>
                <select id="item" value={demoItem.id} disabled>
                  <option value={demoItem.id}>
                    {demoItem.name} — satuan {demoItem.unit}
                  </option>
                </select>
                <p className="field-hint">
                  Barang demo untuk tahap ini. Daftar barang dinamis menyusul.
                </p>
              </div>

              <div className="field field--full">
                <label htmlFor="batchCode">Kode batch</label>
                <input
                  id="batchCode"
                  name="batchCode"
                  type="text"
                  autoComplete="off"
                  value={form.batchCode}
                  onChange={(event) => updateField('batchCode', event.target.value)}
                  placeholder="Contoh: SUSU-20261117-A"
                  aria-invalid={Boolean(fieldErrors.batchCode)}
                  aria-describedby={fieldErrors.batchCode ? 'batchCode-error' : undefined}
                />
                {fieldErrors.batchCode && (
                  <p className="field-error" id="batchCode-error">{fieldErrors.batchCode}</p>
                )}
              </div>

              <div className="field">
                <label htmlFor="quantity">Jumlah</label>
                <div className={`input-affix${fieldErrors.quantity ? ' input-affix--error' : ''}`}>
                  <input
                    ref={quantityRef}
                    id="quantity"
                    name="quantity"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={form.quantity}
                    onChange={(event) => updateField('quantity', event.target.value)}
                    placeholder="0"
                    aria-invalid={Boolean(fieldErrors.quantity)}
                    aria-describedby={fieldErrors.quantity ? 'quantity-error' : undefined}
                  />
                  <span>{demoItem.unit}</span>
                </div>
                {fieldErrors.quantity && (
                  <p className="field-error" id="quantity-error">{fieldErrors.quantity}</p>
                )}
              </div>

              <div className="field">
                <label htmlFor="unitCost">Harga beli per satuan</label>
                <div className={`input-affix input-affix--prefix${fieldErrors.unitCost ? ' input-affix--error' : ''}`}>
                  <span>Rp</span>
                  <input
                    id="unitCost"
                    name="unitCost"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.unitCost}
                    onChange={(event) => updateField('unitCost', event.target.value)}
                    placeholder="4500"
                    aria-invalid={Boolean(fieldErrors.unitCost)}
                    aria-describedby={fieldErrors.unitCost ? 'unitCost-error' : undefined}
                  />
                </div>
                {fieldErrors.unitCost && (
                  <p className="field-error" id="unitCost-error">{fieldErrors.unitCost}</p>
                )}
              </div>

              <div className="field">
                <label htmlFor="receivedOn">Tanggal masuk</label>
                <input
                  id="receivedOn"
                  name="receivedOn"
                  type="date"
                  value={form.receivedOn}
                  onChange={(event) => updateField('receivedOn', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.receivedOn)}
                  aria-describedby={fieldErrors.receivedOn ? 'receivedOn-error' : undefined}
                />
                {fieldErrors.receivedOn && (
                  <p className="field-error" id="receivedOn-error">{fieldErrors.receivedOn}</p>
                )}
              </div>

              <div className="field">
                <label htmlFor="expiresOn">Kedaluwarsa</label>
                <input
                  id="expiresOn"
                  name="expiresOn"
                  type="date"
                  value={form.expiresOn}
                  onChange={(event) => updateField('expiresOn', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.expiresOn)}
                  aria-describedby={fieldErrors.expiresOn ? 'expiresOn-error' : undefined}
                />
                {fieldErrors.expiresOn && (
                  <p className="field-error" id="expiresOn-error">{fieldErrors.expiresOn}</p>
                )}
              </div>

              <div className="form-actions">
                <button className="btn-primary" type="submit" disabled={submitting || !itemConfigured}>
                  {submitting && <span className="spinner" aria-hidden="true" />}
                  {submitting
                    ? 'Menyimpan…'
                    : formError.startsWith('Koneksi') || formError.startsWith('Server gagal')
                      ? 'Coba lagi'
                      : 'Simpan penerimaan'}
                </button>
                <p className="form-footnote">
                  Data disimpan sebagai satu batch dan satu riwayat stok.
                </p>
              </div>
            </form>
          </section>

          <aside
            className={`card balance-card${receipt ? ' balance-card--success' : ''}`}
            aria-live="polite"
          >
            {receipt ? (
              <>
                <span className="success-mark" aria-hidden="true">✓</span>
                <p className="eyebrow">Penerimaan tersimpan</p>
                <p className="balance-caption">Saldo terkini</p>
                <p className="balance-number">
                  {receipt.stockBalance}
                  <span>{receipt.unit}</span>
                </p>
                <dl className="receipt-summary">
                  <div>
                    <dt>Batch</dt>
                    <dd>{receipt.batchCode}</dd>
                  </div>
                  <div>
                    <dt>Jumlah masuk</dt>
                    <dd>+{receipt.quantity} {receipt.unit}</dd>
                  </div>
                  <div>
                    <dt>ID transaksi</dt>
                    <dd className="mono" title={receipt.transactionId}>
                      {shortId(receipt.transactionId)}
                    </dd>
                  </div>
                </dl>
                <p className="balance-note">Angka saldo berasal langsung dari respons server.</p>
              </>
            ) : (
              <>
                <span className="balance-empty-icon" aria-hidden="true">◎</span>
                <p className="eyebrow">Konfirmasi saldo</p>
                <p className="balance-caption">Belum ada penerimaan</p>
                <p className="balance-empty-copy">
                  Setelah formulir disimpan, saldo terbaru dari server akan muncul di sini.
                </p>
                <ol className="flow-list">
                  <li>Isi detail barang</li>
                  <li>Simpan penerimaan</li>
                  <li>Periksa saldo</li>
                </ol>
              </>
            )}
          </aside>
        </div>
      </main>

      <footer className="app-footer">
        KantinFlow SIM · Login &amp; Stok Masuk
      </footer>
    </div>
  );
}
