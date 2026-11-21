import { useEffect, useState } from 'react';
import { getRoleLabel } from '../format.js';
import Icon from './Icon.jsx';

export const NAV_GROUPS = [
  {
    label: 'Operasional',
    items: [
      { path: '/dashboard', label: 'Dashboard', shortLabel: 'Beranda', icon: 'dashboard' },
      { path: '/items', label: 'Barang & Batch', shortLabel: 'Barang', icon: 'items' },
      { path: '/receipts', label: 'Stok Masuk', shortLabel: 'Masuk', icon: 'receipts' },
      { path: '/usages', label: 'Pemakaian FEFO', shortLabel: 'FEFO', icon: 'usages' },
      { path: '/disposals', label: 'Pembuangan', shortLabel: 'Buang', icon: 'disposals' },
      { path: '/transactions', label: 'Riwayat Stok', shortLabel: 'Riwayat', icon: 'transactions' },
    ],
  },
  {
    label: 'Administrasi',
    adminOnly: true,
    items: [
      { path: '/users', label: 'Akun Petugas', shortLabel: 'Petugas', icon: 'users', adminOnly: true },
      { path: '/reports/disposals', label: 'Laporan Biaya', shortLabel: 'Laporan', icon: 'reports', adminOnly: true },
    ],
  },
];

export default function AppShell({ session, currentPath, onNavigate, onLogout, children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isAdmin = session.user.role === 'admin';
  const roleLabel = getRoleLabel(session.user.role);
  const initials = (session.user.name ?? roleLabel)
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'KF';

  const visibleGroups = NAV_GROUPS.filter((group) => !group.adminOnly || isAdmin).map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.adminOnly || isAdmin),
  }));

  const activeLabel = visibleGroups
    .flatMap((group) => group.items)
    .find((item) => item.path === currentPath)?.label ?? 'Dashboard';

  const mobileTabs = [
    { path: '/dashboard', label: 'Beranda', icon: 'dashboard' },
    { path: '/items', label: 'Barang', icon: 'items' },
    { path: '/receipts', label: 'Masuk', icon: 'receipts' },
    isAdmin
      ? { path: '/users', label: 'Petugas', icon: 'users' }
      : { path: '/usages', label: 'FEFO', icon: 'usages' },
  ];

  useEffect(() => {
    if (!drawerOpen) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') setDrawerOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  function handleSelect(path) {
    setDrawerOpen(false);
    onNavigate(path);
  }

  return (
    <div className="shell-layout">
      <a className="skip-link" href="#main-content">Lewati ke konten</a>

      {drawerOpen && (
        <div
          className="drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`shell-sidebar${drawerOpen ? ' shell-sidebar--open' : ''}`}
        aria-label="Navigasi utama"
      >
        <div className="sidebar-top">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">KF</span>
            <span className="brand-name">KantinFlow <em>SIM</em></span>
          </div>
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Tutup menu"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {visibleGroups.map((group) => (
            <div key={group.label} className="nav-group">
              <p className="nav-group-label">{group.label}</p>
              <ul>
                {group.items.map((item) => {
                  const active = currentPath === item.path;
                  return (
                    <li key={item.path}>
                      <button
                        type="button"
                        className={`nav-link${active ? ' nav-link--active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => handleSelect(item.path)}
                      >
                        <Icon name={item.icon} size={18} />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="user-avatar" aria-hidden="true">{initials}</span>
            <div className="sidebar-user-meta">
              <span className="sidebar-user-role">{roleLabel}</span>
              <strong>{session.user.name ?? roleLabel}</strong>
              <span className="sidebar-user-email">{session.user.email}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn-sidebar-logout"
            onClick={() => onLogout('Anda sudah keluar.')}
          >
            <Icon name="logout" size={16} />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      <div className="shell-body">
        <header className="shell-topbar">
          <button
            type="button"
            className="topbar-menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Buka menu navigasi"
            aria-expanded={drawerOpen}
          >
            <Icon name="menu" size={20} />
          </button>

          <div className="topbar-context">
            <span className="topbar-app">KantinFlow</span>
            <span className="topbar-sep" aria-hidden="true">/</span>
            <strong>{activeLabel}</strong>
          </div>

          <div className="topbar-right">
            <span className={`role-pill role-pill--${isAdmin ? 'admin' : 'petugas'}`}>
              {roleLabel}
            </span>
            <span className="topbar-avatar" aria-hidden="true">{initials}</span>
          </div>
        </header>

        <main className="shell-content" id="main-content" tabIndex={-1}>
          {children}
        </main>

        <footer className="app-footer">
          KantinFlow SIM · Sistem Informasi Pengelolaan Stok &amp; Kedaluwarsa Kantin
        </footer>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Navigasi cepat mobile">
        {mobileTabs.map((tab) => {
          const active = currentPath === tab.path;
          return (
            <button
              key={tab.path}
              type="button"
              className={`bottom-nav-btn${active ? ' bottom-nav-btn--active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => handleSelect(tab.path)}
            >
              <Icon name={tab.icon} size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="bottom-nav-btn"
          onClick={() => setDrawerOpen(true)}
        >
          <Icon name="more" size={18} />
          <span>Menu</span>
        </button>
      </nav>
    </div>
  );
}
