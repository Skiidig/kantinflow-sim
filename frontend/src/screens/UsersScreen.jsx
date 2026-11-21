import { useCallback, useEffect, useState } from 'react';
import { ApiError, NetworkError, createUser, getUsers, updateUser } from '../api.js';
import { formatDateTimeId, getRoleLabel } from '../format.js';

const INITIAL_FORM = {
  name: '',
  email: '',
  password: '',
  role: 'petugas',
};

export default function UsersScreen({ session, onToast }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [form, setForm] = useState(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getUsers({
        role: roleFilter,
        q: searchInput.trim(),
      });
      setUsers(data ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(
        err instanceof NetworkError
          ? 'Tidak dapat terhubung ke server.'
          : err instanceof ApiError && err.status === 403
            ? 'Halaman ini hanya dapat diakses oleh Admin.'
            : 'Gagal memuat daftar akun pengguna.',
      );
    } finally {
      setLoading(false);
    }
  }, [roleFilter, searchInput]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers();
    }, 200);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  function updateField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setFormError('');
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFieldErrors({});
    setFormError('');

    try {
      const created = await createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
      });
      setForm(INITIAL_FORM);
      onToast({
        type: 'success',
        title: 'Akun berhasil dibuat',
        message: `${created.name} (${created.email}) siap digunakan untuk login.`,
      });
      await loadUsers();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (err instanceof NetworkError) {
        setFormError('Tidak dapat terhubung ke server.');
      } else if (err instanceof ApiError) {
        if (err.fields) setFieldErrors(err.fields);
        if (err.code === 'EMAIL_EXISTS') {
          setFormError('Email tersebut sudah terdaftar.');
        } else if (!err.fields) {
          setFormError('Gagal membuat akun baru.');
        }
      } else {
        setFormError('Terjadi kesalahan tak terduga.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(user) {
    if (togglingId) return;
    setTogglingId(user.id);
    try {
      const updated = await updateUser(user.id, { isActive: !user.isActive });
      onToast({
        type: 'success',
        title: updated.isActive ? 'Akun diaktifkan' : 'Akun dinonaktifkan',
        message: `${updated.name} kini berstatus ${updated.isActive ? 'Aktif' : 'Nonaktif'}.`,
      });
      await loadUsers();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      onToast({
        type: 'error',
        title: 'Gagal mengubah status',
        message: err instanceof ApiError && err.code === 'CANNOT_DEACTIVATE_SELF'
          ? 'Anda tidak dapat menonaktifkan akun Anda sendiri.'
          : 'Gagal memperbarui status akun.',
      });
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="page-container">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administrasi pengguna (FR-001)</p>
          <h1>Manajemen Akun Petugas</h1>
          <p className="lede">
            Buat akun petugas kantin baru dan kelola status akses aktif tanpa mengubah data riwayat.
          </p>
        </div>
      </div>

      <div className="split-grid">
        {/* Form Tambah Petugas */}
        <section className="card form-card" aria-labelledby="create-user-title">
          <div className="card-heading">
            <div>
              <h2 id="create-user-title">Tambah Akun Baru</h2>
              <p>Password otomatis dienkripsi dengan Bcrypt di server.</p>
            </div>
            <span className="card-step" aria-hidden="true">+</span>
          </div>

          {formError && <div className="form-alert" role="alert">{formError}</div>}

          <form className="stack-form" onSubmit={handleCreateUser} noValidate>
            <div className="field">
              <label htmlFor="user-name">Nama Lengkap</label>
              <input
                id="user-name"
                type="text"
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                placeholder="Contoh: Siti Rahayu"
                aria-invalid={Boolean(fieldErrors.name)}
              />
              {fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}
            </div>

            <div className="field">
              <label htmlFor="user-email">Email</label>
              <input
                id="user-email"
                type="email"
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
                placeholder="petugas@kantinflow.local"
                aria-invalid={Boolean(fieldErrors.email)}
              />
              {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
            </div>

            <div className="field">
              <label htmlFor="user-password">Password Awal</label>
              <input
                id="user-password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(event) => updateField('password', event.target.value)}
                placeholder="Minimal 6 karakter"
                aria-invalid={Boolean(fieldErrors.password)}
              />
              {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
            </div>

            <div className="field">
              <label htmlFor="user-role">Peran</label>
              <select
                id="user-role"
                value={form.role}
                onChange={(event) => updateField('role', event.target.value)}
              >
                <option value="petugas">Petugas (Operasional Stok)</option>
                <option value="admin">Admin (Akses Penuh)</option>
              </select>
              {fieldErrors.role && <p className="field-error">{fieldErrors.role}</p>}
            </div>

            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting && <span className="spinner" aria-hidden="true" />}
              {submitting ? 'Membuat akun…' : 'Buat Akun'}
            </button>
          </form>
        </section>

        {/* Daftar Akun */}
        <section className="card panel-card">
          <div className="panel-header panel-header--wrap">
            <div>
              <h2>Daftar Akun ({users.length})</h2>
              <p>Akun nonaktif otomatis ditolak saat mencoba login.</p>
            </div>
            <div className="inline-filters">
              <input
                type="search"
                className="compact-input"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Cari nama/email…"
                aria-label="Cari akun pengguna"
              />
              <select
                className="compact-select"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                aria-label="Filter peran pengguna"
              >
                <option value="">Semua peran</option>
                <option value="petugas">Petugas</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          {error && <div className="form-alert" role="alert">{error}</div>}

          {loading ? (
            <div className="loading-panel" role="status">
              <span className="spinner spinner--dark" aria-hidden="true" />
              <span>Memuat daftar akun…</span>
            </div>
          ) : users.length === 0 ? (
            <div className="empty-state">
              <strong>Tidak ada akun ditemukan.</strong>
              <p>Tambahkan akun petugas baru melalui formulir di samping.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pengguna</th>
                    <th>Peran</th>
                    <th>Status</th>
                    <th>Dibuat</th>
                    <th className="col-actions">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const isSelf = user.id === session.user.id;
                    return (
                      <tr key={user.id} className={!user.isActive ? 'row-muted' : undefined}>
                        <td>
                          <strong>{user.name ?? 'Tanpa nama'}</strong>
                          <span className="sub-cell">{user.email}</span>
                        </td>
                        <td>
                          <span className={`badge badge--${user.role === 'admin' ? 'forest' : 'info'}`}>
                            {getRoleLabel(user.role)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge badge--${user.isActive ? 'success' : 'muted'}`}>
                            {user.isActive ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td>{formatDateTimeId(user.createdAt)}</td>
                        <td className="col-actions">
                          <button
                            type="button"
                            className={`btn-table${user.isActive ? ' btn-table--danger' : ''}`}
                            disabled={isSelf || togglingId === user.id}
                            title={isSelf ? 'Tidak dapat menonaktifkan akun sendiri' : undefined}
                            onClick={() => handleToggleActive(user)}
                          >
                            {togglingId === user.id
                              ? '…'
                              : isSelf
                                ? 'Akun Anda'
                                : user.isActive
                                  ? 'Nonaktifkan'
                                  : 'Aktifkan'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
