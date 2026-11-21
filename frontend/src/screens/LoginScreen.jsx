import { useState } from 'react';
import { ApiError, NetworkError, login } from '../api.js';

export default function LoginScreen({ onLogin, notice }) {
  const [email, setEmail] = useState(import.meta.env.VITE_DEMO_EMAIL ?? '');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function clearFieldError(name) {
    setFieldErrors((previous) => {
      if (!previous[name]) return previous;
      const next = { ...previous };
      delete next[name];
      return next;
    });
    setFormError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = {};
    if (!email.trim()) nextErrors.email = 'Email wajib diisi';
    if (!password) nextErrors.password = 'Password wajib diisi';
    setFieldErrors(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      const data = await login(email.trim(), password);
      onLogin(data);
    } catch (error) {
      if (error instanceof NetworkError) {
        setFormError('Tidak dapat terhubung ke server. Pastikan backend berjalan di port 3000.');
      } else if (error instanceof ApiError) {
        if (error.status === 401) {
          setFormError('Email atau password salah.');
        } else if (error.fields) {
          setFieldErrors(error.fields);
        } else {
          setFormError('Login belum berhasil. Periksa koneksi lalu coba lagi.');
        }
      } else {
        setFormError('Terjadi kesalahan tak terduga. Coba lagi.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-shell">
        <div className="brand-lockup login-brand-lockup">
          <span className="brand-mark" aria-hidden="true">KF</span>
          <span className="brand-name">KantinFlow <em>SIM</em></span>
        </div>

        <section className="login-card" aria-labelledby="login-title">
          <h1 id="login-title">Masuk ke KantinFlow</h1>
          <p className="lede">Gunakan akun admin atau petugas untuk mengelola stok kantin.</p>

          {notice && (
            <div className="notice notice--info" role="status">
              {notice}
            </div>
          )}
          {formError && (
            <div className="form-alert" role="alert">
              {formError}
            </div>
          )}

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearFieldError('email');
                }}
                placeholder="nama@kantinflow.local"
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              />
              {fieldErrors.email && (
                <p className="field-error" id="email-error">{fieldErrors.email}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearFieldError('password');
                }}
                placeholder="Masukkan password"
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
              />
              {fieldErrors.password && (
                <p className="field-error" id="password-error">{fieldErrors.password}</p>
              )}
            </div>

            <button className="btn-primary" type="submit" disabled={submitting}>
              {submitting && <span className="spinner" aria-hidden="true" />}
              {submitting ? 'Memeriksa…' : 'Masuk'}
            </button>
          </form>

          {import.meta.env.DEV && (
            <p className="dev-hint">
              Akun demo: <strong>{import.meta.env.VITE_DEMO_EMAIL || 'petugas@kantinflow.local'}</strong>.
              Password ada di <code>backend/.env</code>.
            </p>
          )}
        </section>

        <p className="login-foot">KantinFlow SIM · Pengelolaan stok &amp; kedaluwarsa kantin</p>
      </div>
    </main>
  );
}
