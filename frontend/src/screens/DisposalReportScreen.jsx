import { useCallback, useEffect, useState } from 'react';
import { ApiError, NetworkError, getDisposalReport, getItems } from '../api.js';
import { formatDateId, formatDateTimeId, formatRupiah, validateDateRange } from '../format.js';
import Icon from '../components/Icon.jsx';

export default function DisposalReportScreen() {
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [report, setReport] = useState(null);
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

  const loadReport = useCallback(async () => {
    if (dateRangeError) {
      setError(dateRangeError);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getDisposalReport({ from, to, itemId });
      setReport(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (err instanceof ApiError && err.status === 400 && err.fields) {
        setError(Object.values(err.fields)[0]);
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Laporan biaya pembuangan hanya dapat diakses oleh Admin.');
      } else {
        setError(
          err instanceof NetworkError
            ? 'Tidak dapat terhubung ke server.'
            : 'Gagal memuat laporan biaya barang terbuang.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [from, to, itemId, dateRangeError]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  function resetFilters() {
    setItemId('');
    setFrom('');
    setTo('');
  }

  const summary = report?.summary;
  const byItem = report?.byItem ?? [];
  const byReason = report?.byReason ?? [];
  const disposals = report?.disposals ?? [];

  return (
    <div className="page-container">
      <div className="page-heading">
        <div>
          <h1>Laporan biaya barang terbuang</h1>
          <p className="lede">
            Evaluasi pemborosan persediaan dari jumlah terbuang dan harga beli per batch.
          </p>
        </div>
        <div className="heading-actions">
          <button type="button" className="btn-secondary" onClick={loadReport} disabled={loading}>
            <Icon name="refresh" size={15} />
            {loading ? 'Memuat…' : 'Muat ulang'}
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <section className="card toolbar-card" aria-label="Filter laporan biaya pembuangan">
        <div className="toolbar-grid">
          <div className="field">
            <label htmlFor="rep-item">Filter Barang</label>
            <select
              id="rep-item"
              value={itemId}
              onChange={(event) => setItemId(event.target.value)}
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
            <label htmlFor="rep-from">Dari Tanggal</label>
            <input
              id="rep-from"
              type="date"
              value={from}
              aria-invalid={Boolean(dateRangeError)}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="rep-to">Sampai Tanggal</label>
            <input
              id="rep-to"
              type="date"
              value={to}
              aria-invalid={Boolean(dateRangeError)}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>

          <div className="field">
            <button
              type="button"
              className="btn-secondary"
              onClick={resetFilters}
              disabled={!itemId && !from && !to}
            >
              Reset Filter
            </button>
          </div>
        </div>
      </section>

      {error && <div className="form-alert" role="alert">{error}</div>}

      {loading && !report ? (
        <div className="loading-panel" role="status">
          <span className="spinner spinner--dark" aria-hidden="true" />
          <span>Menghitung ringkasan biaya pembuangan…</span>
        </div>
      ) : (
        <>
          {/* 3 KPI Summary Cards */}
          <section className="kpi-grid kpi-grid--3" aria-label="Ringkasan biaya pembuangan">
            <article className="kpi-card kpi-card--cost kpi-card--danger">
              <div className="kpi-head">
                <p className="kpi-label">Total Biaya Terbuang</p>
                <span className="kpi-icon" aria-hidden="true">
                  <Icon name="coins" size={18} />
                </span>
              </div>
              <p className="kpi-value kpi-value--money">{formatRupiah(summary?.totalCost ?? '0')}</p>
              <p className="kpi-sub">
                {summary?.from || summary?.to
                  ? `Periode ${summary.from ? formatDateId(summary.from) : 'awal'} s.d. ${summary.to ? formatDateId(summary.to) : 'kini'}`
                  : 'Seluruh periode tercatat'}
              </p>
            </article>

            <article className="kpi-card kpi-card--events">
              <div className="kpi-head">
                <p className="kpi-label">Kejadian Pembuangan</p>
                <span className="kpi-icon" aria-hidden="true">
                  <Icon name="activity" size={18} />
                </span>
              </div>
              <p className="kpi-value">{summary?.totalEvents ?? 0}</p>
              <p className="kpi-sub">Transaksi pembuangan tercatat</p>
            </article>

            <article className="kpi-card kpi-card--quantity">
              <div className="kpi-head">
                <p className="kpi-label">Kuantitas Terbuang</p>
                <span className="kpi-icon" aria-hidden="true">
                  <Icon name="scale" size={18} />
                </span>
              </div>
              <p className="kpi-value">{summary?.totalQuantity ?? '0'}</p>
              <p className="kpi-sub">Akumulasi seluruh unit barang</p>
            </article>
          </section>

          {/* Ringkasan per Barang & per Alasan */}
          <div className="report-two-col">
            <section className="card panel-card table-card">
              <div className="panel-header">
                <div>
                  <h2>Ringkasan per Barang</h2>
                  <p>Diurutkan dari total kerugian biaya terbesar.</p>
                </div>
              </div>

              {byItem.length === 0 ? (
                <div className="empty-state">
                  <strong>Belum ada data pembuangan.</strong>
                  <p>Tidak ada barang yang dibuang pada periode filter ini.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Barang</th>
                        <th>Kejadian</th>
                        <th>Jumlah</th>
                        <th>Total Biaya</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byItem.map((row) => (
                        <tr key={row.itemId ?? row.itemName}>
                          <td>
                            <strong>{row.itemName ?? 'Barang tidak dikenal'}</strong>
                            {row.itemCode && <span className="sub-cell mono">{row.itemCode}</span>}
                          </td>
                          <td>{row.eventCount}x</td>
                          <td className="nowrap">{row.totalQuantity} {row.baseUnit ?? ''}</td>
                          <td className="nowrap"><strong>{formatRupiah(row.totalCost)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card panel-card table-card">
              <div className="panel-header">
                <div>
                  <h2>Ringkasan per Alasan</h2>
                  <p>Identifikasi penyebab utama pemborosan stok.</p>
                </div>
              </div>

              {byReason.length === 0 ? (
                <div className="empty-state">
                  <strong>Belum ada alasan tercatat.</strong>
                  <p>Alasan pembuangan akan diringkas otomatis di sini.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Alasan</th>
                        <th>Kejadian</th>
                        <th>Jumlah</th>
                        <th>Total Biaya</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byReason.map((row) => (
                        <tr key={row.reason}>
                          <td><strong>{row.reason}</strong></td>
                          <td>{row.eventCount}x</td>
                          <td>{row.totalQuantity}</td>
                          <td className="nowrap"><strong>{formatRupiah(row.totalCost)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Tabel Rincian Transaksi Pembuangan */}
          <section className="card panel-card table-card">
            <div className="panel-header">
              <div>
                <h2>Rincian Pembuangan ({disposals.length})</h2>
                <p>Catatan detail per batch termasuk harga beli satuan saat penerimaan.</p>
              </div>
            </div>

            {disposals.length === 0 ? (
              <div className="empty-state">
                <strong>Tidak ada rincian pembuangan untuk ditampilkan.</strong>
                <p>Ubah rentang tanggal atau filter barang untuk melihat data lainnya.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Barang</th>
                      <th>Batch</th>
                      <th>Jumlah</th>
                      <th>Harga Satuan</th>
                      <th>Total Biaya</th>
                      <th>Alasan</th>
                      <th>Pencatat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disposals.map((row, idx) => (
                      <tr key={`${row.transactionId}-${row.batchId ?? idx}`}>
                        <td className="nowrap">{formatDateTimeId(row.recordedAt)}</td>
                        <td>
                          <strong>{row.itemName ?? '—'}</strong>
                          {row.itemCode && <span className="sub-cell mono">{row.itemCode}</span>}
                        </td>
                        <td>
                          <span className="mono">{row.batchCode ?? '—'}</span>
                          {row.expiresOn && (
                            <span className="sub-cell">Exp {formatDateId(row.expiresOn)}</span>
                          )}
                        </td>
                        <td className="nowrap">{row.quantity} {row.baseUnit ?? ''}</td>
                        <td className="nowrap">{formatRupiah(row.unitCost)}</td>
                        <td className="nowrap"><strong>{formatRupiah(row.totalCost)}</strong></td>
                        <td>{row.reason}</td>
                        <td>{row.actor?.name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
