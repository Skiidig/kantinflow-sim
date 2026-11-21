import { useCallback, useEffect, useState } from 'react';
import { ApiError, NetworkError, getDashboard } from '../api.js';
import { formatDateId, formatRupiah } from '../format.js';
import Icon from '../components/Icon.jsx';

export default function DashboardScreen({ session, onNavigate, onOpenItemBatches, onToast }) {
  const isAdmin = session.user.role === 'admin';
  const [days, setDays] = useState(3);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async (thresholdDays, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const result = await getDashboard({ days: thresholdDays });
      setData(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      const message = err instanceof NetworkError
        ? 'Tidak dapat terhubung ke server. Pastikan backend berjalan di port 3000.'
        : 'Gagal memuat data dashboard. Coba muat ulang.';
      setError(message);
      if (silent && onToast) {
        onToast({ type: 'error', title: 'Gagal memuat ulang', message });
      }
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    loadDashboard(days);
  }, [days, loadDashboard]);

  const summary = data?.summary;
  const lowStockItems = data?.lowStockItems ?? [];
  const expiringSoonBatches = data?.expiringSoonBatches ?? [];
  const expiredBatches = data?.expiredBatches ?? [];

  return (
    <div className="page-container">
      <div className="page-heading">
        <div>
          <h1>Dashboard stok &amp; kedaluwarsa</h1>
          <p className="lede">
            Pantau stok menipis, batch yang mendekati kedaluwarsa dalam {days} hari, dan sisa stok yang harus dibuang.
          </p>
        </div>

        <div className="heading-actions">
          <label className="inline-select">
            <span>Ambang peringatan</span>
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              aria-label="Ambang hari mendekati kedaluwarsa"
            >
              <option value={3}>H-3 (Standar SRS)</option>
              <option value={7}>H-7 (Mingguan)</option>
              <option value={14}>H-14 (2 Minggu)</option>
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => loadDashboard(days, { silent: Boolean(data) })}
            disabled={loading}
          >
            {loading ? 'Memuat…' : 'Muat ulang'}
          </button>
        </div>
      </div>

      {error && (
        <div className="form-alert" role="alert">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="loading-panel" role="status">
          <span className="spinner spinner--dark" aria-hidden="true" />
          <span>Memuat ringkasan persediaan…</span>
        </div>
      ) : (
        <>
          <section className="kpi-grid" aria-label="Ringkasan stok">
            <article className="kpi-card kpi-card--items">
              <div className="kpi-head">
                <p className="kpi-label">Total Barang Aktif</p>
                <span className="kpi-icon" aria-hidden="true">
                  <Icon name="package" size={18} />
                </span>
              </div>
              <p className="kpi-value">{summary?.totalActiveItems ?? 0}</p>
              <p className="kpi-sub">Per {formatDateId(summary?.asOfDate)}</p>
            </article>

            <article className={`kpi-card kpi-card--low${(summary?.lowStockCount ?? 0) > 0 ? ' kpi-card--warning' : ''}`}>
              <div className="kpi-head">
                <p className="kpi-label">Stok Menipis</p>
                <span className="kpi-icon" aria-hidden="true">
                  <Icon name="alertTriangle" size={18} />
                </span>
              </div>
              <p className="kpi-value">{summary?.lowStockCount ?? 0}</p>
              <p className="kpi-sub">Stok layak ≤ batas minimum</p>
            </article>

            <article className={`kpi-card kpi-card--expiring${(summary?.expiringSoonCount ?? 0) > 0 ? ' kpi-card--warning' : ''}`}>
              <div className="kpi-head">
                <p className="kpi-label">Kedaluwarsa H-{days}</p>
                <span className="kpi-icon" aria-hidden="true">
                  <Icon name="clock" size={18} />
                </span>
              </div>
              <p className="kpi-value">{summary?.expiringSoonCount ?? 0}</p>
              <p className="kpi-sub">Batch layak dalam {days} hari ke depan</p>
            </article>

            <article className={`kpi-card kpi-card--expired${(summary?.expiredRemainingCount ?? 0) > 0 ? ' kpi-card--danger' : ''}`}>
              <div className="kpi-head">
                <p className="kpi-label">Kedaluwarsa Masih Bersisa</p>
                <span className="kpi-icon" aria-hidden="true">
                  <Icon name="disposals" size={18} />
                </span>
              </div>
              <p className="kpi-value">{summary?.expiredRemainingCount ?? 0}</p>
              <p className="kpi-sub">Perlu segera dicatat pembuangan</p>
            </article>
          </section>

          <div className="dashboard-sections">
            {/* 1. Stok Menipis */}
            <section className="card panel-card table-card">
              <div className="panel-header">
                <div>
                  <h2>Stok Menipis</h2>
                  <p>Barang aktif dengan stok layak di bawah atau sama dengan batas minimum.</p>
                </div>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => onNavigate('/items')}
                >
                  Lihat semua barang
                  <Icon name="arrowRight" size={14} />
                </button>
              </div>

              {lowStockItems.length === 0 ? (
                <div className="empty-state">
                  <strong>Tidak ada stok menipis.</strong>
                  <p>Seluruh barang aktif masih berada di atas batas minimum.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Kode</th>
                        <th>Nama Barang</th>
                        <th>Stok Layak</th>
                        <th>Stok Fisik</th>
                        <th>Batas Min.</th>
                        <th>Status</th>
                        <th className="col-actions">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStockItems.map((item) => (
                        <tr key={item.id}>
                          <td className="mono">{item.code}</td>
                          <td><strong>{item.name}</strong></td>
                          <td>{item.usableStock} {item.baseUnit}</td>
                          <td>{item.physicalStock} {item.baseUnit}</td>
                          <td>{item.minimumStock} {item.baseUnit}</td>
                          <td>
                            <span className="badge badge--warning">Menipis</span>
                          </td>
                          <td className="col-actions">
                            <button
                              type="button"
                              className="btn-table"
                              onClick={() => onOpenItemBatches(item.id)}
                            >
                              Cek Batch
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 2. Mendekati Kedaluwarsa H-3 */}
            <section className="card panel-card table-card">
              <div className="panel-header">
                <div>
                  <h2>Batch Mendekati Kedaluwarsa (H-{days})</h2>
                  <p>Batch layak yang kedaluwarsa dalam {days} hari ke depan, terurut paling dekat.</p>
                </div>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => onNavigate('/usages')}
                >
                  Pemakaian FEFO
                  <Icon name="arrowRight" size={14} />
                </button>
              </div>

              {expiringSoonBatches.length === 0 ? (
                <div className="empty-state">
                  <strong>Tidak ada batch mendekati kedaluwarsa.</strong>
                  <p>Belum ada batch yang jatuh tempo dalam {days} hari ke depan.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Kode Batch</th>
                        <th>Barang</th>
                        <th>Kedaluwarsa</th>
                        <th>Sisa Stok</th>
                        {isAdmin && <th>Harga Beli</th>}
                        <th>Peringatan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expiringSoonBatches.map((batch) => (
                        <tr key={batch.id}>
                          <td className="mono">{batch.batchCode}</td>
                          <td>
                            <strong>{batch.itemName}</strong>
                            <span className="sub-cell">{batch.itemCode}</span>
                          </td>
                          <td>{formatDateId(batch.expiresOn)}</td>
                          <td>{batch.remainingQuantity} {batch.baseUnit}</td>
                          {isAdmin && <td>{formatRupiah(batch.unitCost)}</td>}
                          <td>
                            <span className="badge badge--warning">
                              {batch.daysUntilExpiry === 0 ? 'Hari ini (H-0)' : `H-${batch.daysUntilExpiry}`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 3. Kedaluwarsa Masih Bersisa */}
            <section className="card panel-card table-card">
              <div className="panel-header">
                <div>
                  <h2>Batch Kedaluwarsa Masih Bersisa</h2>
                  <p>Stok ini tidak dihitung sebagai stok layak FEFO dan harus segera dibuang.</p>
                </div>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => onNavigate('/disposals')}
                >
                  Catat Pembuangan
                  <Icon name="arrowRight" size={14} />
                </button>
              </div>

              {expiredBatches.length === 0 ? (
                <div className="empty-state">
                  <strong>Bersih dari stok kedaluwarsa.</strong>
                  <p>Tidak ada batch lewat kedaluwarsa yang masih menyisakan stok fisik.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Kode Batch</th>
                        <th>Barang</th>
                        <th>Kedaluwarsa</th>
                        <th>Sisa Fisik</th>
                        {isAdmin && <th>Harga Beli</th>}
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expiredBatches.map((batch) => (
                        <tr key={batch.id}>
                          <td className="mono">{batch.batchCode}</td>
                          <td>
                            <strong>{batch.itemName}</strong>
                            <span className="sub-cell">{batch.itemCode}</span>
                          </td>
                          <td>{formatDateId(batch.expiresOn)}</td>
                          <td>{batch.remainingQuantity} {batch.baseUnit}</td>
                          {isAdmin && <td>{formatRupiah(batch.unitCost)}</td>}
                          <td>
                            <span className="badge badge--danger">
                              Lewat {batch.daysOverdue} hari
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
