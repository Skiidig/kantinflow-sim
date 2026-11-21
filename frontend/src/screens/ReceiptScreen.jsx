import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError, getItems, saveReceipt } from '../api.js';
import { resolveIdempotencyKey } from '../idempotency.js';
import Icon from '../components/Icon.jsx';

const formFieldNames = ['itemId', 'batchCode', 'quantity', 'unitCost', 'receivedOn', 'expiresOn'];

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialForm(itemId = '') {
  const today = new Date();
  const expires = new Date(today);
  expires.setDate(expires.getDate() + 7);
  return {
    itemId,
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

function quantityStepForScale(scale = 0) {
  if (!scale || scale <= 0) return '1';
  return `0.${'0'.repeat(scale - 1)}1`;
}

export default function ReceiptScreen({ session, onLogout, onToast }) {
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState('');

  const [form, setForm] = useState(() => initialForm(''));
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [formNotice, setFormNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const pendingKeyRef = useRef(null);
  const inFlightRef = useRef(false);
  const quantityRef = useRef(null);

  const loadActiveItems = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setItemsLoading(true);
    setItemsError('');
    try {
      const response = await getItems({
        status: 'active',
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 100,
      });
      const list = response.data ?? [];
      setItems(list);
      setForm((previous) => {
        if (previous.itemId && list.some((item) => item.id === previous.itemId)) {
          return previous;
        }
        return { ...previous, itemId: list[0]?.id ?? '' };
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return;
      setItemsError(
        error instanceof NetworkError
          ? 'Tidak dapat terhubung ke server. Pastikan backend berjalan di port 3000.'
          : 'Gagal memuat daftar barang aktif.',
      );
    } finally {
      setItemsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActiveItems();
  }, [loadActiveItems]);

  const selectedItem = items.find((item) => item.id === form.itemId) ?? null;
  const currentUnit = selectedItem?.baseUnit ?? 'satuan';
  const quantityScale = selectedItem?.quantityScale ?? 0;

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
    if (!selectedItem) {
      setFieldErrors({ itemId: 'Pilih barang yang valid' });
      return;
    }

    const payload = {
      itemId: selectedItem.id,
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
        itemName: selectedItem.name,
        itemCode: selectedItem.code,
        batchCode: payload.batchCode,
        quantity: payload.quantity,
        fingerprint,
      });
      onToast?.({
        type: 'success',
        title: 'Penerimaan tersimpan',
        message: `${selectedItem.name} (${payload.batchCode}, +${payload.quantity} ${data.unit}) tercatat. Saldo kini ${data.stockBalance} ${data.unit}.`,
      });
      loadActiveItems({ silent: true });
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
          setFormError('Barang yang dipilih tidak ditemukan. Muat ulang daftar barang.');
        } else if (error.status === 409) {
          setFormError(
            error.code === 'IDEMPOTENCY_CONFLICT'
              ? 'Isian berubah saat pengiriman diulang. Coba kirim ulang.'
              : 'Barang sedang diarsipkan dan tidak dapat menerima stok baru.',
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
    <div className="page-container page-container--form">
      <div className="page-heading">
        <div>
          <h1>Stok masuk</h1>
          <p className="lede">
            Pilih barang aktif, isi detail batch, lalu cocokkan saldo terbaru dari server.
          </p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => loadActiveItems()}
            disabled={itemsLoading}
          >
            <Icon name="refresh" size={15} />
            {itemsLoading ? 'Memuat barang…' : 'Muat ulang barang'}
          </button>
        </div>
      </div>

      <div className="receipt-grid">
        <section className="card form-card" aria-labelledby="receipt-form-title">
          <div className="card-heading">
            <div>
              <h2 id="receipt-form-title">Detail penerimaan</h2>
              <p>Isi sesuai surat jalan atau nota dari pemasok.</p>
            </div>
          </div>

          {itemsError && <div className="form-alert" role="alert">{itemsError}</div>}
          {formError && <div className="form-alert" role="alert">{formError}</div>}
          {formNotice && <div className="notice notice--info" role="status">{formNotice}</div>}

          <form className="receipt-form" onSubmit={handleSubmit} noValidate>
            <div className="field field--full">
              <label htmlFor="item">Barang</label>
              <select
                id="item"
                name="itemId"
                value={form.itemId}
                disabled={itemsLoading || items.length === 0}
                onChange={(event) => updateField('itemId', event.target.value)}
                aria-invalid={Boolean(fieldErrors.itemId)}
              >
                {itemsLoading ? (
                  <option value="">Memuat daftar barang aktif…</option>
                ) : items.length === 0 ? (
                  <option value="">Belum ada barang aktif — tambahkan di menu Barang</option>
                ) : (
                  items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.name} ({item.baseUnit})
                    </option>
                  ))
                )}
              </select>
              {fieldErrors.itemId && <p className="field-error">{fieldErrors.itemId}</p>}
              {selectedItem && (
                <p className="field-hint">
                  Stok saat ini: <strong>{selectedItem.usableStock} {selectedItem.baseUnit}</strong> layak
                  {' · '}
                  {selectedItem.physicalStock} {selectedItem.baseUnit} fisik
                  {quantityScale > 0 ? ` · ketelitian ${quantityScale} desimal` : ' · bilangan bulat'}.
                </p>
              )}
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
                placeholder="Contoh: SUSU-20261121-A"
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
                  step={quantityStepForScale(quantityScale)}
                  inputMode={quantityScale > 0 ? 'decimal' : 'numeric'}
                  value={form.quantity}
                  onChange={(event) => updateField('quantity', event.target.value)}
                  placeholder="0"
                  aria-invalid={Boolean(fieldErrors.quantity)}
                  aria-describedby={fieldErrors.quantity ? 'quantity-error' : undefined}
                />
                <span>{currentUnit}</span>
              </div>
              {fieldErrors.quantity && (
                <p className="field-error" id="quantity-error">{fieldErrors.quantity}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="unitCost">Harga beli per {currentUnit}</label>
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
              <button className="btn-primary" type="submit" disabled={submitting || !selectedItem}>
                {submitting && <span className="spinner" aria-hidden="true" />}
                {submitting
                  ? 'Menyimpan…'
                  : formError.startsWith('Koneksi') || formError.startsWith('Server gagal')
                    ? 'Coba lagi'
                    : 'Simpan penerimaan'}
              </button>
              <p className="form-footnote">
                Dilindungi Idempotency-Key &amp; transaksi atomik (1 batch + 1 riwayat).
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
              <span className="success-mark" aria-hidden="true">
                <Icon name="check" size={18} />
              </span>
              <p className="balance-caption">Saldo fisik terkini ({receipt.itemName})</p>
              <p className="balance-number">
                {receipt.stockBalance}
                <span>{receipt.unit}</span>
              </p>
              <dl className="receipt-summary">
                <div>
                  <dt>Kode barang</dt>
                  <dd className="mono">{receipt.itemCode}</dd>
                </div>
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
              <p className="balance-note">Angka saldo berasal langsung dari transaksi atomik server.</p>
            </>
          ) : (
            <>
              <span className="balance-empty-icon" aria-hidden="true">
                <Icon name="receipts" size={20} />
              </span>
              <p className="balance-caption">Belum ada penerimaan</p>
              <p className="balance-empty-copy">
                Setelah formulir disimpan, saldo fisik terbaru dari server akan muncul di sini.
              </p>
              <ol className="flow-list">
                <li>Pilih barang aktif</li>
                <li>Isi detail batch &amp; harga</li>
                <li>Simpan &amp; periksa saldo</li>
              </ol>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
