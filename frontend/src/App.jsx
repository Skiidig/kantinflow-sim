import { useCallback, useEffect, useRef, useState } from 'react';
import { setAuthToken, setUnauthorizedHandler } from './api.js';
import AppShell from './components/AppShell.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import DashboardScreen from './screens/DashboardScreen.jsx';
import ItemsScreen from './screens/ItemsScreen.jsx';
import LoginScreen from './screens/LoginScreen.jsx';
import ReceiptScreen from './screens/ReceiptScreen.jsx';
import UsersScreen from './screens/UsersScreen.jsx';

const SESSION_KEY = 'kantinflow.session';
const VALID_PATHS = new Set([
  '/dashboard',
  '/items',
  '/receipts',
  '/usages',
  '/disposals',
  '/transactions',
  '/users',
  '/reports/disposals',
]);
const ADMIN_ONLY_PATHS = new Set(['/users', '/reports/disposals']);

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/dashboard';
  const clean = pathname.replace(/\/+$/u, '') || '/dashboard';
  return VALID_PATHS.has(clean) ? clean : '/dashboard';
}

function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (typeof session?.token === 'string' && session.user) return session;
  } catch {
    // Session yang rusak diperlakukan seperti belum masuk.
  }
  return null;
}

function ComingSoonScreen({ eyebrow, title, description, onBack }) {
  return (
    <div className="page-container">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="lede">{description}</p>
        </div>
      </div>
      <section className="card panel-card">
        <div className="empty-state">
          <strong>Endpoint API sudah aktif — antarmuka sedang disiapkan pada tahap berikutnya.</strong>
          <p>Layar ini dijadwalkan pada Issue #18 / #19 setelah modul dasar selesai.</p>
          <button type="button" className="btn-secondary" onClick={onBack}>
            Kembali ke Dashboard
          </button>
        </div>
      </section>
    </div>
  );
}

function ForbiddenScreen({ onBack }) {
  return (
    <div className="page-container">
      <section className="card panel-card">
        <div className="empty-state">
          <span className="badge badge--danger">403 · Akses Terbatas</span>
          <strong>Halaman ini hanya tersedia untuk peran Admin.</strong>
          <p>Akun petugas hanya dapat mengakses menu operasional stok dan pemantauan.</p>
          <button type="button" className="btn-primary" onClick={onBack}>
            Kembali ke Dashboard
          </button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(() => {
    const initial = readSession();
    setAuthToken(initial?.token ?? null);
    return initial;
  });
  const [loginNotice, setLoginNotice] = useState('');
  const [currentPath, setCurrentPath] = useState(() => normalizePath(window.location.pathname));
  const [pendingBatchItemId, setPendingBatchItemId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastSeqRef = useRef(0);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(({ type = 'info', title = '', message }) => {
    const id = ++toastSeqRef.current;
    setToasts((prev) => [...prev.slice(-3), { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4500);
  }, []);

  const navigate = useCallback((nextPath) => {
    const normalized = normalizePath(nextPath);
    if (window.location.pathname !== normalized) {
      window.history.pushState({}, '', normalized);
    }
    setCurrentPath(normalized);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const handleLogout = useCallback((message = '') => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Tidak ada yang perlu dibersihkan bila storage tidak tersedia.
    }
    setAuthToken(null);
    setLoginNotice(message);
    setSession(null);
  }, []);

  useEffect(() => {
    setAuthToken(session?.token ?? null);
  }, [session]);

  useEffect(() => {
    setUnauthorizedHandler((message) => {
      handleLogout(message);
    });
    return () => setUnauthorizedHandler(null);
  }, [handleLogout]);

  useEffect(() => {
    function handlePopState() {
      setCurrentPath(normalizePath(window.location.pathname));
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function handleLogin(data) {
    const next = { token: data.token, user: data.user };
    setAuthToken(next.token);
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    } catch {
      // Simpan di memori saja bila sessionStorage tidak tersedia.
    }
    setLoginNotice('');
    setSession(next);
    navigate('/dashboard');
    pushToast({
      type: 'success',
      title: 'Berhasil masuk',
      message: `Selamat datang, ${next.user.name ?? next.user.email}.`,
    });
  }

  function handleOpenItemBatches(itemId) {
    setPendingBatchItemId(itemId);
    navigate('/items');
  }

  if (!session) {
    return (
      <>
        <LoginScreen onLogin={handleLogin} notice={loginNotice} />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const isAdmin = session.user.role === 'admin';
  const isForbidden = ADMIN_ONLY_PATHS.has(currentPath) && !isAdmin;

  let screen = null;
  if (isForbidden) {
    screen = <ForbiddenScreen onBack={() => navigate('/dashboard')} />;
  } else {
    switch (currentPath) {
      case '/dashboard':
        screen = (
          <DashboardScreen
            session={session}
            onNavigate={navigate}
            onOpenItemBatches={handleOpenItemBatches}
            onToast={pushToast}
          />
        );
        break;
      case '/items':
        screen = (
          <ItemsScreen
            session={session}
            initialBatchItemId={pendingBatchItemId}
            onClearInitialBatchItem={() => setPendingBatchItemId(null)}
            onToast={pushToast}
          />
        );
        break;
      case '/receipts':
        screen = <ReceiptScreen session={session} onLogout={handleLogout} onToast={pushToast} />;
        break;
      case '/users':
        screen = <UsersScreen session={session} onToast={pushToast} />;
        break;
      case '/usages':
        screen = (
          <ComingSoonScreen
            eyebrow="FR-006 · Pemakaian FEFO"
            title="Pemakaian Stok (FEFO)"
            description="Pemotongan otomatis dari batch layak dengan tanggal kedaluwarsa terdekat."
            onBack={() => navigate('/dashboard')}
          />
        );
        break;
      case '/disposals':
        screen = (
          <ComingSoonScreen
            eyebrow="FR-007 · Pembuangan Stok"
            title="Pembuangan Stok per Batch"
            description="Pencatatan jumlah dan alasan pembuangan barang kedaluwarsa atau rusak."
            onBack={() => navigate('/dashboard')}
          />
        );
        break;
      case '/transactions':
        screen = (
          <ComingSoonScreen
            eyebrow="FR-005 · Audit & Riwayat"
            title="Riwayat Transaksi Stok"
            description="Catatan kronologis seluruh penerimaan, pemakaian FEFO, dan pembuangan."
            onBack={() => navigate('/dashboard')}
          />
        );
        break;
      case '/reports/disposals':
        screen = (
          <ComingSoonScreen
            eyebrow="FR-007 · Laporan Admin"
            title="Laporan Biaya Barang Terbuang"
            description="Ringkasan total kuantitas dan biaya barang terbuang berdasarkan harga beli batch."
            onBack={() => navigate('/dashboard')}
          />
        );
        break;
      default:
        screen = (
          <DashboardScreen
            session={session}
            onNavigate={navigate}
            onOpenItemBatches={handleOpenItemBatches}
            onToast={pushToast}
          />
        );
    }
  }

  return (
    <>
      <AppShell
        session={session}
        currentPath={currentPath}
        onNavigate={navigate}
        onLogout={handleLogout}
      >
        {screen}
      </AppShell>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
