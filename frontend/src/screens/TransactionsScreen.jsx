import { useCallback, useEffect, useState } from 'react';
import { ApiError, NetworkError, getItems, getTransactions } from '../api.js';
import {
  formatDateId,
  formatDateTimeId,
  formatRupiah,
  getRoleLabel,
  validateDateRange,
} from '../format.js';
import Icon from '../components/Icon.jsx';

function getTypeMeta(type) {
  switch (type) {
    case 'RECEIPT':
      return { label: 'Penerimaan', tone: 'success' };
    case 'USAGE':
      return { label: 'Pemakaian FEFO', tone: 'info' };
    case 'DISPOSAL':
      return { label: 'Pembuangan', tone: 'danger' };
    default:
      return { label: type || '—', tone: 'muted' };
  }
}

export default function TransactionsScreen({ session }) {
  const isAdmin = session.user.role === 'admin';

  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const limit = 15;

  const [transactions, setTransactions] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getItems({ sortBy: 'name', sortOrder: 'asc', limit: 100 })
      .then((res) => {
        if (active) setItems(res.data ?? []);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const dateRangeError = validateDateRange(from, to);

  const loadTransactions = useCallback(async () => {
    if (dateRangeError) {
      setError(dateRangeError);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await getTransactions({
        itemId,
        type,
        from,
        to,
        page,
        limit,
      });
      setTransactions(response.data ?? []);
      setMeta(response.meta ?? { page, limit, total: 0, totalPages: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (err instanceof ApiError && err.status === 400 && err.fields) {
        setError(Object.values(err.fields)[0]);
      } else {
        setError(
          err instanceof NetworkError
            ? 'Tidak dapat terhubung ke server.'
            : 'Gagal memuat riwayat transaksi stok.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [itemId, type, from, to, page, limit, dateRangeError]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  function resetFilters() {
    setItemId('');
    setType('');
    setFrom('');
    setTo('');
    setPage(1);
  }

  return (
    <div className="page-container">
      <div className="page-heading">
        <div>
          <h1>Riwayat transaksi stok</h1>
          <p className="lede">
            Penerimaan, pemakaian FEFO, dan pembuangan tercatat berurutan.
          </p>
        </div>
        <div className="heading-actions">
          <button type="button" className="btn-secondary" onClick={loadTransactions} disabled={loading}>
            <Icon name="refresh" size={15} />
            {loading ? 'Memuat…' : 'Muat ulang'}
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <section className="card toolbar-card" aria-label="Filter riwayat transaksi">
        <div className="toolbar-grid toolbar-grid--5">
          <div className="field">
            <label htmlFor="tx-item">Barang</label>
            <select
              id="tx-item"
              value={itemId}
              onChange={(event) => {
                setItemId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Semua barang</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="tx-type">Jenis Transaksi</label>
            <select
              id="tx-type"
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Semua jenis</option>
              <option value="RECEIPT">Penerimaan (RECEIPT)</option>
              <option value="USAGE">Pemakaian FEFO (USAGE)</option>
              <option value="DISPOSAL">Pembuangan (DISPOSAL)</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="tx-from">Dari Tanggal</label>
            <input
              id="tx-from"
              type="date"
              value={from}
              aria-invalid={Boolean(dateRangeError)}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="tx-to">Sampai Tanggal</label>
            <input
              id="tx-to"
              type="date"
              value={to}
              aria-invalid={Boolean(dateRangeError)}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="field">
            <button
              type="button"
              className="btn-secondary"
              onClick={resetFilters}
              disabled={!itemId && !type && !from && !to}
            >
              Reset Filter
            </button>
          </div>
        </div>
      </section>

      {error && <div className="form-alert" role="alert">{error}</div>}

      <section className="card panel-card table-card">
        {loading ? (
          <div className="loading-panel" role="status">
            <span className="spinner spinner--dark" aria-hidden="true" />
            <span>Memuat riwayat transaksi…</span>
          </div>
        ) : transactions.length === 0 ? (
          <div className="empty-state">
            <strong>Belum ada transaksi yang cocok.</strong>
            <p>Ubah filter pencarian atau catat transaksi baru pada menu Stok Masuk / Pemakaian / Pembuangan.</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Jenis</th>
                    <th>Barang</th>
                    <th>Rincian Batch &amp; Keterangan</th>
                    <th>Jumlah</th>
                    <th>Pencatat</th>
                    {isAdmin && <th>Total Biaya</th>}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => {
                    const typeMeta = getTypeMeta(tx.type);
                    const unit = tx.item?.baseUnit ?? '';
                    return (
                      <tr key={tx.id}>
                        <td className="nowrap">{formatDateTimeId(tx.recordedAt)}</td>
                        <td>
                          <span className={`badge badge--${typeMeta.tone}`}>
                            {typeMeta.label}
                          </span>
                        </td>
                        <td>
                          <strong>{tx.item?.name ?? 'Barang tidak dikenal'}</strong>
                          {tx.item?.code && <span className="sub-cell mono">{tx.item.code}</span>}
                        </td>
                        <td>
                          <ul className="tx-lines">
                            {(tx.lines ?? []).map((line, idx) => (
                              <li key={`${tx.id}-${line.batchId ?? idx}`}>
                                <span className="mono">{line.batchCode ?? 'Batch'}</span>
                                <strong>
                                  {line.quantityDelta.startsWith('-') ? line.quantityDelta : `+${line.quantityDelta}`} {unit}
                                </strong>
                                {line.expiresOn && (
                                  <span className="tx-exp">(exp {formatDateId(line.expiresOn)})</span>
                                )}
                              </li>
                            ))}
                          </ul>
                          {tx.reason && <span className="sub-cell">Alasan: {tx.reason}</span>}
                          {tx.note && <span className="sub-cell">Catatan: {tx.note}</span>}
                        </td>
                        <td className="nowrap">
                          <strong>{tx.totalQuantity}</strong> {unit}
                        </td>
                        <td>
                          <strong>{tx.actor?.name ?? '—'}</strong>
                          {tx.actor?.role && (
                            <span className="sub-cell">{getRoleLabel(tx.actor.role)}</span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="nowrap">
                            <strong>{formatRupiah(tx.totalCost)}</strong>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination-bar">
              <p className="pagination-info">
                Total <strong>{meta.total}</strong> transaksi · Halaman{' '}
                <strong>{meta.totalPages === 0 ? 0 : meta.page}</strong> dari{' '}
                <strong>{meta.totalPages}</strong>
              </p>
              <div className="pagination-controls">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <Icon name="chevronLeft" size={14} />
                  Sebelumnya
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={meta.totalPages === 0 || page >= meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Berikutnya
                  <Icon name="chevronRight" size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
