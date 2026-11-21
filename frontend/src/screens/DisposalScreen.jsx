import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError, getItemBatches, getItems, recordDisposal } from '../api.js';
import { formatDateId, getBatchStatusMeta } from '../format.js';
import { resolveIdempotencyKey } from '../idempotency.js';
import Icon from '../components/Icon.jsx';

const REASON_PRESETS = [
  'Kedaluwarsa',
  'Kemasan rusak / bocor',
  'Kualitas menurun',
  'Terkontaminasi',
];

function quantityStepForScale(scale = 0) {
  if (!scale || scale <= 0) return '1';
  return `0.${'0'.repeat(scale - 1)}1`;
}

export default function DisposalScreen({ session, onToast }) {
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState('');

  const [selectedItemId, setSelectedItemId] = useState('');
  const [batches, setBatches] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState('');

  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const pendingKeyRef = useRef(null);
  const inFlightRef = useRef(false);

  const loadItems = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setItemsLoading(true);
    setItemsError('');
    try {
      const response = await getItems({ sortBy: 'name', sortOrder: 'asc', limit: 100 });
      const list = response.data ?? [];
      setItems(list);
      setSelectedItemId((prev) => {
        if (prev && list.some((item) => item.id === prev)) return prev;
        const withStock = list.find((item) => Number(item.physicalStock) > 0);
        return (withStock ?? list[0])?.id ?? '';
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setItemsError(
        err instanceof NetworkError
          ? 'Tidak dapat terhubung ke server.'
          : 'Gagal memuat daftar barang.',
      );
    } finally {
      setItemsLoading(false);
    }
  }, []);

  const loadBatches = useCallback(async (itemId) => {
    if (!itemId) {
      setBatches([]);
      setSelectedBatchId('');
      return;
    }
    setBatchLoading(true);
    try {
      const data = await getItemBatches(itemId, { onlyRemaining: 'true' });
      const list = data?.batches ?? [];
      setBatches(list);
      setSelectedBatchId((prev) => {
        if (prev && list.some((batch) => batch.id === prev)) return prev;
        const firstExpired = list.find((batch) => batch.status === 'KEDALUWARSA');
        return (firstExpired ?? list[0])?.id ?? '';
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setBatches([]);
      setSelectedBatchId('');
    } finally {
      setBatchLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    loadBatches(selectedItemId);
  }, [selectedItemId, loadBatches]);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const selectedBatch = batches.find((batch) => batch.id === selectedBatchId) ?? null;
  const unit = selectedItem?.baseUnit ?? 'satuan';
  const quantityScale = selectedItem?.quantityScale ?? 0;

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || inFlightRef.current) return;
    if (!selectedBatch) {
      setFieldErrors({ batchId: 'Pilih batch yang memiliki sisa stok' });
      return;
    }

    const payload = {
      batchId: selectedBatch.id,
      quantity: quantity.trim(),
      reason: reason.trim(),
    };
    const fingerprint = JSON.stringify(payload);
    const resolvedKey = resolveIdempotencyKey(pendingKeyRef.current, fingerprint);
    pendingKeyRef.current = resolvedKey;
    inFlightRef.current = true;

    setSubmitting(true);
    setFieldErrors({});
    setFormError('');

    try {
      const data = await recordDisposal({
        token: session.token,
        disposal: payload,
        idempotencyKey: resolvedKey.key,
      });
      pendingKeyRef.current = null;
      setLastResult({
        ...data,
        itemName: selectedItem?.name ?? 'Barang',
        itemCode: selectedItem?.code ?? '',
      });
      setQuantity('');
      setReason('');
      onToast?.({
        type: 'success',
        title: 'Pembuangan tercatat',
        message: `-${data.quantity} ${data.unit} dari batch ${data.batchCode} dicatat (${data.reason}).`,
      });
      await Promise.all([loadItems({ silent: true }), loadBatches(selectedItemId)]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (err instanceof NetworkError) {
        setFormError('Koneksi terputus. Tekan Coba lagi untuk mengirim ulang dengan Idempotency-Key yang sama.');
      } else if (err instanceof ApiError) {
        if (err.status < 500) pendingKeyRef.current = null;
        if (err.status === 400 && err.fields) {
          setFieldErrors(err.fields);
        } else if (err.code === 'INSUFFICIENT_BATCH_STOCK') {
          const message = `Jumlah melebihi sisa stok batch ${selectedBatch.batchCode} (${selectedBatch.remainingQuantity} ${unit}).`;
          setFieldErrors({ quantity: message });
          setFormError(message);
          onToast?.({ type: 'error', title: 'Melebihi sisa batch', message });
        } else if (err.code === 'IDEMPOTENCY_CONFLICT') {
          setFormError('Isian berubah saat pengiriman ulang. Coba kirim kembali.');
        } else {
          setFormError('Gagal mencatat pembuangan stok.');
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
          <h1>Pembuangan stok per batch</h1>
          <p className="lede">
            Pilih batch yang masih bersisa, catat jumlah dan alasan pembuangan agar saldo fisik tetap akurat.
          </p>
        </div>
      </div>

      <div className="receipt-grid">
        <div className="fefo-left-col">
          <section className="card form-card" aria-labelledby="disposal-form-title">
            <div className="card-heading">
              <div>
                <h2 id="disposal-form-title">Formulir pembuangan</h2>
                <p>Batch kedaluwarsa ditandai merah untuk diprioritaskan.</p>
              </div>
            </div>

            {itemsError && <div className="form-alert" role="alert">{itemsError}</div>}
            {formError && <div className="form-alert" role="alert">{formError}</div>}

            <form className="stack-form" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="disposal-item">Barang</label>
                <select
                  id="disposal-item"
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
                    <option value="">Belum ada barang</option>
                  ) : (
                    items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} — {item.name} (fisik: {item.physicalStock} {item.baseUnit})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="field">
                <label>Pilih batch yang akan dibuang</label>
                {batchLoading ? (
                  <div className="loading-panel loading-panel--compact" role="status">
                    <span className="spinner spinner--dark" aria-hidden="true" />
                    <span>Memuat batch tersisa…</span>
                  </div>
                ) : batches.length === 0 ? (
                  <p className="field-hint">Barang ini tidak memiliki batch dengan sisa stok.</p>
                ) : (
                  <div className="batch-picker-list" role="radiogroup" aria-label="Daftar batch tersisa">
                    {batches.map((batch) => {
                      const statusMeta = getBatchStatusMeta(batch.status);
                      const checked = batch.id === selectedBatchId;
                      return (
                        <label
                          key={batch.id}
                          className={`batch-picker-item${checked ? ' batch-picker-item--selected' : ''}${batch.status === 'KEDALUWARSA' ? ' batch-picker-item--expired' : ''}`}
                        >
                          <input
                            type="radio"
                            name="disposalBatch"
                            value={batch.id}
                            checked={checked}
                            onChange={() => {
                              setSelectedBatchId(batch.id);
                              setFieldErrors({});
                              setFormError('');
                              pendingKeyRef.current = null;
                              if (batch.status === 'KEDALUWARSA' && !reason) {
                                setReason('Kedaluwarsa');
                              }
                            }}
                          />
                          <div className="batch-picker-meta">
                            <strong className="mono">{batch.batchCode}</strong>
                            <span>Kedaluwarsa {formatDateId(batch.expiresOn)}</span>
                          </div>
                          <span className={`badge badge--${statusMeta.tone}`}>{statusMeta.label}</span>
                          <strong className="fefo-qty">
                            {batch.remainingQuantity} {unit}
                          </strong>
                        </label>
                      );
                    })}
                  </div>
                )}
                {fieldErrors.batchId && <p className="field-error">{fieldErrors.batchId}</p>}
              </div>

              <div className="field">
                <div className="label-row">
                  <label htmlFor="disposal-qty">Jumlah dibuang</label>
                  {selectedBatch && (
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => {
                        setQuantity(selectedBatch.remainingQuantity);
                        setFieldErrors((prev) => ({ ...prev, quantity: undefined }));
                        setFormError('');
                      }}
                    >
                      Buang semua sisa ({selectedBatch.remainingQuantity} {unit})
                    </button>
                  )}
                </div>
                <div className={`input-affix${fieldErrors.quantity ? ' input-affix--error' : ''}`}>
                  <input
                    id="disposal-qty"
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
                <label htmlFor="disposal-reason">Alasan pembuangan</label>
                <div className="chip-row" aria-label="Pilihan cepat alasan">
                  {REASON_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`reason-chip${reason === preset ? ' reason-chip--active' : ''}`}
                      onClick={() => {
                        setReason(preset);
                        setFieldErrors((prev) => ({ ...prev, reason: undefined }));
                        setFormError('');
                      }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  id="disposal-reason"
                  type="text"
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setFieldErrors((prev) => ({ ...prev, reason: undefined }));
                    setFormError('');
                  }}
                  placeholder="Tulis alasan pembuangan (wajib diisi)"
                  maxLength={300}
                  aria-invalid={Boolean(fieldErrors.reason)}
                />
                {fieldErrors.reason && <p className="field-error">{fieldErrors.reason}</p>}
              </div>

              <button
                type="submit"
                className="btn-danger"
                disabled={submitting || !selectedBatch}
              >
                {submitting && <span className="spinner" aria-hidden="true" />}
                {submitting ? 'Menyimpan pembuangan…' : 'Catat Pembuangan Stok'}
              </button>
            </form>
          </section>
        </div>

        {/* Panel Konfirmasi Pembuangan */}
        <aside
          className={`card balance-card${lastResult ? ' balance-card--success' : ''}`}
          aria-live="polite"
        >
          {lastResult ? (
            <>
              <span className="success-mark" aria-hidden="true">
                <Icon name="check" size={18} />
              </span>
              <p className="balance-caption">Sisa batch {lastResult.batchCode}</p>
              <p className="balance-number">
                {lastResult.batchRemainingQuantity}
                <span>{lastResult.unit}</span>
              </p>
              <dl className="receipt-summary">
                <div>
                  <dt>Barang</dt>
                  <dd>{lastResult.itemName}</dd>
                </div>
                <div>
                  <dt>Dibuang</dt>
                  <dd>-{lastResult.quantity} {lastResult.unit}</dd>
                </div>
                <div>
                  <dt>Alasan</dt>
                  <dd>{lastResult.reason}</dd>
                </div>
                <div>
                  <dt>Stok fisik barang</dt>
                  <dd>{lastResult.physicalStock} {lastResult.unit}</dd>
                </div>
                <div>
                  <dt>Stok layak barang</dt>
                  <dd>{lastResult.usableStock} {lastResult.unit}</dd>
                </div>
              </dl>
              <p className="balance-note">
                Transaksi pembuangan tercatat di riwayat dan otomatis masuk ke ringkasan biaya admin.
              </p>
            </>
          ) : (
            <>
              <span className="balance-empty-icon" aria-hidden="true">
                <Icon name="disposals" size={20} />
              </span>
              <p className="balance-caption">Belum ada pencatatan</p>
              <p className="balance-empty-copy">
                Setelah pembuangan disimpan, sisa batch dan saldo barang terbaru akan muncul di sini.
              </p>
              <ol className="flow-list">
                <li>Pilih barang &amp; batch tersisa</li>
                <li>Isi jumlah &amp; alasan wajib</li>
                <li>Simpan pengurangan atomik</li>
              </ol>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
