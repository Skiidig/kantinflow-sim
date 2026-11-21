import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError, getItemBatches, getItems, recordUsage } from '../api.js';
import { formatDateId, getBatchStatusMeta } from '../format.js';
import { resolveIdempotencyKey } from '../idempotency.js';
import Icon from '../components/Icon.jsx';

function quantityStepForScale(scale = 0) {
  if (!scale || scale <= 0) return '1';
  return `0.${'0'.repeat(scale - 1)}1`;
}

export default function UsageScreen({ session, onToast }) {
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState('');

  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [batchInfo, setBatchInfo] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const pendingKeyRef = useRef(null);
  const inFlightRef = useRef(false);

  const loadItems = useCallback(async ({ silent = false } = {}) => {
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
      setSelectedItemId((prev) => {
        if (prev && list.some((item) => item.id === prev)) return prev;
        return list[0]?.id ?? '';
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setItemsError(
        err instanceof NetworkError
          ? 'Tidak dapat terhubung ke server.'
          : 'Gagal memuat daftar barang aktif.',
      );
    } finally {
      setItemsLoading(false);
    }
  }, []);

  const loadItemBatches = useCallback(async (itemId) => {
    if (!itemId) {
      setBatchInfo(null);
      return;
    }
    setBatchLoading(true);
    try {
      const data = await getItemBatches(itemId, { onlyRemaining: 'true' });
      setBatchInfo(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setBatchInfo(null);
    } finally {
      setBatchLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    loadItemBatches(selectedItemId);
  }, [selectedItemId, loadItemBatches]);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const usableBatches = (batchInfo?.batches ?? []).filter(
    (batch) => batch.status === 'LAYAK' || batch.status === 'MENDEKATI_KEDALUWARSA',
  );
  const expiredRemainingCount = (batchInfo?.batches ?? []).filter(
    (batch) => batch.status === 'KEDALUWARSA',
  ).length;
  const unit = batchInfo?.item?.baseUnit ?? selectedItem?.baseUnit ?? 'satuan';
  const usableStock = batchInfo?.item?.usableStock ?? selectedItem?.usableStock ?? '0';
  const physicalStock = batchInfo?.item?.physicalStock ?? selectedItem?.physicalStock ?? '0';
  const quantityScale = selectedItem?.quantityScale ?? 0;

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || inFlightRef.current || !selectedItem) return;

    const payload = {
      itemId: selectedItem.id,
      quantity: quantity.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const fingerprint = JSON.stringify(payload);
    const resolvedKey = resolveIdempotencyKey(pendingKeyRef.current, fingerprint);
    pendingKeyRef.current = resolvedKey;
    inFlightRef.current = true;

    setSubmitting(true);
    setFieldErrors({});
    setFormError('');

    try {
      const data = await recordUsage({
        token: session.token,
        usage: payload,
        idempotencyKey: resolvedKey.key,
      });
      pendingKeyRef.current = null;
      setLastResult({
        ...data,
        itemName: selectedItem.name,
        itemCode: selectedItem.code,
      });
      setQuantity('');
      setNote('');
      onToast?.({
        type: 'success',
        title: 'Pemakaian FEFO tersimpan',
        message: `-${data.quantity} ${data.unit} ${selectedItem.name} dialokasikan dari ${data.allocations.length} batch. Sisa layak: ${data.usableStock} ${data.unit}.`,
      });
      await Promise.all([loadItems({ silent: true }), loadItemBatches(selectedItem.id)]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (err instanceof NetworkError) {
        setFormError('Koneksi terputus. Tekan Coba lagi untuk mengirim ulang dengan Idempotency-Key yang sama.');
      } else if (err instanceof ApiError) {
        if (err.status < 500) pendingKeyRef.current = null;
        if (err.status === 400 && err.fields) {
          setFieldErrors(err.fields);
        } else if (err.code === 'INSUFFICIENT_USABLE_STOCK') {
          const message = `Stok layak tidak mencukupi (tersedia ${usableStock} ${unit}). Permintaan ditolak dan saldo seluruh batch tetap utuh.`;
          setFormError(message);
          onToast?.({ type: 'error', title: 'Stok layak kurang', message });
        } else if (err.code === 'ITEM_INACTIVE') {
          setFormError('Barang ini sedang diarsipkan.');
        } else if (err.code === 'IDEMPOTENCY_CONFLICT') {
          setFormError('Isian berubah saat pengiriman ulang. Coba kirim kembali.');
        } else {
          setFormError('Gagal mencatat pemakaian FEFO. Periksa isian lalu coba lagi.');
        }
      } else {
        setFormError('Terjadi kesalahan tak terduga.');
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
          <h1>Pemakaian stok (FEFO)</h1>
          <p className="lede">
            Sistem memotong batch layak dengan kedaluwarsa terdekat dan menolak jika stok layak kurang.
          </p>
        </div>
      </div>

      <div className="receipt-grid">
        <div className="fefo-left-col">
          <section className="card form-card" aria-labelledby="usage-form-title">
            <div className="card-heading">
              <div>
                <h2 id="usage-form-title">Catat pemakaian barang</h2>
                <p>Batch kedaluwarsa otomatis dilewati oleh aturan FEFO.</p>
              </div>
            </div>

            {itemsError && <div className="form-alert" role="alert">{itemsError}</div>}
            {formError && <div className="form-alert" role="alert">{formError}</div>}

            <form className="stack-form" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="usage-item">Barang</label>
                <select
                  id="usage-item"
                  value={selectedItemId}
                  disabled={itemsLoading || items.length === 0}
                  onChange={(event) => {
                    setSelectedItemId(event.target.value);
                    setFieldErrors({});
                    setFormError('');
                    pendingKeyRef.current = null;
                  }}
                >
                  {itemsLoading ? (
                    <option value="">Memuat daftar barang…</option>
                  ) : items.length === 0 ? (
                    <option value="">Belum ada barang aktif</option>
                  ) : (
                    items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} — {item.name} (layak: {item.usableStock} {item.baseUnit})
                      </option>
                    ))
                  )}
                </select>
                {selectedItem && (
                  <p className="field-hint">
                    Stok layak tersedia: <strong>{usableStock} {unit}</strong> · Total fisik: {physicalStock} {unit}
                    {expiredRemainingCount > 0 && ` (${expiredRemainingCount} batch kedaluwarsa dilewati)`}.
                  </p>
                )}
              </div>

              <div className="field">
                <label htmlFor="usage-qty">Jumlah pemakaian</label>
                <div className={`input-affix${fieldErrors.quantity ? ' input-affix--error' : ''}`}>
                  <input
                    id="usage-qty"
                    type="number"
                    min="0"
                    step={quantityStepForScale(quantityScale)}
                    inputMode={quantityScale > 0 ? 'decimal' : 'numeric'}
                    value={quantity}
                    onChange={(event) => {
                      setQuantity(event.target.value);
                      setFieldErrors((prev) => ({ ...prev, quantity: undefined }));
                      setFormError('');
                    }}
                    placeholder="0"
                    aria-invalid={Boolean(fieldErrors.quantity)}
                  />
                  <span>{unit}</span>
                </div>
                {fieldErrors.quantity && <p className="field-error">{fieldErrors.quantity}</p>}
              </div>

              <div className="field">
                <label htmlFor="usage-note">Catatan (opsional)</label>
                <input
                  id="usage-note"
                  type="text"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Contoh: Penyajian jam istirahat sesi 1"
                  maxLength={500}
                />
                {fieldErrors.note && <p className="field-error">{fieldErrors.note}</p>}
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={submitting || !selectedItem}
              >
                {submitting && <span className="spinner" aria-hidden="true" />}
                {submitting ? 'Memproses FEFO…' : 'Catat Pemakaian FEFO'}
              </button>
            </form>
          </section>

          {/* Pratinjau Urutan Batch FEFO */}
          <section className="card panel-card">
            <div className="panel-header">
              <div>
                <h2>Pratinjau Urutan Batch FEFO</h2>
                <p>Urutan batch layak yang akan dipotong otomatis dari kedaluwarsa paling dekat.</p>
              </div>
            </div>

            {batchLoading ? (
              <div className="loading-panel" role="status">
                <span className="spinner spinner--dark" aria-hidden="true" />
                <span>Memuat urutan batch…</span>
              </div>
            ) : usableBatches.length === 0 ? (
              <div className="empty-state">
                <strong>Tidak ada batch layak tersedia.</strong>
                <p>Tambahkan stok melalui menu Stok Masuk terlebih dahulu.</p>
              </div>
            ) : (
              <ol className="fefo-preview-list">
                {usableBatches.map((batch, index) => {
                  const statusMeta = getBatchStatusMeta(batch.status);
                  return (
                    <li key={batch.id} className="fefo-preview-item">
                      <span className="fefo-rank">#{index + 1}</span>
                      <div className="fefo-preview-meta">
                        <strong className="mono">{batch.batchCode}</strong>
                        <span>Kedaluwarsa {formatDateId(batch.expiresOn)}</span>
                      </div>
                      <span className={`badge badge--${statusMeta.tone}`}>{statusMeta.label}</span>
                      <strong className="fefo-qty">
                        {batch.remainingQuantity} {unit}
                      </strong>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        {/* Panel Konfirmasi Alokasi FEFO */}
        <aside
          className={`card balance-card${lastResult ? ' balance-card--success' : ''}`}
          aria-live="polite"
        >
          {lastResult ? (
            <>
              <span className="success-mark" aria-hidden="true">
                <Icon name="check" size={18} />
              </span>
              <p className="balance-caption">Sisa stok layak ({lastResult.itemName})</p>
              <p className="balance-number">
                {lastResult.usableStock}
                <span>{lastResult.unit}</span>
              </p>

              <p className="allocation-heading">Rincian batch terpotong:</p>
              <ul className="allocation-list">
                {lastResult.allocations.map((alloc) => (
                  <li key={alloc.batchId}>
                    <div>
                      <strong className="mono">{alloc.batchCode}</strong>
                      <span>Exp {formatDateId(alloc.expiresOn)} · sisa {alloc.remainingQuantity}</span>
                    </div>
                    <strong className="allocation-delta">-{alloc.quantityUsed} {lastResult.unit}</strong>
                  </li>
                ))}
              </ul>

              <dl className="receipt-summary">
                <div>
                  <dt>Total dipakai</dt>
                  <dd>-{lastResult.quantity} {lastResult.unit}</dd>
                </div>
                <div>
                  <dt>Stok fisik tersisa</dt>
                  <dd>{lastResult.physicalStock} {lastResult.unit}</dd>
                </div>
              </dl>
            </>
          ) : (
            <>
              <span className="balance-empty-icon" aria-hidden="true">
                <Icon name="usages" size={20} />
              </span>
              <p className="balance-caption">Belum ada pemakaian</p>
              <p className="balance-empty-copy">
                Setelah disimpan, rincian potongan per batch dan saldo terbaru akan muncul di sini.
              </p>
              <ol className="flow-list">
                <li>Pilih barang aktif</li>
                <li>Periksa urutan batch FEFO</li>
                <li>Masukkan jumlah &amp; simpan</li>
              </ol>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
