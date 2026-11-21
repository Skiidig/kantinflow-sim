import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  NetworkError,
  createItem,
  deleteItem,
  getItemBatches,
  getItems,
  updateItem,
} from '../api.js';
import { formatDateId, formatRupiah, getBatchStatusMeta } from '../format.js';
import Icon from '../components/Icon.jsx';

const EMPTY_FORM = {
  code: '',
  name: '',
  baseUnit: '',
  minimumStock: '0',
  quantityScale: 0,
};

const SORT_OPTIONS = [
  { value: 'name:asc', label: 'Nama (A → Z)' },
  { value: 'name:desc', label: 'Nama (Z → A)' },
  { value: 'code:asc', label: 'Kode (A → Z)' },
  { value: 'usableStock:asc', label: 'Stok Layak (Terendah)' },
  { value: 'usableStock:desc', label: 'Stok Layak (Tertinggi)' },
  { value: 'createdAt:desc', label: 'Terbaru Ditambahkan' },
];

export default function ItemsScreen({
  session,
  initialBatchItemId,
  onClearInitialBatchItem,
  onToast,
}) {
  const isAdmin = session.user.role === 'admin';

  // Filter, sort & pagination state
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [lowStockFilter, setLowStockFilter] = useState('');
  const [sortOption, setSortOption] = useState('name:asc');
  const [page, setPage] = useState(1);
  const limit = 10;

  // Data state
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create/Edit modal state
  const [modalMode, setModalMode] = useState(null); // null | 'create' | 'edit'
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete/Archive confirm modal state
  const [confirmItem, setConfirmItem] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Batch detail modal state
  const [batchItemId, setBatchItemId] = useState(initialBatchItemId ?? null);
  const [onlyRemaining, setOnlyRemaining] = useState(false);
  const [batchData, setBatchData] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
      setPage(1);
    }, 280);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (initialBatchItemId) {
      setBatchItemId(initialBatchItemId);
      onClearInitialBatchItem?.();
    }
  }, [initialBatchItemId, onClearInitialBatchItem]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    const [sortBy, sortOrder] = sortOption.split(':');
    try {
      const response = await getItems({
        q: debouncedQuery,
        status: statusFilter,
        lowStock: lowStockFilter,
        sortBy,
        sortOrder,
        page,
        limit,
      });
      setItems(response.data ?? []);
      setMeta(response.meta ?? { page, limit, total: 0, totalPages: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(
        err instanceof NetworkError
          ? 'Tidak dapat terhubung ke server. Pastikan backend berjalan di port 3000.'
          : 'Gagal memuat daftar barang.',
      );
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, statusFilter, lowStockFilter, sortOption, page, limit]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const loadBatches = useCallback(async (id, remainingOnly) => {
    if (!id) return;
    setBatchLoading(true);
    setBatchError('');
    try {
      const result = await getItemBatches(id, { onlyRemaining: remainingOnly ? 'true' : 'false' });
      setBatchData(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setBatchError(
        err instanceof NetworkError
          ? 'Tidak dapat terhubung ke server.'
          : 'Gagal memuat daftar batch barang ini.',
      );
    } finally {
      setBatchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (batchItemId) {
      loadBatches(batchItemId, onlyRemaining);
    } else {
      setBatchData(null);
      setBatchError('');
    }
  }, [batchItemId, onlyRemaining, loadBatches]);

  function openCreateModal() {
    setModalMode('create');
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError('');
  }

  function openEditModal(item) {
    setModalMode('edit');
    setEditingItem(item);
    setForm({
      code: item.code ?? '',
      name: item.name ?? '',
      baseUnit: item.baseUnit ?? '',
      minimumStock: item.minimumStock ?? '0',
      quantityScale: item.quantityScale ?? 0,
    });
    setFieldErrors({});
    setFormError('');
  }

  function closeFormModal() {
    if (saving) return;
    setModalMode(null);
    setEditingItem(null);
  }

  function updateFormField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setFormError('');
  }

  async function handleSaveItem(event) {
    event.preventDefault();
    if (saving) return;

    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      baseUnit: form.baseUnit.trim(),
      minimumStock: String(form.minimumStock).trim(),
      quantityScale: Number(form.quantityScale),
    };

    setSaving(true);
    setFieldErrors({});
    setFormError('');

    try {
      if (modalMode === 'create') {
        const created = await createItem(payload);
        onToast({
          type: 'success',
          title: 'Barang ditambahkan',
          message: `${created.name} (${created.code}) berhasil disimpan.`,
        });
      } else if (editingItem) {
        const updated = await updateItem(editingItem.id, payload);
        onToast({
          type: 'success',
          title: 'Barang diperbarui',
          message: `${updated.name} (${updated.code}) berhasil diperbarui.`,
        });
      }
      setModalMode(null);
      setEditingItem(null);
      await loadItems();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (err instanceof NetworkError) {
        setFormError('Tidak dapat terhubung ke server.');
      } else if (err instanceof ApiError) {
        if (err.fields) setFieldErrors(err.fields);
        if (err.code === 'ITEM_CODE_EXISTS') {
          setFormError('Kode barang sudah digunakan oleh barang lain.');
        } else if (err.status === 403) {
          setFormError('Hanya admin yang dapat mengelola data barang.');
        } else if (!err.fields) {
          setFormError('Gagal menyimpan data barang.');
        }
      } else {
        setFormError('Terjadi kesalahan tak terduga.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteOrArchive() {
    if (!confirmItem || deleting) return;
    setDeleting(true);
    try {
      const result = await deleteItem(confirmItem.id);
      if (result.action === 'DELETED') {
        onToast({
          type: 'success',
          title: 'Barang dihapus permanen',
          message: `${confirmItem.name} tidak memiliki riwayat stok dan berhasil dihapus.`,
        });
      } else {
        onToast({
          type: 'info',
          title: 'Barang diarsipkan',
          message: `${confirmItem.name} memiliki riwayat transaksi sehingga diarsipkan (nonaktif).`,
        });
      }
      setConfirmItem(null);
      await loadItems();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (err instanceof ApiError && err.code === 'ITEM_HAS_STOCK') {
        onToast({
          type: 'error',
          title: 'Tidak dapat diarsipkan',
          message: `${confirmItem.name} masih memiliki stok fisik (${confirmItem.physicalStock} ${confirmItem.baseUnit}). Nolkan stok terlebih dahulu.`,
        });
      } else {
        onToast({
          type: 'error',
          title: 'Aksi gagal',
          message: err instanceof NetworkError
            ? 'Koneksi ke server terputus.'
            : 'Gagal menghapus atau mengarsipkan barang.',
        });
      }
      setConfirmItem(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleReactivate(item) {
    try {
      await updateItem(item.id, { isActive: true });
      onToast({
        type: 'success',
        title: 'Barang diaktifkan kembali',
        message: `${item.name} kembali aktif untuk operasional stok.`,
      });
      await loadItems();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      onToast({
        type: 'error',
        title: 'Gagal mengaktifkan',
        message: 'Tidak dapat mengaktifkan barang saat ini.',
      });
    }
  }

  return (
    <div className="page-container">
      <div className="page-heading">
        <div>
          <h1>Barang &amp; batch</h1>
          <p className="lede">
            Cari barang, pantau stok layak dan fisik, lalu periksa detail batch.
          </p>
        </div>

        {isAdmin && (
          <div className="heading-actions">
            <button type="button" className="btn-primary" onClick={openCreateModal}>
              <Icon name="plus" size={16} />
              Tambah Barang
            </button>
          </div>
        )}
      </div>

      {/* Filter & Search Toolbar */}
      <section className="card toolbar-card" aria-label="Pencarian dan filter barang">
        <div className="toolbar-grid">
          <div className="field toolbar-search">
            <label htmlFor="items-search">Cari nama atau kode</label>
            <input
              id="items-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Contoh: Susu Kotak atau SUSU-01"
            />
          </div>

          <div className="field">
            <label htmlFor="items-status">Status</label>
            <select
              id="items-status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Semua status</option>
              <option value="active">Aktif</option>
              <option value="archived">Diarsipkan</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="items-lowstock">Kondisi Stok</label>
            <select
              id="items-lowstock"
              value={lowStockFilter}
              onChange={(event) => {
                setLowStockFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Semua kondisi</option>
              <option value="true">Stok menipis saja</option>
              <option value="false">Stok aman</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="items-sort">Urutkan</label>
            <select
              id="items-sort"
              value={sortOption}
              onChange={(event) => {
                setSortOption(event.target.value);
                setPage(1);
              }}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {error && (
        <div className="form-alert" role="alert">
          {error}
        </div>
      )}

      {/* Items Table */}
      <section className="card panel-card table-card">
        {loading ? (
          <div className="loading-panel" role="status">
            <span className="spinner spinner--dark" aria-hidden="true" />
            <span>Memuat daftar barang…</span>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <strong>Belum ada barang yang cocok.</strong>
            <p>Coba ubah kata kunci pencarian atau filter, atau tambahkan barang baru.</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Nama Barang</th>
                    <th>Satuan</th>
                    <th>Stok Layak</th>
                    <th>Stok Fisik</th>
                    <th>Min. Stok</th>
                    <th>Status</th>
                    <th className="col-actions">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={!item.isActive ? 'row-muted' : undefined}
                    >
                      <td className="mono">{item.code}</td>
                      <td>
                        <strong>{item.name}</strong>
                        {item.quantityScale > 0 && (
                          <span className="sub-cell">Desimal {item.quantityScale} digit</span>
                        )}
                      </td>
                      <td>{item.baseUnit}</td>
                      <td>
                        <strong>{item.usableStock}</strong> {item.baseUnit}
                      </td>
                      <td>{item.physicalStock} {item.baseUnit}</td>
                      <td>{item.minimumStock} {item.baseUnit}</td>
                      <td>
                        <div className="badge-group">
                          {item.isActive ? (
                            <span className="badge badge--success">Aktif</span>
                          ) : (
                            <span className="badge badge--muted">Arsip</span>
                          )}
                          {item.isLowStock && (
                            <span className="badge badge--warning">Menipis</span>
                          )}
                        </div>
                      </td>
                      <td className="col-actions">
                        <div className="action-row">
                          <button
                            type="button"
                            className="btn-table"
                            aria-label={`Lihat batch ${item.name}`}
                            onClick={() => {
                              setOnlyRemaining(false);
                              setBatchItemId(item.id);
                            }}
                          >
                            Batch
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                className="btn-table"
                                aria-label={`Ubah ${item.name}`}
                                onClick={() => openEditModal(item)}
                              >
                                Ubah
                              </button>
                              {item.isActive ? (
                                <button
                                  type="button"
                                  className="btn-table btn-table--danger"
                                  aria-label={`Hapus atau arsipkan ${item.name}`}
                                  onClick={() => setConfirmItem(item)}
                                >
                                  Hapus / Arsip
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-table"
                                  aria-label={`Aktifkan ${item.name}`}
                                  onClick={() => handleReactivate(item)}
                                >
                                  Aktifkan
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination-bar">
              <p className="pagination-info">
                Total <strong>{meta.total}</strong> barang · Halaman{' '}
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

      {/* Modal Tambah / Ubah Barang (Admin) */}
      {modalMode && (
        <div className="modal-backdrop" role="presentation" onClick={closeFormModal}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="item-modal-title">
                  {modalMode === 'create' ? 'Tambah Barang Baru' : `Ubah ${editingItem?.name}`}
                </h2>
                <p className="modal-subtitle">
                  Lengkapi kode, satuan, dan batas stok minimum barang.
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={closeFormModal}
                aria-label="Tutup dialog"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {formError && <div className="form-alert" role="alert">{formError}</div>}

            <form className="modal-form" onSubmit={handleSaveItem} noValidate>
              <div className="field">
                <label htmlFor="item-code">Kode Barang</label>
                <input
                  id="item-code"
                  type="text"
                  value={form.code}
                  onChange={(event) => updateFormField('code', event.target.value)}
                  placeholder="Contoh: SUSU-KOTAK"
                  aria-invalid={Boolean(fieldErrors.code)}
                />
                {fieldErrors.code && <p className="field-error">{fieldErrors.code}</p>}
              </div>

              <div className="field">
                <label htmlFor="item-unit">Satuan Dasar</label>
                <input
                  id="item-unit"
                  type="text"
                  value={form.baseUnit}
                  onChange={(event) => updateFormField('baseUnit', event.target.value)}
                  placeholder="kotak, kg, liter, bungkus"
                  aria-invalid={Boolean(fieldErrors.baseUnit)}
                />
                {fieldErrors.baseUnit && <p className="field-error">{fieldErrors.baseUnit}</p>}
              </div>

              <div className="field field--full">
                <label htmlFor="item-name">Nama Barang</label>
                <input
                  id="item-name"
                  type="text"
                  value={form.name}
                  onChange={(event) => updateFormField('name', event.target.value)}
                  placeholder="Contoh: Susu Kotak Full Cream 250ml"
                  aria-invalid={Boolean(fieldErrors.name)}
                />
                {fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}
              </div>

              <div className="field">
                <label htmlFor="item-min">Batas Stok Minimum</label>
                <input
                  id="item-min"
                  type="number"
                  min="0"
                  step="any"
                  value={form.minimumStock}
                  onChange={(event) => updateFormField('minimumStock', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.minimumStock)}
                />
                {fieldErrors.minimumStock && <p className="field-error">{fieldErrors.minimumStock}</p>}
              </div>

              <div className="field">
                <label htmlFor="item-scale">Ketelitian Satuan</label>
                <select
                  id="item-scale"
                  value={form.quantityScale}
                  onChange={(event) => updateFormField('quantityScale', Number(event.target.value))}
                >
                  <option value={0}>0 — Bilangan bulat (kotak, pcs)</option>
                  <option value={1}>1 — 1 angka desimal (0.5)</option>
                  <option value={2}>2 — 2 angka desimal (0.25 kg)</option>
                  <option value={3}>3 — 3 angka desimal (0.125 kg)</option>
                </select>
                {fieldErrors.quantityScale && <p className="field-error">{fieldErrors.quantityScale}</p>}
              </div>

              <div className="modal-actions field--full">
                <button type="button" className="btn-secondary" onClick={closeFormModal} disabled={saving}>
                  Batal
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving && <span className="spinner" aria-hidden="true" />}
                  {saving ? 'Menyimpan…' : modalMode === 'create' ? 'Simpan Barang' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus / Arsip (Admin) */}
      {confirmItem && (
        <div className="modal-backdrop" role="presentation" onClick={() => !deleting && setConfirmItem(null)}>
          <div
            className="modal-card modal-card--sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="confirm-delete-title">Hapus atau Arsipkan Barang?</h2>
                <p className="modal-subtitle">Tindakan mengikuti riwayat stok barang ini.</p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => !deleting && setConfirmItem(null)}
                aria-label="Tutup dialog"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <p className="modal-copy">
              Anda akan menghapus <strong>{confirmItem.name}</strong> (<code>{confirmItem.code}</code>).
            </p>
            <ul className="modal-rules">
              <li>Jika barang <strong>belum memiliki riwayat stok</strong>, data akan dihapus permanen.</li>
              <li>Jika <strong>sudah memiliki riwayat</strong> dan stok fisik = 0, barang akan diarsipkan.</li>
              <li>Jika <strong>stok fisik masih tersisa ({confirmItem.physicalStock} {confirmItem.baseUnit})</strong>, aksi akan ditolak sistem.</li>
            </ul>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmItem(null)}
                disabled={deleting}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleDeleteOrArchive}
                disabled={deleting}
              >
                {deleting && <span className="spinner" aria-hidden="true" />}
                {deleting ? 'Memproses…' : 'Lanjutkan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Detail Batch Barang */}
      {batchItemId && (
        <div className="modal-backdrop" role="presentation" onClick={() => setBatchItemId(null)}>
          <div
            className="modal-card modal-card--lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="batch-modal-title">
                  {batchData?.item ? `${batchData.item.name} (${batchData.item.code})` : 'Daftar Batch Barang'}
                </h2>
                <p className="modal-subtitle">Batch diurutkan sesuai aturan FEFO.</p>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setBatchItemId(null)}
                aria-label="Tutup detail batch"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {batchData?.item && (
              <div className="batch-summary-strip">
                <div>
                  <span>Stok Layak</span>
                  <strong>{batchData.item.usableStock} {batchData.item.baseUnit}</strong>
                </div>
                <div>
                  <span>Stok Fisik</span>
                  <strong>{batchData.item.physicalStock} {batchData.item.baseUnit}</strong>
                </div>
                <div>
                  <span>Stok Minimum</span>
                  <strong>{batchData.item.minimumStock} {batchData.item.baseUnit}</strong>
                </div>
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={onlyRemaining}
                    onChange={(event) => setOnlyRemaining(event.target.checked)}
                  />
                  <span>Hanya yang bersisa</span>
                </label>
              </div>
            )}

            {batchError && <div className="form-alert" role="alert">{batchError}</div>}

            {batchLoading ? (
              <div className="loading-panel" role="status">
                <span className="spinner spinner--dark" aria-hidden="true" />
                <span>Memuat daftar batch…</span>
              </div>
            ) : (batchData?.batches?.length ?? 0) === 0 ? (
              <div className="empty-state">
                <strong>Belum ada batch untuk barang ini.</strong>
                <p>Catat penerimaan di menu Stok Masuk untuk menambahkan batch baru.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Kode Batch</th>
                      <th>Tgl Masuk</th>
                      <th>Kedaluwarsa</th>
                      <th>Awal</th>
                      <th>Sisa</th>
                      {isAdmin && <th>Harga Beli</th>}
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchData.batches.map((batch) => {
                      const statusMeta = getBatchStatusMeta(batch.status);
                      return (
                        <tr
                          key={batch.id}
                          className={batch.status === 'HABIS' ? 'row-muted' : undefined}
                        >
                          <td className="mono">{batch.batchCode}</td>
                          <td>{formatDateId(batch.receivedOn)}</td>
                          <td><strong>{formatDateId(batch.expiresOn)}</strong></td>
                          <td>{batch.initialQuantity} {batchData.item.baseUnit}</td>
                          <td><strong>{batch.remainingQuantity}</strong> {batchData.item.baseUnit}</td>
                          {isAdmin && <td>{formatRupiah(batch.unitCost)}</td>}
                          <td>
                            <span className={`badge badge--${statusMeta.tone}`}>
                              {statusMeta.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
