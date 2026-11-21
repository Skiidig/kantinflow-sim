import { useEffect, useState } from 'react';
import { getRoleLabel } from '../format.js';

function NavIcon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  switch (name) {
    case 'dashboard':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case 'items':
      return (
        <svg {...common}>
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </svg>
      );
    case 'receipts':
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M4 19h16" />
        </svg>
      );
    case 'usages':
      return (
        <svg {...common}>
          <path d="M12 19V7" />
          <path d="m7 12 5-5 5 5" />
          <path d="M4 5h16" />
        </svg>
      );
    case 'disposals':
      return (
        <svg {...common}>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      );
    case 'transactions':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'reports':
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="M7 15v2" />
          <path d="M12 11v6" />
          <path d="M17 7v10" />
        </svg>
      );
    default:
      return null;
  }
}

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
          <div className="brand-lockup brand-lockup--light">
            <span className="brand-mark" aria-hidden="true">KF</span>
            <span className="brand-name">KantinFlow <em>SIM</em></span>
          </div>
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Tutup menu"
          >
            ×
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
                        <NavIcon name={item.icon} />
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
              <strong>{session.user.name ?? roleLabel}</strong>
              <span>{roleLabel} · {session.user.email}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn-sidebar-logout"
            onClick={() => onLogout('Anda sudah keluar.')}
          >
            Keluar
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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="brand-lockup topbar-brand">
            <span className="brand-mark" aria-hidden="true">KF</span>
            <span className="brand-name">KantinFlow <em>SIM</em></span>
          </div>

          <div className="topbar-right">
            <span className={`role-pill role-pill--${isAdmin ? 'admin' : 'petugas'}`}>
              {roleLabel}
            </span>
          </div>
        </header>

        <main className="shell-content">
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
              <NavIcon name={tab.icon} />
              <span>{tab.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="bottom-nav-btn"
          onClick={() => setDrawerOpen(true)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
            <circle cx="5" cy="12" r="1.5" />
          </svg>
          <span>Menu</span>
        </button>
      </nav>
    </div>
  );
}
